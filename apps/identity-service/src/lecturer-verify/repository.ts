import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { AdminProjectionRow, AdminUser } from "../admin/model.js";
import type { PasswordCredential } from "../password/model.js";
import type { PublicLecturerProjection } from "../public-profile/model.js";
import type { IdempotencyRecord } from "../registration/repository.js";
import { serializeLecturerVerifyMetadata, type LecturerVerifyMetadata } from "./model.js";

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const LOCAL_ONE = "LOCAL_ONE" as const;
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

function nullableText(row: types.Row, name: string): string | null {
  const value: unknown = row.get(name);
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function date(row: types.Row, name: string): Date {
  const value: unknown = row.get(name);
  if (!(value instanceof Date)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}

function nullableUuid(row: types.Row, name: string): string | null {
  const value: unknown = row.get(name);
  if (value === null || value === undefined) return null;
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

function projection(row: types.Row, shard: number): AdminProjectionRow {
  return {
    userId: text(row, "user_id"),
    displayName: text(row, "display_name"),
    role: text(row, "role") as AdminProjectionRow["role"],
    status: text(row, "status") as AdminProjectionRow["status"],
    lecturerVerified: Boolean(row.get("lecturer_verified")),
    profileVersion: numberValue(row, "profile_version"),
    updatedAt: date(row, "updated_at"),
    shard,
  };
}

export class LecturerVerifyRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async getUser(userId: string): Promise<AdminUser | undefined> {
    // Q-IDN-001: exact canonical read for the verification target and actor.
    const rows = await this.client.execute(
      `SELECT user_id,email_masked,normalized_email,display_name,role,status,lecturer_verified,token_version,credential_version,security_operation_id,profile_version,created_at,updated_at
       FROM user_by_id WHERE user_id=?`,
      [uuid(userId)],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      ...projection(row, -1),
      emailMasked: text(row, "email_masked"),
      normalizedEmail: text(row, "normalized_email"),
      tokenVersion: numberValue(row, "token_version"),
      credentialVersion: numberValue(row, "credential_version"),
      securityOperationId: nullableUuid(row, "security_operation_id"),
      createdAt: date(row, "created_at"),
    };
  }

  public async getCredential(normalizedEmail: string): Promise<PasswordCredential | undefined> {
    // Q-IDN-002: actor step-up credential read.
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
      securityOperationId: nullableUuid(row, "security_operation_id"),
      status: text(row, "status"),
      updatedAt: date(row, "updated_at"),
    };
  }

  public async verifyLecturer(input: {
    expected: AdminUser;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean> {
    // Q-IDN-001: privilege-elevation canonical LWT. Advances token_version exactly once.
    const rows = await this.client.execute(
      `UPDATE user_by_id SET lecturer_verified=true,token_version=?,security_operation_id=?,updated_at=?
       WHERE user_id=? IF role='LECTURER' AND status='ACTIVE' AND lecturer_verified=false AND token_version=?`,
      [
        input.expected.tokenVersion + 1,
        uuid(input.operationId),
        input.updatedAt,
        uuid(input.expected.userId),
        input.expected.tokenVersion,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async synchronizeCredentialMarker(input: {
    normalizedEmail: string;
    userId: string;
    credentialVersion: number;
    expectedOperationId: string | null;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean> {
    const condition = input.expectedOperationId
      ? "IF user_id=? AND credential_version=? AND security_operation_id=? AND status='ACTIVE'"
      : "IF user_id=? AND credential_version=? AND security_operation_id=null AND status='ACTIVE'";
    const rows = await this.client.execute(
      `UPDATE credential_by_email SET security_operation_id=?,updated_at=?
       WHERE normalized_email=? ${condition}`,
      [
        uuid(input.operationId),
        input.updatedAt,
        input.normalizedEmail,
        uuid(input.userId),
        long(input.credentialVersion),
        ...(input.expectedOperationId ? [uuid(input.expectedOperationId)] : []),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async getPublicProjection(lecturerId: string): Promise<PublicLecturerProjection | undefined> {
    // Q-IDN-006: exact public projection read at the registry candidate consistency.
    const rows = await this.client.execute(
      `SELECT lecturer_id,display_name,bio,avatar_object_key,verified,profile_version,updated_at
       FROM public_lecturer_by_id WHERE lecturer_id=?`,
      [uuid(lecturerId)],
      LOCAL_ONE,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      lecturerId: text(row, "lecturer_id"),
      displayName: text(row, "display_name"),
      bio: nullableText(row, "bio"),
      avatarObjectKey: nullableText(row, "avatar_object_key"),
      verified: Boolean(row.get("verified")),
      profileVersion: numberValue(row, "profile_version"),
      updatedAt: date(row, "updated_at"),
    };
  }

  public async insertPublicProjection(input: {
    lecturerId: string;
    displayName: string;
    profileVersion: number;
    updatedAt: Date;
  }): Promise<boolean> {
    // Q-IDN-006: initial-creation producer. bio/avatar remain null until the lecturer edits them.
    const rows = await this.client.execute(
      `INSERT INTO public_lecturer_by_id
       (lecturer_id,display_name,bio,avatar_object_key,verified,profile_version,updated_at)
       VALUES (?,?,null,null,true,?,?) IF NOT EXISTS`,
      [uuid(input.lecturerId), input.displayName, long(input.profileVersion), input.updatedAt],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async reconcilePublicProjection(input: {
    lecturerId: string;
    displayName: string;
    profileVersion: number;
    updatedAt: Date;
  }): Promise<boolean> {
    // Q-IDN-006: reconcile an existing row to verified=true while preserving bio/avatar.
    const rows = await this.client.execute(
      `UPDATE public_lecturer_by_id SET display_name=?,verified=true,profile_version=?,updated_at=?
       WHERE lecturer_id=?`,
      [input.displayName, long(input.profileVersion), input.updatedAt, uuid(input.lecturerId)],
      LOCAL_QUORUM,
    );
    void rows;
    // Plain UPDATE converges representation; exact read-back in the service confirms it.
    return true;
  }

  public async getAdminProjection(input: {
    role: string;
    status: string;
    shard: number;
    updatedAt: Date;
    userId: string;
  }): Promise<AdminProjectionRow | undefined> {
    const rows = await this.client.execute(
      `SELECT role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version
       FROM users_by_role_status_bucket
       WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?`,
      [input.role, input.status, input.shard, input.updatedAt, uuid(input.userId)],
      LOCAL_QUORUM,
    );
    return rows[0] ? projection(rows[0], input.shard) : undefined;
  }

  public async insertAdminProjection(row: AdminProjectionRow): Promise<boolean> {
    const rows = await this.client.execute(
      `INSERT INTO users_by_role_status_bucket
       (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version)
       VALUES (?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        row.role,
        row.status,
        row.shard,
        row.updatedAt,
        uuid(row.userId),
        row.displayName,
        row.lecturerVerified,
        long(row.profileVersion),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async removeAdminProjection(row: AdminProjectionRow): Promise<boolean> {
    const rows = await this.client.execute(
      `DELETE FROM users_by_role_status_bucket
       WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?
       IF display_name=? AND lecturer_verified=? AND profile_version=?`,
      [
        row.role,
        row.status,
        row.shard,
        row.updatedAt,
        uuid(row.userId),
        row.displayName,
        row.lecturerVerified,
        long(row.profileVersion),
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
    targetId: string;
    fingerprint: string;
    createdAt: Date;
    ttlSeconds: number;
  }): Promise<{ created: boolean; record: IdempotencyRecord }> {
    // Q-IDN-007: reserve the actor/target scoped command key before the mutation.
    const rows = await this.client.execute(
      `INSERT INTO idempotency_by_scope_key
       (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS USING TTL ?`,
      [
        input.scope,
        input.keyHash,
        input.idempotencyKey,
        uuid(input.operationId),
        uuid(input.targetId),
        0,
        "IN_PROGRESS",
        input.fingerprint,
        input.createdAt,
        new Date(input.createdAt.getTime() + input.ttlSeconds * 1_000),
        input.ttlSeconds,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    const record = await this.getIdempotency(input.scope, input.keyHash, input.idempotencyKey);
    if (!record) throw new Error("LECTURER_VERIFY_IDEMPOTENCY_RESERVATION_MISSING");
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
    metadata: LecturerVerifyMetadata;
    resultCode?: number;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `UPDATE idempotency_by_scope_key SET status=?,result_code=?,result_checksum=?
       WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=? AND status=?`,
      [
        input.nextStatus,
        input.resultCode ?? 0,
        serializeLecturerVerifyMetadata(input.metadata),
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
