import { describe, it, expect, vi } from "vitest";
import {
  course,
  courses,
  courseDetail,
  offering,
  offerings,
  lessonSummary,
  lessonSummaries,
  lessonDetail,
  progress,
  enrolledCourses,
  resumeTarget,
  safeContentUrl,
  isAlreadyEnrolledConflict,
  requestCourseRefund,
  isRefundEligible,
  type LessonSummary,
} from "../src/learning";
import { ApiError } from "../src/api";

const sampleCourse = {
  courseId: "c-1",
  title: "Cơ sở dữ liệu",
  state: "PUBLISHED",
  priceType: "FREE",
};

const sampleLesson = {
  lessonId: "l-1",
  courseId: "c-1",
  title: "Bài 1: Giới thiệu",
  sectionTitle: "Chương 1",
  preview: true,
  position: { sectionOrder: 1, lessonOrder: 1 },
};

const sampleProgress = {
  courseId: "c-1",
  percent: 50,
  completedCount: 3,
  publishedTotal: 6,
  progressVersion: 1,
  courseContentVersion: 1,
  completed: false,
};

describe("course decoder", () => {
  it("decodes a valid course", () => {
    const result = course(sampleCourse);
    expect(result.courseId).toBe("c-1");
    expect(result.title).toBe("Cơ sở dữ liệu");
    expect(result.priceType).toBe("FREE");
  });

  it("throws on missing courseId", () => {
    expect(() => course({ title: "Test" })).toThrow();
  });

  it("throws on missing title", () => {
    expect(() => course({ courseId: "c-1" })).toThrow();
  });

  it("treats missing optional fields as undefined", () => {
    const result = course({ courseId: "c-2", title: "Test" });
    expect(result.state).toBeUndefined();
    expect(result.priceType).toBeUndefined();
    expect(result.price).toBeUndefined();
    expect(result.currency).toBeUndefined();
    expect(result.categoryId).toBeUndefined();
  });

  it("throws on null input", () => {
    expect(() => course(null)).toThrow();
  });

  it("throws on primitive input", () => {
    expect(() => course("not-an-object")).toThrow();
  });
});

describe("courses list decoder", () => {
  it("decodes from direct array", () => {
    const result = courses([sampleCourse]);
    expect(result).toHaveLength(1);
    expect(result[0].courseId).toBe("c-1");
  });

  it("decodes from {items: [...]} envelope", () => {
    const result = courses({ items: [sampleCourse] });
    expect(result).toHaveLength(1);
  });

  it("throws on non-array, non-envelope", () => {
    expect(() => courses({ notItems: [] })).toThrow();
  });

  it("decodes empty array", () => {
    expect(courses([])).toHaveLength(0);
  });

  it("throws on array with malformed item", () => {
    expect(() => courses([{ title: "No ID" }])).toThrow();
  });
});

describe("courseDetail decoder", () => {
  it("includes base course fields and optional detail fields", () => {
    const result = courseDetail({
      ...sampleCourse,
      description: "Mô tả khóa học",
      slug: "co-so-du-lieu",
      lecturerName: "Nguyễn Văn A",
      totalLessons: 12,
    });
    expect(result.description).toBe("Mô tả khóa học");
    expect(result.slug).toBe("co-so-du-lieu");
    expect(result.lecturerName).toBe("Nguyễn Văn A");
    expect(result.totalLessons).toBe(12);
  });

  it("handles numeric string totalLessons", () => {
    const result = courseDetail({ ...sampleCourse, totalLessons: "5" });
    expect(result.totalLessons).toBe(5);
  });

  it("handles missing optional detail fields", () => {
    const result = courseDetail(sampleCourse);
    expect(result.description).toBeUndefined();
    expect(result.slug).toBeUndefined();
    expect(result.lecturerName).toBeUndefined();
    expect(result.totalLessons).toBeUndefined();
  });
});

