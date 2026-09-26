import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { AuthoringCourse } from "../authoring/model.js";
import type { LessonContentRef, LessonDetail, LessonReceipt, LessonSummary } from "./model.js";

const LQ = "LOCAL_QUORUM" as const;
const LS = "LOCAL_SERIAL" as const;
const uuid = (value: string) => types.Uuid.fromString(value);
const long = (value: number) => types.Long.fromNumber(value);

export interface LessonCommandRecord {
  operationId: string;
  resourceId: string;
  status: string;
  receipt: LessonReceipt;
}

export class LearningLessonRepository {
  public constructor(private readonly db: CassandraClient) {}

  public async reserve(
    scope: string,
    keyHash: number,
    key: string,
    operationId: string,
    lessonId: string,
    receipt: LessonReceipt,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO idempotency_by_scope_key
       (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at)
       VALUES (?,?,?,?,?,0,'IN_PROGRESS',?,?,?) IF NOT EXISTS`,
      [
        scope,
        keyHash,
        key,
        uuid(operationId),
        uuid(lessonId),
        JSON.stringify(receipt),
        now,
        new Date(now.getTime() + 86_400_000),
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }

  public async command(
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<LessonCommandRecord | undefined> {
    const rows = await this.db.execute(
      `SELECT operation_id,resource_id,status,result_checksum FROM idempotency_by_scope_key
       WHERE scope=? AND key_hash=? AND idempotency_key=?`,
      [scope, keyHash, key],
      LQ,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      operationId: String(row.operation_id),
      resourceId: String(row.resource_id),
      status: String(row.status),
      receipt: JSON.parse(String(row.result_checksum)) as LessonReceipt,
    };
  }

  public async checkpoint(
    scope: string,
    keyHash: number,
    key: string,
    operationId: string,
    receipt: LessonReceipt,
  ): Promise<void> {
    const rows = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET result_checksum=?
       WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=? AND status='IN_PROGRESS'`,
      [JSON.stringify(receipt), scope, keyHash, key, uuid(operationId)],
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("LESSON_COMMAND_CHECKPOINT_CONFLICT");
  }

  public async complete(
    scope: string,
    keyHash: number,
    key: string,
    operationId: string,
    receipt: LessonReceipt,
  ): Promise<void> {
    const rows = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET status='COMPLETE',result_code=200,result_checksum=?
       WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [JSON.stringify(receipt), scope, keyHash, key, uuid(operationId)],
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("LESSON_COMMAND_COMPLETE_CONFLICT");
  }

  public async course(courseId: string): Promise<AuthoringCourse | undefined> {
    const rows = await this.db.execute(
      `SELECT course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,
              price_type,price,currency,created_at,updated_at,published_at
       FROM course_by_id WHERE course_id=?`,
      [uuid(courseId)],
      LQ,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      courseId: String(row.course_id),
      ownerLecturerId: String(row.owner_lecturer_id),
      title: String(row.title),
      slug: String(row.slug),
      categoryId: String(row.category_id),
      state: String(row.state),
      contentVersion: Number(row.content_version),
      recordVersion: Number(row.record_version),
      priceType: String(row.price_type),
      price: String(row.price),
      currency: String(row.currency),
      createdAt: date(row.created_at),
      updatedAt: date(row.updated_at),
      ...(row.published_at ? { publishedAt: date(row.published_at) } : {}),
    };
  }

  public async list(courseId: string, contentVersion: number, ceiling = 1_999): Promise<LessonSummary[]> {
    const result: LessonSummary[] = [];
    let cursor: LessonSummary | undefined;
    for (;;) {
      const base = `SELECT section_order,lesson_order,lesson_id,section_title,lesson_title,state,preview,object_key,lesson_version
                    FROM lessons_by_course_version WHERE course_id=? AND content_version=?`;
      const rows = cursor
        ? await this.db.execute(
            `${base} AND (section_order,lesson_order,lesson_id)>(?,?,?) LIMIT 100`,
            [
              uuid(courseId),
              long(contentVersion),
              cursor.sectionOrder,
              cursor.lessonOrder,
              uuid(cursor.lessonId),
            ],
            LQ,
          )
        : await this.db.execute(`${base} LIMIT 100`, [uuid(courseId), long(contentVersion)], LQ);
      for (const row of rows) {
        result.push(summary(row));
        if (result.length > ceiling) throw new Error("SYLLABUS_LIMIT_EXCEEDED");
      }
      if (rows.length < 100) return result;
      cursor = result.at(-1);
      if (!cursor) return result;
    }
  }

  public async clearSnapshot(courseId: string, contentVersion: number): Promise<void> {
    await this.db.execute(
      "DELETE FROM lessons_by_course_version WHERE course_id=? AND content_version=?",
      [uuid(courseId), long(contentVersion)],
      LQ,
    );
  }

