import { ApiError, record, string } from "./api";

export type AdminRole = "STUDENT" | "LECTURER" | "ADMIN";
export type AdminUserStatus = "ACTIVE" | "SUSPENDED";

export interface AdminUser {
  userId: string;
  displayName: string;
  emailMasked?: string;
  role: AdminRole;
  status: AdminUserStatus;
  lecturerVerified: boolean;
  profileVersion: number;
  createdAt?: string;
  updatedAt: string;
}

export interface AdminUserListResponse {
  items: AdminUser[];
  nextCursor: string | null;
}

export type ApplicationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface LecturerApplication {
  applicationId: string;
  userId: string;
  displayName?: string;
  emailMasked?: string;
  status: ApplicationStatus;
  submittedAt: string;
  decidedAt?: string | null;
  notes?: string;
}

export type ModerationTargetType = "COMMENT" | "REVIEW";
export type ModerationState = "OPEN" | "RESOLVED";
export type ModerationAction = "HIDE" | "RESTORE" | "DISMISS" | "WARN";

export interface ModerationReport {
  reportId: string;
  targetType: ModerationTargetType;
  targetId: string;
  state: ModerationState;
  decision: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  reason?: string;
}

export interface ModerationListResponse {
  items: ModerationReport[];
  nextCursor: string | null;
}

export type OrderState = "PENDING" | "PAYMENT_FAILED" | "PAID_PENDING_ENTITLEMENT" | "ENTITLED";

export interface CommerceOrder {
  orderId: string;
  courseId?: string;
  offeringId?: string;
  offeringType?: string;
  state: OrderState;
  fulfillmentState?: string;
  price?: string;
  currency?: string;
  createdAt?: string;
  updatedAt?: string;
  studentId?: string;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new ApiError("invalid");
}

function unwrapRecord(value: unknown): Record<string, unknown> {
  const data = record(value);
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
    return record(data.data);
  }
  return data;
}

export function adminUser(value: unknown): AdminUser {
  const data = unwrapRecord(value);
  const rawRole = string(data.role);
  if (rawRole !== "STUDENT" && rawRole !== "LECTURER" && rawRole !== "ADMIN") {
    throw new ApiError("invalid");
  }
  const rawStatus = string(data.status);
  if (rawStatus !== "ACTIVE" && rawStatus !== "SUSPENDED") {
    throw new ApiError("invalid");
  }

  return {
    userId: string(data.userId),
    displayName: string(data.displayName),
    emailMasked: typeof data.emailMasked === "string" ? data.emailMasked : undefined,
    role: rawRole as AdminRole,
    status: rawStatus as AdminUserStatus,
    lecturerVerified: Boolean(data.lecturerVerified),
    profileVersion: typeof data.profileVersion === "number" ? data.profileVersion : 1,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
  };
}

export function adminUsers(value: unknown): AdminUser[] {
  if (Array.isArray(value)) {
    return value.map(adminUser);
  }
  const rec = record(value);
  if (Array.isArray(rec.data)) {
    return rec.data.map(adminUser);
  }
  if (Array.isArray(rec.items)) {
    return rec.items.map(adminUser);
  }
  throw new ApiError("invalid");
}

export function adminUserListResponse(value: unknown): AdminUserListResponse {
  if (Array.isArray(value)) {
    return {
      items: value.map(adminUser),
      nextCursor: null,
    };
  }
  const rec = record(value);
  const rawItems = Array.isArray(rec.items) ? rec.items : Array.isArray(rec.data) ? rec.data : null;
  if (!rawItems) throw new ApiError("invalid");

  const items = rawItems.map(adminUser);
  let nextCursor: string | null = null;

  if (rec.meta && typeof rec.meta === "object") {
    const meta = rec.meta as Record<string, unknown>;
    if (meta.pagination && typeof meta.pagination === "object") {
      const pag = meta.pagination as Record<string, unknown>;
      if (typeof pag.nextCursor === "string") nextCursor = pag.nextCursor;
    }
    if (!nextCursor && meta.page && typeof meta.page === "object") {
      const page = meta.page as Record<string, unknown>;
      if (typeof page.nextCursor === "string") nextCursor = page.nextCursor;
    }
    if (!nextCursor && typeof meta.nextCursor === "string") {
      nextCursor = meta.nextCursor;
    }
  }

  return { items, nextCursor };
}

export function lecturerApplication(value: unknown): LecturerApplication {
  const data = unwrapRecord(value);
  let normStatus: ApplicationStatus = "PENDING";
  if (typeof data.status === "string") {
    if (data.status === "SUBMITTED" || data.status === "PENDING") {
      normStatus = "PENDING";
    } else if (
      data.status === "APPROVED" ||
      data.status === "APPROVED_VERIFIED" ||
      data.status === "APPROVED_AWAITING_VERIFICATION"
    ) {
      normStatus = "APPROVED";
    } else if (data.status === "REJECTED") {
      normStatus = "REJECTED";
    } else {
      throw new ApiError("invalid");
    }
  }

  const displayName =
    typeof data.displayName === "string"
      ? data.displayName
      : typeof data.displayNameSnapshot === "string"
        ? data.displayNameSnapshot
        : undefined;

  const userId =
    typeof data.userId === "string"
      ? data.userId
      : typeof data.applicantId === "string"
        ? data.applicantId
        : string(data.applicationId);

  const notes =
    typeof data.notes === "string"
      ? data.notes
      : typeof data.teachingArea === "string"
        ? `Lĩnh vực: ${data.teachingArea}`
        : undefined;

  return {
    applicationId: string(data.applicationId),
    userId,
    displayName,
    emailMasked:
      typeof data.emailMasked === "string"
        ? data.emailMasked
        : typeof data.emailMaskedSnapshot === "string"
          ? data.emailMaskedSnapshot
          : undefined,
    status: normStatus as ApplicationStatus,
    submittedAt: typeof data.submittedAt === "string" ? data.submittedAt : new Date().toISOString(),
    decidedAt: typeof data.decidedAt === "string" ? data.decidedAt : null,
    notes,
  };
}