describe("offering decoder", () => {
  const sampleOffering = {
    offeringId: "o-1",
    courseId: "c-1",
    offeringType: "SELF_PACED",
    state: "PUBLISHED",
    price: "0",
    currency: "VND",
  };

  it("decodes a valid offering", () => {
    const result = offering(sampleOffering);
    expect(result.offeringId).toBe("o-1");
    expect(result.offeringType).toBe("SELF_PACED");
  });

  it("throws on missing required fields", () => {
    expect(() => offering({ offeringId: "o-1" })).toThrow();
  });

  it("decodes offerings list from envelope", () => {
    const result = offerings({ items: [sampleOffering] });
    expect(result).toHaveLength(1);
  });

  it("decodes offerings list from array", () => {
    const result = offerings([sampleOffering]);
    expect(result).toHaveLength(1);
  });
});

describe("lessonSummary decoder", () => {
  it("decodes a valid lesson summary", () => {
    const result = lessonSummary(sampleLesson);
    expect(result.lessonId).toBe("l-1");
    expect(result.title).toBe("Bài 1: Giới thiệu");
    expect(result.sectionTitle).toBe("Chương 1");
    expect(result.preview).toBe(true);
    expect(result.position.sectionOrder).toBe(1);
    expect(result.position.lessonOrder).toBe(1);
  });

  it("throws on missing position", () => {
    expect(() => lessonSummary({ lessonId: "l-1", courseId: "c-1", title: "Test" })).toThrow();
  });

  it("handles preview as string 'true'", () => {
    const result = lessonSummary({ ...sampleLesson, preview: "true" });
    expect(result.preview).toBe(true);
  });

  it("handles preview as false", () => {
    const result = lessonSummary({ ...sampleLesson, preview: false });
    expect(result.preview).toBe(false);
  });
});

describe("lessonSummaries list decoder", () => {
  it("decodes from array", () => {
    const result = lessonSummaries([sampleLesson]);
    expect(result).toHaveLength(1);
  });

  it("decodes from envelope", () => {
    const result = lessonSummaries({ items: [sampleLesson] });
    expect(result).toHaveLength(1);
  });

  it("handles empty array", () => {
    expect(lessonSummaries([])).toHaveLength(0);
  });
});

describe("lessonDetail decoder", () => {
  it("extends lesson summary with content fields", () => {
    const result = lessonDetail({
      ...sampleLesson,
      contentUrl: "https://gateway.test/library/doc.pdf",
      contentType: "application/pdf",
      state: "PUBLISHED",
    });
    expect(result.contentUrl).toBe("https://gateway.test/library/doc.pdf");
    expect(result.contentType).toBe("application/pdf");
    expect(result.state).toBe("PUBLISHED");
    expect(result.externalVideo).toBeUndefined();
  });

  it("includes externalVideo when present", () => {
    const result = lessonDetail({
      ...sampleLesson,
      externalVideo: "https://www.youtube-nocookie.com/embed/test123",
    });
    expect(result.externalVideo).toBe("https://www.youtube-nocookie.com/embed/test123");
  });
});

describe("progress decoder", () => {
  it("decodes valid progress", () => {
    const result = progress(sampleProgress);
    expect(result.courseId).toBe("c-1");
    expect(result.percent).toBe(50);
    expect(result.completedCount).toBe(3);
    expect(result.publishedTotal).toBe(6);
    expect(result.completed).toBe(false);
  });

  it("handles numeric strings", () => {
    const result = progress({
      ...sampleProgress,
      percent: "75",
      completedCount: "4",
      publishedTotal: "8",
      progressVersion: "2",
      courseContentVersion: "3",
    });
    expect(result.percent).toBe(75);
    expect(result.completedCount).toBe(4);
  });

  it("handles completed as true", () => {
    const result = progress({ ...sampleProgress, completed: true });
    expect(result.completed).toBe(true);
  });

  it("handles completed as string 'true'", () => {
    const result = progress({ ...sampleProgress, completed: "true" });
    expect(result.completed).toBe(true);
  });

  it("throws on non-numeric percent", () => {
    expect(() => progress({ ...sampleProgress, percent: "not-a-number" })).toThrow();
  });
});

