import { ApiError, record, string, type RequestOptions } from "./api";

type Requester = { request(path: string, options?: RequestOptions): Promise<unknown> };
const minor = (value: unknown) => {
  const text = string(value);
  if (!/^-?\d+$/u.test(text)) throw new ApiError("invalid");
  return text;
};
const points = (value: unknown) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 5000)
    throw new ApiError("invalid");
  return value;
};

export type Commission = { basisPoints: number; effectiveAt: string; updatedBy: string | null };
export function commission(value: unknown): Commission {
  const data = record(value);
  const effectiveAt = string(data.effectiveAt);
  if (!Number.isFinite(Date.parse(effectiveAt))) throw new ApiError("invalid");
  return {
    basisPoints: points(data.basisPoints),
    effectiveAt,
    updatedBy: data.updatedBy === null ? null : string(data.updatedBy),
  };
}
export const percent = (basisPoints: number, locale: string = "vi-VN") =>
  `${(basisPoints / 100).toLocaleString(locale, { maximumFractionDigits: 2 })}%`;
// Format exact integer digits without passing BigInt to native Intl implementations.
const groupedInteger = (amount: bigint, locale: string) =>
  amount.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, locale === "en-US" ? "," : ".");
export const vnd = (amount: string | bigint, locale: string = "vi-VN") =>
  `${groupedInteger(BigInt(amount), locale)} ₫`;
export function quote(price: string, currency: string, basisPoints: number, locale: string = "vi-VN") {
  points(basisPoints);
  const scale = currency === "VND" ? 1n : 100n;
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u.exec(price);
  if (!match || !/^[A-Z]{3}$/u.test(currency) || (scale === 1n && !!match[2])) return null;
  const amount =
    BigInt(match[1]!) * scale + (scale === 100n ? BigInt((match[2] ?? "").padEnd(2, "0") || "0") : 0n);
  const fee = (amount * BigInt(basisPoints)) / 10_000n;
  const format = (value: bigint) =>
    `${groupedInteger(value / scale, locale)}${scale === 100n ? `${locale === "en-US" ? "." : ","}${String(value % scale).padStart(2, "0")}` : ""} ${currency}`;
  return { gross: format(amount), fee: format(fee), earnings: format(amount - fee) };
}
export async function readCommission(api: Requester, role: "ADMIN" | "LECTURER") {
  return commission(
    await api.request(role === "ADMIN" ? "/api/v1/admin/commission" : "/api/v1/me/commission"),
  );
}
export async function saveCommission(
  api: Requester,
  current: Commission,
  percentInput: string,
  idempotencyKey: string,
) {
  const value = Number(percentInput);
  const basisPoints = Math.round(value * 100);
  if (
    !percentInput.trim() ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 50 ||
    Math.abs(value * 100 - basisPoints) > 0.000001
  )
    throw new ApiError("422", 422);
  return commission(
    await api.request("/api/v1/admin/commission", {
      method: "POST",
      body: { basisPoints, expectedEffectiveAt: current.effectiveAt },
      idempotencyKey,
    }),
  );
}

