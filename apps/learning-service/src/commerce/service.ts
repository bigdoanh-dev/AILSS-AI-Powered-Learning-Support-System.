import type { SepayRecoveryRepository, RecoveryCandidate } from "./recovery-repository.js";
import { crashAfter } from "./crash-injection.js";
import { paymentMode, sepayConfig, paymentOrderId, type SepayTransaction } from "./sepay.js";
import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { ClassroomOfferingContextClient } from "../classroom-client.js";
import type { Offering } from "../offerings/model.js";
import { CommerceClassroomError, type CommerceClassroomClient } from "./classroom-client.js";
import {
  decimalIsZero,
  defaultOfferingId,
  deterministicUuid,
  enrollmentDto,
  fingerprint,
  keyHash,
  orderDto,
  type CourseEntitlement,
  type LearningOrder,
  type OfferingEnrollment,
  type OrderCreateRequest,
  type PaymentRequest,
} from "./model.js";
import type { LearningCommerceRepository } from "./repository.js";

export class LearningCommerceService {
  public constructor(
    private readonly repo: LearningCommerceRepository,
    private readonly classroom: CommerceClassroomClient,
    private readonly classroomContext: ClassroomOfferingContextClient,
    private readonly secret: string,
    private readonly recovery?: SepayRecoveryRepository,
  ) {}

  async revenueDashboard(actor: ActorContext, range: string) {
    if (!actor.roles.includes("ADMIN"))
      throw new AppError("ADMIN_REQUIRED", 403, "Admin authorization is required");
    if (range !== "today" && range !== "7d" && range !== "30d")
      throw new AppError("INVALID_REVENUE_RANGE", 422, "Revenue range must be today, 7d, or 30d");
    return this.repo.revenueDashboard(range);
  }

  async lecturerRevenueDashboard(actor: ActorContext, range: string) {
    if (!actor.roles.includes("LECTURER"))
      throw new AppError("LECTURER_REQUIRED", 403, "Lecturer authorization is required");
    if (range !== "today" && range !== "7d" && range !== "30d")
      throw new AppError("INVALID_REVENUE_RANGE", 422, "Revenue range must be today, 7d, or 30d");
    const report = await this.repo.revenueDashboard(range);
    return {
      dataSource: report.dataSource,
      range: report.range,
      currency: report.currency,
      lecturer: report.lecturers.find((item) => item.lecturerId === actor.userId) ?? {
        lecturerId: actor.userId,
        grossMinor: "0",
        refundMinor: "0",
        netMinor: "0",
        estimatedPlatformMinor: "0",
        estimatedEarningsMinor: "0",
        orders: 0,
        courses: [],
      },
      completeness: report.completeness,
    };
  }

  async commission(actor: ActorContext) {
    if (!actor.roles.includes("ADMIN") && !actor.roles.includes("LECTURER"))
      throw new AppError("COMMISSION_ROLE_REQUIRED", 403, "Admin or lecturer authorization is required");
    return this.repo.currentCommission();
  }

  async changeCommission(actor: ActorContext, basisPoints: number, expectedEffectiveAt: string) {
    if (!actor.roles.includes("ADMIN"))
      throw new AppError("ADMIN_REQUIRED", 403, "Admin authorization is required");
    return this.repo.changeCommission(basisPoints, actor.userId, expectedEffectiveAt);
  }

  async payoutAccount(actor: ActorContext) {
    if (!actor.roles.includes("LECTURER")) throw new AppError("LECTURER_REQUIRED", 403, "Lecturer required");
    return this.repo.payoutAccount(actor.userId);
  }

  async savePayoutAccount(
    actor: ActorContext,
    input: { bankName: string; accountNumber: string; accountHolder: string },
  ) {
    if (!actor.roles.includes("LECTURER")) throw new AppError("LECTURER_REQUIRED", 403, "Lecturer required");
    return this.repo.savePayoutAccount(actor.userId, input);
  }

  async payoutInstructions(actor: ActorContext) {
    if (!actor.roles.includes("ADMIN")) throw new AppError("ADMIN_REQUIRED", 403, "Admin required");
    const month = previousMonth();
    const report = await this.repo.revenueDashboard("previousMonth");
    const candidates = await Promise.all(
      report.lecturers.map(async (item) => ({
        lecturerId: item.lecturerId,
        estimatedEarningsMinor: item.estimatedEarningsMinor,
        accountConfigured: !!(await this.repo.payoutAccount(item.lecturerId)),
      })),
    );
    return {
      month,
      canPrepare: new Date().getUTCDate() > 7,
      candidates,
      instructions: await this.repo.payoutInstructions(month),
    };
  }

