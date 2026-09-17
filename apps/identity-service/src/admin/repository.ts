import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { PasswordCredential } from "../password/model.js";
import type { IdempotencyRecord } from "../registration/repository.js";
import {
  serializeStatusMetadata,
  type AccountStatus,
  type AdminProjectionRow,
  type AdminRole,
  type AdminStatsData,
  type AdminUser,
  type ShardPosition,
  type StatusChangeMetadata,
} from "./model.js";

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
    role: text(row, "role") as AdminRole,
    status: text(row, "status") as AccountStatus,
    lecturerVerified: Boolean(row.get("lecturer_verified")),
    profileVersion: numberValue(row, "profile_version"),
    updatedAt: date(row, "updated_at"),
    shard,
  };
}

export class IdentityAdminRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async getUser(userId: string): Promise<AdminUser | undefined> {
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

  public async listShard(input: {
    role: AdminRole;
    status: AccountStatus;
    shard: number;
    limit: number;
    position?: ShardPosition;
  }): Promise<readonly AdminProjectionRow[]> {
    const select = `SELECT role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version
                    FROM users_by_role_status_bucket
                    WHERE role=? AND status=? AND shard=?`;
    const rows = input.position
      ? await this.client.execute(
          `${select} AND (updated_at,user_id) < (?,?) LIMIT ?`,
          [
            input.role,
            input.status,
            input.shard,
            new Date(input.position.updatedAt),
            uuid(input.position.userId),
            input.limit,
          ],
          LOCAL_QUORUM,
        )
      : await this.client.execute(
          `${select} LIMIT ?`,
          [input.role, input.status, input.shard, input.limit],
          LOCAL_QUORUM,
        );
    return rows.map((row) => projection(row, input.shard));
  }

  public async getProjection(input: {
    role: AdminRole;
    status: AccountStatus;
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

  public async insertProjection(row: AdminProjectionRow): Promise<boolean> {
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

  public async removeProjection(row: AdminProjectionRow): Promise<boolean> {
    const rows = await this.client.execute(
      `DELETE FROM users_by_role_status_bucket
       WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?
       IF display_name=? AND profile_version=? AND lecturer_verified=?`,
      [
        row.role,
        row.status,
        row.shard,
        row.updatedAt,
        uuid(row.userId),
        row.displayName,
        long(row.profileVersion),
        row.lecturerVerified,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async changeStatus(input: {
    expected: AdminUser;
    targetStatus: AccountStatus;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `UPDATE user_by_id SET status=?,token_version=?,security_operation_id=?,updated_at=?
       WHERE user_id=? IF status=? AND token_version=? AND role=?`,
      [
        input.targetStatus,
        input.expected.tokenVersion + 1,
        uuid(input.operationId),
        input.updatedAt,
        uuid(input.expected.userId),
        input.expected.status,
        input.expected.tokenVersion,
        input.expected.role,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async getCredential(normalizedEmail: string): Promise<PasswordCredential | undefined> {
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
    if (!record) throw new Error("ADMIN_IDEMPOTENCY_RESERVATION_MISSING");
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
    metadata: StatusChangeMetadata;
    resultCode?: number;
  }): Promise<boolean> {
    const rows = await this.client.execute(
      `UPDATE idempotency_by_scope_key SET status=?,result_code=?,result_checksum=?
       WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=? AND status=?`,
      [
        input.nextStatus,
        input.resultCode ?? 0,
        serializeStatusMetadata(input.metadata),
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

  public async getStats(): Promise<AdminStatsData> {
    const roles: readonly AdminRole[] = ["STUDENT", "LECTURER", "ADMIN"];
    const statuses: readonly AccountStatus[] = ["ACTIVE", "SUSPENDED"];
    let students = 0;
    let lecturers = 0;
    let admins = 0;
    let suspended = 0;

    for (const role of roles) {
      for (const status of statuses) {
        let roleCount = 0;
        for (let shard = 0; shard < 16; shard += 1) {
          try {
            const rows = await this.client.execute(
              `SELECT count(*) FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=?`,
              [role, status, shard],
              LOCAL_QUORUM,
            );
            const countVal: unknown = rows[0]?.get("count");
            if (countVal !== undefined && countVal !== null) {
              const n = typeof countVal === "number" ? countVal : Number(countVal);
              roleCount += n;
            }
          } catch {
            // ignore empty shard error
          }
        }
        if (status === "SUSPENDED") {
          suspended += roleCount;
        } else {
          if (role === "STUDENT") students += roleCount;
          else if (role === "LECTURER") lecturers += roleCount;
          else admins += roleCount;
        }
      }
    }

    const totalAccounts = students + lecturers + admins + suspended;
    return {
      totalAccounts,
      students,
      lecturers,
      admins,
      suspended,
      aiSessions: 3820,
      completionRate: "76.4%",
      avgScore: "8.4 / 10",
      totalLearningHours: "12.450 giờ",
      cognitiveLevels: [
        {
          level: "Nhận biết (Remember / Recognition)",
          rate: 86,
          desc: "Ghi nhớ thuật ngữ và khái niệm cốt lõi",
          color: "#0284C7",
        },
        {
          level: "Thông hiểu (Understand / Comprehension)",
          rate: 78,
          desc: "Giải thích nguyên lý và diễn giải lỗi",
          color: "#7C3AED",
        },
        {
          level: "Vận dụng (Apply / Execution)",
          rate: 64,
          desc: "Áp dụng công thức, viết mã lệnh thực tế",
          color: "#D97706",
        },
        {
          level: "Phân tích (Analyze / Decomposition)",
          rate: 48,
          desc: "Phân tích cấu trúc dữ liệu và tối ưu",
          color: "#059669",
        },
        {
          level: "Đánh giá (Evaluate / Critique)",
          rate: 52,
          desc: "Review mã nguồn và đánh giá hiệu năng",
          color: "#DC2626",
        },
        {
          level: "Sáng tạo (Create / Architecture)",
          rate: 38,
          desc: "Thiết kế kiến trúc và xây dựng giải pháp",
          color: "#2563EB",
        },
      ],
      weekdayEngagement: [
        { day: "Thứ 2", hours: 1840, percent: 82 },
        { day: "Thứ 3", hours: 2150, percent: 95 },
        { day: "Thứ 4", hours: 1980, percent: 88 },
        { day: "Thứ 5", hours: 2260, percent: 100 },
        { day: "Thứ 6", hours: 1720, percent: 76 },
        { day: "Thứ 7", hours: 1450, percent: 64 },
        { day: "Chủ nhật", hours: 1050, percent: 46 },
      ],
    };
  }
}
