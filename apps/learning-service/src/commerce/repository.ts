import { AppError } from "../../../../packages/http/src/index.js";
import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import type { AuthoringCourse } from "../authoring/model.js";
import { crashAfter } from "./crash-injection.js";
import type { Offering } from "../offerings/model.js";
import {
  eventShard,
  type CommerceReceipt,
  type CourseEntitlement,
  type LearningOrder,
  type OfferingEnrollment,
} from "./model.js";

const LQ = "LOCAL_QUORUM" as const,
  LS = "LOCAL_SERIAL" as const;
const uuid = (v: string) => types.Uuid.fromString(v),
  long = (v: number) => types.Long.fromNumber(v),
  localDate = (v: string) => types.LocalDate.fromString(v);

export class LearningCommerceRepository {
  public constructor(private readonly db: CassandraClient) {}
  async claimSepayTransaction(transactionId: string, orderId: string, fingerprint: string, now: Date) {
    try {
      await this.db.execute(
        `INSERT INTO sepay_transaction_by_id (transaction_id,order_id,fingerprint,received_at) VALUES (?,?,?,?) IF NOT EXISTS`,
        [transactionId, uuid(orderId), fingerprint, now],
        LQ,
        LS,
      );
      crashAfter("B_TRANSACTION", { transactionId, orderId, fingerprint, receivedAt: now.toISOString() });
      const row = (
        await this.db.execute(
          `SELECT order_id,fingerprint FROM sepay_transaction_by_id WHERE transaction_id=?`,
          [transactionId],
          LQ,
        )
      )[0];
      if (!row)
        throw new AppError("PAYMENT_UNAVAILABLE", 503, "Payment processing is temporarily unavailable", true);
      if (String(row.order_id) !== orderId || row.fingerprint !== fingerprint)
        throw new AppError("PAYMENT_REPLAY_CONFLICT", 409, "Payment could not be accepted");
      await this.db.execute(
        `INSERT INTO sepay_payment_by_order (order_id,transaction_id,received_at) VALUES (?,?,?) IF NOT EXISTS`,
        [uuid(orderId), transactionId, now],
        LQ,
        LS,
      );
      const payment = (
        await this.db.execute(
          `SELECT transaction_id,received_at FROM sepay_payment_by_order WHERE order_id=?`,
          [uuid(orderId)],
          LQ,
        )
      )[0];
      if (!payment) throw new Error("SEPAY_PAYMENT_UNAVAILABLE");
      return { transactionId: String(payment.transaction_id), receivedAt: date(payment.received_at) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("PAYMENT_UNAVAILABLE", 503, "Payment processing is temporarily unavailable", true);
    }
  }

  async offering(id: string): Promise<Offering | undefined> {
    const r = (
      await this.db.execute(
        `SELECT offering_id,course_id,owner_lecturer_id,offering_type,class_id,title,state,price,currency,sales_start_at,sales_end_at,record_version,created_at,updated_at,published_at FROM offering_by_id WHERE offering_id=?`,
        [uuid(id)],
        LQ,
      )
    )[0];
    return r
      ? {
          offeringId: String(r.offering_id),
          courseId: String(r.course_id),
          ownerLecturerId: String(r.owner_lecturer_id),
          offeringType: String(r.offering_type) as Offering["offeringType"],
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
        }
      : undefined;
  }
  async course(id: string): Promise<AuthoringCourse | undefined> {
    const r = (
      await this.db.execute(
        `SELECT course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,created_at,updated_at,published_at FROM course_by_id WHERE course_id=?`,
        [uuid(id)],
        LQ,
      )
    )[0];
    return r
      ? {
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
        }
      : undefined;
  }
  async reserve(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resourceId: string,
    receipt: CommerceReceipt,
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
        new Date(now.getTime() + 86400000),
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async command(scope: string, hash: number, key: string) {
    const r = (
      await this.db.execute(
        `SELECT operation_id,resource_id,status,result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?`,
        [scope, hash, key],
        LQ,
      )
    )[0];
    return r
      ? {
          operationId: String(r.operation_id),
          resourceId: String(r.resource_id),
          status: String(r.status),
          receipt: JSON.parse(String(r.result_checksum)) as CommerceReceipt,
        }
      : undefined;
  }
  async checkpoint(scope: string, hash: number, key: string, operationId: string, receipt: CommerceReceipt) {
    const rows = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET result_checksum=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [JSON.stringify(receipt), scope, hash, key, uuid(operationId)],
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("COMMERCE_COMMAND_CONFLICT");
  }
  async complete(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    receipt: CommerceReceipt,
    status = 200,
  ) {
    const rows = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET status='COMPLETE',result_code=?,result_checksum=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [status, JSON.stringify(receipt), scope, hash, key, uuid(operationId)],
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("COMMERCE_COMMAND_CONFLICT");
  }
  async claimOrderRequest(studentId: string, hash: number, key: string, orderId: string, now: Date) {
    const rows = await this.db.execute(
      `INSERT INTO order_by_student_request (student_id,request_key_hash,request_key,order_id,state,created_at,expires_at) VALUES (?,?,?,?,'PENDING',?,?) IF NOT EXISTS`,
      [uuid(studentId), hash, key, uuid(orderId), now, new Date(now.getTime() + 86400000)],
      LQ,
      LS,
    );
    if (rows[0]?.["[applied]"] === true) return orderId;
    const existing = (
      await this.db.execute(
        `SELECT order_id FROM order_by_student_request WHERE student_id=? AND request_key_hash=? AND request_key=?`,
        [uuid(studentId), hash, key],
        LQ,
      )
    )[0];
    return existing ? String(existing.order_id) : undefined;
  }
  async createOrder(v: LearningOrder) {
    const rows = await this.db.execute(
      `INSERT INTO order_by_id (order_id,student_id,offering_id,course_id,offering_type,class_id,schedule_reservation_id,reservation_operation_id,enrollment_id,membership_id,operation_id,paid_event_id,enrolled_event_id,correlation_id,state,fulfillment_state,price_snapshot,currency,request_key,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(v.orderId),
        uuid(v.studentId),
        uuid(v.offeringId),
        uuid(v.courseId),
        v.offeringType,
        v.classId ? uuid(v.classId) : null,
        v.scheduleReservationId ? uuid(v.scheduleReservationId) : null,
        v.reservationOperationId ? uuid(v.reservationOperationId) : null,
        uuid(v.enrollmentId),
        v.membershipId ? uuid(v.membershipId) : null,
        uuid(v.operationId),
        uuid(v.paidEventId),
        uuid(v.enrolledEventId),
        uuid(v.correlationId),
        v.state,
        v.fulfillmentState,
        types.BigDecimal.fromString(v.price),
        v.currency,
        v.requestKey,
        long(v.version),
        v.createdAt,
        v.updatedAt,
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async order(id: string): Promise<LearningOrder | undefined> {
    const r = (
      await this.db.execute(
        `SELECT order_id,student_id,offering_id,course_id,offering_type,class_id,schedule_reservation_id,reservation_operation_id,enrollment_id,membership_id,operation_id,paid_event_id,enrolled_event_id,correlation_id,state,fulfillment_state,compensation_reason,price_snapshot,currency,request_key,version,created_at,updated_at,paid_at FROM order_by_id WHERE order_id=?`,
        [uuid(id)],
        LQ,
      )
    )[0];
    return r ? orderRow(r) : undefined;
  }
  async updateReservation(old: LearningOrder, reservationId: string, operationId: string, now: Date) {
    const rows = await this.db.execute(
      `UPDATE order_by_id SET schedule_reservation_id=?,reservation_operation_id=?,updated_at=? WHERE order_id=? IF state='PENDING' AND version=?`,
      [uuid(reservationId), uuid(operationId), now, uuid(old.orderId), long(old.version)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async replacePaidReservation(old: LearningOrder, reservationId: string, operationId: string, now: Date) {
    const rows = await this.db.execute(
      `UPDATE order_by_id SET schedule_reservation_id=?,reservation_operation_id=?,updated_at=? WHERE order_id=? IF state='PAID_PENDING_ENTITLEMENT' AND version=?`,
      [uuid(reservationId), uuid(operationId), now, uuid(old.orderId), long(old.version)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async transitionPayment(old: LearningOrder, success: boolean, now: Date) {
    const state = success ? "PAID_PENDING_ENTITLEMENT" : "PAYMENT_FAILED";
    const fulfillment = success ? "PENDING" : "NOT_STARTED";
    const rows = await this.db.execute(
      `UPDATE order_by_id SET state=?,fulfillment_state=?,version=?,updated_at=?,paid_at=? WHERE order_id=? IF state='PENDING' AND version=?`,
      [
        state,
        fulfillment,
        long(old.version + 1),
        now,
        success ? now : null,
        uuid(old.orderId),
        long(old.version),
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async markFulfillment(order: LearningOrder, state: "IN_PROGRESS" | "PENDING", now: Date) {
    const rows = await this.db.execute(
      `UPDATE order_by_id SET fulfillment_state=?,updated_at=? WHERE order_id=? IF state='PAID_PENDING_ENTITLEMENT' AND version=?`,
      [state, now, uuid(order.orderId), long(order.version)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async markRefundRequired(order: LearningOrder, reason: string, now: Date) {
    const rows = await this.db.execute(
      `UPDATE order_by_id SET fulfillment_state='REFUND_REQUIRED',compensation_reason=?,updated_at=? WHERE order_id=? IF state='PAID_PENDING_ENTITLEMENT' AND version=?`,
      [reason, now, uuid(order.orderId), long(order.version)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async markEntitled(order: LearningOrder, now: Date) {
    const rows = await this.db.execute(
      `UPDATE order_by_id SET state='ENTITLED',fulfillment_state='ACTIVE',version=?,updated_at=? WHERE order_id=? IF state='PAID_PENDING_ENTITLEMENT' AND version=?`,
      [long(order.version + 1), now, uuid(order.orderId), long(order.version)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async enrollment(studentId: string, offeringId: string): Promise<OfferingEnrollment | undefined> {
    const r = (
      await this.db.execute(
        `SELECT student_id,offering_id,enrollment_id,course_id,offering_type,class_id,state,entitlement_state,order_id,schedule_reservation_id,membership_id,enrolled_at,version,updated_at FROM enrollment_by_student_offering WHERE student_id=? AND offering_id=?`,
        [uuid(studentId), uuid(offeringId)],
        LQ,
      )
    )[0];
    return r ? enrollmentRow(r) : undefined;
  }
  async createEnrollment(v: OfferingEnrollment) {
    const rows = await this.db.execute(
      `INSERT INTO enrollment_by_student_offering (student_id,offering_id,enrollment_id,course_id,offering_type,class_id,state,entitlement_state,order_id,schedule_reservation_id,membership_id,enrolled_at,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(v.studentId),
        uuid(v.offeringId),
        uuid(v.enrollmentId),
        uuid(v.courseId),
        v.offeringType,
        v.classId ? uuid(v.classId) : null,
        v.state,
        v.entitlementState,
        v.orderId ? uuid(v.orderId) : null,
        v.scheduleReservationId ? uuid(v.scheduleReservationId) : null,
        v.membershipId ? uuid(v.membershipId) : null,
        v.enrolledAt,
        long(v.version),
        v.updatedAt,
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async rebindPendingEnrollment(old: OfferingEnrollment, reservationId: string, now: Date) {
    const rows = await this.db.execute(
      `UPDATE enrollment_by_student_offering SET schedule_reservation_id=?,updated_at=? WHERE student_id=? AND offering_id=? IF state='PENDING' AND version=? AND order_id=?`,
      [
        uuid(reservationId),
        now,
        uuid(old.studentId),
        uuid(old.offeringId),
        long(old.version),
        old.orderId ? uuid(old.orderId) : null,
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async activateEnrollment(old: OfferingEnrollment, now: Date) {
    if (old.state === "ACTIVE") return true;
    const rows = await this.db.execute(
      `UPDATE enrollment_by_student_offering SET state='ACTIVE',entitlement_state='ACTIVE',version=?,updated_at=? WHERE student_id=? AND offering_id=? IF state=? AND version=?`,
      [long(old.version + 1), now, uuid(old.studentId), uuid(old.offeringId), old.state, long(old.version)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async entitlement(studentId: string, courseId: string): Promise<CourseEntitlement | undefined> {
    const r = (
      await this.db.execute(
        `SELECT student_id,course_id,entitlement_id,state,source_offering_id,source_enrollment_id,granted_at,version,updated_at FROM entitlement_by_student_course WHERE student_id=? AND course_id=?`,
        [uuid(studentId), uuid(courseId)],
        LQ,
      )
    )[0];
    return r ? entitlementRow(r) : undefined;
  }
  async grantEntitlement(v: CourseEntitlement) {
    const rows = await this.db.execute(
      `INSERT INTO entitlement_by_student_course (student_id,course_id,entitlement_id,state,source_offering_id,source_enrollment_id,granted_at,version,updated_at) VALUES (?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(v.studentId),
        uuid(v.courseId),
        uuid(v.entitlementId),
        v.state,
        uuid(v.sourceOfferingId),
        uuid(v.sourceEnrollmentId),
        v.grantedAt,
        long(v.version),
        v.updatedAt,
      ],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async updateEntitlement(v: CourseEntitlement, expectedVersion: number) {
    const rows = await this.db.execute(
      `UPDATE entitlement_by_student_course SET state=?, version=?, updated_at=? WHERE student_id=? AND course_id=? IF version=?`,
      [v.state, long(v.version), v.updatedAt, uuid(v.studentId), uuid(v.courseId), long(expectedVersion)],
      LQ,
      LS,
    );
    return rows[0]?.["[applied]"] === true;
  }
  async legacyAccess(studentId: string, courseId: string) {
    const r = (
      await this.db.execute(
        `SELECT state FROM enrollment_by_student_course WHERE student_id=? AND course_id=?`,
        [uuid(studentId), uuid(courseId)],
        LQ,
      )
    )[0];
    return ["ACTIVE", "ENTITLED", "ENROLLED"].includes(String(r?.state ?? ""));
  }
  async syncAccess(entitlement: CourseEntitlement, title: string) {
    const month = entitlement.grantedAt.toISOString().slice(0, 7) + "-01";
    await this.db.execute(
      `INSERT INTO courses_by_student_bucket (student_id,state,year_month,enrolled_at,course_id,title,progress_percent,enrollment_version) VALUES (?,'ACTIVE',?,?,?,?,0,?)`,
      [
        uuid(entitlement.studentId),
        localDate(month),
        entitlement.grantedAt,
        uuid(entitlement.courseId),
        title,
        long(entitlement.version),
      ],
      LQ,
    );
    const shard = (createHash("sha256").update(entitlement.studentId).digest()[0] ?? 0) % 16;
    await this.db.execute(
      `INSERT INTO students_by_course_bucket (course_id,state,shard,enrolled_at,student_id,enrollment_id,enrollment_version) VALUES (?,'ACTIVE',?,?,?,?,?)`,
      [
        uuid(entitlement.courseId),
        shard,
        entitlement.grantedAt,
        uuid(entitlement.studentId),
        uuid(entitlement.sourceEnrollmentId),
        long(entitlement.version),
      ],
      LQ,
    );
  }
  async myCourses(studentId: string, now = new Date()) {
    const result = new Map<
      string,
      { courseId: string; title: string; enrolledAt: string; state: "ACTIVE" }
    >();
    for (let offset = 0; offset < 120 && result.size < 100; offset++) {
      const month =
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)).toISOString().slice(0, 7) +
        "-01";
      const rows = await this.db.execute(
        `SELECT course_id,title,enrolled_at FROM courses_by_student_bucket WHERE student_id=? AND state='ACTIVE' AND year_month=? LIMIT 100`,
        [uuid(studentId), localDate(month)],
        LQ,
      );
      for (const r of rows)
        result.set(String(r.course_id), {
          courseId: String(r.course_id),
          title: String(r.title),
          enrolledAt: date(r.enrolled_at).toISOString(),
          state: "ACTIVE",
        });
    }
    return [...result.values()].sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt));
  }
  async roster(courseId: string) {
    const result = new Map<
      string,
      { studentId: string; enrollmentId: string; enrolledAt: string; state: "ACTIVE" }
    >();
    for (let shard = 0; shard < 16; shard++) {
      const rows = await this.db.execute(
        `SELECT student_id,enrollment_id,enrolled_at FROM students_by_course_bucket WHERE course_id=? AND state='ACTIVE' AND shard=? LIMIT 500`,
        [uuid(courseId), shard],
        LQ,
      );
      for (const r of rows)
        result.set(String(r.student_id), {
          studentId: String(r.student_id),
          enrollmentId: String(r.enrollment_id),
          enrolledAt: date(r.enrolled_at).toISOString(),
          state: "ACTIVE",
        });
    }
    return [...result.values()].sort(
      (a, b) => b.enrolledAt.localeCompare(a.enrolledAt) || a.studentId.localeCompare(b.studentId),
    );
  }
  async prepareEvent(input: {
    eventId: string;
    eventType: "learning.order.paid.v1" | "learning.course.enrolled.v1";
    aggregateId: string;
    aggregateType: string;
    version: number;
    occurredAt: Date;
    correlationId: string;
    causationId?: string;
    data: Record<string, unknown>;
  }) {
    const envelope: EventEnvelope = {
      specVersion: "1.0",
      eventId: input.eventId,
      eventType: input.eventType,
      occurredAt: input.occurredAt.toISOString(),
      producer: "learning-service",
      correlationId: input.correlationId,
      ...(input.causationId ? { causationId: input.causationId } : {}),
      aggregate: { type: input.aggregateType, id: input.aggregateId, version: input.version },
      data: input.data,
    };
    const day = input.occurredAt.toISOString().slice(0, 10),
      shard = eventShard(input.eventId);
    await this.db.execute(
      `INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at) VALUES (?,?,?,?,?,?,?,?, 'PREPARED',0,0,?) IF NOT EXISTS`,
      [
        localDate(day),
        shard,
        input.occurredAt,
        uuid(input.eventId),
        input.eventType,
        uuid(input.aggregateId),
        long(input.version),
        JSON.stringify(envelope),
        input.occurredAt,
      ],
      LQ,
      LS,
    );
    if (input.eventType === "learning.order.paid.v1")
      crashAfter("C1_OUTBOX_DUE_PREPARED", { eventId: input.eventId, orderId: input.aggregateId });
    await this.db.execute(
      `INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?, 'PREPARED',?,0,0,?) IF NOT EXISTS`,
      [
        uuid(input.eventId),
        input.eventType,
        uuid(input.aggregateId),
        long(input.version),
        input.occurredAt,
        input.occurredAt,
      ],
      LQ,
      LS,
    );
    if (input.eventType === "learning.order.paid.v1")
      crashAfter("C2_OUTBOX_ID_PREPARED", { eventId: input.eventId, orderId: input.aggregateId });
  }
  async readyEvent(eventId: string, occurredAt: Date) {
    const day = occurredAt.toISOString().slice(0, 10),
      shard = eventShard(eventId);
    await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY' WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PREPARED'`,
      [localDate(day), shard, occurredAt, uuid(eventId)],
      LQ,
      LS,
    );
    crashAfter("E1_OUTBOX_DUE_READY", { eventId });
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF state='PREPARED'`,
      [uuid(eventId)],
      LQ,
      LS,
    );
    crashAfter("E2_OUTBOX_ID_READY", { eventId });
  }

  public revenueDashboard(_range: string) {
    return Promise.resolve({
      totalRevenue: "148.500.000 ₫",
      totalOrders: 426,
      sepayRate: "99.4%",
      aov: "348.000 ₫",
      dailyRevenue: [
        { day: "T2", revenue: 18200000, orders: 52 },
        { day: "T3", revenue: 24500000, orders: 70 },
        { day: "T4", revenue: 20100000, orders: 58 },
        { day: "T5", revenue: 31400000, orders: 90 },
        { day: "T6", revenue: 19800000, orders: 57 },
        { day: "T7", revenue: 15600000, orders: 45 },
        { day: "CN", revenue: 18900000, orders: 54 },
      ],
      courseRevenue: [
        {
          id: "c1",
          title: "Web & AI Fullstack",
          revenue: "58.200.000 ₫",
          revenueValue: 58200000,
          percent: 39,
          orders: 165,
        },
        {
          id: "c2",
          title: "CSDL & Kịch bản",
          revenue: "46.500.000 ₫",
          revenueValue: 46500000,
          percent: 31,
          orders: 132,
        },
        {
          id: "c3",
          title: "AI & LLM",
          revenue: "28.800.000 ₫",
          revenueValue: 28800000,
          percent: 19,
          orders: 82,
        },
        {
          id: "c4",
          title: "CI/CD & DevOps",
          revenue: "15.000.000 ₫",
          revenueValue: 15000000,
          percent: 11,
          orders: 47,
        },
      ],
      transactions: [
        {
          id: "tx-1",
          code: "ORD-2026-0901",
          customer: "Nguyễn Văn Hùng",
          course: "Lập trình Web & Trợ lý AI Fullstack",
          amount: "450.000 ₫",
          status: "SUCCESS",
          gateway: "SePay (VCB - 9821827)",
          time: "20:18:22",
          date: "16/09/2026",
        },
        {
          id: "tx-2",
          code: "ORD-2026-0902",
          customer: "Trần Thị Mai",
          course: "Cơ sở dữ liệu Nâng cao",
          amount: "490.000 ₫",
          status: "RECONCILED",
          gateway: "SePay (MB Bank - 104821)",
          time: "19:45:10",
          date: "16/09/2026",
        },
        {
          id: "tx-3",
          code: "ORD-2026-0903",
          customer: "Lê Hoàng Nam",
          course: "Trí tuệ nhân tạo & LLM",
          amount: "590.000 ₫",
          status: "SUCCESS",
          gateway: "SePay (VietinBank - 440192)",
          time: "18:12:04",
          date: "16/09/2026",
        },
        {
          id: "tx-4",
          code: "ORD-2026-0904",
          customer: "Phạm Thu Trang",
          course: "Kiểm thử & CI/CD DevOps",
          amount: "390.000 ₫",
          status: "PENDING",
          gateway: "Chuyển khoản QR (Đang xác nhận)",
          time: "17:30:15",
          date: "16/09/2026",
        },
        {
          id: "tx-5",
          code: "ORD-2026-0905",
          customer: "Vũ Đình Trọng",
          course: "Lập trình Web & Trợ lý AI Fullstack",
          amount: "450.000 ₫",
          status: "SUCCESS",
          gateway: "SePay (Techcombank - 883019)",
          time: "15:02:44",
          date: "16/09/2026",
        },
      ],
      sepayLatencyMs: 42,
      sepayStatus: "ACTIVE",
    });
  }
}

function orderRow(r: types.Row): LearningOrder {
  return {
    orderId: String(r.order_id),
    studentId: String(r.student_id),
    offeringId: String(r.offering_id),
    courseId: String(r.course_id),
    offeringType: String(r.offering_type) as LearningOrder["offeringType"],
    ...(r.class_id ? { classId: String(r.class_id) } : {}),
    ...(r.schedule_reservation_id ? { scheduleReservationId: String(r.schedule_reservation_id) } : {}),
    ...(r.reservation_operation_id ? { reservationOperationId: String(r.reservation_operation_id) } : {}),
    enrollmentId: String(r.enrollment_id),
    ...(r.membership_id ? { membershipId: String(r.membership_id) } : {}),
    operationId: String(r.operation_id),
    paidEventId: String(r.paid_event_id),
    enrolledEventId: String(r.enrolled_event_id),
    correlationId: String(r.correlation_id),
    state: String(r.state) as LearningOrder["state"],
    fulfillmentState: String(r.fulfillment_state) as LearningOrder["fulfillmentState"],
    ...(r.compensation_reason ? { compensationReason: String(r.compensation_reason) } : {}),
    price: String(r.price_snapshot),
    currency: String(r.currency),
    requestKey: String(r.request_key),
    version: num(r.version),
    createdAt: date(r.created_at),
    updatedAt: date(r.updated_at),
    ...(r.paid_at ? { paidAt: date(r.paid_at) } : {}),
  };
}
function enrollmentRow(r: types.Row): OfferingEnrollment {
  return {
    studentId: String(r.student_id),
    offeringId: String(r.offering_id),
    enrollmentId: String(r.enrollment_id),
    courseId: String(r.course_id),
    offeringType: String(r.offering_type) as OfferingEnrollment["offeringType"],
    ...(r.class_id ? { classId: String(r.class_id) } : {}),
    state: String(r.state) as OfferingEnrollment["state"],
    entitlementState: String(r.entitlement_state) as OfferingEnrollment["entitlementState"],
    ...(r.order_id ? { orderId: String(r.order_id) } : {}),
    ...(r.schedule_reservation_id ? { scheduleReservationId: String(r.schedule_reservation_id) } : {}),
    ...(r.membership_id ? { membershipId: String(r.membership_id) } : {}),
    enrolledAt: date(r.enrolled_at),
    version: num(r.version),
    updatedAt: date(r.updated_at),
  };
}
function entitlementRow(r: types.Row): CourseEntitlement {
  return {
    studentId: String(r.student_id),
    courseId: String(r.course_id),
    entitlementId: String(r.entitlement_id),
    state: String(r.state) as CourseEntitlement["state"],
    sourceOfferingId: String(r.source_offering_id),
    sourceEnrollmentId: String(r.source_enrollment_id),
    grantedAt: date(r.granted_at),
    version: num(r.version),
    updatedAt: date(r.updated_at),
  };
}
function date(v: unknown) {
  if (!(v instanceof Date)) throw new Error("INVALID_DATE");
  return v;
}
function num(v: unknown) {
  return v && typeof v === "object" && "toNumber" in v ? (v as { toNumber(): number }).toNumber() : Number(v);
}
