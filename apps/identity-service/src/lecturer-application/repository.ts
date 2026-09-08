import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import { idempotencyKeyHash } from "../registration/model.js";
import { type Application, type Command, shardOf, unavailable } from "./model.js";
const u = (s: string) => types.Uuid.fromString(s),
  d = (s: string) => types.LocalDate.fromString(s);
const Q = "LOCAL_QUORUM",
  S = "LOCAL_SERIAL";
export class ApplicationRepository {
  constructor(readonly client: CassandraClient) {}
  async application(id: string): Promise<Application | undefined> {
    const r = (
      await this.client.execute(
        "SELECT payload_json,review_operation_id FROM lecturer_application_by_applicant WHERE applicant_id=?",
        [u(id)],
        Q,
      )
    )[0];
    if (!r) return undefined;
    const a = JSON.parse(String(r.get("payload_json"))) as Application;
    const review: unknown = r.get("review_operation_id");
    a.reviewOperationId = review instanceof types.Uuid ? review.toString() : null;
    return a;
  }
  async locate(id: string): Promise<string | undefined> {
    const value: unknown = (
      await this.client.execute(
        "SELECT applicant_id FROM lecturer_application_locator_by_id WHERE application_id=?",
        [u(id)],
        Q,
      )
    )[0]?.get("applicant_id");
    return value instanceof types.Uuid ? value.toString() : undefined;
  }
  async command(scope: string, key: string): Promise<Command | undefined> {
    const r = (
      await this.client.execute(
        "SELECT result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?",
        [scope, idempotencyKeyHash(key), key],
        Q,
      )
    )[0];
    return r ? (JSON.parse(String(r.get("result_checksum"))) as Command) : undefined;
  }
  async intent(c: Command) {
    await this.client.execute(
      "INSERT INTO identity_commands_by_due_bucket (due_day,shard,next_attempt_at,operation_id,scope,key_hash,idempotency_key,intent_json,lease_owner,lease_until,fence) VALUES (?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS",
      [
        d(c.createdAt.slice(0, 10)),
        shardOf(c.operationId),
        new Date(c.createdAt),
        u(c.operationId),
        c.scope,
        idempotencyKeyHash(c.key),
        c.key,
        JSON.stringify(c),
        "",
        new Date(0),
        0,
      ],
      Q,
      S,
    );
  }
  async reserve(c: Command): Promise<Command> {
    // No TTL for this approved command family. Old API journals are unchanged.
    try {
      await this.client.execute(
        "INSERT INTO idempotency_by_scope_key (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at) VALUES (?,?,?,?,?,?,?,?,?) IF NOT EXISTS",
        [
          c.scope,
          idempotencyKeyHash(c.key),
          c.key,
          u(c.operationId),
          u(c.applicationId),
          0,
          "APPLICATION_COMMAND",
          JSON.stringify(c),
          new Date(c.createdAt),
        ],
        Q,
        S,
      );
    } catch {
      /* ambiguous LWT: exact read below */
    }
    const actual = await this.command(c.scope, c.key);
    if (!actual) throw unavailable();
    return actual;
  }
  async finish(c: Command) {
    try {
      await this.client.execute(
        "UPDATE idempotency_by_scope_key SET result_checksum=?,status=?,result_code=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=? AND status='APPLICATION_COMMAND'",
        [
          JSON.stringify(c),
          "APPLICATION_COMPLETE",
          c.error ? 409 : c.kind === "SUBMIT" ? 201 : 200,
          c.scope,
          idempotencyKeyHash(c.key),
          c.key,
          u(c.operationId),
        ],
        Q,
        S,
      );
    } catch {
      /* Exact read-back resolves a lost final LWT acknowledgement. */
    }
    const actual = await this.command(c.scope, c.key);
    if (!actual || actual.operationId !== c.operationId || (!actual.result && !actual.error))
      throw unavailable();
    if (actual.error !== c.error || JSON.stringify(actual.result) !== JSON.stringify(c.result))
      throw unavailable();
  }
  async insert(a: Application) {
    try {
      await this.client.execute(
        "INSERT INTO lecturer_application_by_applicant (applicant_id,application_id,payload_json,status,version,submission_operation_id,review_operation_id) VALUES (?,?,?,?,?,?,null) IF NOT EXISTS",
        [
          u(a.applicantId),
          u(a.applicationId),
          JSON.stringify(a),
          a.status,
          a.version,
          u(a.submissionOperationId),
        ],
        Q,
        S,
      );
    } catch {
      /* read-back is authoritative */
    }
    return this.application(a.applicantId);
  }
  async locator(a: Application) {
    try {
      await this.client.execute(
        "INSERT INTO lecturer_application_locator_by_id (application_id,applicant_id) VALUES (?,?) IF NOT EXISTS",
        [u(a.applicationId), u(a.applicantId)],
        Q,
        S,
      );
    } catch {
      /* exact read-back */
    }
    if ((await this.locate(a.applicationId)) !== a.applicantId) throw unavailable();
  }
  async pending(a: Application) {
    await this.client.execute(
      "INSERT INTO pending_lecturer_applications_by_month_shard (submission_month,shard,submitted_at,application_id,applicant_id,display_name_snapshot,teaching_area) VALUES (?,?,?,?,?,?,?)",
      [
        d(a.submittedAt.slice(0, 7) + "-01"),
        shardOf(a.applicantId),
        new Date(a.submittedAt),
        u(a.applicationId),
        u(a.applicantId),
        a.displayNameSnapshot,
        a.teachingArea,
      ],
      Q,
    );
  }
  async removePending(a: Application) {
    await this.client.execute(
      "DELETE FROM pending_lecturer_applications_by_month_shard WHERE submission_month=? AND shard=? AND submitted_at=? AND application_id=?",
      [
        d(a.submittedAt.slice(0, 7) + "-01"),
        shardOf(a.applicantId),
        new Date(a.submittedAt),
        u(a.applicationId),
      ],
      Q,
    );
  }
  async claim(c: Command) {
    try {
      await this.client.execute(
        "UPDATE lecturer_application_by_applicant SET review_operation_id=? WHERE applicant_id=? IF status='SUBMITTED' AND version=1 AND review_operation_id=null",
        [u(c.operationId), u(c.applicantId)],
        Q,
        S,
      );
    } catch {
      /* exact read-back */
    }
    return this.application(c.applicantId);
  }
  async releaseFailedClaim(c: Command) {
    await this.client.execute(
      "UPDATE lecturer_application_by_applicant SET review_operation_id=null WHERE applicant_id=? IF status='SUBMITTED' AND review_operation_id=?",
      [u(c.applicantId), u(c.operationId)],
      Q,
      S,
    );
  }
  async terminal(c: Command): Promise<Application> {
    const a = {
      ...c.application,
      status: c.kind === "APPROVE" ? ("APPROVED" as const) : ("REJECTED" as const),
      decidedAt: c.createdAt,
      reviewerId: c.actorId,
      decision: c.kind as "APPROVE" | "REJECT",
      version: 2,
      reviewOperationId: c.operationId,
    };
    try {
      await this.client.execute(
        "UPDATE lecturer_application_by_applicant SET payload_json=?,status=?,version=2 WHERE applicant_id=? IF review_operation_id=? AND status='SUBMITTED'",
        [JSON.stringify(a), a.status, u(c.applicantId), u(c.operationId)],
        Q,
        S,
      );
    } catch {
      /* exact read-back */
    }
    const actual = await this.application(c.applicantId);
    if (actual?.status !== a.status || actual.reviewOperationId !== c.operationId) throw unavailable();
    return actual;
  }
  async page(month: string, shard: number, limit: number, pageState?: string) {
    return this.client.executePage(
      "SELECT applicant_id FROM pending_lecturer_applications_by_month_shard WHERE submission_month=? AND shard=?",
      [d(month + "-01"), shard],
      Q,
      limit,
      pageState,
    );
  }
  async promote(c: Command) {
    const expected = c.expectedUser;
    if (!expected) throw unavailable();
    try {
      await this.client.execute(
        "UPDATE user_by_id SET role='LECTURER',lecturer_verified=false,token_version=?,security_operation_id=?,updated_at=? WHERE user_id=? IF role='STUDENT' AND status='ACTIVE' AND token_version=? AND credential_version=? AND updated_at=?",
        [
          expected.tokenVersion + 1,
          u(c.operationId),
          new Date(c.createdAt),
          u(c.applicantId),
          expected.tokenVersion,
          types.Long.fromNumber(expected.credentialVersion),
          new Date(expected.updatedAt),
        ],
        Q,
        S,
      );
    } catch {
      /* caller exact-read-back */
    }
  }
  async due(day: string, shard: number, pageState?: string) {
    return this.client.executePage(
      "SELECT next_attempt_at,operation_id,intent_json,lease_until,fence FROM identity_commands_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at<=?",
      [d(day), shard, new Date()],
      Q,
      32,
      pageState,
    );
  }
  async lease(c: Command, owner: string, fence: number, until: Date): Promise<boolean> {
    const r = await this.client.execute(
      "UPDATE identity_commands_by_due_bucket SET lease_owner=?,lease_until=?,fence=? WHERE due_day=? AND shard=? AND next_attempt_at=? AND operation_id=? IF fence=? AND lease_until=?",
      [
        owner,
        new Date(Date.now() + 30000),
        fence + 1,
        d(c.createdAt.slice(0, 10)),
        shardOf(c.operationId),
        new Date(c.createdAt),
        u(c.operationId),
        fence,
        until,
      ],
      Q,
      S,
    );
    return Boolean(r[0]?.get("[applied]"));
  }
  async removeIntent(c: Command, owner: string, fence: number) {
    await this.client.execute(
      "DELETE FROM identity_commands_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at=? AND operation_id=? IF lease_owner=? AND fence=?",
      [
        d(c.createdAt.slice(0, 10)),
        shardOf(c.operationId),
        new Date(c.createdAt),
        u(c.operationId),
        owner,
        fence,
      ],
      Q,
      S,
    );
  }
}
