import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { types } from "cassandra-driver";
import { describe, expect, it, vi } from "vitest";
import { IdentityPasswordRepository } from "../../apps/identity-service/src/password/repository.js";
import { IdentityPasswordResetRepository } from "../../apps/identity-service/src/password-reset/repository.js";
import { PasswordResetService } from "../../apps/identity-service/src/password-reset/service.js";
import type { PasswordResetMailer } from "../../apps/identity-service/src/password-reset/mailer.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";

// Use the driver's independent CQL generator and migration column names as
// the oracle; a service-only mock would miss a malformed repository INSERT.
const generator = createRequire(import.meta.url)("cassandra-driver/lib/mapping/query-generator.js") as {
  _getInsertQuery(
    table: string,
    keyspace: string,
    columns: { columnName: string }[],
    ifNotExists: boolean,
    ttl: number,
  ): string;
};
const schema = readFileSync(
  new URL("../../database/migrations/dev/089_identity_password_reset.cql", import.meta.url),
  "utf8",
);
const columns = (schema.match(/password_reset_by_email\s*\(([\s\S]*?)PRIMARY KEY/)?.[1] ?? "")
  .split(",")
  .map((line) => line.trim().split(/\s+/)[0])
  .filter((name): name is string => Boolean(name));
const normalize = (query: string) =>
  query
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();
const expectedInsert = normalize(
  generator
    ._getInsertQuery(
      "password_reset_by_email",
      "identity_keyspace",
      columns.map((columnName) => ({ columnName })),
      true,
      900,
    )
    .replace("identity_keyspace.", "")
    .replaceAll('"', "")
    .replace("USING TTL ?", "USING TTL 900"),
);
const email = "reset-test@example.invalid";
const userId = "71cb8035-dc79-4e4d-9b05-de57a5fd008b";
const instant = new Date("2026-10-01T07:00:00Z");
const row = (value: Record<string, unknown>) => ({ get: (name: string) => value[name] }) as types.Row;

function fixture() {
  let now = instant;
  let challenge: Record<string, unknown> | undefined;
  const execute = vi.fn(
    async (query: string, params: readonly unknown[], consistency: string, serial?: string) => {
      if (query.includes("FROM credential_by_email"))
        return params[0] === email
          ? [
              row({
                user_id: types.Uuid.fromString(userId),
                password_hash: "test-only-hash",
                credential_version: types.Long.ONE,
                security_operation_id: null,
                status: "ACTIVE",
                updated_at: instant,
              }),
            ]
          : [];
      if (query.includes("FROM user_by_id"))
        return [
          row({
            user_id: types.Uuid.fromString(userId),
            normalized_email: email,
            display_name: "Reset Test",
            role: "STUDENT",
            status: "ACTIVE",
            lecturer_verified: false,
            token_version: 1,
            credential_version: types.Long.ONE,
            profile_version: types.Long.ONE,
            security_operation_id: null,
            created_at: instant,
            updated_at: instant,
          }),
        ];
      if (query.trim().startsWith("SELECT") && query.includes("FROM password_reset_by_email"))
        return challenge ? [row(challenge)] : [];
      if (query.includes("INSERT INTO password_reset_by_email")) {
        if (normalize(query) !== expectedInsert)
          throw new Error("Invalid Cassandra conditional INSERT grammar");
        expect(consistency).toBe("LOCAL_QUORUM");
        expect(serial).toBe("LOCAL_SERIAL");
        expect(params).toHaveLength(columns.length);
        expect(params[1]).toBeInstanceOf(types.Uuid);
        expect(params[5]).toBeInstanceOf(types.Long);
        challenge = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
        return [row({ "[applied]": true })];
      }
      if (query.includes("SET verified_token_hmac=?")) {
        if (challenge) challenge.verified_token_hmac = params[0];
        return [row({ "[applied]": true })];
      }
      if (query.includes("SET attempts=?")) {
        if (challenge) challenge.attempts = params[0];
        return [row({ "[applied]": true })];
      }
      if (query.includes("DELETE FROM password_reset_by_email")) {
        challenge = undefined;
        return [];
      }
      throw new Error("Unexpected test query");
    },
  );
  const client = { execute } as unknown as CassandraClient;
  const mailer = {
    isConfigured: true,
    sendResetCode: vi.fn(async (_email: string, _code: string, _minutes: number) => ({
      accepted: true as const,
      smtpResponseCode: 250,
      messageId: "<test-message@example.invalid>",
    })),
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  const service = new PasswordResetService(
    new IdentityPasswordRepository(client),
    new IdentityPasswordResetRepository(client),
    mailer as unknown as PasswordResetMailer,
    "test-only-password-reset-hmac-key-32-bytes",
    logger,
    () => now,
  );
  return {
    service,
    execute,
    mailer,
    logger,
    challenge: () => challenge,
    advance: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

describe("password recovery with Cassandra repositories", () => {
  it("stores a valid conditional INSERT before delivering the OTP for an existing account", async () => {
    const f = fixture();
    await expect(f.service.requestCode({ email, requestId: "request-test" })).resolves.toEqual({
      accepted: true,
    });
    expect(f.mailer.sendResetCode).toHaveBeenCalledWith(email, expect.stringMatching(/^\d{6}$/), 15);
    expect(f.challenge()?.otp_hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(f.challenge())).not.toContain(f.mailer.sendResetCode.mock.calls[0]?.[1]);
    expect(f.challenge()?.expires_at).toEqual(new Date(instant.getTime() + 900_000));
    expect(f.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ smtpAccepted: true, smtpResponseCode: 250 }),
      "password reset code requested",
    );
    expect(JSON.stringify(f.logger.info.mock.calls)).not.toContain(f.mailer.sendResetCode.mock.calls[0]?.[1]);
  });
  it("clears an unusable OTP after SMTP failure and logs failure without claiming delivery", async () => {
    const f = fixture();
    f.mailer.sendResetCode.mockRejectedValue(new Error("SMTP_RECIPIENT_NOT_ACCEPTED"));
    await expect(f.service.requestCode({ email, requestId: "failed-smtp-test" })).resolves.toEqual({
      accepted: true,
    });
    expect(f.challenge()).toBeUndefined();
    expect(f.logger.info).not.toHaveBeenCalled();
    expect(f.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PASSWORD_RESET_EMAIL_DELIVERY_FAILED" }),
      "password reset code email delivery failed",
    );
  });
  it("verifies the delivered OTP and stores only a HMAC of the reset token", async () => {
    const f = fixture();
    await f.service.requestCode({ email, requestId: "request-test" });
    const code = f.mailer.sendResetCode.mock.calls[0]?.[1] ?? "";
    const verified = await f.service.verifyCode({ email, code });
    expect(verified.resetToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.challenge()?.verified_token_hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(f.challenge()?.verified_token_hmac).not.toBe(verified.resetToken);
  });
  it("keeps unknown accounts indistinguishable without an insert or email", async () => {
    const f = fixture();
    await expect(
      f.service.requestCode({ email: "unknown@example.invalid", requestId: "request-test" }),
    ).resolves.toEqual({ accepted: true });
    expect(f.mailer.sendResetCode).not.toHaveBeenCalled();
    expect(f.challenge()).toBeUndefined();
  });
  it("enforces the resend interval and rejects an expired delivered code", async () => {
    const f = fixture();
    await f.service.requestCode({ email, requestId: "request-test" });
    const code = f.mailer.sendResetCode.mock.calls[0]?.[1] ?? "";
    await f.service.requestCode({ email, requestId: "repeat-test" });
    expect(f.mailer.sendResetCode).toHaveBeenCalledTimes(1);
    f.advance(900_001);
    await expect(f.service.verifyCode({ email, code })).rejects.toMatchObject({
      code: "INVALID_PASSWORD_RESET_CODE",
    });
  });
});