export function lecturerApplications(value: unknown): LecturerApplication[] {
  if (Array.isArray(value)) {
    return value.map(lecturerApplication);
  }
  const rec = record(value);
  if (Array.isArray(rec.data)) {
    return rec.data.map(lecturerApplication);
  }
  if (
    rec.data &&
    typeof rec.data === "object" &&
    Array.isArray((rec.data as Record<string, unknown>).items)
  ) {
    return ((rec.data as Record<string, unknown>).items as unknown[]).map(lecturerApplication);
  }
  if (Array.isArray(rec.items)) {
    return rec.items.map(lecturerApplication);
  }
  throw new ApiError("invalid");
}

export function moderationReport(value: unknown): ModerationReport {
  const data = unwrapRecord(value);
  const rawTarget = string(data.targetType);
  if (rawTarget !== "COMMENT" && rawTarget !== "REVIEW") {
    throw new ApiError("invalid");
  }
  const rawState = string(data.state);
  if (rawState !== "OPEN" && rawState !== "RESOLVED") {
    throw new ApiError("invalid");
  }

  return {
    reportId: string(data.reportId),
    targetType: rawTarget as ModerationTargetType,
    targetId: string(data.targetId),
    state: rawState as ModerationState,
    decision: data.decision === null || data.decision === undefined ? null : string(data.decision),
    version: parseNumber(data.version),
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    reason: typeof data.reason === "string" ? data.reason : undefined,
  };
}

export function moderationReports(value: unknown): ModerationReport[] {
  if (Array.isArray(value)) {
    return value.map(moderationReport);
  }
  const rec = record(value);
  if (Array.isArray(rec.data)) {
    return rec.data.map(moderationReport);
  }
  if (Array.isArray(rec.items)) {
    return rec.items.map(moderationReport);
  }
  throw new ApiError("invalid");
}

export function moderationListResponse(value: unknown): ModerationListResponse {
  if (Array.isArray(value)) {
    return {
      items: value.map(moderationReport),
      nextCursor: null,
    };
  }
  const rec = record(value);
  const rawItems = Array.isArray(rec.items) ? rec.items : Array.isArray(rec.data) ? rec.data : null;
  if (!rawItems) throw new ApiError("invalid");

  const items = rawItems.map(moderationReport);
  let nextCursor: string | null = null;

  if (rec.meta && typeof rec.meta === "object") {
    const meta = rec.meta as Record<string, unknown>;
    if (meta.page && typeof meta.page === "object") {
      const page = meta.page as Record<string, unknown>;
      if (typeof page.nextCursor === "string") nextCursor = page.nextCursor;
    }
    if (!nextCursor && meta.pagination && typeof meta.pagination === "object") {
      const pag = meta.pagination as Record<string, unknown>;
      if (typeof pag.nextCursor === "string") nextCursor = pag.nextCursor;
    }
    if (!nextCursor && typeof meta.nextCursor === "string") {
      nextCursor = meta.nextCursor;
    }
  }

  return { items, nextCursor };
}

export function commerceOrder(value: unknown): CommerceOrder {
  const data = unwrapRecord(value);
  const rawState = string(data.state);
  const validStates: OrderState[] = ["PENDING", "PAYMENT_FAILED", "PAID_PENDING_ENTITLEMENT", "ENTITLED"];
  if (!validStates.includes(rawState as OrderState)) {
    throw new ApiError("invalid");
  }

  return {
    orderId: string(data.orderId),
    courseId: typeof data.courseId === "string" ? data.courseId : undefined,
    offeringId: typeof data.offeringId === "string" ? data.offeringId : undefined,
    offeringType: typeof data.offeringType === "string" ? data.offeringType : undefined,
    state: rawState as OrderState,
    fulfillmentState: typeof data.fulfillmentState === "string" ? data.fulfillmentState : undefined,
    price: typeof data.price === "string" ? data.price : undefined,
    currency: typeof data.currency === "string" ? data.currency : "VND",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
    studentId: typeof data.studentId === "string" ? data.studentId : undefined,
  };
}

export function isOrderEntitled(state: OrderState): boolean {
  return state === "ENTITLED";
}

export function isPaymentPendingEntitlement(state: OrderState): boolean {
  return state === "PAID_PENDING_ENTITLEMENT";
}

export function formatVND(amountStr?: string): string {
  if (!amountStr) return "0 ₫";
  const num = Number(amountStr);
  if (Number.isNaN(num)) return amountStr;
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
}

export function validatePassword(password: string): boolean {
  return typeof password === "string" && password.trim().length >= 6;
}

export function validateReason(reason: string, maxLength = 1000): boolean {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength;
}

export const CONTRACT_LIMITED = {
  userRoleChange:
    "API không hỗ trợ thay đổi vai trò tự do. Hãy sử dụng quy trình thẩm định giảng viên hoặc chuyển vai trò.",
  orderList:
    "API không cung cấp danh sách toàn bộ đơn hàng của hệ thống. Tra cứu theo mã đơn hàng trực tiếp.",
  manualPaymentMutation:
    "Thao tác đánh dấu thanh toán hoặc cấp quyền học thủ công không được hỗ trợ trên thiết bị di động.",
  sepayDirect: "Không truy cập trực tiếp hạ tầng hoặc bí mật cổng thanh toán từ ứng dụng di động.",
  courseArchive: "Quản lý xuất bản hoặc lưu trữ khóa học yêu cầu mã UUID khóa học cụ thể.",
} as const;