  async preparePayouts(actor: ActorContext, lecturerId?: string) {
    if (!actor.roles.includes("ADMIN")) throw new AppError("ADMIN_REQUIRED", 403, "Admin required");
    if (new Date().getUTCDate() <= 7)
      throw new AppError(
        "PAYOUT_REFUND_WINDOW_OPEN",
        409,
        "Previous month payout can be prepared after the refund window closes",
      );
    const month = previousMonth();
    const report = await this.repo.revenueDashboard("previousMonth");
    const selected = lecturerId
      ? report.lecturers.filter((item) => item.lecturerId === lecturerId)
      : report.lecturers;
    const skipped: Array<{ lecturerId: string; reason: string }> = [];
    for (const item of selected) {
      if (BigInt(item.estimatedEarningsMinor) <= 0n) {
        skipped.push({ lecturerId: item.lecturerId, reason: "NO_POSITIVE_BALANCE" });
        continue;
      }
      const account = await this.repo.payoutAccount(item.lecturerId);
      if (!account) {
        skipped.push({ lecturerId: item.lecturerId, reason: "PAYOUT_ACCOUNT_MISSING" });
        continue;
      }
      await this.repo.preparePayoutInstruction(month, item.lecturerId, item.estimatedEarningsMinor, account);
    }
    return { month, instructions: await this.repo.payoutInstructions(month), skipped };
  }

