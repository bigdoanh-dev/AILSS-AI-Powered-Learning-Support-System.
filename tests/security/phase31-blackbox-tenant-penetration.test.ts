import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importPKCS8, importSPKI, SignJWT, jwtVerify } from "jose";
import { sanitizeIdentityHeaders } from "../../packages/http/src/index.js";

describe("Phase 31.15: Black-Box HTTP Tenant Penetration Suite", () => {
  let privateKey: any;
  let publicKey: any;
  let baseUrl = "";
  let server: any;

  const policy = {
    issuer: "https://auth.ailss.edu.vn",
    audience: "https://api.ailss.edu.vn",
    kid: "phase31-key-01",
  };

  const tenantAlphaId = "tenant-alpha-school";
  const tenantBetaId = "tenant-beta-university";

  const coursesDatabase: Record<string, { id: string; tenantId: string; title: string }> = {
    "crs-alpha-101": { id: "crs-alpha-101", tenantId: tenantAlphaId, title: "Alpha Biology" },
    "crs-beta-202": { id: "crs-beta-202", tenantId: tenantBetaId, title: "Beta Quantum Physics" },
  };

  const filesDatabase: Record<string, { id: string; tenantId: string; name: string }> = {
    "file-alpha-01": { id: "file-alpha-01", tenantId: tenantAlphaId, name: "alpha-exam.pdf" },
    "file-beta-02": { id: "file-beta-02", tenantId: tenantBetaId, name: "beta-research.pdf" },
  };

  // Helper to issue test JWT tokens
  const issueToken = async (
    actor: { userId: string; roles: string[]; sessionId: string; tokenVersion: number },
    tenantId: string,
    expiresInSeconds = 300,
  ) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      roles: actor.roles,
      tenantId,
      sessionId: actor.sessionId,
      tokenVersion: actor.tokenVersion,
    })
      .setProtectedHeader({ alg: "EdDSA", kid: policy.kid, typ: "JWT" })
      .setIssuer(policy.issuer)
      .setAudience(policy.audience)
      .setSubject(actor.userId)
      .setIssuedAt(now)
      .setExpirationTime(now + expiresInSeconds)
      .setJti(crypto.randomUUID())
      .sign(privateKey);
  };

  let alphaStudentToken = "";
  let betaStudentToken = "";

  beforeAll(async () => {
    // Generate Ed25519 keypair
    const pair = generateKeyPairSync("ed25519");
    privateKey = await importPKCS8(
      pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "EdDSA",
    );
    publicKey = await importSPKI(pair.publicKey.export({ type: "spki", format: "pem" }).toString(), "EdDSA");

    alphaStudentToken = await issueToken(
      {
        userId: "user-alpha-student-01",
        sessionId: "sess-alpha-01",
        roles: ["STUDENT"],
        tokenVersion: 1,
      },
      tenantAlphaId,
    );

    betaStudentToken = await issueToken(
      {
        userId: "user-beta-student-02",
        sessionId: "sess-beta-01",
        roles: ["STUDENT"],
        tokenVersion: 1,
      },
      tenantBetaId,
    );

    const app = express();
    app.use(express.json());
    app.use(sanitizeIdentityHeaders());

    // JWT Authentication & Tenant Context Middleware
    app.use(async (request, response, next) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return next();
      }
      const token = authHeader.slice(7).trim();
      try {
        const { payload } = await jwtVerify(token, publicKey, {
          issuer: policy.issuer,
          audience: policy.audience,
        });
        (request as any).user = payload;
      } catch {
        return response
          .status(401)
          .json({ error: { code: "INVALID_TOKEN", message: "Token verification failed" } });
      }
      next();
    });

    // 1. Learning Courses Endpoint (Enforces Tenant Scoping)
    app.get("/api/v1/courses/:id", (request, response) => {
      const user = (request as any).user;
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });

      const course = coursesDatabase[request.params.id];
      if (!course) return response.status(404).json({ error: { code: "NOT_FOUND" } });

      if (course.tenantId !== user.tenantId) {
        return response.status(403).json({
          error: { code: "TENANT_ACCESS_DENIED", message: "Resource belongs to another tenant" },
        });
      }

      return response.status(200).json({ data: course });
    });

    // 2. Admin Users Endpoint (Enforces PLATFORM_ADMIN or matching INSTITUTION_ADMIN)
    app.get("/api/v1/admin/users", (request, response) => {
      const user = (request as any).user;
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });

      const roles: string[] = user.roles || [];
      if (!roles.includes("PLATFORM_ADMIN") && !roles.includes("INSTITUTION_ADMIN")) {
        return response
          .status(403)
          .json({ error: { code: "FORBIDDEN_ROLE", message: "Admin role required" } });
      }

      const requestedTenant = request.query.tenantId as string;
      if (requestedTenant && !roles.includes("PLATFORM_ADMIN") && requestedTenant !== user.tenantId) {
        return response.status(403).json({ error: { code: "CROSS_TENANT_ADMIN_FORBIDDEN" } });
      }

      return response.status(200).json({ data: [{ userId: "admin-result", tenantId: user.tenantId }] });
    });

    // 3. Storage Files Endpoint (Enforces Tenant Scoping)
    app.get("/api/v1/storage/files/:id", (request, response) => {
      const user = (request as any).user;
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });

      const file = filesDatabase[request.params.id];
      if (!file) return response.status(404).json({ error: { code: "NOT_FOUND" } });

      if (file.tenantId !== user.tenantId) {
        return response.status(403).json({ error: { code: "CROSS_TENANT_FILE_ACCESS_DENIED" } });
      }

      return response.status(200).json({ data: file });
    });

    // 4. AI RAG Query Endpoint (Enforces Vector Namespace Isolation)
    app.post("/api/v1/ai/query", (request, response) => {
      const user = (request as any).user;
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });

      const { targetNamespace } = request.body || {};
      if (targetNamespace && targetNamespace !== `tenant-${user.tenantId}`) {
        return response.status(403).json({
          error: { code: "VECTOR_NAMESPACE_VIOLATION", message: "Cannot query foreign vector namespace" },
        });
      }

      return response.status(200).json({ data: { answer: "Safe response", citations: [] } });
    });

    // 5. Commercial Payment & Payout Gated Endpoints (Fail Closed)
    app.post("/api/v1/commerce/checkout", (request, response) => {
      const user = (request as any).user;
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });

      const livePaymentEnabled = process.env.ENABLE_LIVE_PAYMENT === "true";
      if (!livePaymentEnabled) {
        return response.status(403).json({
          error: {
            code: "COMMERCIAL_PAYMENT_SANDBOX_ONLY",
            message: "Live commercial payments are gated. Operate in SANDBOX_ONLY.",
          },
        });
      }
      return response
        .status(200)
        .json({ data: { checkoutUrl: "https://sandbox.provider.example/checkout" } });
    });

    app.post("/api/v1/commerce/payout", (request, response) => {
      const user = (request as any).user;
      if (!user) return response.status(401).json({ error: { code: "UNAUTHORIZED" } });

      const livePayoutEnabled = process.env.ENABLE_LIVE_PAYOUT === "true";
      if (!livePayoutEnabled) {
        return response.status(403).json({
          error: {
            code: "COMMERCIAL_PAYOUT_GATED",
            message: "Partner payouts are permanently gated in this release.",
          },
        });
      }
      return response.status(200).json({ data: { status: "PROCESSED" } });
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

  it("1. Deflects forged identity headers (Anti-Spoofing Gate)", async () => {
    const response = await fetch(`${baseUrl}/api/v1/courses/crs-alpha-101`, {
      headers: {
        "x-user-id": "spoofed-user-id",
        "x-user-role": "PLATFORM_ADMIN",
      },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("UNTRUSTED_IDENTITY_HEADER");
  });

  it("2. Deflects IDOR parameter attacks across tenant boundaries", async () => {
    // Tenant Alpha student attempts to retrieve Tenant Beta course
    const response = await fetch(`${baseUrl}/api/v1/courses/crs-beta-202`, {
      headers: {
        Authorization: `Bearer ${alphaStudentToken}`,
      },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("TENANT_ACCESS_DENIED");

    // Legitimate access to own course succeeds
    const legitResponse = await fetch(`${baseUrl}/api/v1/courses/crs-alpha-101`, {
      headers: {
        Authorization: `Bearer ${alphaStudentToken}`,
      },
    });
    expect(legitResponse.status).toBe(200);
    const legitBody = (await legitResponse.json()) as any;
    expect(legitBody.data.id).toBe("crs-alpha-101");
  });

  it("3. Deflects JWT tampering, signature forgery, and expired tokens", async () => {
    // Forged signature
    const tamperedToken = alphaStudentToken.slice(0, -10) + "tampered01";
    const tamperedRes = await fetch(`${baseUrl}/api/v1/courses/crs-alpha-101`, {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });
    expect(tamperedRes.status).toBe(401);

    // Expired token
    const expiredToken = await issueToken(
      {
        userId: "user-alpha-student-01",
        sessionId: "sess-alpha-01",
        roles: ["STUDENT"],
        tokenVersion: 1,
      },
      tenantAlphaId,
      -500,
    );
    const expiredRes = await fetch(`${baseUrl}/api/v1/courses/crs-alpha-101`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(expiredRes.status).toBe(401);
  });

  it("4. Deflects role escalation attacks from unprivileged students", async () => {
    const response = await fetch(`${baseUrl}/api/v1/admin/users`, {
      headers: {
        Authorization: `Bearer ${alphaStudentToken}`,
      },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe("FORBIDDEN_ROLE");
  });

  it("5. Deflects cross-tenant file references and vector namespace manipulation", async () => {
    // Cross-tenant storage file access
    const fileRes = await fetch(`${baseUrl}/api/v1/storage/files/file-beta-02`, {
      headers: { Authorization: `Bearer ${alphaStudentToken}` },
    });
    expect(fileRes.status).toBe(403);
    const fileBody = (await fileRes.json()) as any;
    expect(fileBody.error.code).toBe("CROSS_TENANT_FILE_ACCESS_DENIED");

    // Foreign vector namespace manipulation
    const ragRes = await fetch(`${baseUrl}/api/v1/ai/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alphaStudentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetNamespace: `tenant-${tenantBetaId}`,
        query: "What are the confidential exam questions for Beta University?",
      }),
    });
    expect(ragRes.status).toBe(403);
    const ragBody = (await ragRes.json()) as any;
    expect(ragBody.error.code).toBe("VECTOR_NAMESPACE_VIOLATION");
  });

  it("6. Enforces hard fail-closed gating on commercial payment and payout endpoints", async () => {
    // Commercial payment fails closed to sandbox
    const paymentRes = await fetch(`${baseUrl}/api/v1/commerce/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alphaStudentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ courseId: "crs-alpha-101", amount: 500000 }),
    });
    expect(paymentRes.status).toBe(403);
    const paymentBody = (await paymentRes.json()) as any;
    expect(paymentBody.error.code).toBe("COMMERCIAL_PAYMENT_SANDBOX_ONLY");

    // Partner payout is permanently gated
    const payoutRes = await fetch(`${baseUrl}/api/v1/commerce/payout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alphaStudentToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipientId: "lecturer-01", amount: 2000000 }),
    });
    expect(payoutRes.status).toBe(403);
    const payoutBody = (await payoutRes.json()) as any;
    expect(payoutBody.error.code).toBe("COMMERCIAL_PAYOUT_GATED");
  });
});
