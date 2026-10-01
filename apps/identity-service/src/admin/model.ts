import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const ADMIN_ROLES = ["STUDENT", "LECTURER", "ADMIN"] as const;
export const ACCOUNT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export const ADMIN_SHARD_COUNT = 16;
export const ADMIN_CURSOR_TTL_SECONDS = 900;
export const ADMIN_STATUS_IDEMPOTENCY_TTL_SECONDS = 86_400;

export type AdminRole = (typeof ADMIN_ROLES)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

const searchSchema = z
  .object({
    role: z.enum(ADMIN_ROLES),
    status: z.enum(ACCOUNT_STATUSES),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(16).max(16_384).optional(),
  })
  .strict();

const statusRequestSchema = z
  .object({
    status: z.enum(ACCOUNT_STATUSES),
    currentPassword: z.string().min(1).max(128),
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export interface AdminSearchQuery {
  readonly role: AdminRole;
  readonly status: AccountStatus;
  readonly limit: number;
  readonly cursor?: string;
}

export interface AdminProjectionRow {
  readonly userId: string;
  readonly displayName: string;
  readonly role: AdminRole;
  readonly status: AccountStatus;
  readonly lecturerVerified: boolean;
  readonly profileVersion: number;
  readonly updatedAt: Date;
  readonly shard: number;
}

export interface AdminUser extends AdminProjectionRow {
  readonly emailMasked: string;
  readonly normalizedEmail: string;
  readonly tokenVersion: number;
  readonly credentialVersion: number;
  readonly securityOperationId: string | null;
  readonly createdAt: Date;
}

export interface AdminStatusRequest {
  readonly status: AccountStatus;
  readonly currentPassword: string;
  readonly reason?: string;
}

export interface ShardPosition {
  readonly updatedAt: string;
  readonly userId: string;
}

export interface AdminCursorPayload {
  readonly v: 1;
  readonly role: AdminRole;
  readonly status: AccountStatus;
  readonly filtersHash: string;
  readonly direction: "forward";
  readonly issuedAt: number;
  readonly perShardPositions: Readonly<Record<string, ShardPosition>>;
}

export interface StatusChangeMetadata {
  readonly schemaVersion: 1;
  readonly requestFingerprint: string;
  readonly actorId: string;
  readonly targetId: string;
  readonly role: Exclude<AdminRole, "ADMIN">;
  readonly displayName: string;
  readonly lecturerVerified: boolean;
  readonly profileVersion: number;
  readonly oldStatus: AccountStatus;
  readonly newStatus: AccountStatus;
  readonly shard: number;
  readonly oldUpdatedAt: string;
  readonly newUpdatedAt: string;
  readonly expectedTokenVersion: number;
  readonly nextTokenVersion: number;
  readonly previousSecurityOperationId: string | null;
  readonly eventId: string;
  readonly auditEventId: string;
  readonly reasonClass: "PROVIDED" | "UNSPECIFIED";
}

export function parseAdminSearchQuery(value: unknown): AdminSearchQuery {
  const parsed = searchSchema.parse(value);
  return {
    role: parsed.role,
    status: parsed.status,
    limit: parsed.limit,
    ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
  };
}

export function parseAdminStatusRequest(value: unknown): AdminStatusRequest {
  const parsed = statusRequestSchema.parse(value);
  return {
    status: parsed.status,
    currentPassword: parsed.currentPassword,
    ...(parsed.reason ? { reason: parsed.reason } : {}),
  };
}

export function identitySearchShard(userId: string): number {
  return (createHash("sha256").update(userId, "utf8").digest()[0] ?? 0) % ADMIN_SHARD_COUNT;
}

export function adminFiltersHash(role: AdminRole, status: AccountStatus): string {
  return createHash("sha256").update(JSON.stringify({ role, status }), "utf8").digest("hex");
}

export function encodeAdminCursor(secret: string, payload: AdminCursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body, "utf8").digest("base64url");
  return `${body}.${signature}`;
}

export function decodeAdminCursor(
  secret: string,
  cursor: string,
  expected: { role: AdminRole; status: AccountStatus },
  nowSeconds = Math.floor(Date.now() / 1_000),
): AdminCursorPayload {
  const [body, signature, extra] = cursor.split(".");
  if (!body || !signature || extra) throw new Error("INVALID_CURSOR");
  const expectedSignature = createHmac("sha256", secret).update(body, "utf8").digest();
  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(signature, "base64url");
    if (actualSignature.toString("base64url") !== signature) throw new Error("NON_CANONICAL");
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error("INVALID_CURSOR");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  const positionSchema = z.object({ updatedAt: z.string().datetime(), userId: z.string().uuid() }).strict();
  const schema = z
    .object({
      v: z.literal(1),
      role: z.enum(ADMIN_ROLES),
      status: z.enum(ACCOUNT_STATUSES),
      filtersHash: z.string().regex(/^[a-f0-9]{64}$/u),
      direction: z.literal("forward"),
      issuedAt: z.number().int().nonnegative(),
      perShardPositions: z.record(z.string().regex(/^(?:[0-9]|1[0-5])$/u), positionSchema),
    })
    .strict();
  const payload = schema.parse(parsed);
  if (
    payload.role !== expected.role ||
    payload.status !== expected.status ||
    payload.filtersHash !== adminFiltersHash(expected.role, expected.status) ||
    payload.issuedAt > nowSeconds ||
    nowSeconds - payload.issuedAt > ADMIN_CURSOR_TTL_SECONDS
  ) {
    throw new Error("INVALID_CURSOR");
  }
  return payload;
}

export function statusChangeScope(actorId: string, targetId: string): string {
  return `admin:${actorId}:target:${targetId}:IDN-11`;
}

export function statusCommandFingerprint(
  secret: string,
  actorId: string,
  targetId: string,
  request: AdminStatusRequest,
): string {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify({
        api: "IDN-11",
        method: "PATCH",
        path: `/api/v1/admin/users/${targetId}/status`,
        actorId,
        targetId,
        status: request.status,
        reason: request.reason ?? null,
        currentPassword: request.currentPassword,
      }),
      "utf8",
    )
    .digest("hex");
}

