import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../packages/cassandra/src/index.js";
import type { Comment, ResourceType } from "./model.js";

const uuid = (v: string) => types.Uuid.fromString(v),
  applied = (r: readonly Record<string, unknown>[]) => r[0]?.["[applied]"] === true;
export interface Position {
  createdAt: string;
  commentId: string;
}
export interface Candidate {
  comment: Comment;
  partition: string;
}
export interface Bounds {
  earliestDay: string;
  latestDay: string;
  version: number;
}
export interface Receipt {
  operationId: string;
  resourceId: string;
  fingerprint: string;
  status: string;
  commandState: string;
  responseStatus: number;
  resultVersion: number;
  body?: string;
}
export class InteractionRepository {
  constructor(private readonly db: CassandraClient) {}
  async get(id: string): Promise<Comment | undefined> {
    const r = (
      await this.db.execute(`SELECT * FROM comment_by_id WHERE comment_id=?`, [uuid(id)], "LOCAL_QUORUM")
    )[0];
    return r ? row(r) : undefined;
  }
  async create(c: Comment): Promise<boolean> {
    return applied(
      await this.db.execute(
        `INSERT INTO comment_by_id (comment_id,target_type,target_id,author_id,parent_id,body_sanitized,state,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
        [
          uuid(c.commentId),
          c.resourceType,
          uuid(c.resourceId),
          uuid(c.authorId),
          c.parentId ? uuid(c.parentId) : null,
          c.body,
          c.state,
          c.version,
          c.createdAt,
          c.updatedAt,
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      ),
    );
  }
  async claim(
    id: string,
    expected: number,
    operationId: string,
    kind: string,
    checksum: string,
  ): Promise<boolean> {
    return applied(
      await this.db.execute(
        `UPDATE comment_by_id SET pending_operation_id=?,pending_operation_kind=?,pending_expected_version=?,pending_content_checksum=? WHERE comment_id=? IF version=? AND pending_operation_id=null`,
        [uuid(operationId), kind, expected, checksum, uuid(id), expected],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      ),
    );
  }
  async applyMutation(c: Comment, expected: number, operationId: string): Promise<boolean> {
    return applied(
      await this.db.execute(
        `UPDATE comment_by_id SET body_sanitized=?,state=?,version=?,updated_at=? WHERE comment_id=? IF version=? AND pending_operation_id=?`,
        [c.body, c.state, c.version, c.updatedAt, uuid(c.commentId), expected, uuid(operationId)],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      ),
    );
  }
  async clearClaim(id: string, operationId: string): Promise<void> {
    await this.db.execute(
      `UPDATE comment_by_id SET pending_operation_id=null,pending_operation_kind=null,pending_expected_version=null,pending_content_checksum=null WHERE comment_id=? IF pending_operation_id=?`,
      [uuid(id), uuid(operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async project(c: Comment): Promise<void> {
    await this.db.execute(
      `INSERT INTO comments_by_target_bucket (target_type,target_id,day_bucket,shard,created_at,comment_id,author_id,parent_id,body_sanitized,state,comment_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        c.resourceType,
        uuid(c.resourceId),
        localDate(day(c.createdAt)),
        shard(c.commentId),
        c.createdAt,
        uuid(c.commentId),
        uuid(c.authorId),
        c.parentId ? uuid(c.parentId) : null,
        c.body,
        c.state,
        c.version,
      ],
      "LOCAL_QUORUM",
    );
  }
  async projection(c: Comment): Promise<Comment | undefined> {
    const r = (
      await this.db.execute(
        `SELECT * FROM comments_by_target_bucket WHERE target_type=? AND target_id=? AND day_bucket=? AND shard=? AND created_at=? AND comment_id=?`,
        [
          c.resourceType,
          uuid(c.resourceId),
          localDate(day(c.createdAt)),
          shard(c.commentId),
          c.createdAt,
          uuid(c.commentId),
        ],
        "LOCAL_QUORUM",
      )
    )[0];
    return r ? projection(r) : undefined;
  }
  async bounds(type: ResourceType, id: string): Promise<Bounds | undefined> {
    const r = (
      await this.db.execute(
        `SELECT earliest_day,latest_day,version FROM comment_timeline_bounds_by_target WHERE target_type=? AND target_id=?`,
        [type, uuid(id)],
        "LOCAL_QUORUM",
      )
    )[0];
    return r
      ? { earliestDay: String(r.earliest_day), latestDay: String(r.latest_day), version: Number(r.version) }
      : undefined;
  }
  async includeDay(type: ResourceType, id: string, value: string, now: Date): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.bounds(type, id);
      if (!current) {
        if (
          applied(
            await this.db.execute(
              `INSERT INTO comment_timeline_bounds_by_target (target_type,target_id,earliest_day,latest_day,version,updated_at) VALUES (?,?,?,?,1,?) IF NOT EXISTS`,
              [type, uuid(id), localDate(value), localDate(value), now],
              "LOCAL_QUORUM",
              "LOCAL_SERIAL",
            ),
          )
        )
          return;
        continue;
      }
      if (value >= current.earliestDay && value <= current.latestDay) return;
      const earliest = value < current.earliestDay ? value : current.earliestDay,
        latest = value > current.latestDay ? value : current.latestDay;
      if (
        applied(
          await this.db.execute(
            `UPDATE comment_timeline_bounds_by_target SET earliest_day=?,latest_day=?,version=?,updated_at=? WHERE target_type=? AND target_id=? IF version=? AND earliest_day=? AND latest_day=?`,
            [
              localDate(earliest),
              localDate(latest),
              current.version + 1,
              now,
              type,
              uuid(id),
              current.version,
              localDate(current.earliestDay),
              localDate(current.latestDay),
            ],
            "LOCAL_QUORUM",
            "LOCAL_SERIAL",
          ),
        )
      )
        return;
    }
    throw new Error("BOUNDS_CONTENTION");
  }
  async listWindow(
    type: ResourceType,
    id: string,
    days: readonly string[],
    snapshot: Date,
    positions: Readonly<Record<string, Position>>,
  ): Promise<{ candidates: Candidate[]; exhausted: boolean }> {
    const parts = days.flatMap((d) =>
      Array.from({ length: 8 }, (_, s) => ({ d, s, key: `${d}:${String(s)}` })),
    );
    const rows = await Promise.all(
      parts.map(async (p) => {
        const pos = positions[p.key],
          upper = pos ? new Date(pos.createdAt) : snapshot,
          result = await this.db.execute(
            `SELECT * FROM comments_by_target_bucket WHERE target_type=? AND target_id=? AND day_bucket=? AND shard=? AND created_at<=? LIMIT 101`,
            [type, uuid(id), localDate(p.d), p.s, upper],
            "LOCAL_QUORUM",
          );
        return result
          .map((r) => ({ comment: projection(r), partition: p.key }))
          .filter(
            (x) =>
              !pos ||
              x.comment.createdAt.toISOString() < pos.createdAt ||
              (x.comment.createdAt.toISOString() === pos.createdAt && x.comment.commentId > pos.commentId),
          );
      }),
    );
    return {
      candidates: rows
        .flat()
        .sort(
          (a, b) =>
            b.comment.createdAt.getTime() - a.comment.createdAt.getTime() ||
            a.comment.commentId.localeCompare(b.comment.commentId),
        ),
      exhausted: rows.every((x) => x.length < 101),
    };
  }
  async operationState(operationId: string): Promise<string | undefined> {
    const r = (
      await this.db.execute(
        `SELECT state FROM reconcile_operation_by_id WHERE operation_id=?`,
        [uuid(operationId)],
        "LOCAL_QUORUM",
      )
    )[0];
    return r ? String(r.state) : undefined;
  }
  async markOperation(operationId: string, commentId: string, state: string, now: Date): Promise<void> {
    await this.db.execute(
      `INSERT INTO reconcile_operation_by_id (operation_id,projection_name,canonical_id,canonical_version,projection_version,checksum,state,retry_count,next_attempt_at,updated_at) VALUES (?,'COMMENT_MUTATION',?,0,0,'',?,0,?,?)`,
      [uuid(operationId), uuid(commentId), state, now, now],
      "LOCAL_QUORUM",
    );
  }
  async receipt(scope: string, hash: number, key: string): Promise<Receipt | undefined> {
    const r = (
      await this.db.execute(
        `SELECT operation_id,resource_id,request_fingerprint,status,command_state,response_status,result_version,response_body_json FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?`,
        [scope, hash, key],
        "LOCAL_QUORUM",
      )
    )[0];
    return r
      ? {
          operationId: String(r.operation_id),
          resourceId: String(r.resource_id),
          fingerprint: String(r.request_fingerprint),
          status: String(r.status),
          commandState: String(r.command_state),
          responseStatus: Number(r.response_status),
          resultVersion: Number(r.result_version),
          ...(r.response_body_json ? { body: String(r.response_body_json) } : {}),
        }
      : undefined;
  }
  async reserve(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resourceId: string,
    fingerprint: string,
    now: Date,
  ): Promise<boolean> {
    return applied(
      await this.db.execute(
        `INSERT INTO idempotency_by_scope_key (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at,request_fingerprint,command_state,updated_at) VALUES (?,?,?,?,?,0,'IN_PROGRESS','',?,?,?,?,?) IF NOT EXISTS`,
        [
          scope,
          hash,
          key,
          uuid(operationId),
          uuid(resourceId),
          now,
          new Date(now.getTime() + 86400000),
          fingerprint,
          "RESERVED",
          now,
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      ),
    );
  }
  async checkpoint(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    state: string,
    now: Date,
  ): Promise<void> {
    if (
      !applied(
        await this.db.execute(
          `UPDATE idempotency_by_scope_key SET command_state=?,updated_at=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
          [state, now, scope, hash, key, uuid(operationId)],
          "LOCAL_QUORUM",
          "LOCAL_SERIAL",
        ),
      )
    )
      throw new Error("RECEIPT_CONFLICT");
  }
  async complete(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    status: number,
    version: number,
    body: string,
    checksum: string,
    now: Date,
  ): Promise<void> {
    if (
      !applied(
        await this.db.execute(
          `UPDATE idempotency_by_scope_key SET status='COMPLETE',result_code=?,command_state='COMPLETE',result_version=?,response_status=?,response_body_json=?,response_checksum=?,updated_at=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
          [status, version, status, body, checksum, now, scope, hash, key, uuid(operationId)],
          "LOCAL_QUORUM",
          "LOCAL_SERIAL",
        ),
      )
    )
      throw new Error("RECEIPT_CONFLICT");
  }
}
function row(r: Record<string, unknown>): Comment {
  return {
    commentId: String(r.comment_id),
    resourceType: String(r.target_type) as ResourceType,
    resourceId: String(r.target_id),
    parentId: r.parent_id ? safeString(r.parent_id) : null,
    authorId: String(r.author_id),
    body: r.body_sanitized === null ? null : safeString(r.body_sanitized),
    state: String(r.state) as Comment["state"],
    version: Number(r.version),
    createdAt: new Date(r.created_at as string | number | Date),
    updatedAt: new Date(r.updated_at as string | number | Date),
    ...(r.pending_operation_id
      ? {
          pendingOperationId: safeString(r.pending_operation_id),
          pendingOperationKind: String(r.pending_operation_kind),
          pendingExpectedVersion: Number(r.pending_expected_version),
          pendingContentChecksum: String(r.pending_content_checksum),
        }
      : {}),
  };
}
function projection(r: Record<string, unknown>): Comment {
  return row({ ...r, version: r.comment_version, updated_at: r.created_at });
}
export function day(d: Date) {
  return d.toISOString().slice(0, 10);
}
function localDate(value: string) {
  return types.LocalDate.fromString(value);
}
export function shard(id: string) {
  return (createHash("sha256").update(id.toLowerCase()).digest()[0] ?? 0) % 8;
}
function safeString(value: unknown) {
  return typeof value === "string" ? value : String(value);
}
