import { ApiError, record, string } from "./api";

export interface Course {
  courseId: string;
  title: string;
  state?: string;
  priceType?: string;
  price?: string;
  currency?: string;
  categoryId?: string;
}

export function course(value: unknown): Course {
  const rec = record(value);
  return {
    courseId: string(rec.courseId),
    title: string(rec.title),
    state: typeof rec.state === "string" ? rec.state : undefined,
    priceType: typeof rec.priceType === "string" ? rec.priceType : undefined,
    price: typeof rec.price === "string" ? rec.price : undefined,
    currency: typeof rec.currency === "string" ? rec.currency : undefined,
    categoryId: typeof rec.categoryId === "string" ? rec.categoryId : undefined,
  };
}

export function courses(value: unknown): Course[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(course);
}

export interface CourseDetail extends Course {
  description?: string;
  slug?: string;
  lecturerName?: string;
  publishedAt?: string;
  totalLessons?: number;
}

function getNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const num = Number(value);
  if (Number.isNaN(num)) throw new ApiError("invalid");
  return num;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return getNumber(value);
}

export function courseDetail(value: unknown): CourseDetail {
  const base = course(value);
  const rec = record(value);
  return {
    ...base,
    description: typeof rec.description === "string" ? rec.description : undefined,
    slug: typeof rec.slug === "string" ? rec.slug : undefined,
    lecturerName: typeof rec.lecturerName === "string" ? rec.lecturerName : undefined,
    publishedAt: typeof rec.publishedAt === "string" ? rec.publishedAt : undefined,
    totalLessons: optionalNumber(rec.totalLessons),
  };
}

export interface Offering {
  offeringId: string;
  courseId: string;
  offeringType: string;
  state: string;
  price?: string;
  currency?: string;
}

export function offering(value: unknown): Offering {
  const rec = record(value);
  return {
    offeringId: string(rec.offeringId),
    courseId: string(rec.courseId),
    offeringType: string(rec.offeringType),
    state: string(rec.state),
    price: typeof rec.price === "string" ? rec.price : undefined,
    currency: typeof rec.currency === "string" ? rec.currency : undefined,
  };
}

export function offerings(value: unknown): Offering[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(offering);
}

export interface Position {
  sectionOrder: number;
  lessonOrder: number;
}

export interface LessonSummary {
  lessonId: string;
  courseId: string;
  title: string;
  sectionTitle?: string;
  preview: boolean;
  position: Position;
}

function positionDecoder(value: unknown): Position {
  const rec = record(value);
  return {
    sectionOrder: getNumber(rec.sectionOrder),
    lessonOrder: getNumber(rec.lessonOrder),
  };
}

export function lessonSummary(value: unknown): LessonSummary {
  const rec = record(value);
  return {
    lessonId: string(rec.lessonId),
    courseId: string(rec.courseId),
    title: string(rec.title),
    sectionTitle: typeof rec.sectionTitle === "string" ? rec.sectionTitle : undefined,
    preview: typeof rec.preview === "boolean" ? rec.preview : rec.preview === "true" || rec.preview === true,
    position: positionDecoder(rec.position),
  };
}

export function lessonSummaries(value: unknown): LessonSummary[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(lessonSummary);
}

export interface LessonDetail extends LessonSummary {
  mediaAssetId?: string;
  mediaStatus?: string;
  contentUrl?: string;
  externalVideo?: string;
  contentType?: string;
  state?: string;
}

export function lessonDetail(value: unknown): LessonDetail {
  const rec = record(value);
  return {
    lessonId: string(rec.lessonId),
    courseId: string(rec.courseId),
    title: string(rec.title),
    sectionTitle: typeof rec.sectionTitle === "string" ? rec.sectionTitle : undefined,
    preview: typeof rec.preview === "boolean" ? rec.preview : rec.preview === "true" || rec.preview === true,
    position: rec.position ? positionDecoder(rec.position) : { sectionOrder: 1, lessonOrder: 1 },
    contentUrl: typeof rec.contentUrl === "string" ? rec.contentUrl : undefined,
    externalVideo: typeof rec.externalVideo === "string" ? rec.externalVideo : undefined,
    contentType: typeof rec.contentType === "string" ? rec.contentType : undefined,
    mediaAssetId: typeof rec.mediaAssetId === "string" ? rec.mediaAssetId : undefined,
    mediaStatus: typeof rec.mediaStatus === "string" ? rec.mediaStatus : undefined,
    state: typeof rec.state === "string" ? rec.state : undefined,
  };
}

export interface Progress {
  courseId: string;
  percent: number;
  completedCount: number;
  publishedTotal: number;
  progressVersion: number;
  courseContentVersion: number;
  completed: boolean;
}

