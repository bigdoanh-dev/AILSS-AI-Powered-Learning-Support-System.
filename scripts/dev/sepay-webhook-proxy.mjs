import { createServer } from "node:http";

const listenHost = "127.0.0.1";
const listenPort = Number(process.env.AILSS_SEPAY_PROXY_PORT ?? 18081);
const gatewayOrigin = new URL(process.env.AILSS_GATEWAY_URL ?? "http://127.0.0.1:8080");
const webhookPath = "/api/v1/payments/sepay/webhook";
const maxBodyBytes = 16 * 1024;

if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
  throw new Error("AILSS_SEPAY_PROXY_PORT must be a valid TCP port");
}

const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== webhookPath) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "NOT_FOUND" }));
    return;
  }

  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    response.writeHead(415, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "UNSUPPORTED_MEDIA_TYPE" }));
    return;
  }

  const chunks = [];
  let bytes = 0;
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) {
      response.writeHead(413, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "PAYLOAD_TOO_LARGE" }));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    if (response.writableEnded) return;
    void fetch(new URL(webhookPath, gatewayOrigin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: request.headers.authorization ?? "",
      },
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(30_000),
    })
      .then(async (upstream) => {
        response.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") ?? "application/json",
          "cache-control": "no-store",
        });
        response.end(await upstream.text());
      })
      .catch(() => {
        response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "GATEWAY_UNAVAILABLE" }));
      });
  });
});

server.listen(listenPort, listenHost, () => {
  console.log(`SePay webhook proxy listening on http://${listenHost}:${listenPort}${webhookPath}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
