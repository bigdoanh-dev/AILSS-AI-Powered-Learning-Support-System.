import { createServer } from "node:http";
import { createHash } from "node:crypto";

const token = process.env.BANK_PAYOUT_MOCK_TOKEN;
const port = Number(process.env.BANK_PAYOUT_MOCK_PORT ?? 8799);
const outcome = process.env.BANK_PAYOUT_MOCK_OUTCOME ?? "paid";
if (!token || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Set BANK_PAYOUT_MOCK_TOKEN and a valid BANK_PAYOUT_MOCK_PORT");
if (!["paid", "rejected", "error", "timeout"].includes(outcome))
  throw new Error("BANK_PAYOUT_MOCK_OUTCOME must be paid, rejected, error, or timeout");

const records = new Map();
createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/payouts") {
    response.writeHead(404).end();
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end();
    return;
  }
  try {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 8192) throw new Error("Body too large");
    }
    const input = JSON.parse(body);
    const reference = request.headers["idempotency-key"];
    if (
      typeof reference !== "string" ||
      reference !== input.reference ||
      !/^[1-9]\d*$/.test(input.amountMinor) ||
      input.currency !== "VND" ||
      !input.destinationAccount?.accountNumber
    ) {
      response.writeHead(400).end();
      return;
    }
    const fingerprint = createHash("sha256").update(body).digest("hex");
    const previous = records.get(reference);
    if (previous && previous.fingerprint !== fingerprint) {
      response.writeHead(409).end();
      return;
    }
    if (outcome === "timeout") return;
    if (outcome === "error") {
      response.writeHead(500).end();
      return;
    }
    const result =
      previous?.result ??
      (outcome === "rejected"
        ? { status: "rejected" }
        : {
            status: "paid",
            providerReference: `mock_${createHash("sha256").update(reference).digest("hex").slice(0, 20)}`,
          });
    records.set(reference, { fingerprint, result });
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  } catch {
    response.writeHead(400).end();
  }
}).listen(port, "127.0.0.1", () => {
  process.stdout.write(`Mock payout listening on 127.0.0.1:${String(port)}\n`);
});