export function progress(value: unknown): Progress {
  const rec = record(value);
  return {
    courseId: string(rec.courseId),
    percent: getNumber(rec.percent),
    completedCount: getNumber(rec.completedCount),
    publishedTotal: getNumber(rec.publishedTotal),
    progressVersion: getNumber(rec.progressVersion),
    courseContentVersion: getNumber(rec.courseContentVersion),
    completed:
      typeof rec.completed === "boolean" ? rec.completed : rec.completed === "true" || rec.completed === true,
  };
}

export type EnrolledCourse = Course;

export function enrolledCourses(value: unknown): EnrolledCourse[] {
  return courses(value);
}

export function resumeTarget(
  lessons: LessonSummary[],
  completed: Set<string> | number | Progress,
): LessonSummary | undefined {
  const sorted = [...lessons].sort((a, b) => {
    if (a.position.sectionOrder !== b.position.sectionOrder) {
      return a.position.sectionOrder - b.position.sectionOrder;
    }
    return a.position.lessonOrder - b.position.lessonOrder;
  });

  if (completed instanceof Set) {
    return sorted.find((l) => !completed.has(l.lessonId));
  }

  const count = typeof completed === "number" ? completed : completed.completedCount;
  if (count >= sorted.length) return undefined;
  return sorted[Math.max(0, count)];
}

export function safeContentUrl(
  value?: string,
  environment: "development" | "research" | "production" = (process.env.EXPO_PUBLIC_AILSS_ENV as
    "development" | "research" | "production") ?? "development",
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    // Unsupported URI schemes fail closed
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    // Credential-bearing URLs fail closed
    if (url.username || url.password) return undefined;
    // Production external resource URLs require HTTPS; cleartext HTTP allowed only in dev/research
    if (environment === "production" && url.protocol !== "https:") return undefined;
    // Never expose MinIO credentials or private object storage internals
    const search = url.search.toLowerCase();
    if (
      search.includes("awsaccesskeyid") ||
      search.includes("x-amz-signature") ||
      search.includes("x-amz-credential") ||
      search.includes("x-amz-security-token")
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isAlreadyEnrolledConflict(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 409) {
    return error.code === "ALREADY_ENROLLED" || error.code === "ENROLLMENT_EXISTS";
  }
  return false;
}

export interface RefundRequestInput {
  orderId: string;
  courseId: string;
  reason: string;
  bankAccount?: string | undefined;
}

export interface RefundResponse {
  refundId: string;
  status: "PROCESSED" | "REJECTED" | "PENDING";
  message: string;
  amountMinor?: number | undefined;
}

export async function requestCourseRefund(
  input: RefundRequestInput,
  apiCall?: (endpoint: string, body: unknown) => Promise<unknown>,
): Promise<RefundResponse> {
  if (!apiCall) throw new ApiError("unavailable");
  const res = await apiCall("/api/v1/learning/refunds", {
    orderId: input.orderId,
    courseId: input.courseId,
    reason: input.reason,
    bankAccount: input.bankAccount,
  });
  const data = record(record(res).data),
    status = data.status;
  if (
    typeof data.refundId !== "string" ||
    !data.refundId.trim() ||
    (status !== "PROCESSED" && status !== "REJECTED" && status !== "PENDING") ||
    typeof data.message !== "string" ||
    (data.amountMinor !== undefined &&
      (typeof data.amountMinor !== "number" ||
        !Number.isSafeInteger(data.amountMinor) ||
        data.amountMinor < 0))
  )
    throw new ApiError("invalid");
  return {
    refundId: data.refundId,
    status,
    message: data.message,
    ...(typeof data.amountMinor === "number" ? { amountMinor: data.amountMinor } : {}),
  };
}

export interface MobileMasteryItem {
  conceptId: string;
  conceptName: string;
  masteryScore: number;
  bloomLevel: string;
  confidenceScore: number;
}

export interface MobileAdaptivePathItem {
  itemId: string;
  conceptName: string;
  action: "CONTINUE" | "PRACTICE" | "REVIEW" | "REVISIT_PREREQUISITE" | "OPTIONAL_ENRICHMENT";
  priority: number;
  rationale: string;
}

export interface MobileCourseVersionInfo {
  courseId: string;
  pinnedVersion: number;
  latestVersion: number;
  hasUpgradeAvailable: boolean;
  upgradeDecision: "STAY_ON_CURRENT" | "OPTIONAL_UPGRADE" | "MANDATORY_CORRECTION";
  humanSummary: string;
}

export function isRefundEligible(
  progressPercent: number,
  purchaseDateIso: string,
  now: Date = new Date(),
): { eligible: boolean; reason?: string } {
  if (progressPercent >= 20) {
    return { eligible: false, reason: "Tiến độ học tập đã đạt từ 20% trở lên." };
  }
  const purchaseTime = new Date(purchaseDateIso).getTime();
  const diffDays = (now.getTime() - purchaseTime) / (1000 * 60 * 60 * 24);
  if (diffDays > 7) {
    return { eligible: false, reason: "Đã quá thời hạn hoàn tiền 7 ngày." };
  }
  return { eligible: true };
}
