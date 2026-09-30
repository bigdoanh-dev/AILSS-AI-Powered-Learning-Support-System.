import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { PasswordResetChallenge } from "./model.js";

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const LOCAL_SERIAL = "LOCAL_SERIAL" as const;
const uuid = (value: string) => types.Uuid.fromString(value);
const long = (value: number) => types.Long.fromNumber(value);

function wasApplied(rows: readonly types.Row[]): boolean {
  return Boolean(rows[0]?.get("[applied]"));
}
function string(row: types.Row, name: string): string {
  const value: unknown = row.get(name);
  if (typeof value === "string") return value;
  if (value instanceof types.Uuid) return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}
function number(row: types.Row, name: string): number {
  const value: unknown = row.get(name);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  throw new Error(`INVALID_${name.toUpperCase()}`);
}
function date(row: types.Row, name: string): Date {
  const value: unknown = row.get(name);
  if (!(value instanceof Date)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}

export class IdentityPasswordResetRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async getChallenge(email: string): Promise<PasswordResetChallenge | undefined> {
    const rows = await this.client.execute(
      `SELECT normalized_email,user_id,otp_hmac,verified_token_hmac,token_version,credential_version,attempts,issued_at,sent_at,expires_at
       FROM password_reset_by_email WHERE normalized_email=?`,
      [email],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      normalizedEmail: string(row, "normalized_email"),
      userId: string(row, "user_id"),
      otpHmac: string(row, "otp_hmac"),
      verifiedTokenHmac: string(row, "verified_token_hmac"),
      tokenVersion: number(row, "token_version"),
      credentialVersion: number(row, "credential_version"),
      attempts: number(row, "attempts"),
      issuedAt: date(row, "issued_at"),
      sentAt: date(row, "sent_at"),
      expiresAt: date(row, "expires_at"),
    };
  }

  public async insertChallenge(input: PasswordResetChallenge): Promise<boolean> {
    const rows = await this.client.execute(
      `INSERT INTO password_reset_by_email
       (normalized_email,user_id,otp_hmac,verified_token_hmac,token_version,credential_version,attempts,issued_at,sent_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) USING TTL 900 IF NOT EXISTS`,
      [
        input.normalizedEmail,
        uuid(input.userId),
        input.otpHmac,
        input.verifiedTokenHmac,
        input.tokenVersion,
        long(input.credentialVersion),
        input.attempts,
        input.issuedAt,
        input.sentAt,
        input.expiresAt,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async replaceChallenge(input: {
    readonly challenge: PasswordResetChallenge;
    readonly expectedOtpHmac: string;
    readonly expectedSentAt: Date;
  }): Promise<boolean> {
    const value = input.challenge;
    const rows = await this.client.execute(
      `UPDATE password_reset_by_email USING TTL 900
       SET user_id=?,otp_hmac=?,verified_token_hmac=?,token_version=?,credential_version=?,attempts=?,issued_at=?,sent_at=?,expires_at=?
       WHERE normalized_email=? IF otp_hmac=? AND sent_at=?`,
      [
        uuid(value.userId),
        value.otpHmac,
        value.verifiedTokenHmac,
        value.tokenVersion,
        long(value.credentialVersion),
        value.attempts,
        value.issuedAt,
        value.sentAt,
        value.expiresAt,
        value.normalizedEmail,
        input.expectedOtpHmac,
        input.expectedSentAt,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async incrementAttempts(input: {
    readonly email: string;
    readonly expectedOtpHmac: string;
    readonly expectedAttempts: number;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `UPDATE password_reset_by_email SET attempts=? WHERE normalized_email=? IF otp_hmac=? AND attempts=?`,
      [input.expectedAttempts + 1, input.email, input.expectedOtpHmac, input.expectedAttempts],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async setVerifiedToken(input: {
    readonly email: string;
    readonly expectedOtpHmac: string;
    readonly expectedAttempts: number;
    readonly expectedIssuedAt: Date;
    readonly verifiedTokenHmac: string;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `UPDATE password_reset_by_email SET verified_token_hmac=?
       WHERE normalized_email=? IF otp_hmac=? AND attempts=? AND issued_at=? AND verified_token_hmac=''`,
      [
        input.verifiedTokenHmac,
        input.email,
        input.expectedOtpHmac,
        input.expectedAttempts,
        input.expectedIssuedAt,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async deleteChallenge(email: string, expectedOtpHmac: string): Promise<void> {
    await this.client.execute(
      "DELETE FROM password_reset_by_email WHERE normalized_email=? IF otp_hmac=?",
      [email, expectedOtpHmac],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }
}