export function serializeStatusMetadata(value: StatusChangeMetadata): string {
  return JSON.stringify(value);
}

export function parseStatusMetadata(value: string): StatusChangeMetadata | undefined {
  try {
    return z
      .object({
        schemaVersion: z.literal(1),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        actorId: z.string().uuid(),
        targetId: z.string().uuid(),
        role: z.enum(["STUDENT", "LECTURER"]),
        displayName: z.string().min(2).max(100),
        lecturerVerified: z.boolean(),
        profileVersion: z.number().int().positive(),
        oldStatus: z.enum(ACCOUNT_STATUSES),
        newStatus: z.enum(ACCOUNT_STATUSES),
        shard: z.number().int().min(0).max(15),
        oldUpdatedAt: z.string().datetime(),
        newUpdatedAt: z.string().datetime(),
        expectedTokenVersion: z.number().int().positive(),
        nextTokenVersion: z.number().int().positive(),
        previousSecurityOperationId: z.string().uuid().nullable(),
        eventId: z.string().uuid(),
        auditEventId: z.string().uuid(),
        reasonClass: z.enum(["PROVIDED", "UNSPECIFIED"]),
      })
      .strict()
      .parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export interface AdminStatsData {
  readonly totalAccounts: number;
  readonly students: number;
  readonly lecturers: number;
  readonly admins: number;
  readonly suspended: number;
  readonly aiSessions: number | null;
  readonly completionRate: string | null;
  readonly avgScore: string | null;
  readonly totalLearningHours: string | null;
  readonly cognitiveLevels: readonly {
    readonly level: string;
    readonly rate: number;
    readonly desc: string;
    readonly color: string;
  }[];
  readonly weekdayEngagement: readonly {
    readonly day: string;
    readonly hours: number;
    readonly percent: number;
  }[];
}