  async freeEnroll(input: { courseId: string; actor: ActorContext; key: string; correlationId: string }) {
    student(input.actor);
    const offeringId = defaultOfferingId(input.courseId),
      now = new Date(),
      scope = `LRN-14:${input.actor.userId}:${input.courseId}`,
      hash = keyHash(this.secret, input.key),
      operationId = randomUUID(),
      enrollmentId = randomUUID();
    const fp = fingerprint(this.secret, {
      method: "POST",
      route: "/api/v1/courses/{courseId}/enrollments",
      actor: input.actor.userId,
      courseId: input.courseId,
    });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      operationId,
      enrollmentId,
      { fingerprint: fp, occurredAt: now.toISOString() },
      now,
    );
    const command = await this.repo.command(scope, hash, input.key);
    if (!command) throw unavailable();
    if (command.receipt.fingerprint !== fp)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request");
    if (command.status === "COMPLETE" && command.receipt.enrollment)
      return { enrollment: command.receipt.enrollment, replayed: true };
    const offering = await this.requireOffering(offeringId, now);
    if (
      offering.courseId !== input.courseId ||
      offering.offeringType !== "SELF_PACED" ||
      !decimalIsZero(offering.price)
    )
      throw conflict("PURCHASE_REQUIRED", "Course requires purchase through an Offering");
    let enrollment = await this.repo.enrollment(input.actor.userId, offeringId);
    if (enrollment?.state !== "ACTIVE") {
      const occurredAt = new Date(command.receipt.occurredAt);
      const stableEventId = deterministicUuid(this.secret, "free-enrolled-event", command.operationId);
      await this.repo.prepareEvent({
        eventId: stableEventId,
        eventType: "learning.course.enrolled.v1",
        aggregateId: command.resourceId,
        aggregateType: "OFFERING_ENROLLMENT",
        version: 2,
        occurredAt,
        correlationId: input.correlationId,
        data: {
          courseId: input.courseId,
          offeringId,
          studentId: input.actor.userId,
          enrollmentId: command.resourceId,
          version: 2,
        },
      });
      const proposed: OfferingEnrollment = {
        enrollmentId: command.resourceId,
        studentId: input.actor.userId,
        offeringId,
        courseId: input.courseId,
        offeringType: "SELF_PACED",
        state: "PENDING",
        entitlementState: "PENDING",
        enrolledAt: occurredAt,
        version: 1,
        updatedAt: occurredAt,
      };
      await this.repo.createEnrollment(proposed);
      enrollment = (await this.repo.enrollment(input.actor.userId, offeringId)) ?? proposed;
      await this.convergeAccess(enrollment, offering.title, occurredAt);
      enrollment = await this.requiredEnrollment(input.actor.userId, offeringId);
      await this.repo.readyEvent(stableEventId, occurredAt);
    } else if (enrollment.enrollmentId === command.resourceId) {
      const occurredAt = new Date(command.receipt.occurredAt),
        stableEventId = deterministicUuid(this.secret, "free-enrolled-event", command.operationId);
      await this.repo.prepareEvent({
        eventId: stableEventId,
        eventType: "learning.course.enrolled.v1",
        aggregateId: command.resourceId,
        aggregateType: "OFFERING_ENROLLMENT",
        version: enrollment.version,
        occurredAt,
        correlationId: input.correlationId,
        data: {
          courseId: input.courseId,
          offeringId,
          studentId: input.actor.userId,
          enrollmentId: command.resourceId,
          version: enrollment.version,
        },
      });
      await this.repo.readyEvent(stableEventId, occurredAt);
    }
    const dto = enrollmentDto(enrollment);
    await this.repo.complete(
      scope,
      hash,
      input.key,
      command.operationId,
      { ...command.receipt, enrollment: dto },
      200,
    );
    return { enrollment: dto, replayed: false };
  }

  async createOrder(input: {
    actor: ActorContext;
    request: OrderCreateRequest;
    key: string;
    correlationId: string;
    classroomActorContext?: string;
  }) {
    student(input.actor);
    const now = new Date(),
      scope = `LRN-19:${input.actor.userId}`,
      hash = keyHash(this.secret, input.key),
      operationId = randomUUID(),
      orderId = randomUUID();
    const fp = fingerprint(this.secret, {
      method: "POST",
      route: "/api/v1/orders",
      actor: input.actor.userId,
      body: input.request,
    });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      operationId,
      orderId,
      { fingerprint: fp, occurredAt: now.toISOString() },
      now,
    );
    const command = await this.repo.command(scope, hash, input.key);
    if (!command) throw unavailable();
    if (command.receipt.fingerprint !== fp)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request");
    if (command.status === "COMPLETE" && command.receipt.order)
      return { order: command.receipt.order, replayed: true };
    const existing = await this.repo.order(command.resourceId);
    if (existing)
      return this.completeOrderCommand(
        scope,
        hash,
        input.key,
        command.operationId,
        command.receipt,
        existing,
        true,
      );
    const offering = await this.requireOffering(input.request.offeringId, now);
    if (
      paymentMode() === "sepay" &&
      (offering.currency !== "VND" ||
        !/^\d+(?:\.0+)?$/.test(offering.price) ||
        !Number.isSafeInteger(Number(offering.price)) ||
        Number(offering.price) <= 0)
    )
      throw new AppError(
        "PAYMENT_CURRENCY_UNSUPPORTED",
        422,
        "Thanh toán SePay yêu cầu số tiền VND nguyên và lớn hơn 0",
      );
    let reservationId: string | undefined, reservationOperationId: string | undefined;
    if (offering.offeringType === "LIVE_COHORT") {
      if (!offering.classId || !input.classroomActorContext)
        throw new AppError("CLASSROOM_ACTOR_CONTEXT_REQUIRED", 401, "Trusted Student context is required");
      const classId = offering.classId;
      await this.requireLiveContext(offering, input.correlationId);
      const stableReservationOperationId = deterministicUuid(
        this.secret,
        "order-reservation",
        command.operationId,
      );
      reservationOperationId = stableReservationOperationId;
      const held = await this.classroomCall(() =>
        this.classroom.reserve(
          {
            operationId: stableReservationOperationId,
            studentId: input.actor.userId,
            offeringId: offering.offeringId,
            classId,
          },
          input.correlationId,
          input.classroomActorContext,
        ),
      );
      reservationId = held.reservationId;
    }
    const occurredAt = new Date(command.receipt.occurredAt),
      order: LearningOrder = {
        orderId: command.resourceId,
        studentId: input.actor.userId,
        offeringId: offering.offeringId,
        courseId: offering.courseId,
        offeringType: offering.offeringType,
        ...(offering.classId ? { classId: offering.classId } : {}),
        ...(reservationId ? { scheduleReservationId: reservationId } : {}),
        ...(reservationOperationId ? { reservationOperationId } : {}),
        enrollmentId: deterministicUuid(this.secret, "order-enrollment", command.resourceId),
        ...(offering.classId
          ? { membershipId: deterministicUuid(this.secret, "order-membership", command.resourceId) }
          : {}),
        operationId: command.operationId,
        paidEventId: deterministicUuid(this.secret, "order-paid-event", command.resourceId),
        enrolledEventId: deterministicUuid(this.secret, "order-enrolled-event", command.resourceId),
        correlationId: input.correlationId,
        state: "PENDING",
        fulfillmentState: "NOT_STARTED",
        price: offering.price,
        currency: offering.currency,
        requestKey: input.key,
        version: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      };
    const claimed = await this.repo.claimOrderRequest(
      order.studentId,
      hash,
      input.key,
      order.orderId,
      occurredAt,
    );
    if (claimed !== order.orderId)
      throw conflict("ORDER_REQUEST_CONFLICT", "Order request already maps to another Order");
    await this.repo.createOrder(order);
    const canonical = await this.repo.order(order.orderId);
    if (!canonical) throw unavailable();
    return this.completeOrderCommand(
      scope,
      hash,
      input.key,
      command.operationId,
      command.receipt,
      canonical,
      false,
    );
  }

  async orderDetail(orderId: string, actor: ActorContext) {
    const order = await this.repo.order(orderId);
    if (!order) throw notFound("ORDER_NOT_FOUND", "Order not found");
    if (order.studentId !== actor.userId && !actor.roles.includes("ADMIN"))
      throw notFound("ORDER_NOT_FOUND", "Order not found");
    return orderDto(order);
  }

  async receiveSepay(transaction: SepayTransaction, correlationId: string) {
    const config = sepayConfig();
    if (transaction.transferType !== "in" || transaction.accountNumber !== config.accountNumber)
      throw new AppError("PAYMENT_REJECTED", 422, "Payment could not be accepted");
    const orderId = paymentOrderId(transaction.content);
    if (!orderId) throw new AppError("PAYMENT_REJECTED", 422, "Payment could not be accepted");
    const order = await this.repo.order(orderId);
    if (!order) throw new AppError("PAYMENT_REJECTED", 422, "Payment could not be accepted");
    if (
      order.currency !== "VND" ||
      !/^\d+(?:\.0+)?$/.test(order.price) ||
      !Number.isSafeInteger(Number(order.price)) ||
      Number(order.price) !== transaction.transferAmount
    )
      throw new AppError("PAYMENT_REJECTED", 422, "Payment could not be accepted");
    if (order.state === "PAYMENT_FAILED")
      throw conflict(
        "PAYMENT_REQUIRES_REVIEW",
        "Transfer received for a failed order; manual review required",
      );
    if (!this.recovery)
      throw new AppError("PAYMENT_UNAVAILABLE", 503, "Payment processing is temporarily unavailable", true);
    if (typeof this.recovery.get === "function") {
      const existing = await this.recovery.get(String(transaction.id));
      if (existing) {
        if (existing.orderId !== orderId || existing.amount !== transaction.transferAmount) {
          console.warn(
            JSON.stringify({
              eventType: "APPSEC_AUDIT_PAYLOAD_COLLISION",
              severity: "HIGH",
              transactionId: String(transaction.id),
              existingOrderId: existing.orderId,
              incomingOrderId: orderId,
              existingAmount: existing.amount,
              incomingAmount: transaction.transferAmount,
              correlationId,
            }),
          );
          throw new AppError(
            "PROVIDER_TRANSACTION_CONFLICT",
            409,
            "Payment could not be accepted: transaction payload conflict",
          );
        }
      }
    }
    const receivedAt = new Date(),
      accepted = {
        transactionId: String(transaction.id),
        orderId,
        paidEventId: order.paidEventId,
        amount: transaction.transferAmount,
        receivedAt,
        correlationId,
        fingerprint: fingerprint(this.secret, {
          orderId,
          accountNumber: transaction.accountNumber,
          amount: transaction.transferAmount,
          type: transaction.transferType,
          content: transaction.content,
          code: transaction.code ?? null,
          referenceCode: transaction.referenceCode ?? null,
        }),
      };
    const candidate = await this.recovery.ensure({
      ...accepted,
      recoveryMac: recoveryMac(this.secret, accepted),
    });
    await this.resumeSepay(candidate);
    return { success: true, processed: true };
  }

  async resumeSepay(candidate: RecoveryCandidate) {
    const { orderId, correlationId } = candidate;
    let order = await this.repo.order(orderId);
    if (
      !order ||
      candidate.recoveryMac !== recoveryMac(this.secret, candidate) ||
      order.paidEventId !== candidate.paidEventId ||
      order.currency !== "VND" ||
      Number(order.price) !== candidate.amount ||
      order.state === "PAYMENT_FAILED"
    )
      throw new AppError("PAYMENT_REQUIRES_REVIEW", 409, "Payment requires review");
    const payment = await this.repo.claimSepayTransaction(
      candidate.transactionId,
      orderId,
      candidate.fingerprint,
      candidate.receivedAt,
    );
    if (payment.transactionId !== candidate.transactionId)
      throw conflict("DUPLICATE_ORDER_TRANSFER", "Additional transfer requires manual review");
    const occurredAt = order.paidAt ?? payment.receivedAt;
    if (order.state === "PENDING") {
      await this.repo.prepareEvent({
        eventId: order.paidEventId,
        eventType: "learning.order.paid.v1",
        aggregateId: orderId,
        aggregateType: "ORDER",
        version: order.version + 1,
        occurredAt,
        correlationId,
        data: {
          orderId,
          studentId: order.studentId,
          offeringId: order.offeringId,
          courseId: order.courseId,
          version: order.version + 1,
        },
      });
      await this.repo.transitionPayment(order, true, occurredAt);
      crashAfter("D_ORDER_PAID", {
        transactionId: candidate.transactionId,
        orderId,
        eventId: order.paidEventId,
      });
      order = await this.repo.order(orderId);
      if (!order || !["PAID_PENDING_ENTITLEMENT", "ENTITLED"].includes(order.state)) throw unavailable();
    }
    await this.repo.ensureRevenuePaymentFact(order, candidate.transactionId, occurredAt);
    await this.repo.readyEvent(order.paidEventId, occurredAt);
    crashAfter("F_READY_BEFORE_PUBLISH", {
      transactionId: candidate.transactionId,
      orderId,
      eventId: order.paidEventId,
    });
    return order;
  }

  async simulatePayment(input: {
    orderId: string;
    actor: ActorContext;
    request: PaymentRequest;
    key: string;
    correlationId: string;
    classroomActorContext?: string;
  }) {
    if (!input.actor.roles.includes("STUDENT") && !input.actor.roles.includes("ADMIN"))
      throw new AppError("PAYMENT_ROLE_REQUIRED", 403, "Order owner or Admin authorization is required");
    const now = new Date(),
      scope = `LRN-21:${input.actor.userId}:${input.orderId}`,
      hash = keyHash(this.secret, input.key),
      operationId = randomUUID();
    const fp = fingerprint(this.secret, {
      method: "POST",
      route: "/api/v1/orders/{orderId}/simulate-payment",
      actor: input.actor.userId,
      orderId: input.orderId,
      body: input.request,
    });
    await this.repo.reserve(
      scope,
      hash,
      input.key,
      operationId,
      input.orderId,
      { fingerprint: fp, occurredAt: now.toISOString() },
      now,
    );
    const command = await this.repo.command(scope, hash, input.key);
    if (!command) throw unavailable();
    if (command.receipt.fingerprint !== fp)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request");
    if (command.status === "COMPLETE" && command.receipt.order)
      return { order: command.receipt.order, replayed: true };
    let order = await this.repo.order(input.orderId);
    if (!order) throw notFound("ORDER_NOT_FOUND", "Order not found");
    if (order.studentId !== input.actor.userId && !input.actor.roles.includes("ADMIN"))
      throw notFound("ORDER_NOT_FOUND", "Order not found");
    if (order.state !== "PENDING") {
      const desired =
        input.request.outcome === "SUCCESS" ? ["PAID_PENDING_ENTITLEMENT", "ENTITLED"] : ["PAYMENT_FAILED"];
      if (!desired.includes(order.state))
        throw conflict("ORDER_STATE_CONFLICT", "Order is not payable in its current state");
      if (input.request.outcome === "SUCCESS")
        await this.repo.readyEvent(order.paidEventId, new Date(command.receipt.occurredAt));
      else if (order.scheduleReservationId) {
        const reservationId = order.scheduleReservationId,
          orderId = order.orderId;
        await this.classroomCall(() =>
          this.classroom.release(
            reservationId,
            {
              operationId: deterministicUuid(this.secret, "payment-release", orderId),
              reason: "PAYMENT_FAILED",
            },
            input.correlationId,
          ),
        );
      }
      return this.completePayment(scope, hash, input.key, command.operationId, command.receipt, order, true);
    }
    const offering = await this.requireOffering(order.offeringId, now, true);
    if (offering.courseId !== order.courseId || offering.offeringType !== order.offeringType)
      throw conflict("OFFERING_SNAPSHOT_CONFLICT", "Offering authority no longer matches Order");
    if (input.request.outcome === "FAILURE") {
      await this.repo.transitionPayment(order, false, now);
      if (order.scheduleReservationId) {
        const reservationId = order.scheduleReservationId,
          orderId = order.orderId;
        await this.classroomCall(() =>
          this.classroom.release(
            reservationId,
            {
              operationId: deterministicUuid(this.secret, "payment-release", orderId),
              reason: "PAYMENT_FAILED",
            },
            input.correlationId,
          ),
        );
      }
    } else {
      if (order.offeringType === "LIVE_COHORT")
        order = await this.revalidateBeforePayment(order, offering, input);
      const occurredAt = new Date(command.receipt.occurredAt);
      await this.repo.prepareEvent({
        eventId: order.paidEventId,
        eventType: "learning.order.paid.v1",
        aggregateId: order.orderId,
        aggregateType: "ORDER",
        version: order.version + 1,
        occurredAt,
        correlationId: input.correlationId,
        data: {
          orderId: order.orderId,
          studentId: order.studentId,
          offeringId: order.offeringId,
          courseId: order.courseId,
          version: order.version + 1,
        },
      });
      await this.repo.transitionPayment(order, true, occurredAt);
      const paid = await this.repo.order(order.orderId);
      if (!paid || paid.state !== "PAID_PENDING_ENTITLEMENT") throw unavailable();
      await this.repo.readyEvent(order.paidEventId, occurredAt);
    }
    const canonical = await this.repo.order(order.orderId);
    if (!canonical) throw unavailable();
    return this.completePayment(
      scope,
      hash,
      input.key,
      command.operationId,
      command.receipt,
      canonical,
      false,
    );
  }

  async myCourses(actor: ActorContext) {
    student(actor);
    return this.repo.myCourses(actor.userId);
  }
  async roster(courseId: string, actor: ActorContext) {
    const course = await this.repo.course(courseId);
    if (!course) throw notFound("COURSE_NOT_FOUND", "Course not found");
    const owner = actor.roles.includes("LECTURER") && course.ownerLecturerId === actor.userId;
    if (!owner && !actor.roles.includes("ADMIN"))
      throw new AppError("COURSE_ROSTER_FORBIDDEN", 403, "Course roster authorization is required");
    return this.repo.roster(courseId);
  }

  async fulfill(orderId: string, causationId: string) {
    let order = await this.repo.order(orderId);
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.state === "ENTITLED") return order.version;
    if (order.state !== "PAID_PENDING_ENTITLEMENT" || order.fulfillmentState === "REFUND_REQUIRED")
      return order.version;
    await this.repo.markFulfillment(order, "IN_PROGRESS", new Date());
    order = (await this.repo.order(orderId)) ?? order;
    const offering = await this.repo.offering(order.offeringId);
    const course = await this.repo.course(order.courseId);
    if (!offering || !course) throw new Error("FULFILLMENT_AUTHORITY_UNAVAILABLE");
    if (!order.paidAt) throw new Error("ORDER_PAID_AT_REQUIRED");
    const occurredAt = order.paidAt;
    await this.repo.prepareEvent({
      eventId: order.enrolledEventId,
      eventType: "learning.course.enrolled.v1",
      aggregateId: order.enrollmentId,
      aggregateType: "OFFERING_ENROLLMENT",
      version: 2,
      occurredAt,
      correlationId: order.correlationId,
      causationId,
      data: {
        courseId: order.courseId,
        offeringId: order.offeringId,
        studentId: order.studentId,
        enrollmentId: order.enrollmentId,
        version: 2,
      },
    });
    let enrollment = await this.repo.enrollment(order.studentId, order.offeringId);
    if (!enrollment) {
      const proposed: OfferingEnrollment = {
        enrollmentId: order.enrollmentId,
        studentId: order.studentId,
        offeringId: order.offeringId,
        courseId: order.courseId,
        offeringType: order.offeringType,
        ...(order.classId ? { classId: order.classId } : {}),
        state: "PENDING",
        entitlementState: "PENDING",
        orderId: order.orderId,
        ...(order.scheduleReservationId ? { scheduleReservationId: order.scheduleReservationId } : {}),
        ...(order.membershipId ? { membershipId: order.membershipId } : {}),
        enrolledAt: occurredAt,
        version: 1,
        updatedAt: occurredAt,
      };
      await this.repo.createEnrollment(proposed);
      enrollment = (await this.repo.enrollment(order.studentId, order.offeringId)) ?? proposed;
    }
    if (order.offeringType === "LIVE_COHORT") {
      try {
        order = await this.ensurePostPaymentReservation(order);
        if (!order.classId || !order.scheduleReservationId || !order.membershipId)
          throw new Error("LIVE_ORDER_BINDING_INCOMPLETE");
        if (
          enrollment.state === "PENDING" &&
          enrollment.scheduleReservationId !== order.scheduleReservationId
        ) {
          await this.repo.rebindPendingEnrollment(enrollment, order.scheduleReservationId, new Date());
          enrollment = await this.requiredEnrollment(order.studentId, order.offeringId);
          if (enrollment.scheduleReservationId !== order.scheduleReservationId)
            throw new Error("ENROLLMENT_RESERVATION_BINDING_MISMATCH");
        }
        const classId = order.classId,
          reservationId = order.scheduleReservationId,
          membershipId = order.membershipId;
        const common = {
          operationId: deterministicUuid(this.secret, "membership-operation", order.orderId),
          studentId: order.studentId,
          offeringId: order.offeringId,
          enrollmentId: order.enrollmentId,
          reservationId,
          orderId: order.orderId,
          membershipId,
        };
        await this.classroom.membership(classId, { action: "PREPARE", ...common }, order.correlationId);
        await this.classroom.confirm(
          reservationId,
          {
            operationId: deterministicUuid(this.secret, "schedule-confirm", order.orderId),
            orderId: order.orderId,
            membershipId,
          },
          order.correlationId,
        );
        const active = await this.classroom.membership(
          classId,
          { action: "ACTIVATE", ...common },
          order.correlationId,
        );
        if (active.state !== "ACTIVE") throw new Error("MEMBERSHIP_NOT_ACTIVE");
      } catch (error) {
        if (
          error instanceof CommerceClassroomError &&
          ["SCHEDULE_CONFLICT", "RESERVATION_TERMINAL"].includes(error.code)
        ) {
          await this.repo.markRefundRequired(order, "SCHEDULE_REACQUIRE_CONFLICT", new Date());
          return order.version;
        }
        throw error;
      }
    }
    await this.convergeAccess(enrollment, course.title, new Date());
    const active = await this.requiredEnrollment(order.studentId, order.offeringId);
    if (active.state !== "ACTIVE") throw new Error("ENROLLMENT_NOT_ACTIVE");
    await this.repo.readyEvent(order.enrolledEventId, occurredAt);
    order = (await this.repo.order(orderId)) ?? order;
    await this.repo.markEntitled(order, new Date());
    const complete = await this.repo.order(orderId);
    if (!complete || complete.state !== "ENTITLED") throw new Error("ORDER_NOT_ENTITLED");
    return complete.version;
  }

  private async convergeAccess(enrollment: OfferingEnrollment, title: string, now: Date) {
    let entitlement = await this.repo.entitlement(enrollment.studentId, enrollment.courseId);
    if (!entitlement) {
      const proposed: CourseEntitlement = {
        entitlementId: deterministicUuid(
          this.secret,
          "course-entitlement",
          `${enrollment.studentId}:${enrollment.courseId}`,
        ),
        studentId: enrollment.studentId,
        courseId: enrollment.courseId,
        state: "ACTIVE",
        sourceOfferingId: enrollment.offeringId,
        sourceEnrollmentId: enrollment.enrollmentId,
        grantedAt: enrollment.enrolledAt,
        version: 1,
        updatedAt: now,
      };
      await this.repo.grantEntitlement(proposed);
      entitlement = (await this.repo.entitlement(enrollment.studentId, enrollment.courseId)) ?? proposed;
    }
    if (entitlement.state !== "ACTIVE") throw new Error("ENTITLEMENT_NOT_ACTIVE");
    await this.repo.syncAccess(entitlement, title);
    await this.repo.activateEnrollment(enrollment, now);
  }
  private async revalidateBeforePayment(
    order: LearningOrder,
    offering: Offering,
    input: { correlationId: string; classroomActorContext?: string; actor: ActorContext },
  ) {
    if (!order.classId || !order.reservationOperationId || !input.classroomActorContext)
      throw new AppError("CLASSROOM_ACTOR_CONTEXT_REQUIRED", 401, "Trusted Student context is required");
    const classId = order.classId,
      reservationOperationId = order.reservationOperationId;
    await this.requireLiveContext(offering, input.correlationId);
    try {
      await this.classroomCall(() =>
        this.classroom.reserve(
          {
            operationId: reservationOperationId,
            studentId: order.studentId,
            offeringId: order.offeringId,
            classId,
          },
          input.correlationId,
          input.classroomActorContext,
        ),
      );
      return order;
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        !["RESERVATION_EXPIRED", "RESERVATION_TERMINAL"].includes(error.code)
      )
        throw error;
      const operationId = deterministicUuid(this.secret, "payment-reacquire", order.orderId);
      const held = await this.classroomCall(() =>
        this.classroom.reserve(
          { operationId, studentId: order.studentId, offeringId: order.offeringId, classId },
          input.correlationId,
          input.classroomActorContext,
        ),
      );
      if (!(await this.repo.updateReservation(order, held.reservationId, operationId, new Date())))
        throw conflict("ORDER_VERSION_CONFLICT", "Order changed during reservation reacquisition");
      return (await this.repo.order(order.orderId)) ?? order;
    }
  }
  private async ensurePostPaymentReservation(order: LearningOrder) {
    if (
      !order.classId ||
      !order.scheduleReservationId ||
      !order.reservationOperationId ||
      !order.membershipId
    )
      throw new Error("LIVE_ORDER_BINDING_INCOMPLETE");
    try {
      await this.classroom.reserve(
        {
          operationId: order.reservationOperationId,
          studentId: order.studentId,
          offeringId: order.offeringId,
          classId: order.classId,
        },
        order.correlationId,
        undefined,
        true,
      );
      return order;
    } catch (error) {
      if (
        !(error instanceof CommerceClassroomError) ||
        !["RESERVATION_EXPIRED", "RESERVATION_TERMINAL"].includes(error.code)
      )
        throw error;
      const operationId = deterministicUuid(this.secret, "fulfillment-reacquire", order.orderId);
      const held = await this.classroom.reserve(
        { operationId, studentId: order.studentId, offeringId: order.offeringId, classId: order.classId },
        order.correlationId,
        undefined,
        true,
      );
      await this.repo.replacePaidReservation(order, held.reservationId, operationId, new Date());
      return (await this.repo.order(order.orderId)) ?? order;
    }
  }
  private async requireOffering(id: string, now: Date, existingOrder = false) {
    const offering = await this.repo.offering(id);
    if (!offering || offering.state !== "PUBLISHED")
      throw notFound("OFFERING_NOT_AVAILABLE", "Offering is not available");
    if (!existingOrder) {
      const course = await this.repo.course(offering.courseId);
      if (!course || course.state !== "PUBLISHED")
        throw notFound("COURSE_NOT_AVAILABLE", "Course is no longer open for enrollment");
    }
    if (
      !existingOrder &&
      ((offering.salesStartAt && offering.salesStartAt > now) ||
        (offering.salesEndAt && offering.salesEndAt <= now))
    )
      throw conflict("OFFERING_NOT_ON_SALE", "Offering is outside its sales window");
    return offering;
  }
  private async requireLiveContext(offering: Offering, requestId: string) {
    if (!offering.classId) throw conflict("LIVE_COHORT_CLASS_REQUIRED", "LIVE_COHORT requires a Class");
    const context = await this.classroomContext.get(offering.classId, requestId);
    if (
      context.classKind !== "LIVE_COHORT" ||
      context.classState !== "ACTIVE" ||
      context.scheduleState !== "PUBLISHED" ||
      context.linkedCourseId !== offering.courseId ||
      context.sessionCount < 1
    )
      throw conflict("LIVE_COHORT_CONTEXT_INVALID", "Class context is not purchase eligible");
  }
  private async requiredEnrollment(studentId: string, offeringId: string) {
    const value = await this.repo.enrollment(studentId, offeringId);
    if (!value) throw unavailable();
    return value;
  }
  private async completeOrderCommand(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    receipt: { fingerprint: string; occurredAt: string },
    order: LearningOrder,
    replayed: boolean,
  ) {
    const dto = orderDto(order);
    await this.repo.complete(scope, hash, key, operationId, { ...receipt, order: dto }, 201);
    return { order: dto, replayed };
  }
  private async completePayment(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    receipt: { fingerprint: string; occurredAt: string },
    order: LearningOrder,
    replayed: boolean,
  ) {
    const dto = orderDto(order);
    await this.repo.complete(scope, hash, key, operationId, { ...receipt, order: dto }, 200);
    return { order: dto, replayed };
  }
  private async classroomCall<T>(call: () => Promise<T>) {
    try {
      return await call();
    } catch (error) {
      if (error instanceof CommerceClassroomError) {
        if (error.kind === "UNAVAILABLE")
          throw new AppError("CLASSROOM_UNAVAILABLE", 503, "Classroom is temporarily unavailable", true);
        throw new AppError(error.code, error.status ?? 409, "Classroom rejected the operation");
      }
      throw error;
    }
  }
}
function recoveryMac(
  secret: string,
  value: Pick<
    RecoveryCandidate,
    "transactionId" | "orderId" | "fingerprint" | "receivedAt" | "paidEventId" | "correlationId" | "amount"
  >,
) {
  return fingerprint(secret, {
    purpose: "sepay-recovery-v1",
    transactionId: value.transactionId,
    orderId: value.orderId,
    fingerprint: value.fingerprint,
    receivedAt: value.receivedAt.toISOString(),
    paidEventId: value.paidEventId,
    correlationId: value.correlationId,
    amount: value.amount,
  });
}
function student(actor: ActorContext) {
  if (!actor.roles.includes("STUDENT"))
    throw new AppError("STUDENT_REQUIRED", 403, "Student authorization is required");
}
function conflict(code: string, message: string) {
  return new AppError(code, 409, message);
}
function notFound(code: string, message: string) {
  return new AppError(code, 404, message);
}
function unavailable() {
  return new AppError(
    "LEARNING_COMMAND_UNAVAILABLE",
    503,
    "Learning command is temporarily unavailable",
    true,
  );
}
function previousMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
}
