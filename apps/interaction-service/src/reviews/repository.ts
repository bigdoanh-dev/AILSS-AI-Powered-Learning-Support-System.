/* eslint-disable @typescript-eslint/no-base-to-string */
import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import type { Review } from "./model.js";
const LQ = "LOCAL_QUORUM" as const,
  LS = "LOCAL_SERIAL" as const,
  u = (v: string) => types.Uuid.fromString(v),
  l = (v: number) => types.Long.fromNumber(v),
  date = (v: string) => types.LocalDate.fromString(v),
  shard = (id: string) => (createHash("sha256").update(id).digest()[0] ?? 0) % 8,
  eventShard = (id: string) => (createHash("sha256").update(id).digest()[0] ?? 0) % 16,
  applied = (r: readonly Record<string, unknown>[]) => r[0]?.["[applied]"] === true;
export class ReviewRepository {
  constructor(private db: CassandraClient) {}
  async canonical(student: string, course: string) {
    const r = (
      await this.db.execute(
        "SELECT * FROM review_by_student_course WHERE student_id=? AND course_id=?",
        [u(student), u(course)],
        LQ,
      )
    )[0];
    return r ? row(r) : undefined;
  }
  async locator(id: string) {
    const r = (
      await this.db.execute(
        "SELECT student_id,course_id,canonical_version FROM review_locator_by_id WHERE review_id=?",
        [u(id)],
        LQ,
      )
    )[0];
    return r
      ? {
          studentId: String(r.student_id),
          courseId: String(r.course_id),
          version: Number(r.canonical_version),
        }
      : undefined;
  }
  async create(r: Review) {
    return applied(
      await this.db.execute(
        "INSERT INTO review_by_student_course (student_id,course_id,review_id,rating,body_sanitized,state,version,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE',1,?,?) IF NOT EXISTS",
        [u(r.authorId), u(r.courseId), u(r.reviewId), r.rating, r.body, r.createdAt, r.updatedAt],
        LQ,
        LS,
      ),
    );
  }
  async locate(r: Review) {
    await this.db.execute(
      "INSERT INTO review_locator_by_id (review_id,student_id,course_id,canonical_version,updated_at) VALUES (?,?,?,?,?)",
      [u(r.reviewId), u(r.authorId), u(r.courseId), l(r.version), r.updatedAt],
      LQ,
    );
  }
  async mutate(r: Review, expected: number, operationId: string) {
    return applied(
      await this.db.execute(
        "UPDATE review_by_student_course SET rating=?,body_sanitized=?,state=?,version=?,updated_at=?,pending_operation_id=?,pending_expected_version=? WHERE student_id=? AND course_id=? IF version=?",
        [
          r.rating,
          r.body,
          r.state,
          l(r.version),
          r.updatedAt,
          u(operationId),
          l(expected),
          u(r.authorId),
          u(r.courseId),
          l(expected),
        ],
        LQ,
        LS,
      ),
    );
  }
  async project(r: Review) {
    const m = r.createdAt.toISOString().slice(0, 7) + "-01";
    if (r.state !== "ACTIVE") {
      await this.db.execute(
        "DELETE FROM reviews_by_course_bucket WHERE course_id=? AND year_month=? AND shard=? AND created_at=? AND review_id=?",
        [u(r.courseId), date(m), shard(r.reviewId), r.createdAt, u(r.reviewId)],
        LQ,
      );
      return;
    }
    await this.db.execute(
      "INSERT INTO reviews_by_course_bucket (course_id,year_month,shard,created_at,review_id,student_id,rating,body_sanitized,state,review_version) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [
        u(r.courseId),
        date(m),
        shard(r.reviewId),
        r.createdAt,
        u(r.reviewId),
        u(r.authorId),
        r.rating,
        r.body,
        r.state,
        l(r.version),
      ],
      LQ,
    );
  }
  async bounds(course: string) {
    const r = (
      await this.db.execute(
        "SELECT earliest_month,latest_month,version FROM review_timeline_bounds_by_course WHERE course_id=?",
        [u(course)],
        LQ,
      )
    )[0];
    return r
      ? { earliest: String(r.earliest_month), latest: String(r.latest_month), version: Number(r.version) }
      : undefined;
  }
  async includeMonth(course: string, m: string, now: Date) {
    for (let n = 0; n < 5; n++) {
      const b = await this.bounds(course);
      if (!b) {
        if (
          applied(
            await this.db.execute(
              "INSERT INTO review_timeline_bounds_by_course (course_id,earliest_month,latest_month,version,updated_at) VALUES (?,?,?,1,?) IF NOT EXISTS",
              [u(course), date(m), date(m), now],
              LQ,
              LS,
            ),
          )
        )
          return;
        continue;
      }
      if (m >= b.earliest && m <= b.latest) return;
      const e = m < b.earliest ? m : b.earliest,
        x = m > b.latest ? m : b.latest;
      if (
        applied(
          await this.db.execute(
            "UPDATE review_timeline_bounds_by_course SET earliest_month=?,latest_month=?,version=?,updated_at=? WHERE course_id=? IF version=?",
            [date(e), date(x), l(b.version + 1), now, u(course), l(b.version)],
            LQ,
            LS,
          ),
        )
      )
        return;
    }
    throw new Error("REVIEW_BOUNDS_CONTENTION");
  }
  async list(course: string, month: string, snapshot: Date) {
    const rows = (
      await Promise.all(
        Array.from({ length: 8 }, (_, s) =>
          this.db.execute(
            "SELECT * FROM reviews_by_course_bucket WHERE course_id=? AND year_month=? AND shard=? AND created_at<=? LIMIT 101",
            [u(course), date(month), s, snapshot],
            LQ,
          ),
        ),
      )
    ).flat();
    return rows
      .map(projection)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.reviewId.localeCompare(b.reviewId));
  }
  async summary(course: string) {
    const r = (
      await this.db.execute(
        "SELECT review_count,rating_sum,version FROM rating_summary_by_course WHERE course_id=?",
        [u(course)],
        LQ,
      )
    )[0];
    return r
      ? { count: Number(r.review_count), sum: Number(r.rating_sum), version: Number(r.version) }
      : { count: 0, sum: 0, version: 0 };
  }
  async reconcile(r: Review, operationId: string, now: Date) {
    let locked = false;
    for (let n = 0; n < 8 && !locked; n++) {
      const x = await this.db.execute(
        "INSERT INTO rating_mutation_by_course (course_id,operation_id,expires_at,updated_at) VALUES (?,?,?,?) IF NOT EXISTS USING TTL 30",
        [u(r.courseId), u(operationId), new Date(now.getTime() + 30000), now],
        LQ,
        LS,
      );
      locked = applied(x) || String(x[0]?.operation_id) === operationId;
      if (!locked) await new Promise((v) => setTimeout(v, 25));
    }
    if (!locked) throw new Error("RATING_BUSY");
    try {
      const old = (
          await this.db.execute(
            "SELECT applied_active,applied_rating,applied_review_version,last_operation_id FROM rating_contribution_by_course_review WHERE course_id=? AND review_id=?",
            [u(r.courseId), u(r.reviewId)],
            LQ,
          )
        )[0],
        s = await this.summary(r.courseId),
        oldActive = old?.applied_active === true,
        oldRating = Number(old?.applied_rating ?? 0),
        active = r.state === "ACTIVE",
        dc = Number(active) - Number(oldActive),
        ds = (active ? r.rating : 0) - (oldActive ? oldRating : 0);
      if (dc || ds) {
        const rows =
          s.version === 0
            ? await this.db.execute(
                "INSERT INTO rating_summary_by_course (course_id,review_count,rating_sum,average,source_watermark,checksum,version,updated_at,last_operation_id) VALUES (?,?,?,?,0,'',1,?,?) IF NOT EXISTS",
                [u(r.courseId), l(dc), l(ds), dc ? ds / dc : 0, now, u(operationId)],
                LQ,
                LS,
              )
            : await this.db.execute(
                "UPDATE rating_summary_by_course SET review_count=?,rating_sum=?,average=?,version=?,updated_at=?,last_operation_id=? WHERE course_id=? IF version=?",
                [
                  l(s.count + dc),
                  l(s.sum + ds),
                  s.count + dc ? (s.sum + ds) / (s.count + dc) : 0,
                  l(s.version + 1),
                  now,
                  u(operationId),
                  u(r.courseId),
                  l(s.version),
                ],
                LQ,
                LS,
              );
        if (!applied(rows)) {
          const check = await this.db.execute(
            "SELECT last_operation_id FROM rating_summary_by_course WHERE course_id=?",
            [u(r.courseId)],
            LQ,
          );
          if (String(check[0]?.last_operation_id) !== operationId) throw new Error("RATING_VERSION_CONFLICT");
        }
      }
      await this.db.execute(
        "INSERT INTO rating_contribution_by_course_review (course_id,review_id,applied_review_version,applied_active,applied_rating,last_operation_id,updated_at) VALUES (?,?,?,?,?,?,?)",
        [u(r.courseId), u(r.reviewId), l(r.version), active, r.rating, u(operationId), now],
        LQ,
      );
    } finally {
      await this.db.execute(
        "DELETE FROM rating_mutation_by_course WHERE course_id=? IF operation_id=?",
        [u(r.courseId), u(operationId)],
        LQ,
        LS,
      );
    }
  }
  async prepareEvent(eventId: string, r: Review, occurredAt: Date, correlationId: string) {
    const e: EventEnvelope = {
        specVersion: "1.0",
        eventId,
        eventType: "interaction.review.created.v1",
        occurredAt: occurredAt.toISOString(),
        producer: "interaction-service",
        correlationId,
        aggregate: { type: "REVIEW", id: r.reviewId, version: r.version },
        data: { reviewId: r.reviewId, courseId: r.courseId, rating: r.rating, version: r.version },
      },
      d = occurredAt.toISOString().slice(0, 10),
      s = eventShard(eventId);
    await this.db.execute(
      "INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at) VALUES (?,?,?,?,?,?,?,?, 'READY',0,0,?) IF NOT EXISTS",
      [
        date(d),
        s,
        occurredAt,
        u(eventId),
        "interaction.review.created.v1",
        u(r.reviewId),
        l(r.version),
        JSON.stringify(e),
        occurredAt,
      ],
      LQ,
      LS,
    );
    await this.db.execute(
      "INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?, 'READY',?,0,0,?) IF NOT EXISTS",
      [u(eventId), "interaction.review.created.v1", u(r.reviewId), l(r.version), occurredAt, occurredAt],
      LQ,
      LS,
    );
  }
}
function row(r: Record<string, unknown>): Review {
  return {
    reviewId: String(r.review_id),
    courseId: String(r.course_id),
    authorId: String(r.student_id),
    rating: Number(r.rating),
    body: r.body_sanitized === null ? null : String(r.body_sanitized),
    state: String(r.state) as Review["state"],
    version: Number(r.version),
    createdAt: new Date(r.created_at as Date),
    updatedAt: new Date(r.updated_at as Date),
    ...(r.pending_operation_id
      ? {
          pendingOperationId: String(r.pending_operation_id),
          pendingExpectedVersion: Number(r.pending_expected_version),
        }
      : {}),
  };
}
function projection(r: Record<string, unknown>): Review {
  return row({
    ...r,
    course_id: r.course_id,
    author_id: r.student_id,
    version: r.review_version,
    updated_at: r.created_at,
  });
}
