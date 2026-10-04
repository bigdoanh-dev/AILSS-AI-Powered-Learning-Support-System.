import { describe, expect, it, vi } from "vitest";
import { aggregateReport, loadTeachingReport, reportCsv } from "../src/lecturer/teachingReport";
import { translateInterface } from "../../../packages/localization/src";

describe("lecturer teaching report", () => {
  it("uses the Vietnam calendar day near midnight", async () => {
    const report = await loadTeachingReport(
      30,
      new AbortController().signal,
      async <T,>() => ({ data: [] as T }),
      new Date("2026-09-28T18:00:00Z"),
    );
    expect(report.from).toBe("2026-08-31");
    expect(report.to).toBe("2026-09-29");
  });

  it("loads class, paginated results and attendance, then calculates only current students and latest attempts", async () => {
    const paths: string[] = [];
    const read = vi.fn(async (path: string) => {
      paths.push(path);
      if (path === "/me/owned-classes")
        return { data: [{ classId: "class-1", name: "Lớp thật", state: "ACTIVE" }] };
      if (path === "/classes/class-1/members")
        return {
          data: [
            { studentId: "student-1", state: "ACTIVE" },
            { studentId: "student-2", state: "ACTIVE" },
            { studentId: "student-3", state: "PENDING" },
          ],
        };
      if (path === "/targets/CLASS/class-1/quizzes")
        return { data: [{ quizId: "quiz-1", state: "PUBLISHED", createdAt: "2026-09-01T00:00:00Z" }] };
      if (path.startsWith("/classes/class-1/sessions?"))
        return {
          data: [
            {
              sessionId: "session-1",
              startAt: "2026-09-20T09:00:00Z",
              endAt: "2026-09-20T10:00:00Z",
              status: "COMPLETED",
            },
          ],
        };
      if (path === "/class-sessions/session-1/attendance")
        return {
          data: [
            { studentId: "student-1", attendanceStatus: "PRESENT" },
            { studentId: "student-2", attendanceStatus: "ABSENT" },
            { studentId: "student-3", attendanceStatus: "PRESENT" },
          ],
        };
      if (path.includes("month=2026-08")) return { data: { items: [] } };
      if (path.includes("cursor=next"))
        return {
          data: {
            items: [
              {
                attemptId: "attempt-3",
                studentId: "student-2",
                score: "0",
                maxScore: "10",
                submittedAt: "2026-09-21T12:00:00Z",
                gradingStatus: "PENDING_MANUAL_GRADING",
              },
              {
                attemptId: "attempt-4",
                studentId: "student-3",
                score: "10",
                maxScore: "10",
                submittedAt: "2026-09-22T12:00:00Z",
                gradingStatus: "AUTO_GRADED",
              },
            ],
          },
        };
      if (path.includes("month=2026-09"))
        return {
          data: {
            items: [
              {
                attemptId: "attempt-1",
                studentId: "student-1",
                score: "6",
                maxScore: "10",
                submittedAt: "2026-09-19T12:00:00Z",
                gradingStatus: "AUTO_GRADED",
              },
              {
                attemptId: "attempt-2",
                studentId: "student-1",
                score: "8",
                maxScore: "10",
                submittedAt: "2026-09-20T12:00:00Z",
                gradingStatus: "AUTO_GRADED",
              },
            ],
            nextCursor: "next",
          },
        };
      throw new Error(`Unexpected request: ${path}`);
    });
    const report = await loadTeachingReport(
      30,
      new AbortController().signal,
      read as never,
      new Date("2026-09-29T12:00:00Z"),
    );
    const total = aggregateReport(report.classes);
    expect(report.from).toBe("2026-08-31");
    expect(report.to).toBe("2026-09-29");
    expect(paths.some((path) => path.includes("cursor=next"))).toBe(true);
    expect(total).toMatchObject({
      students: 2,
      quizzes: 1,
      submitted: 2,
      expected: 2,
      pending: 1,
      scored: 1,
      averageScore: 8,
      attendanceRate: 50,
      submissionRate: 100,
      passRate: 100,
    });
    expect(total.distribution).toEqual([0, 0, 0, 1, 0]);
    expect(reportCsv(report, report.classes)).toContain('"Lớp thật"');
    const english = reportCsv(report, report.classes, (source) => translateInterface(source, "en"));
    expect(english.split("\r\n")[0]).not.toMatch(/[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9]/u);
    expect(english).toContain('"Lớp thật"');
    expect(english.split("\r\n").slice(1)).toEqual(reportCsv(report, report.classes).split("\r\n").slice(1));
  });

  it("shows unavailable rates when no quiz or recorded attendance exists", async () => {
    const read = vi.fn(async (path: string) => ({
      data:
        path === "/me/owned-classes"
          ? [{ classId: "class-2", name: "Lớp mới", state: "ACTIVE" }]
          : path.endsWith("/members")
            ? [{ studentId: "student-1", state: "ACTIVE" }]
            : [],
    }));
    const report = await loadTeachingReport(
      30,
      new AbortController().signal,
      read as never,
      new Date("2026-09-29T12:00:00Z"),
    );
    expect(aggregateReport(report.classes)).toMatchObject({
      students: 1,
      submissionRate: null,
      averageScore: null,
      attendanceRate: null,
    });
  });

  it("includes linked-course quizzes only for enrolled class members", async () => {
    const read = vi.fn(async (path: string) => {
      if (path === "/me/owned-classes")
        return {
          data: [{ classId: "class-1", linkedCourseId: "course-1", name: "Lớp liên kết", state: "ACTIVE" }],
        };
      if (path === "/classes/class-1/members")
        return {
          data: [
            { studentId: "student-1", state: "ACTIVE", joinedAt: "2026-09-01T00:00:00Z" },
            { studentId: "student-2", state: "ACTIVE", joinedAt: "2026-09-01T00:00:00Z" },
          ],
        };
      if (path === "/targets/CLASS/class-1/quizzes") return { data: [] };
      if (path === "/targets/COURSE/course-1/quizzes")
        return { data: [{ quizId: "quiz-course", state: "PUBLISHED", createdAt: "2026-09-10T00:00:00Z" }] };
      if (path === "/courses/course-1/roster")
        return { data: [{ studentId: "student-1", state: "ACTIVE", enrolledAt: "2026-09-02T00:00:00Z" }] };
      if (path.startsWith("/classes/class-1/sessions?")) return { data: [] };
      if (path.includes("month=2026-08")) return { data: { items: [] } };
      if (path.includes("month=2026-09"))
        return {
          data: {
            items: [
              {
                attemptId: "attempt-1",
                studentId: "student-1",
                score: "9",
                maxScore: "10",
                submittedAt: "2026-09-20T12:00:00Z",
                gradingStatus: "AUTO_GRADED",
              },
              {
                attemptId: "attempt-2",
                studentId: "student-2",
                score: "10",
                maxScore: "10",
                submittedAt: "2026-09-20T12:00:00Z",
                gradingStatus: "AUTO_GRADED",
              },
            ],
          },
        };
      throw new Error(`Unexpected request: ${path}`);
    });
    const report = await loadTeachingReport(
      30,
      new AbortController().signal,
      read as never,
      new Date("2026-09-29T12:00:00Z"),
    );
    expect(aggregateReport(report.classes)).toMatchObject({
      quizzes: 1,
      students: 2,
      expected: 1,
      submitted: 1,
      averageScore: 9,
      submissionRate: 100,
    });
    expect(read).toHaveBeenCalledWith("/courses/course-1/roster", expect.any(AbortSignal));
  });
});
