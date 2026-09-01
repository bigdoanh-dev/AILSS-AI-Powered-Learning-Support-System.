import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { CanonicalLoginUser } from "../login/model.js";
import type { IdempotencyRecord } from "../registration/repository.js";
import type { PasswordChangeMetadata, PasswordCredential } from "./model.js";
import { serializePasswordMetadata } from "./model.js";

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const LOCAL_SERIAL = "LOCAL_SERIAL" as const;
const uuid = (value: string) => types.Uuid.fromString(value);
const long = (value: number) => types.Long.fromNumber(value);

function wasApplied(rows: readonly types.Row[]): boolean {
  return Boolean(rows[0]?.get("[applied]"));
}

function text(row: types.Row, name: string): string {
  const value: unknown = row.get(name);
  if (typeof value === "string") return value;
  if (value instanceof types.Uuid) return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
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

export class IdentityPasswordRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async getUser(userId: string): Promise<CanonicalLoginUser | undefined> {
    // Q-IDN-001: internal credential locator and canonical security-version handshake.
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
      normalizedEmail: text(row, "normalized_email"),
      displayName: text(row, "display_name"),
      role: text(row, "role"),
      status: text(row, "status"),
      lecturerVerified: Boolean(row.get("lecturer_verified")),
      tokenVersion: numberValue(row, "token_version"),
      credentialVersion: numberValue(row, "credential_version"),
      profileVersion: numberValue(row, "profile_version"),
      createdAt: date(row, "created_at"),
      updatedAt: date(row, "updated_at"),
      securityOperationId: nullableUuidText(row, "security_operation_id"),
    };
  }

  public async getCredential(normalizedEmail: string): Promise<PasswordCredential | undefined> {
    // Q-IDN-002: exact lookup using the internal Q-IDN-001 locator.
    const rows = await this.client.execute(
      `SELECT user_id,password_hash,credential_version,security_operation_id,status,updated_at
       FROM credential_by_email WHERE normalized_email=?`,
      [normalizedEmail],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      userId: text(row, "user_id"),
      passwordHash: text(row, "password_hash"),
      credentialVersion: numberValue(row, "credential_version"),
      status: text(row, "status"),
      updatedAt: date(row, "updated_at"),
      securityOperationId: nullableUuidText(row, "security_operation_id"),
    };
  }

  public async advanceUserSecurityEpoch(input: {
    expected: CanonicalLoginUser;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `UPDATE user_by_id SET token_version=?,credential_version=?,security_operation_id=?,updated_at=?
       WHERE user_id=?
       IF token_version=? AND credential_version=? AND status=? AND role=?`,
      [
        input.expected.tokenVersion + 1,
        long(input.expected.credentialVersion + 1),
        uuid(input.operationId),
        input.updatedAt,
        uuid(input.expected.userId),
        input.expected.tokenVersion,
        long(input.expected.credentialVersion),
        "ACTIVE",
        input.expected.role,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async updateCredential(input: {
    normalizedEmail: string;
    expected: PasswordCredential;
    passwordHash: string;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `UPDATE credential_by_email SET password_hash=?,credential_version=?,security_operation_id=?,updated_at=?
       WHERE normalized_email=?
       IF user_id=? AND credential_version=? AND status=?`,
      [
        input.passwordHash,
        long(input.expected.credentialVersion + 1),
        uuid(input.operationId),
        input.updatedAt,
        input.normalizedEmail,
        uuid(input.expected.userId),
        long(input.expected.credentialVersion),
        "ACTIVE",
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async beginIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    userId: string;
    requestFingerprint: string;
    createdAt: Date;
    ttlSeconds: number;
  }): Promise<{ created: boolean; record: IdempotencyRecord }> {
    // Q-IDN-007: password-safe keyed fingerprint; no password/hash is persisted.
    const rows = await this.client.execute(
      `INSERT INTO idempotency_by_scope_key
       (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS USING TTL ?`,
      [
        input.scope,
        input.keyHash,
        input.idempotencyKey,
        uuid(input.operationId),
        uuid(input.userId),
        0,
        "IN_PROGRESS",
        input.requestFingerprint,
        input.createdAt,
        new Date(input.createdAt.getTime() + input.ttlSeconds * 1_000),
        input.ttlSeconds,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    const record = await this.getIdempotency(input.scope, input.keyHash, input.idempotencyKey);
    if (!record) throw new Error("PASSWORD_IDEMPOTENCY_RESERVATION_MISSING");
    return { created: wasApplied(rows), record };
  }

  public async getIdempotency(
    scope: string,
    keyHash: number,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | undefined> {
    const rows = await this.client.execute(
      `SELECT operation_id,resource_id,result_code,status,result_checksum,created_at
       FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?`,
      [scope, keyHash, idempotencyKey],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      operationId: text(row, "operation_id"),
      resourceId: text(row, "resource_id"),
      resultCode: numberValue(row, "result_code"),
      status: text(row, "status"),
      requestChecksum: text(row, "result_checksum"),
      createdAt: date(row, "created_at"),
    };
  }

  public async transitionIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    expectedStatus: string;
    nextStatus: string;
    metadata: PasswordChangeMetadata;
    resultCode?: number;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `UPDATE idempotency_by_scope_key SET status=?,result_code=?,result_checksum=?
       WHERE scope=? AND key_hash=? AND idempotency_key=?
       IF operation_id=? AND status=?`,
      [
        input.nextStatus,
        input.resultCode ?? 0,
        serializePasswordMetadata(input.metadata),
        input.scope,
        input.keyHash,
        input.idempotencyKey,
        uuid(input.operationId),
        input.expectedStatus,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }
}