  public async writeSnapshot(courseId: string, contentVersion: number, lessons: readonly LessonSummary[]) {
    for (const lesson of lessons)
      await this.db.execute(
        `INSERT INTO lessons_by_course_version
         (course_id,content_version,section_order,lesson_order,lesson_id,section_title,lesson_title,state,preview,object_key,lesson_version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          uuid(courseId),
          long(contentVersion),
          lesson.sectionOrder,
          lesson.lessonOrder,
          uuid(lesson.lessonId),
          lesson.sectionTitle,
          lesson.title,
          lesson.state,
          lesson.preview,
          lesson.objectKey ?? null,
          long(lesson.lessonVersion),
        ],
        LQ,
      );
  }

  public async writeDetail(
    lesson: LessonSummary,
    courseId: string,
    contentVersion: number,
    contentRef: LessonContentRef | undefined,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO lesson_by_id_version
       (lesson_id,lesson_version,course_id,content_version,state,preview,title,object_key,checksum,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(lesson.lessonId),
        long(lesson.lessonVersion),
        uuid(courseId),
        long(contentVersion),
        lesson.state,
        lesson.preview,
        lesson.title,
        contentRef?.objectKey ?? lesson.objectKey ?? null,
        contentRef?.sha256 ?? null,
        now,
      ],
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] === true) return true;
    const existing = await this.detail(lesson.lessonId, lesson.lessonVersion);
    return !!existing && existing.courseId === courseId && existing.title === lesson.title;
  }

  public async pointer(lessonId: string) {
    const rows = await this.db.execute(
      "SELECT lesson_version,course_id,updated_at FROM lesson_current_by_id WHERE lesson_id=?",
      [uuid(lessonId)],
      LQ,
    );
    const row = rows[0];
    return row
      ? {
          lessonVersion: Number(row.lesson_version),
          courseId: String(row.course_id),
          updatedAt: date(row.updated_at),
        }
      : undefined;
  }

  public async detail(lessonId: string, lessonVersion: number): Promise<LessonDetail | undefined> {
    const rows = await this.db.execute(
      `SELECT lesson_id,lesson_version,course_id,content_version,state,preview,title,object_key,checksum,updated_at
       FROM lesson_by_id_version WHERE lesson_id=? AND lesson_version=?`,
      [uuid(lessonId), long(lessonVersion)],
      LQ,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      lessonId: String(row.lesson_id),
      lessonVersion: Number(row.lesson_version),
      courseId: String(row.course_id),
      contentVersion: Number(row.content_version),
      state: String(row.state) as LessonDetail["state"],
      preview: row.preview === true,
      title: String(row.title),
      ...(row.object_key ? { objectKey: String(row.object_key) } : {}),
      ...(row.checksum ? { checksum: String(row.checksum) } : {}),
      updatedAt: date(row.updated_at),
    };
  }

  public async acquireBuilder(
    courseId: string,
    operationId: string,
    source: number,
    target: number,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO content_mutation_by_course
       (course_id,operation_id,source_content_version,target_content_version,expires_at,updated_at)
       VALUES (?,?,?,?,?,?) IF NOT EXISTS USING TTL 300`,
      [uuid(courseId), uuid(operationId), long(source), long(target), new Date(now.getTime() + 300_000), now],
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] === true) return true;
    return String(rows[0]?.operation_id) === operationId;
  }

  public async releaseBuilder(courseId: string, operationId: string): Promise<void> {
    await this.db.execute(
      "DELETE FROM content_mutation_by_course WHERE course_id=? IF operation_id=?",
      [uuid(courseId), uuid(operationId)],
      LQ,
      LS,
    );
  }

  public async activate(course: AuthoringCourse, target: number): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE course_by_id SET content_version=? WHERE course_id=?
       IF state='DRAFT' AND content_version=? AND record_version=?`,
      [long(target), uuid(course.courseId), long(course.contentVersion), long(course.recordVersion)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }

  public async setPointer(
    lessonId: string,
    lessonVersion: number,
    courseId: string,
    now: Date,
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO lesson_current_by_id (lesson_id,lesson_version,course_id,updated_at)
       VALUES (?,?,?,?)`,
      [uuid(lessonId), long(lessonVersion), uuid(courseId), now],
      LQ,
    );
  }

  public async hasAccess(studentId: string, courseId: string): Promise<boolean> {
    const entitlement = await this.db.execute(
      "SELECT state FROM entitlement_by_student_course WHERE student_id=? AND course_id=?",
      [uuid(studentId), uuid(courseId)],
      LQ,
    );
    if (entitlement[0]) return String(entitlement[0].state ?? "") === "ACTIVE";
    // P7.17 verified migration-window compatibility fallback. Canonical entitlement is always read first.
    const rows = await this.db.execute(
      "SELECT state FROM enrollment_by_student_course WHERE student_id=? AND course_id=?",
      [uuid(studentId), uuid(courseId)],
      LQ,
    );
    return ["ACTIVE", "ENTITLED", "ENROLLED"].includes(String(rows[0]?.state ?? ""));
  }
}

function summary(row: Record<string, unknown>): LessonSummary {
  return {
    lessonId: String(row.lesson_id),
    lessonVersion: Number(row.lesson_version),
    sectionOrder: Number(row.section_order),
    lessonOrder: Number(row.lesson_order),
    sectionTitle: String(row.section_title),
    title: String(row.lesson_title),
    state: String(row.state) as LessonSummary["state"],
    preview: row.preview === true,
    ...(typeof row.object_key === "string" ? { objectKey: row.object_key } : {}),
  };
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
