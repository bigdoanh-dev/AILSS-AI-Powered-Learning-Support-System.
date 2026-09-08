import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger, httpRequestSerializer, redactSensitiveUrl } from "../../packages/logger/src/index.js";

describe("P7.8 request log redaction", () => {
  it("masks the opaque cursor query value in request URLs", () => {
    expect(
      redactSensitiveUrl("/api/v1/admin/users?role=STUDENT&status=ACTIVE&limit=2&cursor=eyJhbGci.sig"),
    ).toBe("/api/v1/admin/users?role=STUDENT&status=ACTIVE&limit=2&cursor=[REDACTED]");
    expect(redactSensitiveUrl("/api/v1/admin/users?cursor=abc&role=STUDENT")).toBe(
      "/api/v1/admin/users?cursor=[REDACTED]&role=STUDENT",
    );
    expect(redactSensitiveUrl("/api/v1/admin/users?role=STUDENT&status=ACTIVE")).toBe(
      "/api/v1/admin/users?role=STUDENT&status=ACTIVE",
    );
    expect(redactSensitiveUrl(undefined)).toBeUndefined();
  });

  it("masks the cursor in the parsed query object and keeps other fields", () => {
    const serialized = httpRequestSerializer({
      id: 7,
      method: "GET",
      url: "/api/v1/admin/users?role=STUDENT&status=ACTIVE&cursor=opaque.value",
      query: { role: "STUDENT", status: "ACTIVE", limit: "2", cursor: "opaque.value" },
      headers: { host: "127.0.0.1:8080" },
    });
    expect(serialized.url).toBe("/api/v1/admin/users?role=STUDENT&status=ACTIVE&cursor=[REDACTED]");
    expect(serialized.query).toEqual({ role: "STUDENT", status: "ACTIVE", limit: "2", cursor: "[REDACTED]" });
    expect(serialized.method).toBe("GET");
    expect(serialized.headers).toEqual({ host: "127.0.0.1:8080" });
  });

  it("redacts authorization, actor context, admin proof, and idempotency-key headers in emitted logs", () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const logger = createLogger({ service: "test", environment: "test", level: "info", destination });
    logger.info(
      {
        req: {
          method: "PATCH",
          url: "/api/v1/admin/users/x/status",
          headers: {
            authorization: "Bearer secret-jwt",
            "x-actor-context": "signed-actor",
            "x-assessment-actor-context": "signed-assessment-actor",
            "x-classroom-actor-context": "signed-classroom-actor",
            "x-admin-step-up-proof": "signed-admin-proof",
            "idempotency-key": "p78-secret-key",
          },
        },
      },
      "request",
    );
    const joined = lines.join("");
    expect(joined).not.toContain("secret-jwt");
    expect(joined).not.toContain("signed-actor");
    expect(joined).not.toContain("signed-assessment-actor");
    expect(joined).not.toContain("signed-admin-proof");
    expect(joined).not.toContain("p78-secret-key");
    expect(joined).toContain("[REDACTED]");
  });

  it("redacts P7.12A current-password and step-up proof fields", () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const logger = createLogger({ service: "test", environment: "test", level: "info", destination });
    logger.info(
      {
        currentPassword: "do-not-log-this-password",
        proof: "do-not-log-this-proof",
        stepUpProof: "do-not-log-forwarded-proof",
      },
      "step-up",
    );
    const joined = lines.join("");
    expect(joined).not.toContain("do-not-log-this-password");
    expect(joined).not.toContain("do-not-log-this-proof");
    expect(joined).not.toContain("do-not-log-forwarded-proof");
  });
});
