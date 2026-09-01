import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import { eventBucket, type AuthoringCourse, type CommandIds } from "../authoring/model.js";
import { learningShard, yearMonthKey } from "../catalog/model.js";

const LQ = "LOCAL_QUORUM" as const;
const LS = "LOCAL_SERIAL" as const;
const uuid = (v: string) => types.Uuid.fromString(v);
const long = (v: number) => types.Long.fromNumber(v);
const month = (v: string) => types.LocalDate.fromString(`${v}-01`);

export class LearningLifecycleRepository {
  public constructor(private readonly db: CassandraClient) {}

  public async allLessonsReady(courseId: string, contentVersion: number): Promise<boolean> {
    let cursor: { section: number; lesson: number; id: string } | undefined;
    let count = 0;
    for (;;) {
      const select = `SELECT section_order,lesson_order,lesson_id,state FROM lessons_by_course_version
                      WHERE course_id=? AND content_version=?`;
      const rows = cursor
        ? await this.db.execute(
            `${select} AND (section_order,lesson_order,lesson_id)>(?,?,?) LIMIT 25`,
            [uuid(courseId), long(contentVersion), cursor.section, cursor.lesson, uuid(cursor.id)],
            LQ,
          )
        : await this.db.execute(`${select} LIMIT 25`, [uuid(courseId), long(contentVersion)], LQ);
      for (const row of rows) {
        count += 1;
        if (String(row.state) !== "READY") return false;
      }
      if (rows.length < 25) return count > 0;
      const last = rows.at(-1);
      if (!last) return count > 0;
      cursor = {
        section: Number(last.section_order),
        lesson: Number(last.lesson_order),
        id: String(last.lesson_id),
      };
    }
  }

