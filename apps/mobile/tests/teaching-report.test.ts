import { describe, expect, it, vi } from "vitest";
import { aggregateReport, loadMobileTeachingReport } from "../src/teachingReport";
import type { Session } from "../src/session";

describe("mobile lecturer teaching report", () => {
  it("uses authenticated mobile requests and shared report calculations", async () => {
    const request = vi.fn(async (path: string) => {
      if (path === "/api/v1/me/owned-classes")
        return [{ classId: "class-1", linkedCourseId: "course-1", name: "Lớp A", state: "ACTIVE" }];
      if (path === "/api/v1/classes/class-1/members") return [{ studentId: "student-1", state: "ACTIVE" }];
      if (path === "/api/v1/targets/CLASS/class-1/quizzes") return [];
      if (path === "/api/v1/targets/COURSE/course-1/quizzes") return [];
      if (path === "/api/v1/courses/course-1/roster") return [];
      if (path.startsWith("/api/v1/classes/class-1/sessions?")) return [];
      throw new Error(`Unexpected request: ${path}`);
    });
    const report = await loadMobileTeachingReport(30, new AbortController().signal, {
      request,
    } as unknown as Session);
    expect(request).toHaveBeenCalledWith(
      "/api/v1/me/owned-classes",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(request).toHaveBeenCalledWith(
      "/api/v1/courses/course-1/roster",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(aggregateReport(report.classes)).toMatchObject({
      students: 1,
      submissionRate: null,
      averageScore: null,
      attendanceRate: null,
    });
  });
});
