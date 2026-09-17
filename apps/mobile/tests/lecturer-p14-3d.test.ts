import { describe, it, expect } from "vitest";
import {
  userProfile,
  validateDisplayName,
  validatePasswordChange,
  validateAvatarDataUrl,
} from "../src/account";
import {
  notificationList,
  resolveNotificationRoute,
  formatCurrentMonth,
  isValidMonth,
  isRead,
  type NotificationItem,
} from "../src/notifications";
import { announcement, announcements, validateAnnouncement, CONTRACT_LIMITED } from "../src/teaching";
import {
  reviewList,
  commentList,
  validateCommentInput,
  validateReviewInput,
  buildIfMatch,
  parseETagVersion,
  isAuthor,
} from "../src/interaction";

describe("AILSS P14.3D — Lecturer Account & Verification", () => {
  it("decodes role-neutral profile for Lecturer with unverified state", () => {
    const raw = {
      userId: "00000000-0000-4000-8000-000000000002",
      displayName: "Giảng viên Demo AILSS",
      emailMasked: "le***@ailss.local",
      role: "LECTURER",
      status: "ACTIVE",
      lecturerVerified: false,
      profileVersion: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    const prof = userProfile(raw);
    expect(prof.role).toBe("LECTURER");
    expect(prof.lecturerVerified).toBe(false);
    expect(prof.displayName).toBe("Giảng viên Demo AILSS");
    expect(prof.status).toBe("ACTIVE");
  });

  it("decodes role-neutral profile for Lecturer with verified state", () => {
    const raw = {
      userId: "00000000-0000-4000-8000-000000000002",
      displayName: "ThS. Nguyễn Văn A",
      emailMasked: "ng***@ailss.local",
      role: "LECTURER",
      status: "ACTIVE",
      lecturerVerified: true,
      profileVersion: 2,
    };
    const prof = userProfile(raw);
    expect(prof.role).toBe("LECTURER");
    expect(prof.lecturerVerified).toBe(true);
  });

  it("decodes role-neutral profile for Student without error", () => {
    const raw = {
      userId: "00000000-0000-4000-8000-000000000001",
      displayName: "Học viên Demo AILSS",
      emailMasked: "de***@ailss.local",
      role: "STUDENT",
      status: "ACTIVE",
      lecturerVerified: false,
      profileVersion: 1,
    };
    const prof = userProfile(raw);
    expect(prof.role).toBe("STUDENT");
    expect(prof.lecturerVerified).toBe(false);
  });

  it("enforces display name constraints", () => {
    expect(validateDisplayName("").valid).toBe(false);
    expect(validateDisplayName("   ").valid).toBe(false);
    expect(validateDisplayName("A".repeat(101)).valid).toBe(false);
    expect(validateDisplayName("Giảng viên Demo").valid).toBe(true);
  });

  it("enforces password change validation", () => {
    expect(validatePasswordChange("", "NewPass!2026").valid).toBe(false);
    expect(validatePasswordChange("OldPass!2026", "short").valid).toBe(false);
    expect(validatePasswordChange("SamePass!2026", "SamePass!2026").valid).toBe(false);
    expect(validatePasswordChange("OldPass!2026", "NewPass!2026").valid).toBe(true);
  });

  it("validates avatar payload data URLs within size boundary", () => {
    const validPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    expect(validateAvatarDataUrl(validPng).valid).toBe(true);
    expect(validateAvatarDataUrl("not-a-data-url").valid).toBe(false);
    expect(validateAvatarDataUrl("data:text/plain;base64,hello").valid).toBe(false);
  });

  it("documents selfVerification as CONTRACT_LIMITED", () => {
    expect(CONTRACT_LIMITED.selfVerification).toBeDefined();
    expect(CONTRACT_LIMITED.selfVerification).toContain("Quản trị viên");
  });
});

describe("AILSS P14.3D — Lecturer Notification Routing & In-App Module", () => {
  const baseNotification: NotificationItem = {
    notificationId: "notif-1",
    type: "SYSTEM",
    title: "Thông báo kiểm tra",
    body: "Nội dung thông báo",
    source: {
      type: "CLASS_ANNOUNCEMENT",
      id: "ann-1",
      contextId: "class-100",
    },
    createdAt: "2026-09-15T10:00:00.000Z",
    readAt: null,
    locator: "loc-abc",
  };

  it("routes CLASS_ANNOUNCEMENT to teaching classes for Lecturer", () => {
    const route = resolveNotificationRoute(baseNotification, "LECTURER");
    expect(route).toBe("/teaching/classes/class-100");
  });

  it("routes CLASS_ANNOUNCEMENT to student classes for Student", () => {
    const route = resolveNotificationRoute(baseNotification, "STUDENT");
    expect(route).toBe("/classes/class-100");
  });

  it("routes TEACHING_COURSE to teaching courses for Lecturer", () => {
    const notif: NotificationItem = {
      ...baseNotification,
      source: { type: "TEACHING_COURSE", id: "course-123", contextId: "course-123" },
    };
    expect(resolveNotificationRoute(notif, "LECTURER")).toBe("/teaching/courses/course-123");
  });

  it("routes SESSION to teaching session for Lecturer", () => {
    const notif: NotificationItem = {
      ...baseNotification,
      source: { type: "CLASS_SESSION", id: "sess-99", contextId: "class-100" },
    };
    expect(resolveNotificationRoute(notif, "LECTURER")).toBe("/teaching/classes/class-100/sessions/sess-99");
    expect(resolveNotificationRoute(notif, "STUDENT")).toBe("/classes/class-100/sessions/sess-99");
  });

  it("routes ASSESSMENT / QUIZ to teaching assessments for Lecturer", () => {
    const notif: NotificationItem = {
      ...baseNotification,
      source: { type: "ASSESSMENT", id: "quiz-55", contextId: "" },
    };
    expect(resolveNotificationRoute(notif, "LECTURER")).toBe("/teaching/assessments/quiz-55");
    expect(resolveNotificationRoute(notif, "STUDENT")).toBe("/assessments/quiz-55");
  });

  it("routes AI_JOB / AI_QUIZ to teaching AI studio", () => {
    const notif: NotificationItem = {
      ...baseNotification,
      source: { type: "AI_JOB", id: "job-ai-1", contextId: "" },
    };
    expect(resolveNotificationRoute(notif, "LECTURER")).toBe("/teaching/ai/job-ai-1");
  });

  it("rejects unknown notification target types safely without throwing", () => {
    const notif: NotificationItem = {
      ...baseNotification,
      source: { type: "UNKNOWN_CUSTOM_TYPE", id: "xyz", contextId: "abc" },
    };
    expect(resolveNotificationRoute(notif, "LECTURER")).toBeNull();
    expect(resolveNotificationRoute(notif, "STUDENT")).toBeNull();
    expect(resolveNotificationRoute(notif)).toBeNull();
  });

  it("decodes notification lists with pagination and locator", () => {
    const raw = {
      items: [baseNotification],
      page: {
        month: "2026-09",
        nextCursor: "cursor-token-next",
      },
    };
    const res = notificationList(raw);
    expect(res.items.length).toBe(1);
    expect(res.month).toBe("2026-09");
    expect(res.nextCursor).toBe("cursor-token-next");
    expect(isRead(res.items[0])).toBe(false);
  });

  it("formats and validates month strings correctly", () => {
    expect(isValidMonth("2026-09")).toBe(true);
    expect(isValidMonth("2026-13")).toBe(false);
    expect(isValidMonth("invalid")).toBe(false);
    expect(formatCurrentMonth(new Date(Date.UTC(2026, 8, 15)))).toBe("2026-09");
  });
});

describe("AILSS P14.3D — Classroom Announcements (CLS-09 & CLS-10)", () => {
  it("decodes single announcement correctly from CLS-09 response", () => {
    const raw = {
      data: {
        announcementId: "ann-uuid-1",
        classId: "class-uuid-1",
        title: "Thông báo nghỉ lễ 2/9",
        body: "Các bạn học viên lưu ý lịch nghỉ lễ vào ngày 02/09/2026.",
        createdAt: "2026-08-30T10:00:00.000Z",
        version: 1,
      },
      replayed: false,
    };
    const res = announcement(raw);
    expect(res.announcementId).toBe("ann-uuid-1");
    expect(res.classId).toBe("class-uuid-1");
    expect(res.title).toBe("Thông báo nghỉ lễ 2/9");
    expect(res.body).toContain("Các bạn học viên");
    expect(res.createdAt).toBe("2026-08-30T10:00:00.000Z");
  });

  it("decodes announcements list from CLS-10 response", () => {
    const raw = {
      data: [
        {
          announcement_id: "ann-uuid-2",
          author_id: "lecturer-uuid-1",
          title: "Chuẩn bị đồ án môn học",
          body_sanitized: "Vui lòng nộp báo cáo tiến độ trước Chủ Nhật.",
          created_at: "2026-09-10T12:00:00.000Z",
          version: 1,
        },
      ],
    };
    const list = announcements(raw);
    expect(list.length).toBe(1);
    expect(list[0].announcementId).toBe("ann-uuid-2");
    expect(list[0].title).toBe("Chuẩn bị đồ án môn học");
    expect(list[0].body).toBe("Vui lòng nộp báo cáo tiến độ trước Chủ Nhật.");
  });

  it("validates announcement input fields", () => {
    expect(validateAnnouncement("", "body").valid).toBe(false);
    expect(validateAnnouncement("ab", "body").valid).toBe(false);
    expect(validateAnnouncement("A".repeat(161), "body").valid).toBe(false);
    expect(validateAnnouncement("Tiêu đề hợp lệ", "").valid).toBe(false);
    expect(validateAnnouncement("Tiêu đề hợp lệ", "Nội dung chi tiết thông báo").valid).toBe(true);
  });

  it("marks announcement edit and delete as CONTRACT_LIMITED", () => {
    expect(CONTRACT_LIMITED.announcementEdit).toBeDefined();
    expect(CONTRACT_LIMITED.announcementDelete).toBeDefined();
  });
});

describe("AILSS P14.3D — Interaction & Review Boundaries", () => {
  it("decodes course reviews and rating summary (INT-05)", () => {
    const raw = {
      data: [
        {
          reviewId: "rev-1",
          courseId: "course-1",
          authorId: "student-1",
          rating: 5,
          body: "Khóa học rất hay và dễ hiểu!",
          state: "ACTIVE",
          version: 1,
          createdAt: "2026-09-10T10:00:00.000Z",
          updatedAt: "2026-09-10T10:00:00.000Z",
        },
      ],
      ratingSummary: {
        reviewCount: 1,
        ratingSum: 5,
        average: 5.0,
      },
    };
    const res = reviewList(raw);
    expect(res.items.length).toBe(1);
    expect(res.items[0].rating).toBe(5);
    expect(res.items[0].body).toBe("Khóa học rất hay và dễ hiểu!");
    expect(res.ratingSummary.average).toBe(5.0);
    expect(res.ratingSummary.reviewCount).toBe(1);
  });

  it("affirms Lecturer review moderation is CONTRACT_LIMITED", () => {
    expect(CONTRACT_LIMITED.reviewModerate).toBeDefined();
    expect(CONTRACT_LIMITED.reviewModerate).toContain("không có quyền");
  });

  it("decodes comments and comment lists (INT-01..04)", () => {
    const raw = {
      items: [
        {
          commentId: "comm-1",
          resourceType: "COURSE",
          resourceId: "course-1",
          authorId: "lecturer-user-id",
          parentId: null,
          body: "Chào mừng các bạn đến với khóa học!",
          state: "ACTIVE",
          version: 1,
          createdAt: "2026-09-10T10:00:00.000Z",
          updatedAt: "2026-09-10T10:00:00.000Z",
        },
      ],
    };
    const res = commentList(raw);
    expect(res.items.length).toBe(1);
    expect(res.items[0].body).toBe("Chào mừng các bạn đến với khóa học!");
    expect(isAuthor(res.items[0], "lecturer-user-id")).toBe(true);
    expect(isAuthor(res.items[0], "other-user-id")).toBe(false);
  });

  it("enforces comment and review validation", () => {
    expect(validateCommentInput("").valid).toBe(false);
    expect(validateCommentInput("Phản hồi hợp lệ").valid).toBe(true);
    expect(validateReviewInput(0, "Tệ").valid).toBe(false);
    expect(validateReviewInput(6, "Quá tốt").valid).toBe(false);
    expect(validateReviewInput(4, "Khá tốt").valid).toBe(true);
  });

  it("builds and parses version ETag / If-Match headers", () => {
    expect(buildIfMatch(1)).toBe('"v1"');
    expect(buildIfMatch(5)).toBe('"v5"');
    expect(() => buildIfMatch(0)).toThrow();
    expect(parseETagVersion('"v2"')).toBe(2);
    expect(parseETagVersion("v3")).toBe(3);
    expect(parseETagVersion("invalid")).toBeNull();
  });
});
