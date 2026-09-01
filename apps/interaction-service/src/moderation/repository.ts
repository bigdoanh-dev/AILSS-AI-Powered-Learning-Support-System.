/* eslint-disable @typescript-eslint/no-base-to-string */
import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import type { ModerationAction, Report, TargetType } from "./model.js";
const LQ = "LOCAL_QUORUM" as const,
  LS = "LOCAL_SERIAL" as const,
  u = (v: string) => types.Uuid.fromString(v),
  l = (v: number) => types.Long.fromNumber(v),
  d = (v: string) => types.LocalDate.fromString(v),
  shard = (id: string, count = 8) => (createHash("sha256").update(id).digest()[0] ?? 0) % count,
  applied = (rows: readonly Record<string, unknown>[]) => rows[0]?.["[applied]"] === true;
export class ModerationRepository {
  constructor(private db: CassandraClient) {}
  async get(id: string) {
    const r = (await this.db.execute("SELECT * FROM report_by_id WHERE report_id=?", [u(id)], LQ))[0];
    return r ? row(r) : undefined;
  }
  async create(r: Report) {
    return applied(
      await this.db.execute(
        "INSERT INTO report_by_id (report_id,reporter_id,target_type,target_id,reason,state,decision,version,created_at,updated_at) VALUES (?,?,?,?,?,'OPEN',null,1,?,?) IF NOT EXISTS",
        [u(r.reportId), u(r.reporterId), r.targetType, u(r.targetId), r.reason, r.createdAt, r.updatedAt],
        LQ,
        LS,
      ),
    );
  }
  async project(r: Report) {
    await this.db.execute(
      "INSERT INTO reports_by_status_bucket (state,day_bucket,shard,created_at,report_id,target_type,target_id,priority,report_version) VALUES (?,?,?,?,?,?,?,0,?)",
      [
        r.state,
        d(day(r.createdAt)),
        shard(r.reportId),
        r.createdAt,
        u(r.reportId),
        r.targetType,
        u(r.targetId),
        l(r.version),
      ],
      LQ,
    );
  }
  async moveResolved(r: Report) {
    await this.db.execute(
      "DELETE FROM reports_by_status_bucket WHERE state='OPEN' AND day_bucket=? AND shard=? AND created_at=? AND report_id=?",
      [d(day(r.createdAt)), shard(r.reportId), r.createdAt, u(r.reportId)],
      LQ,
    );
    await this.project(r);
  }
  async bounds() {
    const r = (
      await this.db.execute(
        "SELECT earliest_day,latest_day,version FROM report_queue_bounds_by_state WHERE state='OPEN'",
        [],
        LQ,
      )
    )[0];
    return r
      ? { earliest: String(r.earliest_day), latest: String(r.latest_day), version: Number(r.version) }
      : undefined;
  }
  async includeDay(value: string, now: Date) {
    for (let n = 0; n < 5; n++) {
      const b = await this.bounds();
      if (!b) {
        if (
          applied(
            await this.db.execute(
              "INSERT INTO report_queue_bounds_by_state (state,earliest_day,latest_day,version,updated_at) VALUES ('OPEN',?,?,1,?) IF NOT EXISTS",
              [d(value), d(value), now],
              LQ,
              LS,
            ),
          )
        )
          return;
        continue;
      }
      if (value >= b.earliest && value <= b.latest) return;
      const earliest = value < b.earliest ? value : b.earliest,
        latest = value > b.latest ? value : b.latest;
      if (
        applied(
          await this.db.execute(
            "UPDATE report_queue_bounds_by_state SET earliest_day=?,latest_day=?,version=?,updated_at=? WHERE state='OPEN' IF version=?",
            [d(earliest), d(latest), l(b.version + 1), now, l(b.version)],
            LQ,
            LS,
          ),
        )
      )
        return;
    }
    throw new Error("REPORT_BOUNDS_CONTENTION");
  }
  async list(dayValue: string, afterAt: string, afterId: string) {
    const rows = (
      await Promise.all(
        Array.from({ length: 8 }, (_, s) =>
          this.db.execute(
            "SELECT * FROM reports_by_status_bucket WHERE state='OPEN' AND day_bucket=? AND shard=? LIMIT 101",
            [d(dayValue), s],
            LQ,
          ),
        ),
      )
    ).flat();
    return rows
      .map((r) => ({ createdAt: new Date(r.created_at as Date), reportId: String(r.report_id) }))
      .filter(
        (r) =>
          !afterAt ||
          r.createdAt.toISOString() > afterAt ||
          (r.createdAt.toISOString() === afterAt && r.reportId > afterId),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.reportId.localeCompare(b.reportId));
  }
  async claim(id: string, expected: number, operationId: string) {
    const result = await this.db.execute(
      "UPDATE report_by_id SET pending_operation_id=?,pending_expected_version=? WHERE report_id=? IF state='OPEN' AND version=? AND pending_operation_id=null",
      [u(operationId), l(expected), u(id), l(expected)],
      LQ,
      LS,
    );
    return applied(result) || String(result[0]?.pending_operation_id) === operationId;
  }
  async resolve(
    id: string,
    expected: number,
    operationId: string,
    action: ModerationAction,
    moderator: string,
    now: Date,
  ) {
    return applied(
      await this.db.execute(
        "UPDATE report_by_id SET state='RESOLVED',decision=?,moderator_id=?,version=?,updated_at=?,pending_operation_id=null,pending_expected_version=null WHERE report_id=? IF state='OPEN' AND version=? AND pending_operation_id=?",
        [action, u(moderator), l(expected + 1), now, u(id), l(expected), u(operationId)],
        LQ,
        LS,
      ),
    );
  }
  async prepareEvent(
    eventId: string,
    type: "interaction.report.created.v1" | "interaction.content.moderated.v1",
    report: Report,
    correlationId: string,
    data: Record<string, unknown>,
  ) {
    const at = new Date(),
      envelope: EventEnvelope = {
        specVersion: "1.0",
        eventId,
        eventType: type,
        occurredAt: at.toISOString(),
        producer: "interaction-service",
        correlationId,
        aggregate: { type: "REPORT", id: report.reportId, version: report.version },
        data,
      },
      dayValue = day(at),
      eventShard = shard(eventId, 16);
    await this.db.execute(
      "INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at) VALUES (?,?,?,?,?,?,?,?, 'READY',0,0,?) IF NOT EXISTS",
      [
        d(dayValue),
        eventShard,
        at,
        u(eventId),
        type,
        u(report.reportId),
        l(report.version),
        JSON.stringify(envelope),
        at,
      ],
      LQ,
      LS,
    );
    await this.db.execute(
      "INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?, 'READY',?,0,0,?) IF NOT EXISTS",
      [u(eventId), type, u(report.reportId), l(report.version), at, at],
      LQ,
      LS,
    );
  }
}
const day = (v: Date) => v.toISOString().slice(0, 10);
function row(r: Record<string, unknown>): Report {
  return {
    reportId: String(r.report_id),
    reporterId: String(r.reporter_id),
    targetType: String(r.target_type) as TargetType,
    targetId: String(r.target_id),
    reason: String(r.reason),
    state: String(r.state) as Report["state"],
    decision: r.decision ? (String(r.decision) as ModerationAction) : null,
    moderatorId: r.moderator_id ? String(r.moderator_id) : null,
    version: Number(r.version),
    createdAt: new Date(r.created_at as Date),
    updatedAt: new Date(r.updated_at as Date),
    ...(r.pending_operation_id ? { pendingOperationId: String(r.pending_operation_id) } : {}),
  };
}