export type RevenueDay = {
  day: string;
  grossMinor: string;
  refundMinor: string;
  netMinor: string;
  orders: number;
};
export type RevenueCourse = {
  courseId: string;
  title: string;
  grossMinor: string;
  refundMinor: string;
  netMinor: string;
  orders: number;
};
export type LecturerRevenue = {
  lecturerId: string;
  grossMinor: string;
  refundMinor: string;
  netMinor: string;
  estimatedPlatformMinor: string;
  estimatedEarningsMinor: string;
  orders: number;
  dailyRevenue: RevenueDay[];
  courses: RevenueCourse[];
};
const day = (value: unknown): RevenueDay => {
  const r = record(value);
  return {
    day: string(r.day),
    grossMinor: minor(r.grossMinor),
    refundMinor: minor(r.refundMinor),
    netMinor: minor(r.netMinor),
    orders: Number(r.orders ?? 0),
  };
};
const course = (value: unknown): RevenueCourse => {
  const r = record(value);
  return {
    courseId: string(r.courseId),
    title: string(r.title),
    grossMinor: minor(r.grossMinor),
    refundMinor: minor(r.refundMinor),
    netMinor: minor(r.netMinor),
    orders: Number(r.orders ?? 0),
  };
};
const lecturer = (value: unknown): LecturerRevenue => {
  const r = record(value);
  return {
    lecturerId: string(r.lecturerId),
    grossMinor: minor(r.grossMinor),
    refundMinor: minor(r.refundMinor),
    netMinor: minor(r.netMinor),
    estimatedPlatformMinor: minor(r.estimatedPlatformMinor),
    estimatedEarningsMinor: minor(r.estimatedEarningsMinor),
    orders: Number(r.orders ?? 0),
    dailyRevenue: Array.isArray(r.dailyRevenue) ? r.dailyRevenue.map(day) : [],
    courses: Array.isArray(r.courses) ? r.courses.map(course) : [],
  };
};
export type LecturerReport = { lecturer: LecturerRevenue; backfillThrough: string };
export function lecturerReport(value: unknown): LecturerReport {
  const r = record(value);
  if (r.dataSource !== "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION") throw new ApiError("invalid");
  return { lecturer: lecturer(r.lecturer), backfillThrough: string(record(r.completeness).backfillThrough) };
}
export type AdminReport = {
  grossMinor: string;
  refundMinor: string;
  netMinor: string;
  orderCount: number;
  refundCount: number;
  dailyRevenue: RevenueDay[];
  lecturers: LecturerRevenue[];
  backfillThrough: string;
};
export function adminReport(value: unknown): AdminReport {
  const r = record(value);
  if (r.dataSource !== "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION") throw new ApiError("invalid");
  return {
    grossMinor: minor(r.grossMinor),
    refundMinor: minor(r.refundMinor),
    netMinor: minor(r.netMinor),
    orderCount: Number(r.orderCount),
    refundCount: Number(r.refundCount),
    dailyRevenue: Array.isArray(r.dailyRevenue) ? r.dailyRevenue.map(day) : [],
    lecturers: Array.isArray(r.lecturers) ? r.lecturers.map(lecturer) : [],
    backfillThrough: string(record(r.completeness).backfillThrough),
  };
}
export type PayoutAccount = { bankName: string; accountNumber: string; accountHolder: string };
export function payoutAccount(value: unknown): PayoutAccount | null {
  if (value === null) return null;
  const r = record(value);
  return {
    bankName: string(r.bankName),
    accountNumber: string(r.accountNumber),
    accountHolder: string(r.accountHolder),
  };
}
export type PayoutCandidate = {
  lecturerId: string;
  estimatedEarningsMinor: string;
  accountConfigured: boolean;
};
export type PayoutInstruction = {
  lecturerId: string;
  amountMinor: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  status: string;
};
export type Payouts = {
  month: string;
  canPrepare: boolean;
  candidates: PayoutCandidate[];
  instructions: PayoutInstruction[];
  skipped: { lecturerId: string; reason: string }[];
};
export function payouts(value: unknown): Payouts {
  const r = record(value);
  return {
    month: string(r.month),
    canPrepare: r.canPrepare === true,
    candidates: Array.isArray(r.candidates)
      ? r.candidates.map((item) => {
          const c = record(item);
          return {
            lecturerId: string(c.lecturerId),
            estimatedEarningsMinor: minor(c.estimatedEarningsMinor),
            accountConfigured: c.accountConfigured === true,
          };
        })
      : [],
    instructions: Array.isArray(r.instructions)
      ? r.instructions.map((item) => {
          const i = record(item);
          return {
            lecturerId: string(i.lecturerId),
            amountMinor: minor(i.amountMinor),
            bankName: string(i.bankName),
            accountNumber: string(i.accountNumber),
            accountHolder: string(i.accountHolder),
            status: string(i.status),
          };
        })
      : [],
    skipped: Array.isArray(r.skipped)
      ? r.skipped.map((item) => {
          const s = record(item);
          return { lecturerId: string(s.lecturerId), reason: string(s.reason) };
        })
      : [],
  };
}
export async function preparePayouts(api: Requester, lecturerId: string | undefined, idempotencyKey: string) {
  return payouts(
    await api.request("/api/v1/admin/payouts/prepare", {
      method: "POST",
      body: lecturerId ? { lecturerId } : {},
      idempotencyKey,
    }),
  );
}