  public async transition(
    course: AuthoringCourse,
    from: "DRAFT" | "IN_REVIEW" | "PUBLISHED",
    to: "IN_REVIEW" | "PUBLISHED" | "ARCHIVED",
    now: Date,
    publishedAt?: Date,
  ): Promise<boolean> {
    const next = course.recordVersion + 1;
    const setPublished = to === "PUBLISHED" ? ",published_at=?" : "";
    const params: unknown[] = [to, long(next), now];
    if (to === "PUBLISHED") params.push(publishedAt);
    params.push(uuid(course.courseId), from, long(course.recordVersion), long(course.contentVersion));
    const rows = await this.db.execute(
      `UPDATE course_by_id SET state=?,record_version=?,updated_at=?${setPublished}
       WHERE course_id=? IF state=? AND record_version=? AND content_version=?`,
      params,
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }

  public async claimSlug(
    course: AuthoringCourse,
    version: number,
    publishedAt: Date,
  ): Promise<"OWNED" | "CONFLICT"> {
    const values = [
      course.slug,
      uuid(course.courseId),
      "PUBLISHED",
      course.title,
      uuid(course.categoryId),
      course.priceType,
      types.BigDecimal.fromString(course.price),
      course.currency,
      long(version),
      publishedAt,
    ];
    const rows = await this.db.execute(
      `INSERT INTO course_by_slug
       (normalized_slug,course_id,state,title,category_id,price_type,price,currency,course_version,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      values,
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] === true) return "OWNED";
    if (String(rows[0]?.course_id) !== course.courseId) return "CONFLICT";
    const recovered = await this.db.execute(
      `UPDATE course_by_slug SET state='PUBLISHED',title=?,category_id=?,price_type=?,price=?,currency=?,course_version=?,updated_at=?
       WHERE normalized_slug=? IF course_id=?`,
      [
        course.title,
        uuid(course.categoryId),
        course.priceType,
        types.BigDecimal.fromString(course.price),
        course.currency,
        long(version),
        publishedAt,
        course.slug,
        uuid(course.courseId),
      ],
      LQ,
      LS,
    );
    return recovered[0]?.["[applied]"] === true ? "OWNED" : "CONFLICT";
  }

  public async writePublicProjections(
    course: AuthoringCourse,
    version: number,
    publishedAt: Date,
    searchTokens: readonly string[],
  ): Promise<void> {
    const ym = month(yearMonthKey(publishedAt));
    const shard = learningShard(course.courseId);
    await this.db.execute(
      `INSERT INTO published_courses_by_category_bucket
       (category_id,year_month,shard,published_at,course_id,slug,title,lecturer_id,price_type,price,currency,course_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid(course.categoryId),
        ym,
        shard,
        publishedAt,
        uuid(course.courseId),
        course.slug,
        course.title,
        uuid(course.ownerLecturerId),
        course.priceType,
        types.BigDecimal.fromString(course.price),
        course.currency,
        long(version),
      ],
      LQ,
    );
    for (const token of searchTokens)
      await this.db.execute(
        `INSERT INTO published_courses_by_search_token_bucket
         (token_prefix,year_month,shard,published_at,course_id,slug,title,category_id,course_version)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          token,
          ym,
          shard,
          publishedAt,
          uuid(course.courseId),
          course.slug,
          course.title,
          uuid(course.categoryId),
          long(version),
        ],
        LQ,
      );
  }

  public async publicProjectionsMatch(
    course: AuthoringCourse,
    version: number,
    publishedAt: Date,
    searchTokens: readonly string[],
  ): Promise<boolean> {
    const ym = month(yearMonthKey(publishedAt));
    const shard = learningShard(course.courseId);
    const category = await this.db.execute(
      `SELECT slug,title,lecturer_id,course_version FROM published_courses_by_category_bucket
       WHERE category_id=? AND year_month=? AND shard=? AND published_at=? AND course_id=?`,
      [uuid(course.categoryId), ym, shard, publishedAt, uuid(course.courseId)],
      LQ,
    );
    const row = category[0];
    if (
      !row ||
      String(row.slug) !== course.slug ||
      String(row.title) !== course.title ||
      String(row.lecturer_id) !== course.ownerLecturerId ||
      Number(row.course_version) !== version
    )
      return false;
    for (const token of searchTokens) {
      const rows = await this.db.execute(
        `SELECT slug,title,category_id,course_version FROM published_courses_by_search_token_bucket
         WHERE token_prefix=? AND year_month=? AND shard=? AND published_at=? AND course_id=?`,
        [token, ym, shard, publishedAt, uuid(course.courseId)],
        LQ,
      );
      const search = rows[0];
      if (
        !search ||
        String(search.slug) !== course.slug ||
        String(search.title) !== course.title ||
        String(search.category_id) !== course.categoryId ||
        Number(search.course_version) !== version
      )
        return false;
    }
    return true;
  }

  public async prepareEvent(input: {
    ids: CommandIds;
    eventType: "learning.course.published.v1" | "system.projection.reconcile.v1";
    version: number;
    occurredAt: Date;
    correlationId: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    const envelope: EventEnvelope = {
      specVersion: "1.0",
      eventId: input.ids.eventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt.toISOString(),
      producer: "learning-service",
      correlationId: input.correlationId,
      aggregate: { type: "COURSE", id: input.ids.courseId, version: input.version },
      data: input.data,
    };
    const dueDay = input.occurredAt.toISOString().slice(0, 10);
    const shard = eventBucket(input.ids.eventId);
    await this.db.execute(
      `INSERT INTO pending_events_by_due_bucket
       (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at)
       VALUES (?,?,?,?,?,?,?,?,'PREPARED',0,0,?) IF NOT EXISTS`,
      [
        types.LocalDate.fromString(dueDay),
        shard,
        input.occurredAt,
        uuid(input.ids.eventId),
        input.eventType,
        uuid(input.ids.courseId),
        long(input.version),
        JSON.stringify(envelope),
        input.occurredAt,
      ],
      LQ,
      LS,
    );
    await this.db.execute(
      `INSERT INTO pending_event_by_id
       (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at)
       VALUES (?,?,?,?,'PREPARED',?,0,0,?) IF NOT EXISTS`,
      [
        uuid(input.ids.eventId),
        input.eventType,
        uuid(input.ids.courseId),
        long(input.version),
        input.occurredAt,
        input.occurredAt,
      ],
      LQ,
      LS,
    );
  }
}
