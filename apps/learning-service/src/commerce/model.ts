import { createHash, createHmac } from "node:crypto";
import { paymentInstructions, paymentMode } from "./sepay.js";
import { z } from "zod";
import type { OfferingType } from "../offerings/model.js";

export const orderCreateSchema = z.object({ offeringId: z.string().uuid() }).strict();
export const paymentSchema = z.object({ outcome: z.enum(["SUCCESS", "FAILURE"]) }).strict();
export type OrderCreateRequest = z.infer<typeof orderCreateSchema>;
export type PaymentRequest = z.infer<typeof paymentSchema>;
export const orderStates = ["PENDING", "PAYMENT_FAILED", "PAID_PENDING_ENTITLEMENT", "ENTITLED"] as const;
export const fulfillmentStates = [
  "NOT_STARTED",
  "PENDING",
  "IN_PROGRESS",
  "ACTIVE",
  "REFUND_REQUIRED",
] as const;
export type OrderState = (typeof orderStates)[number];
export type FulfillmentState = (typeof fulfillmentStates)[number];

export interface LearningOrder {
  orderId: string;
  studentId: string;
  offeringId: string;
  courseId: string;
  offeringType: OfferingType;
  classId?: string;
  scheduleReservationId?: string;
  reservationOperationId?: string;
  enrollmentId: string;
  membershipId?: string;
  operationId: string;
  paidEventId: string;
  enrolledEventId: string;
  correlationId: string;
  state: OrderState;
  fulfillmentState: FulfillmentState;
  compensationReason?: string;
  price: string;
  currency: string;
  requestKey: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  paidAt?: Date;
}

export type EnrollmentState = "PENDING" | "FULFILLMENT_PENDING" | "ACTIVE" | "CANCELLED" | "REFUND_REQUIRED";
export interface OfferingEnrollment {
  enrollmentId: string;
  studentId: string;
  offeringId: string;
  courseId: string;
  offeringType: OfferingType;
  classId?: string;
  state: EnrollmentState;
  entitlementState: "PENDING" | "ACTIVE";
  orderId?: string;
  scheduleReservationId?: string;
  membershipId?: string;
  enrolledAt: Date;
  version: number;
  updatedAt: Date;
}
export interface CourseEntitlement {
  entitlementId: string;
  studentId: string;
  courseId: string;
  state: "ACTIVE" | "REVOKED";
  sourceOfferingId: string;
  sourceEnrollmentId: string;
  grantedAt: Date;
  version: number;
  updatedAt: Date;
}
export interface CommerceReceipt {
  fingerprint: string;
  occurredAt: string;
  order?: ReturnType<typeof orderDto>;
  enrollment?: ReturnType<typeof enrollmentDto>;
}

export function orderDto(v: LearningOrder) {
  return {
    paymentMode: paymentMode(),
    payment: paymentInstructions(v),
    orderId: v.orderId,
    studentId: v.studentId,
    offeringId: v.offeringId,
    courseId: v.courseId,
    offeringType: v.offeringType,
    ...(v.classId ? { classId: v.classId } : {}),
    ...(v.scheduleReservationId ? { scheduleReservationId: v.scheduleReservationId } : {}),
    state: v.state,
    fulfillmentState: v.fulfillmentState,
    ...(v.compensationReason ? { compensationReason: v.compensationReason } : {}),
    price: v.price,
    currency: v.currency,
    version: v.version,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    ...(v.paidAt ? { paidAt: v.paidAt.toISOString() } : {}),
  };
}
export function enrollmentDto(v: OfferingEnrollment) {
  return {
    enrollmentId: v.enrollmentId,
    studentId: v.studentId,
    offeringId: v.offeringId,
    courseId: v.courseId,
    offeringType: v.offeringType,
    ...(v.classId ? { classId: v.classId } : {}),
    state: v.state,
    entitlementState: v.entitlementState,
    enrolledAt: v.enrolledAt.toISOString(),
    version: v.version,
  };
}
export function fingerprint(secret: string, value: object) {
  return createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex");
}
export function keyHash(secret: string, value: string) {
  const valueByte = createHmac("sha256", secret).update(value).digest()[0] ?? 0;
  return valueByte > 127 ? valueByte - 256 : valueByte;
}
export function deterministicUuid(secret: string, label: string, value: string) {
  const bytes = createHmac("sha256", secret).update(`${label}:${value}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return uuidBytes(bytes);
}
export function defaultOfferingId(courseId: string) {
  const namespace = Buffer.from("f36a5ca45f165dae8c7db8bf0f02d814", "hex");
  const bytes = createHash("sha1").update(namespace).update(courseId, "utf8").digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return uuidBytes(bytes);
}
function uuidBytes(bytes: Buffer) {
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function decimalIsZero(value: string) {
  return /^0(?:\.0{1,2})?$/u.test(value);
}
export function eventShard(id: string) {
  return (createHash("sha256").update(id).digest()[0] ?? 0) % 16;
}