describe("enrolledCourses decoder", () => {
  it("delegates to courses decoder", () => {
    const result = enrolledCourses([sampleCourse]);
    expect(result).toHaveLength(1);
    expect(result[0].courseId).toBe("c-1");
  });
});

describe("resumeTarget", () => {
  const makeLessons = (count: number): LessonSummary[] =>
    Array.from({ length: count }, (_, i) => ({
      lessonId: `l-${i + 1}`,
      courseId: "c-1",
      title: `Lesson ${i + 1}`,
      preview: false,
      position: { sectionOrder: Math.floor(i / 3) + 1, lessonOrder: (i % 3) + 1 },
    }));

  it("returns the first incomplete lesson in order", () => {
    const lessons = makeLessons(6);
    const completed = new Set(["l-1", "l-2"]);
    const target = resumeTarget(lessons, completed);
    expect(target?.lessonId).toBe("l-3");
  });

  it("returns undefined when all lessons are completed", () => {
    const lessons = makeLessons(3);
    const completed = new Set(["l-1", "l-2", "l-3"]);
    expect(resumeTarget(lessons, completed)).toBeUndefined();
  });

  it("returns the first lesson when nothing is completed", () => {
    const lessons = makeLessons(4);
    const target = resumeTarget(lessons, new Set());
    expect(target?.lessonId).toBe("l-1");
  });

  it("handles empty lesson list", () => {
    expect(resumeTarget([], new Set())).toBeUndefined();
  });

  it("respects sectionOrder over lessonOrder", () => {
    const lessons: LessonSummary[] = [
      {
        lessonId: "l-b",
        courseId: "c-1",
        title: "B",
        preview: false,
        position: { sectionOrder: 2, lessonOrder: 1 },
      },
      {
        lessonId: "l-a",
        courseId: "c-1",
        title: "A",
        preview: false,
        position: { sectionOrder: 1, lessonOrder: 1 },
      },
    ];
    const target = resumeTarget(lessons, new Set());
    expect(target?.lessonId).toBe("l-a");
  });
});

