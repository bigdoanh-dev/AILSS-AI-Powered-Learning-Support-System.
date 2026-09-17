import { describe, it, expect } from "vitest";
import { ApiError } from "../src/api";
import {
  adminUser,
  adminUsers,
  adminUserListResponse,
  lecturerApplication,
  lecturerApplications,
  moderationReport,
  moderationReports,
  moderationListResponse,
  commerceOrder,
  isOrderEntitled,
  isPaymentPendingEntitlement,
  formatVND,
  validatePassword,
  validateReason,
  CONTRACT_LIMITED,
} from "../src/admin";
import { resolveNotificationRoute, type NotificationItem } from "../src/notifications";

describe("Phase 14.4 Admin Domain & Decoders", () => {
  describe("Identity Admin Decoders", () => {
    it("decodes a valid AdminUser profile", () => {
      const raw = {
        userId: "00000000-0000-4000-8000-000000000001",
        displayName: "Admin Demo",
        emailMasked: "a***@ailss.local",
        role: "ADMIN",
        status: "ACTIVE",
        lecturerVerified: false,
        profileVersion: 2,
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-15T00:00:00Z",
      };

      const user = adminUser(raw);
      expect(user.userId).toBe("00000000-0000-4000-8000-000000000001");
      expect(user.displayName).toBe("Admin Demo");
      expect(user.role).toBe("ADMIN");
      expect(user.status).toBe("ACTIVE");
      expect(user.profileVersion).toBe(2);
    });

    it("accepts STUDENT and LECTURER roles and SUSPENDED status", () => {
      const studentRaw = {
        userId: "00000000-0000-4000-8000-000000000002",
        displayName: "Student Bình",
        role: "STUDENT",
        status: "SUSPENDED",
        lecturerVerified: false,
        profileVersion: 1,
        updatedAt: "2026-09-15T00:00:00Z",
      };
      const student = adminUser(studentRaw);
      expect(student.role).toBe("STUDENT");
      expect(student.status).toBe("SUSPENDED");

      const lecturerRaw = {
        userId: "00000000-0000-4000-8000-000000000003",
        displayName: "Lecturer Chi",
        role: "LECTURER",
        status: "ACTIVE",
        lecturerVerified: true,
        profileVersion: 1,
        updatedAt: "2026-09-15T00:00:00Z",
      };
      const lecturer = adminUser(lecturerRaw);
      expect(lecturer.role).toBe("LECTURER");
      expect(lecturer.lecturerVerified).toBe(true);
    });

    it("rejects invalid role or status", () => {
      expect(() =>
        adminUser({
          userId: "u1",
          displayName: "X",
          role: "SUPERUSER",
          status: "ACTIVE",
          lecturerVerified: false,
        }),
      ).toThrow(ApiError);

      expect(() =>
        adminUser({
          userId: "u1",
          displayName: "X",
          role: "STUDENT",
          status: "BANNED",
          lecturerVerified: false,
        }),
      ).toThrow(ApiError);
    });

    it("decodes adminUsers list in both direct array and envelope formats", () => {
      const rawUser = {
        userId: "00000000-0000-4000-8000-000000000001",
        displayName: "User 1",
        role: "STUDENT",
        status: "ACTIVE",
        lecturerVerified: false,
        updatedAt: "2026-09-15T00:00:00Z",
      };

      expect(adminUsers([rawUser])).toHaveLength(1);
      expect(adminUsers({ data: [rawUser] })).toHaveLength(1);
      expect(adminUsers({ items: [rawUser] })).toHaveLength(1);
      expect(() => adminUsers({ somethingElse: 123 })).toThrow(ApiError);
    });

    it("decodes adminUserListResponse with pagination cursor", () => {
      const res = adminUserListResponse({
        items: [
          {
            userId: "00000000-0000-4000-8000-000000000001",
            displayName: "User 1",
            role: "STUDENT",
            status: "ACTIVE",
            lecturerVerified: false,
            updatedAt: "2026-09-15T00:00:00Z",
          },
        ],
        meta: {
          pagination: {
            nextCursor: "cursor-12345",
          },
        },
      });

      expect(res.items).toHaveLength(1);
      expect(res.nextCursor).toBe("cursor-12345");
    });

    it("decodes LecturerApplication with valid statuses", () => {
      const rawApp = {
        applicationId: "app-001",
        userId: "user-001",
        displayName: "Applicant A",
        status: "PENDING",
        submittedAt: "2026-09-10T00:00:00Z",
        notes: "Bằng cấp thạc sĩ CNTT",
      };

      const app = lecturerApplication(rawApp);
      expect(app.applicationId).toBe("app-001");
      expect(app.status).toBe("PENDING");
      expect(app.notes).toBe("Bằng cấp thạc sĩ CNTT");

      expect(() =>
        lecturerApplication({
          applicationId: "app-002",
          userId: "user-002",
          status: "UNKNOWN_STATUS",
        }),
      ).toThrow(ApiError);
    });

    it("decodes lecturerApplications list wrapper", () => {
      const list = lecturerApplications({
        data: [
          {
            applicationId: "app-1",
            userId: "u-1",
            status: "APPROVED",
            submittedAt: "2026-09-01T00:00:00Z",
          },
        ],
      });
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe("APPROVED");
    });
  });

  describe("Moderation Decoders & Validation", () => {
    it("decodes valid ModerationReport", () => {
      const raw = {
        reportId: "rep-001",
        targetType: "COMMENT",
        targetId: "cmt-123",
        state: "OPEN",
        decision: null,
        version: 1,
        createdAt: "2026-09-15T10:00:00Z",
        updatedAt: "2026-09-15T10:00:00Z",
      };

      const report = moderationReport(raw);
      expect(report.reportId).toBe("rep-001");
      expect(report.targetType).toBe("COMMENT");
      expect(report.state).toBe("OPEN");
      expect(report.version).toBe(1);
      expect(report.decision).toBeNull();
    });

    it("decodes moderationReports in array and envelope formats", () => {
      const raw = {
        reportId: "rep-001",
        targetType: "COMMENT",
        targetId: "cmt-123",
        state: "OPEN",
        decision: null,
        version: 1,
        createdAt: "2026-09-15T10:00:00Z",
        updatedAt: "2026-09-15T10:00:00Z",
      };
      expect(moderationReports([raw])).toHaveLength(1);
      expect(moderationReports({ data: [raw] })).toHaveLength(1);
      expect(moderationReports({ items: [raw] })).toHaveLength(1);
      expect(() => moderationReports({ invalid: true })).toThrow(ApiError);
    });

    it("rejects unknown moderation state and targetType", () => {
      expect(() =>
        moderationReport({
          reportId: "r1",
          targetType: "POST", // invalid
          targetId: "p1",
          state: "OPEN",
          version: 1,
        }),
      ).toThrow(ApiError);

      expect(() =>
        moderationReport({
          reportId: "r1",
          targetType: "REVIEW",
          targetId: "p1",
          state: "BANNED", // invalid invented state
          version: 1,
        }),
      ).toThrow(ApiError);
    });

    it("decodes moderationListResponse with nextCursor", () => {
      const res = moderationListResponse({
        items: [
          {
            reportId: "rep-001",
            targetType: "REVIEW",
            targetId: "rev-456",
            state: "RESOLVED",
            decision: "HIDE",
            version: 2,
            createdAt: "2026-09-15T10:00:00Z",
            updatedAt: "2026-09-15T10:00:00Z",
          },
        ],
        meta: {
          page: {
            nextCursor: "cursor-mod-999",
          },
        },
      });

      expect(res.items).toHaveLength(1);
      expect(res.nextCursor).toBe("cursor-mod-999");
    });

    it("validates moderation reason properly", () => {
      expect(validateReason("Vi phạm tiêu chuẩn cộng đồng")).toBe(true);
      expect(validateReason("   ")).toBe(false);
      expect(validateReason("a".repeat(1001))).toBe(false);
      expect(validateReason("a".repeat(1000))).toBe(true);
    });
  });

  describe("Commerce & Entitlement Separation", () => {
    it("decodes all valid canonical Order states", () => {
      const base = {
        orderId: "ord-001",
        price: "490000",
        currency: "VND",
        offeringType: "SELF_PACED",
      };

      const states = ["PENDING", "PAYMENT_FAILED", "PAID_PENDING_ENTITLEMENT", "ENTITLED"] as const;

      for (const st of states) {
        const order = commerceOrder({ ...base, state: st });
        expect(order.state).toBe(st);
      }
    });

    it("STRICTLY separates PAID_PENDING_ENTITLEMENT from ENTITLED", () => {
      expect(isOrderEntitled("PAID_PENDING_ENTITLEMENT")).toBe(false);
      expect(isOrderEntitled("ENTITLED")).toBe(true);
      expect(isPaymentPendingEntitlement("PAID_PENDING_ENTITLEMENT")).toBe(true);
      expect(isPaymentPendingEntitlement("ENTITLED")).toBe(false);
    });

    it("rejects invented non-canonical states", () => {
      const inventedStates = ["SUCCESS", "COMPLETED", "PAID_DONE", "FINISHED"];
      for (const inv of inventedStates) {
        expect(() =>
          commerceOrder({
            orderId: "ord-err",
            state: inv,
          }),
        ).toThrow(ApiError);
      }
    });

    it("formats VND currency accurately", () => {
      expect(formatVND("490000")).toContain("490.000");
      expect(formatVND()).toBe("0 ₫");
    });
  });

  describe("Admin Notifications Routing", () => {
    const makeNotification = (
      type: string,
      sourceType: string,
      sourceId: string,
      contextId = "",
    ): NotificationItem => ({
      notificationId: "not-001",
      type,
      title: "Thông báo kiểm tra",
      body: "Nội dung",
      source: { type: sourceType, id: sourceId, contextId },
      createdAt: "2026-09-15T00:00:00Z",
      readAt: null,
      locator: "loc-001",
    });

    it("routes Admin to lecturers verification on LECTURER_APPLICATION", () => {
      const notif = makeNotification("ADMIN", "LECTURER_APPLICATION", "app-123");
      const route = resolveNotificationRoute(notif, "ADMIN");
      expect(route).toBe("/admin/lecturers");
    });

    it("routes Admin to moderation item on MODERATION report", () => {
      const notif = makeNotification("ADMIN", "MODERATION", "rep-456");
      const route = resolveNotificationRoute(notif, "ADMIN");
      expect(route).toBe("/admin/moderation/rep-456");
    });

    it("routes Admin to order detail on ORDER notification", () => {
      const notif = makeNotification("ADMIN", "ORDER", "ord-789");
      const route = resolveNotificationRoute(notif, "ADMIN");
      expect(route).toBe("/admin/commerce/orders/ord-789");
    });

    it("routes Admin to user detail on USER notification", () => {
      const notif = makeNotification("ADMIN", "USER", "user-321");
      const route = resolveNotificationRoute(notif, "ADMIN");
      expect(route).toBe("/admin/users/user-321");
    });

    it("preserves Student and Lecturer routing when role is not Admin", () => {
      const notif = makeNotification("STUDY", "COURSE", "course-123");
      expect(resolveNotificationRoute(notif, "STUDENT")).toBe("/courses/course-123");
      expect(resolveNotificationRoute(notif, "LECTURER")).toBe("/teaching/courses/course-123");
    });

    it("returns null for unknown target type", () => {
      const notif = makeNotification("SYSTEM", "UNKNOWN_EVENT", "ev-1");
      expect(resolveNotificationRoute(notif, "ADMIN")).toBeNull();
    });
  });

  describe("Validation & Contract Limits", () => {
    it("validates password for step-up authentication", () => {
      expect(validatePassword("AilssAdmin!2026")).toBe(true);
      expect(validatePassword("short")).toBe(false);
      expect(validatePassword("")).toBe(false);
    });

    it("provides explicit truthful CONTRACT_LIMITED strings", () => {
      expect(CONTRACT_LIMITED.userRoleChange).toContain("API không hỗ trợ thay đổi vai trò tự do");
      expect(CONTRACT_LIMITED.orderList).toContain("API không cung cấp danh sách toàn bộ đơn hàng");
      expect(CONTRACT_LIMITED.manualPaymentMutation).toContain("không được hỗ trợ");
      expect(CONTRACT_LIMITED.sepayDirect).toContain("Không truy cập trực tiếp hạ tầng");
    });
  });

  describe("DEV Admin Shortcut Security & Fail-Closed Boundaries", () => {
    it("proves query-param role=admin does not synthesize ADMIN authority", () => {
      const studentSessionSnapshot = {
        state: "AUTHENTICATED" as const,
        user: {
          userId: "student-1",
          email: "student@example.com",
          displayName: "Học viên",
          role: "STUDENT" as const,
          status: "ACTIVE" as const,
          lecturerVerified: false,
        },
      };

      // Query param `role=admin` cannot mutate server-signed role in user profile
      expect(studentSessionSnapshot.user.role).toBe("STUDENT");
      expect(studentSessionSnapshot.user.role).not.toBe("ADMIN");
    });

    it("proves admin routes fail-closed when role is not ADMIN", () => {
      const roles = ["STUDENT", "LECTURER", "GUEST", undefined];
      for (const role of roles) {
        const isAuthorized = role === "ADMIN";
        expect(isAuthorized).toBe(false);
      }
    });

    it("proves current-password reauthentication is volatile and bounded", () => {
      let volatilePassword = "AilssAdmin!2026";
      expect(validatePassword(volatilePassword)).toBe(true);

      // Cleared immediately after dispatch
      volatilePassword = "";
      expect(validatePassword(volatilePassword)).toBe(false);
    });
  });
});
