import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { CanonicalLoginUser, LoginCredential, LoginSession } from "./model.js";

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const LOCAL_SERIAL = "LOCAL_SERIAL" as const;
const uuid = (value: string) => types.Uuid.fromString(value);
const long = (value: number) => types.Long.fromNumber(value);

function text(row: types.Row, name: string): string {
  const value: unknown = row.get(name);
  if (typeof value === "string") return value;
  if (value instanceof types.Uuid) return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function date(row: types.Row, name: string): Date {
  const value: unknown = row.get(name);
  if (!(value instanceof Date)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}

function nullableUuidText(row: types.Row, name: string): string | null {
  const value: unknown = row.get(name);
  if (value === null || value === undefined) return null;
  if (value instanceof types.Uuid) return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function nullableDate(row: types.Row, name: string): Date | null {
  const value: unknown = row.get(name);
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}

function numberValue(row: types.Row, name: string): number {
  const value: unknown = row.get(name);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function wasApplied(rows: readonly types.Row[]): boolean {
  return Boolean(rows[0]?.get("[applied]"));
}

export class IdentityLoginRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async getCredential(normalizedEmail: string): Promise<LoginCredential | undefined> {
    // Q-IDN-002: exact prepared lookup by the canonical normalized email.
    const rows = await this.client.execute(
      "SELECT user_id,password_hash,credential_version,security_operation_id,status FROM credential_by_email WHERE normalized_email=?",
      [normalizedEmail],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      userId: text(row, "user_id"),
      passwordHash: text(row, "password_hash"),
      credentialVersion: numberValue(row, "credential_version"),
      securityOperationId: nullableUuidText(row, "security_operation_id"),
      status: text(row, "status"),
    };
  }

  public async getUser(userId: string): Promise<CanonicalLoginUser | undefined> {
    // Q-IDN-001: user_by_id is canonical for status, role, and token version.
    const rows = await this.client.execute(
      `SELECT user_id,normalized_email,display_name,role,status,lecturer_verified,token_version,credential_version,security_operation_id,profile_version,created_at,updated_at
       FROM user_by_id WHERE user_id=?`,
      [uuid(userId)],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      userId: text(row, "user_id"),
      displayName: text(row, "display_name"),
      role: text(row, "role"),
      status: text(row, "status"),
      lecturerVerified: Boolean(row.get("lecturer_verified")),
      tokenVersion: numberValue(row, "token_version"),
      credentialVersion: numberValue(row, "credential_version"),
      normalizedEmail: text(row, "normalized_email"),
      securityOperationId: nullableUuidText(row, "security_operation_id"),
      profileVersion: numberValue(row, "profile_version"),
      createdAt: date(row, "created_at"),
      updatedAt: date(row, "updated_at"),
    };
  }

  public async insertSession(session: LoginSession): Promise<boolean> {
    // Q-IDN-003: canonical, single-partition session creation. No user-bucket projection is bound to IDN-02.
    const rows = await this.client.execute(
      `INSERT INTO session_by_id
       (session_id,user_id,token_family_id,refresh_fingerprint,generation,state,expires_at,revoked_at,version,auth_version,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(session.sessionId),
        uuid(session.userId),
        uuid(session.tokenFamilyId),
        session.refreshFingerprint,
        session.generation,
        session.state,
        session.expiresAt,
        session.revokedAt,
        long(session.version),
        session.authVersion,
        session.createdAt,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async getSession(sessionId: string): Promise<LoginSession | undefined> {
    // Q-IDN-003: exact read-back resolves an ambiguous create outcome using the known server UUID.
    const rows = await this.client.execute(
      `SELECT session_id,user_id,token_family_id,refresh_fingerprint,generation,state,expires_at,revoked_at,version,auth_version,created_at
       FROM session_by_id WHERE session_id=?`,
      [uuid(sessionId)],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      sessionId: text(row, "session_id"),
      userId: text(row, "user_id"),
      tokenFamilyId: text(row, "token_family_id"),
      refreshFingerprint: text(row, "refresh_fingerprint"),
      generation: numberValue(row, "generation"),
      state: text(row, "state"),
      expiresAt: date(row, "expires_at"),
      revokedAt: nullableDate(row, "revoked_at"),
      version: numberValue(row, "version"),
      authVersion:
        row.get("auth_version") === null || row.get("auth_version") === undefined
          ? null
          : numberValue(row, "auth_version"),
      createdAt: date(row, "created_at"),
    };
  }

  public async revokeSession(sessionId: string, expectedVersion: number, revokedAt: Date): Promise<boolean> {
    // Q-IDN-003: bounded compensation and IDN-04 current-session ACTIVE -> REVOKED transition.
    const rows = await this.client.execute(
      `UPDATE session_by_id SET state=?,revoked_at=?,version=?
       WHERE session_id=? IF state=? AND version=?`,
      ["REVOKED", revokedAt, long(expectedVersion + 1), uuid(sessionId), "ACTIVE", long(expectedVersion)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async rotateSession(input: {
    expected: LoginSession;
    nextRefreshFingerprint: string;
  }): Promise<boolean> {
    // Q-IDN-003: one-row CAS prevents two requests from rotating the same generation.
    const rows = await this.client.execute(
      `UPDATE session_by_id SET refresh_fingerprint=?,generation=?,version=?
       WHERE session_id=?
       IF state=? AND generation=? AND version=? AND refresh_fingerprint=?`,
      [
        input.nextRefreshFingerprint,
        input.expected.generation + 1,
        long(input.expected.version + 1),
        uuid(input.expected.sessionId),
        "ACTIVE",
        input.expected.generation,
        long(input.expected.version),
        input.expected.refreshFingerprint,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }
}
