import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { AuthoringCourse } from "../authoring/model.js";
import type { Offering, OfferingReceipt, OfferingType } from "./model.js";

const LQ = "LOCAL_QUORUM" as const,
  LO = "LOCAL_ONE" as const,
  LS = "LOCAL_SERIAL" as const;
const uuid = (v: string) => types.Uuid.fromString(v),
  long = (v: number) => types.Long.fromNumber(v);
const localDate = (v: string) => types.LocalDate.fromString(v);

export class LearningOfferingRepository {
  public constructor(private readonly db: CassandraClient) {}
  public async course(courseId: string): Promise<AuthoringCourse | undefined> {
    const rows = await this.db.execute(
      `SELECT course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,created_at,updated_at,published_at FROM course_by_id WHERE course_id=?`,
      [uuid(courseId)],
      LQ,
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      courseId: String(r.course_id),
      ownerLecturerId: String(r.owner_lecturer_id),
      title: String(r.title),
      slug: String(r.slug),
      categoryId: String(r.category_id),
      state: String(r.state),
      contentVersion: num(r.content_version),
      recordVersion: num(r.record_version),
      priceType: String(r.price_type),
      price: String(r.price),
      currency: String(r.currency),
      createdAt: date(r.created_at),
      updatedAt: date(r.updated_at),
      ...(r.published_at ? { publishedAt: date(r.published_at) } : {}),
    };
  }
  public async get(id: string): Promise<Offering | undefined> {
    const rows = await this.db.execute(
      `SELECT offering_id,course_id,owner_lecturer_id,offering_type,class_id,title,state,price,currency,sales_start_at,sales_end_at,record_version,created_at,updated_at,published_at FROM offering_by_id WHERE offering_id=?`,
      [uuid(id)],
      LQ,
    );
    return rows[0] ? row(rows[0]) : undefined;
  }
  public async reserve(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resourceId: string,
    receipt: OfferingReceipt,
    now: Date,
  ) {
    const rows = await this.db.execute(
      `INSERT INTO idempotency_by_scope_key (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at) VALUES (?,?,?,?,?,0,'IN_PROGRESS',?,?,?) IF NOT EXISTS`,
      [
        scope,
        hash,
        key,
        uuid(operationId),
        uuid(resourceId),
        JSON.stringify(receipt),
        now,
        new Date(now.getTime() + 86_400_000),
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  public async command(scope: string, hash: number, key: string) {
    const rows = await this.db.execute(
      `SELECT operation_id,resource_id,status,result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?`,
      [scope, hash, key],
      LQ,
    );
    const r = rows[0];
    return r
      ? {
          operationId: String(r.operation_id),
          resourceId: String(r.resource_id),
          status: String(r.status),
          receipt: JSON.parse(String(r.result_checksum)) as OfferingReceipt,
        }
      : undefined;
  }
  public async checkpoint(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    receipt: OfferingReceipt,
    status = "IN_PROGRESS",
  ) {
    const rows = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET status=?,result_checksum=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [status, JSON.stringify(receipt), scope, hash, key, uuid(operationId)],
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("OFFERING_COMMAND_CONFLICT");
  }
  public async complete(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    receipt: OfferingReceipt,
    resultCode: number,
  ) {
    const rows = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET status='COMPLETE',result_code=?,result_checksum=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [resultCode, JSON.stringify(receipt), scope, hash, key, uuid(operationId)],
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("OFFERING_COMMAND_CONFLICT");
  }
  public async create(v: Offering) {
    const rows = await this.db.execute(
      `INSERT INTO offering_by_id (offering_id,course_id,owner_lecturer_id,offering_type,class_id,title,state,price,currency,sales_start_at,sales_end_at,record_version,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      params(v),
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  public async update(old: Offering, next: Offering) {
    const rows = await this.db.execute(
      `UPDATE offering_by_id SET title=?,price=?,currency=?,sales_start_at=?,sales_end_at=?,record_version=?,updated_at=? WHERE offering_id=? IF owner_lecturer_id=? AND state='DRAFT' AND record_version=?`,
      [
        next.title,
        types.BigDecimal.fromString(next.price),
        next.currency,
        next.salesStartAt ?? null,
        next.salesEndAt ?? null,
        long(next.recordVersion),
        next.updatedAt,
        uuid(next.offeringId),
        uuid(old.ownerLecturerId),
        long(old.recordVersion),
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  public async publish(old: Offering, next: Offering) {
    const rows = await this.db.execute(
      `UPDATE offering_by_id SET state='PUBLISHED',record_version=?,updated_at=?,published_at=? WHERE offering_id=? IF owner_lecturer_id=? AND state='DRAFT' AND record_version=?`,
      [
        long(next.recordVersion),
        next.updatedAt,
        next.publishedAt,
        uuid(next.offeringId),
        uuid(old.ownerLecturerId),
        long(old.recordVersion),
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  public async claimClass(
    classId: string,
    offeringId: string,
    courseId: string,
    offeringVersion: number,
    now: Date,
  ) {
    const rows = await this.db.execute(
      `INSERT INTO offering_by_class (class_id,offering_id,course_id,state,offering_version,claimed_at) VALUES (?,?,?,'CLAIMED',?,?) IF NOT EXISTS`,
      [uuid(classId), uuid(offeringId), uuid(courseId), long(offeringVersion), now],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  public async classClaim(classId: string) {
    const rows = await this.db.execute(
      `SELECT offering_id,course_id,state,offering_version,claimed_at FROM offering_by_class WHERE class_id=?`,
      [uuid(classId)],
      LQ,
    );
    const r = rows[0];
    return r
      ? {
          offeringId: String(r.offering_id),
          courseId: String(r.course_id),
          state: String(r.state),
          offeringVersion: num(r.offering_version),
          claimedAt: date(r.claimed_at),
        }
      : undefined;
  }
  public async finalizeClassClaim(classId: string, offeringId: string, offeringVersion: number) {
    const rows = await this.db.execute(
      `UPDATE offering_by_class SET state='PUBLISHED',offering_version=? WHERE class_id=? IF offering_id=?`,
      [long(offeringVersion), uuid(classId), uuid(offeringId)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  public async releaseClassClaim(classId: string, offeringId: string) {
    const rows = await this.db.execute(
      `DELETE FROM offering_by_class WHERE class_id=? IF offering_id=? AND state='CLAIMED'`,
      [uuid(classId), uuid(offeringId)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  public async syncPrivate(v: Offering, oldUpdatedAt?: Date) {
    if (oldUpdatedAt && oldUpdatedAt.getTime() !== v.updatedAt.getTime()) {
      await this.db.execute(
        `DELETE FROM offerings_by_course WHERE course_id=? AND updated_at=? AND offering_id=?`,
        [uuid(v.courseId), oldUpdatedAt, uuid(v.offeringId)],
        LQ,
      );
      await this.db.execute(
        `DELETE FROM offerings_by_lecturer WHERE lecturer_id=? AND updated_at=? AND offering_id=?`,
        [uuid(v.ownerLecturerId), oldUpdatedAt, uuid(v.offeringId)],
        LQ,
      );
    }
    await this.db.execute(
      `INSERT INTO offerings_by_course (course_id,updated_at,offering_id,owner_lecturer_id,offering_type,class_id,title,state,price,currency,offering_version) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid(v.courseId),
        v.updatedAt,
        uuid(v.offeringId),
        uuid(v.ownerLecturerId),
        v.offeringType,
        v.classId ? uuid(v.classId) : null,
        v.title,
        v.state,
        types.BigDecimal.fromString(v.price),
        v.currency,
        long(v.recordVersion),
      ],
      LQ,
    );
    await this.db.execute(
      `INSERT INTO offerings_by_lecturer (lecturer_id,updated_at,offering_id,course_id,offering_type,class_id,title,state,offering_version) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        uuid(v.ownerLecturerId),
        v.updatedAt,
        uuid(v.offeringId),
        uuid(v.courseId),
        v.offeringType,
        v.classId ? uuid(v.classId) : null,
        v.title,
        v.state,
        long(v.recordVersion),
      ],
      LQ,
    );
  }
  public async writePublic(v: Offering) {
    if (!v.publishedAt) throw new Error("PUBLISHED_AT_REQUIRED");
    await this.db.execute(
      `INSERT INTO public_offerings_by_type_bucket (offering_type,year_month,shard,published_at,offering_id,course_id,class_id,title,price,currency,sales_start_at,sales_end_at,offering_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        v.offeringType,
        localDate(v.publishedAt.toISOString().slice(0, 7) + "-01"),
        offeringShard(v.offeringId),
        v.publishedAt,
        uuid(v.offeringId),
        uuid(v.courseId),
        v.classId ? uuid(v.classId) : null,
        v.title,
        types.BigDecimal.fromString(v.price),
        v.currency,
        v.salesStartAt ?? null,
        v.salesEndAt ?? null,
        long(v.recordVersion),
      ],
      LQ,
    );
    await this.updateBounds(v.offeringType, v.publishedAt);
  }
  private async updateBounds(type: OfferingType, at: Date): Promise<void> {
    const m = localDate(at.toISOString().slice(0, 7) + "-01");
    const current = await this.bounds(type);
    if (!current) {
      await this.db.execute(
        `INSERT INTO offering_catalog_bounds_by_type (offering_type,newest_year_month,oldest_year_month,updated_at) VALUES (?,?,?,?) IF NOT EXISTS`,
        [type, m, m, new Date()],
        LQ,
        LS,
      );
      return this.updateBounds(type, at);
    }
    const newest =
        current.newest > at.toISOString().slice(0, 7) + "-01"
          ? current.newest
          : at.toISOString().slice(0, 7) + "-01",
      oldest =
        current.oldest < at.toISOString().slice(0, 7) + "-01"
          ? current.oldest
          : at.toISOString().slice(0, 7) + "-01";
    await this.db.execute(
      `UPDATE offering_catalog_bounds_by_type SET newest_year_month=?,oldest_year_month=?,updated_at=? WHERE offering_type=? IF newest_year_month=? AND oldest_year_month=?`,
      [
        localDate(newest),
        localDate(oldest),
        new Date(),
        type,
        localDate(current.newest),
        localDate(current.oldest),
      ],
      LQ,
      LS,
    );
  }
  public async bounds(type: OfferingType) {
    const rows = await this.db.execute(
      `SELECT newest_year_month,oldest_year_month FROM offering_catalog_bounds_by_type WHERE offering_type=?`,
      [type],
      LQ,
    );
    const r = rows[0];
    return r ? { newest: String(r.newest_year_month), oldest: String(r.oldest_year_month) } : undefined;
  }
  public async listPublic(
    type: OfferingType,
    month: string,
    shard: number,
    limit: number,
    position?: [string, string],
  ) {
    const q = `SELECT offering_id FROM public_offerings_by_type_bucket WHERE offering_type=? AND year_month=? AND shard=?`;
    const rows = position
      ? await this.db.execute(
          `${q} AND (published_at,offering_id)<(?,?) LIMIT ?`,
          [type, localDate(month), shard, new Date(position[0]), uuid(position[1]), limit],
          LO,
        )
      : await this.db.execute(`${q} LIMIT ?`, [type, localDate(month), shard, limit], LO);
    const result: Offering[] = [];
    for (const r of rows) {
      const v = await this.get(String(r.offering_id));
      if (v) result.push(v);
    }
    return result;
  }
  public async listCourse(courseId: string, limit = 50) {
    const rows = await this.db.execute(
      `SELECT offering_id FROM offerings_by_course WHERE course_id=? LIMIT ?`,
      [uuid(courseId), limit],
      LQ,
    );
    return this.resolve(rows);
  }
  public async listLecturer(id: string, limit = 50) {
    const rows = await this.db.execute(
      `SELECT offering_id FROM offerings_by_lecturer WHERE lecturer_id=? LIMIT ?`,
      [uuid(id), limit],
      LQ,
    );
    return this.resolve(rows);
  }
  private async resolve(rows: readonly types.Row[]) {
    const result: Offering[] = [];
    for (const r of rows) {
      const v = await this.get(String(r.offering_id));
      if (v) result.push(v);
    }
    return result;
  }
}
function params(v: Offering) {
  return [
    uuid(v.offeringId),
    uuid(v.courseId),
    uuid(v.ownerLecturerId),
    v.offeringType,
    v.classId ? uuid(v.classId) : null,
    v.title,
    v.state,
    types.BigDecimal.fromString(v.price),
    v.currency,
    v.salesStartAt ?? null,
    v.salesEndAt ?? null,
    long(v.recordVersion),
    v.createdAt,
    v.updatedAt,
    v.publishedAt ?? null,
  ];
}
function row(r: types.Row): Offering {
  return {
    offeringId: String(r.offering_id),
    courseId: String(r.course_id),
    ownerLecturerId: String(r.owner_lecturer_id),
    offeringType: String(r.offering_type) as OfferingType,
    ...(r.class_id ? { classId: String(r.class_id) } : {}),
    title: String(r.title),
    state: String(r.state) as Offering["state"],
    price: String(r.price),
    currency: String(r.currency),
    ...(r.sales_start_at ? { salesStartAt: date(r.sales_start_at) } : {}),
    ...(r.sales_end_at ? { salesEndAt: date(r.sales_end_at) } : {}),
    recordVersion: num(r.record_version),
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
    ...(r.published_at ? { publishedAt: date(r.published_at) } : {}),
  };
}
function num(v: unknown) {
  if (typeof v === "number") return v;
  if (v && typeof v === "object" && "toNumber" in v) return (v as { toNumber(): number }).toNumber();
  return Number(v);
}
function date(v: unknown) {
  if (!(v instanceof Date)) throw new Error("INVALID_DATE");
  return v;
}
function offeringShard(id: string) {
  return (createHash("sha256").update(id).digest()[0] ?? 0) % 8;
}