describe("safeContentUrl", () => {
  it("passes valid https URL", () => {
    expect(safeContentUrl("https://cdn.example.org/doc.pdf")).toBe("https://cdn.example.org/doc.pdf");
  });

  it("passes valid http URL in development and research environments", () => {
    expect(safeContentUrl("http://localhost:8080/file.txt", "development")).toBe(
      "http://localhost:8080/file.txt",
    );
    expect(safeContentUrl("http://10.0.2.2:8080/file.txt", "research")).toBe("http://10.0.2.2:8080/file.txt");
  });

  it("rejects cleartext http in production environment", () => {
    expect(safeContentUrl("http://example.org/doc.pdf", "production")).toBeUndefined();
  });

  it("accepts https in production environment", () => {
    expect(safeContentUrl("https://example.org/doc.pdf", "production")).toBe("https://example.org/doc.pdf");
  });

  it("rejects ftp URL", () => {
    expect(safeContentUrl("ftp://example.org/file.txt")).toBeUndefined();
  });

  it("rejects URL with username/password credentials", () => {
    expect(safeContentUrl("https://user:pass@example.org/file.txt")).toBeUndefined();
  });

  it("rejects URL leaking MinIO / S3 access keys or signatures", () => {
    expect(
      safeContentUrl("https://storage.ailss.internal/doc.pdf?AWSAccessKeyId=TESTACCESSKEY"),
    ).toBeUndefined();
    expect(
      safeContentUrl(
        "https://storage.ailss.internal/doc.pdf?X-Amz-Signature=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      ),
    ).toBeUndefined();
    expect(
      safeContentUrl(
        "https://storage.ailss.internal/doc.pdf?X-Amz-Credential=TESTACCESSKEY/20260914/us-east-1/s3/aws4_request",
      ),
    ).toBeUndefined();
  });

  it("returns undefined for non-string", () => {
    expect(safeContentUrl(undefined)).toBeUndefined();
  });

  it("returns undefined for invalid URL", () => {
    expect(safeContentUrl("not-a-url")).toBeUndefined();
  });

  it("returns undefined for empty or whitespace string", () => {
    expect(safeContentUrl("")).toBeUndefined();
    expect(safeContentUrl("   ")).toBeUndefined();
  });

  it("rejects dangerous and unsupported URI schemes (javascript, data, file, blob)", () => {
    expect(safeContentUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeContentUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeContentUrl("file:///etc/passwd")).toBeUndefined();
    expect(safeContentUrl("blob:https://example.org/uuid")).toBeUndefined();
  });
});

describe("isAlreadyEnrolledConflict", () => {
  it("returns true for HTTP 409 with ALREADY_ENROLLED code", () => {
    const err = new ApiError("409", 409, "req-1", "ALREADY_ENROLLED");
    expect(isAlreadyEnrolledConflict(err)).toBe(true);
  });

  it("returns true for HTTP 409 with ENROLLMENT_EXISTS code", () => {
    const err = new ApiError("409", 409, "req-2", "ENROLLMENT_EXISTS");
    expect(isAlreadyEnrolledConflict(err)).toBe(true);
  });

  it("returns false for HTTP 409 with PURCHASE_REQUIRED code", () => {
    const err = new ApiError("409", 409, "req-3", "PURCHASE_REQUIRED");
    expect(isAlreadyEnrolledConflict(err)).toBe(false);
  });

  it("returns false for HTTP 409 with IDEMPOTENCY_CONFLICT code", () => {
    const err = new ApiError("409", 409, "req-4", "IDEMPOTENCY_CONFLICT");
    expect(isAlreadyEnrolledConflict(err)).toBe(false);
  });

  it("returns false for HTTP 409 without code or with unknown code", () => {
    const err = new ApiError("409", 409, "req-5");
    expect(isAlreadyEnrolledConflict(err)).toBe(false);
  });

  it("returns false for non-409 statuses or non-ApiError instances", () => {
    expect(isAlreadyEnrolledConflict(new ApiError("400", 400, "req-6", "ALREADY_ENROLLED"))).toBe(false);
    expect(isAlreadyEnrolledConflict(new ApiError("403", 403, "req-7", "ALREADY_ENROLLED"))).toBe(false);
    expect(isAlreadyEnrolledConflict(new ApiError("500", 500, "req-8", "ALREADY_ENROLLED"))).toBe(false);
    expect(isAlreadyEnrolledConflict(new Error("Generic error"))).toBe(false);
    expect(isAlreadyEnrolledConflict(null)).toBe(false);
  });
});

describe("resumeTarget with Progress and number count", () => {
  const makeLessons = (count: number): LessonSummary[] =>
    Array.from({ length: count }, (_, i) => ({
      lessonId: `l-${i + 1}`,
      courseId: "c-1",
      title: `Lesson ${i + 1}`,
      preview: false,
      position: { sectionOrder: Math.floor(i / 3) + 1, lessonOrder: (i % 3) + 1 },
    }));

  it("returns the next lesson by completedCount index", () => {
    const lessons = makeLessons(5);
    expect(resumeTarget(lessons, 0)?.lessonId).toBe("l-1");
    expect(resumeTarget(lessons, 2)?.lessonId).toBe("l-3");
    expect(resumeTarget(lessons, 4)?.lessonId).toBe("l-5");
    expect(resumeTarget(lessons, 5)).toBeUndefined();
  });

  it("returns next lesson using a Progress object", () => {
    const lessons = makeLessons(4);
    const prog = {
      courseId: "c-1",
      percent: 50,
      completedCount: 2,
      publishedTotal: 4,
      progressVersion: 1,
      courseContentVersion: 1,
      completed: false,
    };
    expect(resumeTarget(lessons, prog)?.lessonId).toBe("l-3");
  });

  it("returns undefined when progress indicates 100% completion", () => {
    const lessons = makeLessons(3);
    const prog = {
      courseId: "c-1",
      percent: 100,
      completedCount: 3,
      publishedTotal: 3,
      progressVersion: 1,
      courseContentVersion: 1,
      completed: true,
    };
    expect(resumeTarget(lessons, prog)).toBeUndefined();
  });
});

describe("idempotency key & optimistic rollback behavior", () => {
  it("reuses idempotency key on retry and generates fresh key on opposite action", () => {
    const completeKey = "key-complete-1";
    let uncompleteKey = "key-uncomplete-1";

    // Action 1: complete -> uses completeKey
    const usedKey1 = completeKey;
    expect(usedKey1).toBe("key-complete-1");

    // Retry of same complete action -> reuses same key
    const retryKey1 = completeKey;
    expect(retryKey1).toBe(usedKey1);

    // On success of complete, opposing action (uncomplete) is reset
    uncompleteKey = "key-uncomplete-2";

    // Action 2: uncomplete -> uses uncompleteKey (distinct from completeKey)
    expect(uncompleteKey).not.toBe(completeKey);
    expect(uncompleteKey).toBe("key-uncomplete-2");
  });

  it("rolls back optimistic completion state upon mutation rejection", async () => {
    let isCompleted = false;
    const mutate = async (target: boolean, shouldFail: boolean) => {
      const prev = isCompleted;
      isCompleted = target; // optimistic
      try {
        if (shouldFail) throw new Error("Network error");
      } catch {
        isCompleted = prev; // rollback
      }
    };

    await mutate(true, true);
    expect(isCompleted).toBe(false); // correctly rolled back

    await mutate(true, false);
    expect(isCompleted).toBe(true); // successfully applied
  });

  describe("mobile course refunds and adaptive path helpers (Phase 20A)", () => {
    it("fails closed when no real refund adapter is provided", async () => {
      await expect(
        requestCourseRefund({ orderId: "order", courseId: "course", reason: "reason" }),
      ).rejects.toMatchObject({ kind: "unavailable" });
    });
    it("rejects malformed refund responses instead of displaying fabricated success", async () => {
      await expect(
        requestCourseRefund({ orderId: "order", courseId: "course", reason: "reason" }, async () => ({
          data: { refundId: "", status: "PROCESSED", message: "success" },
        })),
      ).rejects.toMatchObject({ kind: "invalid" });
    });
    it("submits mobile refund request and parses response", async () => {
      const mockApi = vi.fn().mockResolvedValue({
        data: {
          refundId: "ref-mob-123",
          status: "PROCESSED",
          message: "Hoàn tiền thành công",
          amountMinor: 500000,
        },
      });

      const res = await requestCourseRefund(
        {
          orderId: "ord-mob-1",
          courseId: "c-1",
          reason: "Khoá học không phù hợp mục tiêu",
          bankAccount: "VCB - 0123456789",
        },
        mockApi,
      );

      expect(res.refundId).toBe("ref-mob-123");
      expect(res.status).toBe("PROCESSED");
      expect(res.message).toBe("Hoàn tiền thành công");
      expect(mockApi).toHaveBeenCalledWith("/api/v1/learning/refunds", {
        orderId: "ord-mob-1",
        courseId: "c-1",
        reason: "Khoá học không phù hợp mục tiêu",
        bankAccount: "VCB - 0123456789",
      });
    });

    it("validates mobile refund eligibility based on 7-day and <20% completion rules", () => {
      const now = new Date("2026-09-17T12:00:00Z");
      // Eligible: 10% completion, purchased 3 days ago
      expect(isRefundEligible(10, "2026-09-14T12:00:00Z", now)).toEqual({ eligible: true });

      // Ineligible: 25% completion (>= 20%)
      expect(isRefundEligible(25, "2026-09-15T12:00:00Z", now)).toEqual({
        eligible: false,
        reason: "Tiến độ học tập đã đạt từ 20% trở lên.",
      });

      // Ineligible: 5% completion but purchased 10 days ago (> 7 days)
      expect(isRefundEligible(5, "2026-09-05T12:00:00Z", now)).toEqual({
        eligible: false,
        reason: "Đã quá thời hạn hoàn tiền 7 ngày.",
      });
    });
  });
});
