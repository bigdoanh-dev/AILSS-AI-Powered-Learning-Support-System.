import { describe, expect, it } from "vitest";
import {
  authoringQuestion,
  authoringQuiz,
  authoringQuizSummaries,
  authoringQuizSummary,
  blankQuestion,
  cleanQuestion,
  CONTRACT_LIMITED,
  isQuestionType,
  isQuizState,
  quizResultItem,
  quizResultPage,
  validateAuthoringQuestions,
  type AuthoringQuestion,
} from "../src/assessment-authoring";

describe("assessment-authoring domain module", () => {
  describe("Quiz state & Question type validation", () => {
    it("recognizes canonical quiz states", () => {
      expect(isQuizState("DRAFT")).toBe(true);
      expect(isQuizState("PUBLISHED")).toBe(true);
      expect(isQuizState("CLOSED")).toBe(true);
      expect(isQuizState("ARCHIVED")).toBe(true);
      expect(isQuizState("INVALID")).toBe(false);
      expect(isQuizState(123)).toBe(false);
    });

    it("recognizes canonical question types", () => {
      expect(isQuestionType("SINGLE_CHOICE")).toBe(true);
      expect(isQuestionType("MULTIPLE_CHOICE")).toBe(true);
      expect(isQuestionType("TRUE_FALSE")).toBe(true);
      expect(isQuestionType("SHORT_ANSWER")).toBe(true);
      expect(isQuestionType("ESSAY")).toBe(false);
    });
  });

  describe("Blank question templates & cleaning", () => {
    it("creates appropriate blank template for each question type", () => {
      const sc = blankQuestion("SINGLE_CHOICE");
      expect(sc.questionType).toBe("SINGLE_CHOICE");
      expect(sc.options).toHaveLength(2);
      expect(sc.correctAnswer).toBe("");

      const mc = blankQuestion("MULTIPLE_CHOICE");
      expect(mc.questionType).toBe("MULTIPLE_CHOICE");
      expect(mc.options).toHaveLength(2);
      expect(mc.correctAnswer).toEqual([]);

      const tf = blankQuestion("TRUE_FALSE");
      expect(tf.questionType).toBe("TRUE_FALSE");
      expect(tf.correctAnswer).toBe(true);

      const sa = blankQuestion("SHORT_ANSWER");
      expect(sa.questionType).toBe("SHORT_ANSWER");
      expect(sa.correctAnswer).toBe("");
    });

    it("cleans question payload properly for PATCH", () => {
      const q: AuthoringQuestion = {
        questionId: "q1",
        questionOrder: 1,
        prompt: "Clean this prompt",
        questionType: "SINGLE_CHOICE",
        options: ["A", "B"],
        correctAnswer: "A",
        points: "2.0",
      };
      const cleaned = cleanQuestion(q);
      expect(cleaned).toEqual({
        prompt: "Clean this prompt",
        questionType: "SINGLE_CHOICE",
        points: "2.0",
        options: ["A", "B"],
        correctAnswer: "A",
      });
    });
  });

  describe("Question decoder", () => {
    it("decodes authoring question with options and points", () => {
      const q = authoringQuestion({
        prompt: "Sample question?",
        questionType: "SINGLE_CHOICE",
        options: ["A", "B"],
        correctAnswer: "A",
        points: "2.5",
      });
      expect(q.prompt).toBe("Sample question?");
      expect(q.points).toBe("2.5");
    });
  });

  describe("Question validation logic", () => {
    it("passes validation for well-formed questions", () => {
      const questions: AuthoringQuestion[] = [
        {
          prompt: "What is 2 + 2?",
          questionType: "SINGLE_CHOICE",
          options: ["3", "4"],
          correctAnswer: "4",
          points: "1",
        },
        {
          prompt: "Select primes",
          questionType: "MULTIPLE_CHOICE",
          options: ["2", "3", "4"],
          correctAnswer: ["2", "3"],
          points: "2",
        },
        {
          prompt: "Earth is round",
          questionType: "TRUE_FALSE",
          correctAnswer: true,
          points: "1",
        },
        {
          prompt: "Capital of Vietnam?",
          questionType: "SHORT_ANSWER",
          correctAnswer: "Hanoi",
          points: "1.5",
        },
      ];
      const errors = validateAuthoringQuestions(questions);
      expect(errors).toHaveLength(0);
    });

    it("flags missing prompt, invalid points, duplicate options, and mismatched answers", () => {
      const badQuestions: AuthoringQuestion[] = [
        {
          prompt: "  ",
          questionType: "SINGLE_CHOICE",
          options: ["Opt 1", "Opt 1"], // Duplicate options
          correctAnswer: "Unknown", // Mismatched correct answer
          points: "0", // Points <= 0
        },
        {
          prompt: "Question 2",
          questionType: "MULTIPLE_CHOICE",
          options: ["A", "B"],
          correctAnswer: [], // Empty answer
          points: "150", // Points > 100
        },
        {
          prompt: "Question 3",
          questionType: "SHORT_ANSWER",
          correctAnswer: "   ", // Empty answer
          points: "invalid", // Not decimal
        },
      ];
      const errors = validateAuthoringQuestions(badQuestions);
      expect(errors.length).toBeGreaterThanOrEqual(6);
      expect(errors.some((e) => e.includes("chưa có nội dung"))).toBe(true);
      expect(errors.some((e) => e.includes("phải lớn hơn 0 và không quá 100"))).toBe(true);
      expect(errors.some((e) => e.includes("các lựa chọn phải khác nhau"))).toBe(true);
      expect(errors.some((e) => e.includes("chưa chọn đáp án đúng hợp lệ"))).toBe(true);
    });
  });

  describe("Quiz and Summary decoders", () => {
    it("decodes authoring quiz summary", () => {
      const summary = authoringQuizSummary({
        quizId: "quiz-123",
        title: "Midterm Test",
        state: "DRAFT",
        targetType: "COURSE",
        targetId: "course-abc",
        questionCount: 5,
        currentVersion: 2,
      });
      expect(summary.quizId).toBe("quiz-123");
      expect(summary.state).toBe("DRAFT");
      expect(summary.targetType).toBe("COURSE");
      expect(summary.questionCount).toBe(5);
    });

    it("decodes full authoring quiz with questions", () => {
      const quiz = authoringQuiz({
        quizId: "quiz-123",
        title: "Final Exam",
        state: "PUBLISHED",
        targetType: "CLASS",
        targetId: "class-xyz",
        questionCount: 1,
        currentVersion: 1,
        questions: [
          {
            prompt: "Is TypeScript typed?",
            questionType: "TRUE_FALSE",
            correctAnswer: true,
            points: "1",
          },
        ],
      });
      expect(quiz.title).toBe("Final Exam");
      expect(quiz.questions).toHaveLength(1);
      expect(quiz.questions[0].correctAnswer).toBe(true);
    });

    it("decodes list of quizzes in both array and envelope format", () => {
      const raw = [
        {
          quizId: "q1",
          title: "Q1",
          state: "DRAFT",
          targetType: "COURSE",
          targetId: "c1",
          questionCount: 0,
          currentVersion: 1,
        },
      ];
      expect(authoringQuizSummaries(raw)).toHaveLength(1);
      expect(authoringQuizSummaries({ quizzes: raw })).toHaveLength(1);
      expect(authoringQuizSummaries({ data: { items: raw } })).toHaveLength(1);
    });
  });

  describe("Quiz Results overview decoders", () => {
    it("decodes single quiz result item", () => {
      const item = quizResultItem({
        attemptId: "att-0",
        studentId: "stu-0",
        score: "10.0",
        maxScore: "10.0",
        submittedAt: "2026-09-15T11:00:00Z",
      });
      expect(item.attemptId).toBe("att-0");
      expect(item.score).toBe("10.0");
    });
    it("decodes result items and pages", () => {
      const page = quizResultPage({
        items: [
          {
            attemptId: "att-1",
            studentId: "stu-1",
            score: "8.5",
            maxScore: "10.0",
            submittedAt: "2026-09-15T12:00:00Z",
          },
        ],
        nextCursor: "cursor-token-123",
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0].score).toBe("8.5");
      expect(page.nextCursor).toBe("cursor-token-123");
    });
  });

  describe("Contract limited constants", () => {
    it("documents contract limited operations", () => {
      expect(CONTRACT_LIMITED.quizDelete).toBeDefined();
      expect(CONTRACT_LIMITED.manualGrading).toBeDefined();
      expect(CONTRACT_LIMITED.questionReorder).toBeDefined();
    });
  });
});
