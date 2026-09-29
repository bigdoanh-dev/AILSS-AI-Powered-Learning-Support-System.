import { describe, expect, it } from "vitest";
import { assessmentResult, AttemptSubmissionGate, quizSummary } from "../src/assessment";
import { askTutor, masteryRecords, studyPlan, tutorReply } from "../src/adaptive";
import { ApiError } from "../src/api";

describe("Phase 41 mobile DTO parity", () => {
  it("maps authoritative Mastery V2 evidence without recomputing its state", () => {
    const [row] = masteryRecords([
      {
        courseId: "course-1",
        conceptId: "normalization",
        learningOutcomeId: "lo-1",
        masteryScore: 84,
        masteryState: "PROFICIENT",
        confidenceScore: 91,
        evidenceCount: 3,
        calculatedAt: "2026-09-23T00:00:00.000Z",
        explanation: { whyState: "Three verified attempts", nextSteps: "Review edge cases" },
      },
    ]);
    expect(row).toMatchObject({ masteryState: "PROFICIENT", masteryScore: 84, evidenceCount: 3 });
  });

  it("preserves Study Plan provenance, status, and scheduling from the service", () => {
    const plan = studyPlan({
      planId: "plan-1",
      courseId: "course-1",
      generatedAt: "2026-09-23T00:00:00.000Z",
      overallMasteryPercent: 65,
      items: [
        {
          itemId: "item-1",
          courseId: "course-1",
          lessonId: "lesson-1",
          title: "Review joins",
          description: "Practice joins",
          action: "LESSON",
          status: "PROPOSED",
          scheduledDate: "2026-09-24",
          estimatedMinutes: 30,
          rationale: "Evidence gap",
          dueAt: "2026-09-25T00:00:00.000Z",
        },
      ],
      masteryGaps: [],
      upcomingAssessments: [],
    });
    expect(plan.items[0]).toMatchObject({
      status: "PROPOSED",
      rationale: "Evidence gap",
      dueAt: "2026-09-25T00:00:00.000Z",
    });
  });

  it("preserves only citations returned by the authorized Tutor API", () => {
    expect(
      tutorReply({
        conversationId: "conversation-1",
        content: "Use a left join.",
        safetyBlocked: false,
        citations: [
          {
            sourceId: "source-1",
            title: "Join lesson",
            courseId: "course-1",
            lessonId: "lesson-1",
            snippet: "A left join keeps unmatched rows.",
          },
        ],
      }),
    ).toMatchObject({ citations: [{ sourceId: "source-1", lessonId: "lesson-1" }] });
  });

  it("renders only authoritative, bounded catalog matches supplied by the assistant API", () => {
    const reply = tutorReply({
      conversationId: "conversation-1",
      content: "Mình tìm thấy khóa học đang có trong danh mục.",
      citations: [],
      catalogCourses: Array.from({ length: 5 }, (_, index) => ({
        courseId: `course-${String(index)}`,
        title: `Khóa ${String(index)}`,
        priceAmount: 450000,
        priceCurrency: "VND",
      })),
    });
    expect(reply.catalogCourses).toHaveLength(3);
    expect(reply.catalogCourses[0]).toEqual({
      courseId: "course-0",
      title: "Khóa 0",
      priceAmount: 450000,
      priceCurrency: "VND",
    });
    expect(
      tutorReply({ conversationId: "another", content: "Chưa có kết quả", citations: [] }).catalogCourses,
    ).toEqual([]);
    expect(() =>
      tutorReply({
        conversationId: "invalid",
        content: "x",
        citations: [],
        catalogCourses: [{ title: "Không có giá" }],
      }),
    ).toThrow(ApiError);
  });

  it("accepts an authoritative no-result Tutor response without inventing citations", async () => {
    const request = async () => ({
      conversationId: "conversation-2",
      content: "Không tìm thấy tài liệu phù hợp trong khóa học này.",
      safetyBlocked: false,
      citations: [],
    });
    const reply = await askTutor(
      { request },
      { courseId: "course-1", message: "Explain an unrelated topic", signal: new AbortController().signal },
    );
    expect(reply.citations).toEqual([]);
    expect(reply.content).toContain("Không tìm thấy");
  });

  it("starts course advice without attaching an unrelated enrolled course", async () => {
    let sentBody: unknown;
    const request = async (_path: string, options?: { body?: unknown }) => {
      sentBody = options?.body;
      return { conversationId: "conversation-3", content: "Bạn muốn học lĩnh vực nào?", citations: [] };
    };
    await askTutor(
      { request },
      {
        mode: "STUDENT_ADVISOR",
        message: "Mình chưa biết chọn khóa học nào",
        signal: new AbortController().signal,
      },
    );
    expect(sentBody).toMatchObject({ mode: "STUDENT_ADVISOR", message: "Mình chưa biết chọn khóa học nào" });
    expect(sentBody).not.toHaveProperty("courseId");
  });

  it.each([403, 429, 503])(
    "propagates Tutor backend failure %i without creating a response",
    async (status) => {
      const request = async () => {
        throw new ApiError("backend failure", status);
      };
      await expect(
        askTutor({ request }, { message: "Explain this", signal: new AbortController().signal }),
      ).rejects.toMatchObject({ status });
    },
  );

  it("passes cancellation to the live Tutor request and preserves abort failure", async () => {
    const controller = new AbortController();
    const request = async (_path: string, options?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) =>
        options?.signal?.addEventListener("abort", () => reject(new ApiError("cancelled"))),
      );
    const pending = askTutor({ request }, { message: "Explain this", signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("preserves assessment windows and grading state from the backend", () => {
    expect(
      quizSummary({
        quizId: "quiz-1",
        targetType: "COURSE",
        targetId: "course-1",
        title: "Quiz",
        state: "PUBLISHED",
        currentVersion: 2,
        questionCount: 5,
        opensAt: "2026-09-24T00:00:00.000Z",
        closesAt: "2026-09-25T00:00:00.000Z",
        createdAt: "2026-09-20T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
      }),
    ).toMatchObject({ opensAt: "2026-09-24T00:00:00.000Z", closesAt: "2026-09-25T00:00:00.000Z" });
    expect(
      assessmentResult({
        attemptId: "attempt-1",
        quizId: "quiz-1",
        quizVersion: 2,
        score: "9",
        maxScore: "10",
        submittedAt: "2026-09-23T00:00:00.000Z",
        resultVersion: 1,
        gradingStatus: "MANUALLY_GRADED",
        manualScore: "9",
        teacherFeedback: "Good reasoning.",
      }),
    ).toMatchObject({ gradingStatus: "MANUALLY_GRADED", teacherFeedback: "Good reasoning." });
  });

  it("allows only one in-flight assessment submit and keeps retries serialized", () => {
    const gate = new AttemptSubmissionGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    gate.finish("RETRYABLE");
    expect(gate.begin()).toBe(true);
    gate.finish("COMPLETE");
    expect(gate.begin()).toBe(false);
  });
});
