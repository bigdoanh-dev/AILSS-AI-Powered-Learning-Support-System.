import { Readable } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";

// Reuse the HTTP session boundary: cookies, role checks, ownership, refresh and
// idempotency rules are identical for HTTP and WebSocket commands.
export async function sessionCall(handler, handshake, url, method = "GET", body, key) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.url = url;
  req.method = method;
  req.headers = {
    ...handshake.headers,
    "content-type": "application/json",
    ...(key ? { "idempotency-key": key } : {}),
  };
  let status = 503,
    value;
  await handler(req, {
    setHeader() {},
    writeHead(code) {
      status = code;
    },
    end(raw) {
      value = JSON.parse(raw);
    },
  });
  return { status, ...value };
}

export function attachAiRealtime(server, handler, origin) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384, perMessageDeflate: false });
  const counts = new Map();
  const upgrade = async (req, socket, head) => {
    if (req.url !== "/web-session/ai-live") return;
    const reject = (status) => {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
    };
    if (req.headers.origin !== new URL(origin).origin) return reject(403);
    const identity = req.headers.cookie;
    if (!identity || (counts.get(identity) || 0) >= 3) return reject(429);
    counts.set(identity, (counts.get(identity) || 0) + 1);
    const release = () => {
      const n = (counts.get(identity) || 1) - 1;
      if (n) counts.set(identity, n);
      else counts.delete(identity);
    };
    try {
      const auth = await sessionCall(handler, req, "/web-session/bootstrap");
      if (auth.status !== 200 || auth.data?.role !== "LECTURER" || !auth.data?.lecturerVerified) {
        release();
        return reject(403);
      }
      if (socket.destroyed) {
        release();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        let jobId = "",
          last = "",
          busy = false,
          ticks = 0,
          creating = false;
        const send = (v) => {
          if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 65536) ws.send(JSON.stringify(v));
        };
        const read = async () => {
          if (busy || ws.readyState !== WebSocket.OPEN) return;
          busy = true;
          try {
            const current = jobId;
            const url = current ? `/web-session/lecturer/ai/jobs/${current}` : "/web-session/bootstrap";
            const result = await sessionCall(handler, req, url);
            if ([401, 403].includes(result.status)) return ws.close(1008, "Session expired");
            if (current && current === jobId) {
              const serial = JSON.stringify(result);
              if (serial !== last) {
                send({ type: "job", ...result });
                last = serial;
              }
            }
            if (++ticks % 5 === 0) {
              const month = new Date().toISOString().slice(0, 7);
              const notices = await sessionCall(
                handler,
                req,
                `/web-session/notifications?month=${month}&limit=5`,
              );
              if (notices.status === 200) send({ type: "notifications", ...notices });
            }
          } finally {
            busy = false;
          }
        };
        const timer = setInterval(() => {
          void read().catch(() => send({ type: "unavailable" }));
        }, 2000);
        ws.on("message", async (raw, binary) => {
          try {
            if (binary) return ws.close(1003, "Text required");
            const message = JSON.parse(raw.toString());
            if (message.type === "subscribe" && /^[a-f0-9-]{36}$/i.test(message.jobId)) {
              jobId = message.jobId;
              last = "";
              await read();
            } else if (message.type === "create" && /^[a-f0-9-]{36}$/i.test(message.key) && !creating) {
              creating = true;
              try {
                const result = await sessionCall(
                  handler,
                  req,
                  "/web-session/lecturer/ai/quiz-jobs",
                  "POST",
                  message.body,
                  message.key,
                );
                send({ type: "created", key: message.key, ...result });
              } finally {
                creating = false;
              }
            } else send({ type: "invalid" });
          } catch {
            send({ type: "unavailable" });
          }
        });
        ws.on("error", () => ws.close());
        ws.once("close", () => {
          clearInterval(timer);
          release();
        });
        send({ type: "ready" });
      });
    } catch {
      release();
      reject(503);
    }
  };
  server.on("upgrade", upgrade);
  const close = () => {
    server.off("upgrade", upgrade);
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
  server.once("close", close);
  return close;
}
