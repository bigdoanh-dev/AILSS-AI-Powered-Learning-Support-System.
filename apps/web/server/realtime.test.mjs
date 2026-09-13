import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import WebSocket from "ws";
import { attachAiRealtime } from "./realtime.mjs";
const jobId = "11111111-1111-4111-8111-111111111111";
async function fixture(t) {
  const calls = [];
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const handler = async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
    if (req.headers.cookie !== "ailss=valid") {
      res.writeHead(401);
      res.end(JSON.stringify({ error: { code: "SESSION_EXPIRED" } }));
      return true;
    }
    if (req.url.includes("/jobs/") && !req.url.endsWith(jobId)) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
      return true;
    }
    res.writeHead(200);
    res.end(
      JSON.stringify({
        data: req.url.endsWith("bootstrap")
          ? { role: "LECTURER", lecturerVerified: true }
          : { jobId, state: "AI_DRAFT", version: 3 },
      }),
    );
    return true;
  };
  const close = attachAiRealtime(server, handler, origin);
  t.after(async () => {
    close();
    await new Promise((resolve) => server.close(resolve));
  });
  const open = (headers = {}) =>
    new WebSocket(origin.replace("http", "ws") + "/web-session/ai-live", {
      headers: { origin, cookie: "ailss=valid", ...headers },
    });
  return { open, calls };
}
test("authenticates before opening and rejects cross-origin connections", async (t) => {
  const { open } = await fixture(t);
  for (const headers of [{ origin: "https://foreign.invalid" }, { cookie: "ailss=expired" }]) {
    const ws = open(headers);
    const [error] = await once(ws, "error");
    assert.match(error.message, /403/);
  }
});
test("subscribes through ownership-checked HTTP boundary and creates with same idempotency key", async (t) => {
  const { open, calls } = await fixture(t),
    ws = open();
  const [ready] = await once(ws, "message");
  assert.equal(JSON.parse(ready).type, "ready");
  const updated = once(ws, "message");
  ws.send(JSON.stringify({ type: "subscribe", jobId }));
  const [frame] = await updated;
  assert.equal(JSON.parse(frame).data.state, "AI_DRAFT");
  const created = once(ws, "message");
  ws.send(JSON.stringify({ type: "create", key: jobId, body: { documentId: jobId } }));
  assert.equal(JSON.parse((await created)[0]).type, "created");
  assert.equal(calls.at(-1).headers["idempotency-key"], jobId);
  assert.equal(calls.at(-1).url, "/web-session/lecturer/ai/quiz-jobs");
  ws.close();
});
test("does not return another lecturer's job or accept arbitrary proxy paths", async (t) => {
  const { open } = await fixture(t),
    ws = open();
  await once(ws, "message");
  let next = once(ws, "message");
  ws.send(JSON.stringify({ type: "subscribe", jobId: "22222222-2222-4222-8222-222222222222" }));
  const frame = JSON.parse((await next)[0]);
  assert.equal(frame.status, 404);
  assert.equal(frame.data, undefined);
  next = once(ws, "message");
  ws.send(JSON.stringify({ type: "proxy", path: "/admin" }));
  assert.equal(JSON.parse((await next)[0]).type, "invalid");
  ws.close();
});
