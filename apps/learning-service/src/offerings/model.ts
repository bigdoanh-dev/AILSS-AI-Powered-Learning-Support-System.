import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const offeringTypes = ["SELF_PACED", "LIVE_COHORT"] as const;
export type OfferingType = (typeof offeringTypes)[number];
export type OfferingState = "DRAFT" | "PUBLISHED" | "CLOSED";

const title = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .refine(
    (v) => !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    "Control characters are not allowed",
  );
const price = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u);
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{3}$/u));
const instant = z.string().datetime({ offset: true }).nullable();

const write = z
  .object({
    offeringType: z.enum(offeringTypes),
    classId: z.string().uuid().optional(),
    title,
    price,
    currency,
    salesStartAt: instant.optional(),
    salesEndAt: instant.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.offeringType === "SELF_PACED" && v.classId)
      ctx.addIssue({ code: "custom", path: ["classId"], message: "classId is forbidden for SELF_PACED" });
    if (v.offeringType === "LIVE_COHORT" && !v.classId)
      ctx.addIssue({ code: "custom", path: ["classId"], message: "classId is required for LIVE_COHORT" });
    checkWindow(v.salesStartAt, v.salesEndAt, ctx);
  });
const patch = z
  .object({
    title: title.optional(),
    price: price.optional(),
    currency: currency.optional(),
    salesStartAt: instant.optional(),
    salesEndAt: instant.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "PATCH body must not be empty");

export type OfferingWriteRequest = z.infer<typeof write>;
export type OfferingPatchRequest = z.infer<typeof patch>;
export const parseOfferingWrite = (v: unknown) => write.parse(v);
export const parseOfferingPatch = (v: unknown) => patch.parse(v);

export interface Offering {
  offeringId: string;
  courseId: string;
  ownerLecturerId: string;
  offeringType: OfferingType;
  classId?: string;
  title: string;
  state: OfferingState;
  price: string;
  currency: string;
  salesStartAt?: Date;
  salesEndAt?: Date;
  recordVersion: number;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date;
}
export type OfferingDto = ReturnType<typeof offeringDto>;
export interface OfferingReceipt {
  fingerprint: string;
  offering?: OfferingDto;
  oldUpdatedAt?: string;
  occurredAt?: string;
  expectedVersion?: number;
  publishedAt?: string;
}

export function mergePatch(value: Offering, request: OfferingPatchRequest): Offering {
  const start = toDate(request.salesStartAt, value.salesStartAt),
    end = toDate(request.salesEndAt, value.salesEndAt);
  const merged: Offering = {
    ...value,
    title: request.title ?? value.title,
    price: request.price ?? value.price,
    currency: request.currency ?? value.currency,
  };
  if (start) merged.salesStartAt = start;
  else delete merged.salesStartAt;
  if (end) merged.salesEndAt = end;
  else delete merged.salesEndAt;
  if (merged.salesStartAt && merged.salesEndAt && merged.salesStartAt >= merged.salesEndAt)
    throw new Error("INVALID_SALES_WINDOW");
  return merged;
}
function toDate(value: string | null | undefined, current?: Date) {
  return value === undefined ? current : value === null ? undefined : new Date(value);
}
function checkWindow(start: string | null | undefined, end: string | null | undefined, ctx: z.RefinementCtx) {
  if (start && end && new Date(start) >= new Date(end))
    ctx.addIssue({ code: "custom", path: ["salesEndAt"], message: "salesStartAt must be before salesEndAt" });
}
export function offeringDto(v: Offering) {
  return {
    offeringId: v.offeringId,
    courseId: v.courseId,
    ownerLecturerId: v.ownerLecturerId,
    offeringType: v.offeringType,
    ...(v.classId ? { classId: v.classId } : {}),
    title: v.title,
    state: v.state,
    price: v.price,
    currency: v.currency,
    ...(v.salesStartAt ? { salesStartAt: v.salesStartAt.toISOString() } : {}),
    ...(v.salesEndAt ? { salesEndAt: v.salesEndAt.toISOString() } : {}),
    recordVersion: v.recordVersion,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    ...(v.publishedAt ? { publishedAt: v.publishedAt.toISOString() } : {}),
  };
}
export function offeringFromDto(v: OfferingDto): Offering {
  return {
    offeringId: v.offeringId,
    courseId: v.courseId,
    ownerLecturerId: v.ownerLecturerId,
    offeringType: v.offeringType,
    ...(v.classId ? { classId: v.classId } : {}),
    title: v.title,
    state: v.state,
    price: v.price,
    currency: v.currency,
    recordVersion: v.recordVersion,
    createdAt: new Date(v.createdAt),
    updatedAt: new Date(v.updatedAt),
    ...(v.salesStartAt ? { salesStartAt: new Date(v.salesStartAt) } : {}),
    ...(v.salesEndAt ? { salesEndAt: new Date(v.salesEndAt) } : {}),
    ...(v.publishedAt ? { publishedAt: new Date(v.publishedAt) } : {}),
  };
}

export type OfferingCursor = {
  v: 1;
  type: OfferingType;
  windowEnd: string;
  positions: Record<string, [string, string]>;
  filtersHash: string;
  exp: number;
};
export function encodeOfferingCursor(secret: string, value: OfferingCursor) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
export function decodeOfferingCursor(secret: string, token: string): OfferingCursor {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("INVALID_CURSOR");
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("INVALID_CURSOR");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OfferingCursor;
  if (parsed.exp < Math.floor(Date.now() / 1000)) throw new Error("INVALID_CURSOR");
  return parsed;
}
export const month = (date: Date) => date.toISOString().slice(0, 7) + "-01";
