import { createServer } from "node:http";
import { createHmac, generateKeyPairSync } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importPKCS8, importSPKI, SignJWT, jwtVerify } from "jose";
import { sanitizeIdentityHeaders } from "../../packages/http/src/index.js";

describe("Phase 32.13 & 32.27: Black-Box Security V2 & Payment Redirect Assurance", () => {
  let privateKey: any;
  let publicKey: any;
  let baseUrl = "";
  let server: any;

  const policy = {
    issuer: "https://auth.ailss.edu.vn",
    audience: "https://api.ailss.edu.vn",
    kid: "phase32-key-01",
  };

  const webhookSecret = "phase32-sepay-webhook-secret-32-chars-long";
  const processedWebhooks = new Set<string>();

  // Mock multi-tenant backend resources
  const tenantAlphaId = "tenant-alpha-school";
  const tenantBetaId = "tenant-beta-university";

  const ordersDatabase: Record<string, { id: string; tenantId: string; userId: string; amount: number }> = {
    "ord-alpha-01": { id: "ord-alpha-01", tenantId: tenantAlphaId, userId: "user-alpha-01", amount: 500000 },
    "ord-beta-02": { id: "ord-beta-02", tenantId: tenantBetaId, userId: "user-beta-02", amount: 750000 },
  };

  const allowedRedirectDomains = ["https://checkout.sandbox.sepay.vn", "https://auth.ailss.edu.vn"];

  // Helper to issue test JWT tokens
  const issueToken = async (
    actor: { userId: string; roles: string[]; sessionId: string; tokenVersion: number },
    tenantId: string,
    algorithm = "EdDSA",
    expiresInSeconds = 300,
  ) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      roles: actor.roles,
      tenantId,
      sessionId: actor.sessionId,
      tokenVersion: actor.tokenVersion,
    })
      .setProtectedHeader({ alg: algorithm, kid: policy.kid, typ: "JWT" })
      .setIssuer(policy.issuer)
      .setAudience(policy.audience)
      .setSubject(actor.userId)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresInSeconds)
      .setJti(crypto.randomUUID())
      .sign(privateKey);
  };

  let alphaUserToken = "";
  let betaUserToken = "";

  beforeAll(async () => {
    const pair = generateKeyPairSync("ed25519");
    privateKey = await importPKCS8(
      pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "EdDSA",
    );
    publicKey = await importSPKI(pair.publicKey.export({ type: "spki", format: "pem" }).toString(), "EdDSA");

    alphaUserToken = await issueToken(
      { userId: "user-alpha-01", sessionId: "sess-alpha-01", roles: ["STUDENT"], tokenVersion: 1 },
      tenantAlphaId,
    );

    betaUserToken = await issueToken(
      { userId: "user-beta-02", sessionId: "sess-beta-02", roles: ["STUDENT"], tokenVersion: 1 },
      tenantBetaId,
    );

    const app = express();
    app.use(express.json());
    app.use(sanitizeIdentityHeaders());

    // JWT Authentication with Algorithm Confusion Prevention
    app.use(async (request, response, next) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return next();
      }
      const token = authHeader.slice(7).trim();

      // Algorithm confusion check: reject "none" or RS256 algorithm
      try {
        const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
          issuer: policy.issuer,
          audience: policy.audience,
          algorithms: ["EdDSA"], // Strict algorithm pinning
        });
        if (protectedHeader.alg !== "EdDSA") {
          return response.status(401).json({ error: { code: "ALGORITHM_CONFUSION_REJECTED" } });
        }
        (request as any).user = payload;
      } catch {
        return response.status(401).json({ error: { code: "INVALID_TOKEN" } });
      }
      next();
    });

    // 1. Order Details Endpoint (BOLA / IDOR Protection)
    app.get("/api/v1/orders/:orderId", (request, response) => {
      const user = (request as any).user;
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });

      const order = ordersDatabase[request.params.orderId];
      if (!order) return response.status(404).json({ error: { code: "NOT_FOUND" } });

      // Enforce both tenant isolation and object ownership (BOLA prevention)
      if (
        order.tenantId !== user.tenantId ||
        (order.userId !== user.sub && !user.roles.includes("INSTITUTION_ADMIN"))
      ) {
        return response.status(403).json({ error: { code: "BOLA_ACCESS_DENIED" } });
      }

      return response.status(200).json({ data: order });
    });

    // 2. Profile Update Endpoint (Mass Assignment Protection)
    app.patch("/api/v1/me", (request, response) => {
      const user = (request as any).user;
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });

      const allowedFields = new Set(["displayName", "locale", "timezone", "avatarUrl"]);
      const submittedFields = Object.keys(request.body || {});
      const forbiddenFields = submittedFields.filter((f) => !allowedFields.has(f));

      if (forbiddenFields.length > 0) {
        return response.status(400).json({
          error: {
            code: "MASS_ASSIGNMENT_DETECTED",
            message: `Attempted to mutate forbidden fields: ${forbiddenFields.join(", ")}`,
          },
        });
      }

      return response.status(200).json({ data: { updated: true } });
    });

    // 3. Payment Redirect & Open Redirect Protection
    app.post("/api/v1/commerce/initiate-checkout", (request, response) => {
      const user = (request as any).user;
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });

      const { orderId, returnUrl } = request.body || {};
      const order = ordersDatabase[orderId];
      if (!order || order.tenantId !== user.tenantId) {
        return response.status(404).json({ error: { code: "ORDER_NOT_FOUND" } });
      }

      // Validate returnUrl destination against allowlist to prevent open redirect
      try {
        const parsed = new URL(returnUrl);
        const origin = `${parsed.protocol}//${parsed.host}`;
        if (!allowedRedirectDomains.includes(origin)) {
          return response.status(400).json({
            error: { code: "OPEN_REDIRECT_REJECTED", message: "Return URL domain is not in allowlist" },
          });
        }
      } catch {
        return response.status(400).json({ error: { code: "INVALID_RETURN_URL" } });
      }

      // Hosted provider redirect URL
      const checkoutRedirectUrl = `https://checkout.sandbox.sepay.vn/pay?order_id=${orderId}&amount=${order.amount}&tenant=${user.tenantId}`;
      return response.status(200).json({
        data: {
          flow: "FULL_REDIRECT",
          checkoutUrl: checkoutRedirectUrl,
        },
      });
    });

    // 4. Webhook Ingestion Endpoint (HMAC Signature & Replay Protection)
    app.post("/api/v1/payments/sepay/webhook", (request, response) => {
      const signatureHeader = request.headers["x-sepay-signature"] as string;
      const timestampHeader = request.headers["x-sepay-timestamp"] as string;

      if (!signatureHeader || !timestampHeader) {
        return response.status(401).json({ error: { code: "MISSING_SIGNATURE_HEADERS" } });
      }

      // Check timestamp freshness (replay attack prevention: 5-minute window)
      const now = Math.floor(Date.now() / 1000);
      const reqTime = parseInt(timestampHeader, 10);
      if (isNaN(reqTime) || Math.abs(now - reqTime) > 300) {
        return response.status(400).json({ error: { code: "WEBHOOK_TIMESTAMP_EXPIRED" } });
      }

      // Verify HMAC-SHA256 signature
      const rawPayload = JSON.stringify(request.body);
      const expectedSignature = createHmac("sha256", webhookSecret)
        .update(`${timestampHeader}.${rawPayload}`)
        .digest("hex");

      if (signatureHeader !== expectedSignature) {
        return response.status(401).json({ error: { code: "INVALID_WEBHOOK_SIGNATURE" } });
      }

      const { transactionId, orderId, amount } = request.body || {};

      // Idempotency: Reject duplicate transactions
      if (processedWebhooks.has(transactionId)) {
        return response.status(200).json({ status: "ALREADY_PROCESSED" });
      }

      // Amount verification
      const order = ordersDatabase[orderId];
      if (!order || order.amount !== amount) {
        return response.status(400).json({ error: { code: "AMOUNT_MISMATCH_REJECTED" } });
      }

      processedWebhooks.add(transactionId);
      return response.status(200).json({ status: "PROCESSED", transactionId });
    });

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server failed to start");
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server.close((err: any) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("1. Deflects BOLA / IDOR resource access across tenant and user boundaries", async () => {
    // User Alpha attempts to access User Beta's order
    const response = await fetch(`${baseUrl}/api/v1/orders/ord-beta-02`, {
      headers: { Authorization: `Bearer ${alphaUserToken}` },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("BOLA_ACCESS_DENIED");

    // User Alpha accesses own order successfully
    const legitResponse = await fetch(`${baseUrl}/api/v1/orders/ord-alpha-01`, {
      headers: { Authorization: `Bearer ${alphaUserToken}` },
    });
    expect(legitResponse.status).toBe(200);
    const legitBody = (await legitResponse.json()) as any;
    expect(legitBody.data.id).toBe("ord-alpha-01");
  });

  it("2. Deflects mass assignment attacks attempting privilege escalation or role mutation", async () => {
    // Attacker submits forbidden fields: roles, tenantId, isVerified
    const response = await fetch(`${baseUrl}/api/v1/me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${alphaUserToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        displayName: "Legit Name",
        roles: ["PLATFORM_ADMIN"], // Mass assignment attempt
        tenantId: "tenant-beta",
      }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("MASS_ASSIGNMENT_DETECTED");
  });

  it("3. Deflects JWT algorithm confusion attacks (strict EdDSA enforcement)", async () => {
    // Attempting to send malformed JWT header with alg: none or invalid signature
    const fakeToken = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1c2VyLWFscGhhLTAxIn0.";
    const response = await fetch(`${baseUrl}/api/v1/orders/ord-alpha-01`, {
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect(response.status).toBe(401);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("4. Deflects open redirect vulnerabilities in payment initiation flow", async () => {
    // Attacker attempts open redirect to an external phishing site
    const maliciousResponse = await fetch(`${baseUrl}/api/v1/commerce/initiate-checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alphaUserToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: "ord-alpha-01",
        returnUrl: "https://evil-phishing-site.com/steal-creds",
      }),
    });
    expect(maliciousResponse.status).toBe(400);
    const body = (await maliciousResponse.json()) as any;
    expect(body.error.code).toBe("OPEN_REDIRECT_REJECTED");

    // Legitimate redirect to approved platform domain succeeds
    const legitResponse = await fetch(`${baseUrl}/api/v1/commerce/initiate-checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alphaUserToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: "ord-alpha-01",
        returnUrl: "https://auth.ailss.edu.vn/courses/return",
      }),
    });
    expect(legitResponse.status).toBe(200);
    const legitBody = (await legitResponse.json()) as any;
    expect(legitBody.data.flow).toBe("FULL_REDIRECT");
    expect(legitBody.data.checkoutUrl).toContain("https://checkout.sandbox.sepay.vn");
  });

  it("5. Enforces HMAC-SHA256 signature verification on payment provider webhooks", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = { transactionId: "tx-sepay-001", orderId: "ord-alpha-01", amount: 500000 };
    const rawPayload = JSON.stringify(payload);

    // Tampered signature
    const invalidResponse = await fetch(`${baseUrl}/api/v1/payments/sepay/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sepay-signature": "tampered-hmac-signature-0000000000000",
        "x-sepay-timestamp": timestamp,
      },
      body: rawPayload,
    });
    expect(invalidResponse.status).toBe(401);
    const invalidBody = (await invalidResponse.json()) as any;
    expect(invalidBody.error.code).toBe("INVALID_WEBHOOK_SIGNATURE");

    // Valid signature
    const validSignature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${rawPayload}`)
      .digest("hex");

    const validResponse = await fetch(`${baseUrl}/api/v1/payments/sepay/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sepay-signature": validSignature,
        "x-sepay-timestamp": timestamp,
      },
      body: rawPayload,
    });
    expect(validResponse.status).toBe(200);
    const validBody = (await validResponse.json()) as any;
    expect(validBody.status).toBe("PROCESSED");
  });

  it("6. Enforces webhook replay protection and transaction idempotency", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = { transactionId: "tx-sepay-001", orderId: "ord-alpha-01", amount: 500000 };
    const rawPayload = JSON.stringify(payload);

    const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawPayload}`).digest("hex");

    // Replay the same transaction ID
    const replayResponse = await fetch(`${baseUrl}/api/v1/payments/sepay/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sepay-signature": signature,
        "x-sepay-timestamp": timestamp,
      },
      body: rawPayload,
    });
    expect(replayResponse.status).toBe(200);
    const replayBody = (await replayResponse.json()) as any;
    expect(replayBody.status).toBe("ALREADY_PROCESSED");
  });

  it("7. Deflects expired webhook timestamp replay attacks", async () => {
    // Timestamp from 10 minutes ago (> 300s)
    const expiredTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const payload = { transactionId: "tx-sepay-002", orderId: "ord-alpha-01", amount: 500000 };
    const rawPayload = JSON.stringify(payload);

    const signature = createHmac("sha256", webhookSecret)
      .update(`${expiredTimestamp}.${rawPayload}`)
      .digest("hex");

    const response = await fetch(`${baseUrl}/api/v1/payments/sepay/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sepay-signature": signature,
        "x-sepay-timestamp": expiredTimestamp,
      },
      body: rawPayload,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("WEBHOOK_TIMESTAMP_EXPIRED");
  });

  it("8. Deflects amount tampering in payment confirmation webhooks", async () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // Tampered amount: order is 500,000, attacker submits 10,000
    const payload = { transactionId: "tx-sepay-003", orderId: "ord-alpha-01", amount: 10000 };
    const rawPayload = JSON.stringify(payload);

    const signature = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawPayload}`).digest("hex");

    const response = await fetch(`${baseUrl}/api/v1/payments/sepay/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sepay-signature": signature,
        "x-sepay-timestamp": timestamp,
      },
      body: rawPayload,
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("AMOUNT_MISMATCH_REJECTED");
  });
});
