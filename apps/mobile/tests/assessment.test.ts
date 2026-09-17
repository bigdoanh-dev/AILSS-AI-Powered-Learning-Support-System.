import { describe, expect, it } from "vitest";
import {
  assessmentResult,
  attempt,
  attemptWithQuestions,
  buildSubmitPayload,
  calculateRemainingSeconds,
  countAnsweredQuestions,
  formatRemainingTime,
  isAttemptExpired,
  isAttemptState,
  reconcileAttemptSubmitOutcome,
  quizDetail,
  quizQuestion,
  quizQuestions,
  quizSummaries,
  quizSummary,
  submitResponse,
  validateAnswerForQuestion,
  type AttemptState,
  type QuizQuestion,
  type SubmittedAnswer,
} from "../src/assessment";

describe("assessment domain module", () => {
  describe("Attempt state machine & validation", () => {
    it("accepts canonical attempt states", () => {
      expect(isAttemptState("CREATED")).toBe(true);
      expect(isAttemptState("IN_PROGRESS")).toBe(true);
      expect(isAttemptState("SUBMITTED")).toBe(true);
      expect(isAttemptState("EXPIRED")).toBe(true);
    });

    it("strictly rejects invented grading or completion states as attempt states", () => {
      expect(isAttemptState("GRADED")).toBe(false);
      expect(isAttemptState("COMPLETED")).toBe(false);
      expect(isAttemptState("PASSED")).toBe(false);
      expect(isAttemptState("FAILED")).toBe(false);
      expect(isAttemptState("PENDING")).toBe(false);
      expect(isAttemptState(null)).toBe(false);
      expect(isAttemptState(undefined)).toBe(false);
      expect(isAttemptState(123)).toBe(false);
    });
  });

  describe("Quiz Question decoders", () => {
    it("decodes a valid SINGLE_CHOICE question", () => {
      const q = quizQuestion({
        questionId: "q1",
        questionOrder: 1,
        prompt: "CAP theorem covers?",
        questionType: "SINGLE_CHOICE",
        options: ["Consistency", "Latency"],
        points: "2.5",
      });
      expect(q.questionId).toBe("q1");
      expect(q.questionOrder).toBe(1);
      expect(q.prompt).toBe("CAP theorem covers?");
      expect(q.questionType).toBe("SINGLE_CHOICE");
      expect(q.options).toEqual(["Consistency", "Latency"]);
      expect(q.points).toBe("2.5");
    });

    it("decodes MULTIPLE_CHOICE, TRUE_FALSE, and SHORT_ANSWER questions", () => {
      const mc = quizQuestion({
        questionId: "q2",
        questionOrder: 2,
        prompt: "Select ACID properties",
        questionType: "MULTIPLE_CHOICE",
        options: ["Atomicity", "Consistency", "Speed"],
        points: "5",
      });
      expect(mc.questionType).toBe("MULTIPLE_CHOICE");

      const tf = quizQuestion({
        questionId: "q3",
        questionOrder: 3,
        prompt: "Cassandra is NoSQL",
        questionType: "TRUE_FALSE",
        points: "1",
      });
      expect(tf.questionType).toBe("TRUE_FALSE");

      const sa = quizQuestion({
        questionId: "q4",
        questionOrder: 4,
        prompt: "Name of the query language?",
        questionType: "SHORT_ANSWER",
        points: "2",
      });
      expect(sa.questionType).toBe("SHORT_ANSWER");
    });

    it("throws ApiError on invalid questionType or malformed schema", () => {
      expect(() =>
        quizQuestion({
          questionId: "q5",
          questionOrder: 1,
          prompt: "Invalid",
          questionType: "ESSAY",
        }),
      ).toThrow();

      expect(() => quizQuestion(null)).toThrow();
      expect(() => quizQuestions("not an array")).toThrow();
    });
  });

  describe("Quiz Summary and Detail decoders", () => {
    it("decodes a valid QuizSummary with all fields", () => {
      const summary = quizSummary({
        quizId: "quiz-1",
        targetType: "COURSE",
        targetId: "course-1",
        title: "Distributed Systems Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 2,
        questionCount: 4,
        durationSeconds: 1800,
        attemptLimit: 3,
        opensAt: "2026-09-10T00:00:00Z",
        closesAt: "2026-09-20T00:00:00Z",
        createdAt: "2026-09-09T00:00:00Z",
        updatedAt: "2026-09-09T00:00:00Z",
      });
      expect(summary.quizId).toBe("quiz-1");
      expect(summary.targetType).toBe("COURSE");
      expect(summary.title).toBe("Distributed Systems Quiz");
      expect(summary.durationSeconds).toBe(1800);
      expect(summary.attemptLimit).toBe(3);
    });

    it("decodes QuizSummaries from array or envelope items", () => {
      const raw = [
        {
          quizId: "q-1",
          targetType: "CLASS",
          targetId: "c-1",
          title: "Class Quiz",
          state: "PUBLISHED",
          currentVersion: 1,
          questionCount: 2,
          createdAt: "2026-09-01T00:00:00Z",
          updatedAt: "2026-09-01T00:00:00Z",
        },
      ];
      expect(quizSummaries(raw)).toHaveLength(1);
      expect(quizSummaries({ items: raw })).toHaveLength(1);
    });

    it("decodes QuizDetail with embedded questions", () => {
      const detail = quizDetail({
        quizId: "quiz-1",
        targetType: "COURSE",
        targetId: "course-1",
        title: "Distributed Systems Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        questionCount: 1,
        createdAt: "2026-09-09T00:00:00Z",
        updatedAt: "2026-09-09T00:00:00Z",
        questions: [
          {
            questionId: "q1",
            questionOrder: 1,
            prompt: "Is snapshot immutable?",
            questionType: "TRUE_FALSE",
            points: "1",
          },
        ],
      });
      expect(detail.questions).toHaveLength(1);
      expect(detail.questions[0].prompt).toBe("Is snapshot immutable?");
    });
  });

  describe("Attempt decoders", () => {
    it("decodes an active attempt", () => {
      const att = attempt({
        attemptId: "att-1",
        quizId: "quiz-1",
        quizVersion: 1,
        attemptNo: 1,
        state: "IN_PROGRESS",
        startedAt: "2026-09-15T01:00:00Z",
        deadlineAt: "2026-09-15T01:30:00Z",
        version: 1,
      });
      expect(att.state).toBe("IN_PROGRESS");
      expect(att.attemptNo).toBe(1);
      expect(att.deadlineAt).toBe("2026-09-15T01:30:00Z");
    });

    it("decodes attempt with questions response from attempt start", () => {
      const res = attemptWithQuestions({
        attemptId: "att-1",
        quizId: "quiz-1",
        quizVersion: 1,
        attemptNo: 1,
        state: "IN_PROGRESS",
        startedAt: "2026-09-15T01:00:00Z",
        deadlineAt: "2026-09-15T01:30:00Z",
        version: 1,
        questions: [
          {
            questionId: "q1",
            questionOrder: 1,
            prompt: "Prompt 1",
            questionType: "SINGLE_CHOICE",
            options: ["A", "B"],
            points: "1",
          },
        ],
        replayed: true,
      });
      expect(res.attempt.state).toBe("IN_PROGRESS");
      expect(res.questions).toHaveLength(1);
      expect(res.replayed).toBe(true);
    });

    it("rejects attempt with invalid state", () => {
      expect(() =>
        attempt({
          attemptId: "att-1",
          quizId: "quiz-1",
          quizVersion: 1,
          attemptNo: 1,
          state: "GRADED",
          version: 1,
        }),
      ).toThrow();
    });
  });

  describe("Submit & Result decoders", () => {
    it("decodes SubmitResponse", () => {
      const sub = submitResponse({
        attemptId: "att-1",
        score: "8",
        maxScore: "10",
        resultVersion: 1,
      });
      expect(sub.score).toBe("8");
      expect(sub.maxScore).toBe("10");
      expect(sub.resultVersion).toBe(1);
    });

    it("decodes official AssessmentResult", () => {
      const res = assessmentResult({
        attemptId: "att-1",
        quizId: "quiz-1",
        quizVersion: 1,
        score: "10",
        maxScore: "10",
        submittedAt: "2026-09-15T01:25:00Z",
        resultVersion: 1,
        gradingAlgorithmVersion: "objective-v1",
      });
      expect(res.score).toBe("10");
      expect(res.maxScore).toBe("10");
      expect(res.gradingAlgorithmVersion).toBe("objective-v1");
    });
  });

  describe("Authoritative Timer and Expiry Helpers", () => {
    const fixedNow = new Date("2026-09-15T12:00:00Z");

    it("calculates remaining seconds accurately against server deadline", () => {
      const futureDeadline = "2026-09-15T12:15:30Z";
      const remaining = calculateRemainingSeconds(futureDeadline, fixedNow);
      expect(remaining).toBe(15 * 60 + 30);
    });

    it("returns 0 if deadline has already passed or is invalid", () => {
      const pastDeadline = "2026-09-15T11:59:59Z";
      expect(calculateRemainingSeconds(pastDeadline, fixedNow)).toBe(0);
      expect(calculateRemainingSeconds(null, fixedNow)).toBe(0);
      expect(calculateRemainingSeconds("invalid-date", fixedNow)).toBe(0);
    });

    it("formats remaining time cleanly as MM:SS or HH:MM:SS", () => {
      expect(formatRemainingTime(90)).toBe("01:30");
      expect(formatRemainingTime(5)).toBe("00:05");
      expect(formatRemainingTime(3665)).toBe("01:01:05");
      expect(formatRemainingTime(0)).toBe("00:00");
      expect(formatRemainingTime(-10)).toBe("00:00");
    });

    it("detects expiry reliably", () => {
      expect(isAttemptExpired("2026-09-15T11:59:59Z", fixedNow)).toBe(true);
      expect(isAttemptExpired("2026-09-15T12:00:00Z", fixedNow)).toBe(true);
      expect(isAttemptExpired("2026-09-15T12:01:00Z", fixedNow)).toBe(false);
      expect(isAttemptExpired(null, fixedNow)).toBe(false);
    });
  });

  describe("Question answering & submission validation", () => {
    const questions: QuizQuestion[] = [
      {
        questionId: "q-single",
        questionOrder: 1,
        prompt: "Select one",
        questionType: "SINGLE_CHOICE",
        options: ["A", "B", "C"],
        points: "1",
      },
      {
        questionId: "q-multi",
        questionOrder: 2,
        prompt: "Select multiple",
        questionType: "MULTIPLE_CHOICE",
        options: ["X", "Y", "Z"],
        points: "2",
      },
      {
        questionId: "q-tf",
        questionOrder: 3,
        prompt: "True or false?",
        questionType: "TRUE_FALSE",
        points: "1",
      },
      {
        questionId: "q-sa",
        questionOrder: 4,
        prompt: "Short answer",
        questionType: "SHORT_ANSWER",
        points: "1",
      },
    ];

    it("validates answers according to question types", () => {
      expect(
        validateAnswerForQuestion(questions[0], {
          questionId: "q-single",
          selectedOptionId: "B",
        }),
      ).toBe(true);

      // Invalid option for single choice
      expect(
        validateAnswerForQuestion(questions[0], {
          questionId: "q-single",
          selectedOptionId: "UNKNOWN",
        }),
      ).toBe(false);

      expect(
        validateAnswerForQuestion(questions[1], {
          questionId: "q-multi",
          selectedOptionIds: ["X", "Z"],
        }),
      ).toBe(true);

      expect(
        validateAnswerForQuestion(questions[2], {
          questionId: "q-tf",
          value: true,
        }),
      ).toBe(true);

      expect(
        validateAnswerForQuestion(questions[3], {
          questionId: "q-sa",
          text: "My Answer",
        }),
      ).toBe(true);

      // Empty text is invalid
      expect(
        validateAnswerForQuestion(questions[3], {
          questionId: "q-sa",
          text: "   ",
        }),
      ).toBe(false);
    });

    it("accurately counts answered and unanswered questions", () => {
      const draftAnswers: Record<string, SubmittedAnswer> = {
        "q-single": { questionId: "q-single", selectedOptionId: "A" },
        "q-tf": { questionId: "q-tf", value: false },
      };

      const counts = countAnsweredQuestions(questions, draftAnswers);
      expect(counts.total).toBe(4);
      expect(counts.answered).toBe(2);
      expect(counts.unanswered).toBe(2);
    });

    it("builds clean submission payload with only valid answers", () => {
      const draftAnswers: Record<string, SubmittedAnswer> = {
        "q-single": { questionId: "q-single", selectedOptionId: "A" },
        "q-tf": { questionId: "q-tf", value: false },
      };

      const fixedDate = "2026-09-15T12:05:00.000Z";
      const payload = buildSubmitPayload(questions, draftAnswers, fixedDate);
      expect(payload.clientSubmittedAt).toBe(fixedDate);
      expect(payload.answers).toHaveLength(2);
      expect(payload.answers[0]).toEqual({
        questionId: "q-single",
        selectedOptionId: "A",
      });
      expect(payload.answers[1]).toEqual({
        questionId: "q-tf",
        value: false,
      });
    });
  });

  describe("reconcileAttemptSubmitOutcome", () => {
    it("maps SUBMITTED to SUCCESS", () => {
      expect(reconcileAttemptSubmitOutcome("SUBMITTED")).toBe("SUCCESS");
    });

    it("maps EXPIRED to EXPIRED", () => {
      expect(reconcileAttemptSubmitOutcome("EXPIRED")).toBe("EXPIRED");
    });

    it("maps IN_PROGRESS and CREATED to ALLOW_RETRY", () => {
      expect(reconcileAttemptSubmitOutcome("IN_PROGRESS")).toBe("ALLOW_RETRY");
      expect(reconcileAttemptSubmitOutcome("CREATED")).toBe("ALLOW_RETRY");
    });

    it("maps invalid or unrecognized states to UNKNOWN", () => {
      expect(reconcileAttemptSubmitOutcome("UNKNOWN_STATE" as unknown as AttemptState)).toBe("UNKNOWN");
      expect(reconcileAttemptSubmitOutcome(undefined as unknown as AttemptState)).toBe("UNKNOWN");
    });
  });
});
