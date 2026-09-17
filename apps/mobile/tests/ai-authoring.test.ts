import { describe, expect, it } from "vitest";
import {
  aiApprovalResult,
  aiDraft,
  aiDrafts,
  aiJob,
  aiJobs,
  aiUsage,
  isAiJobState,
  objectiveQuiz,
  TERMINAL_AI_JOB_STATES,
  VALID_AI_JOB_STATES,
} from "../src/ai-authoring";

describe("ai-authoring domain module", () => {
  describe("AI State Machine & strict rejection of COMPLETED", () => {
    it("accepts canonical quiz-generation states", () => {
      expect(VALID_AI_JOB_STATES.size).toBe(7);
      const valid = ["QUEUED", "PROCESSING", "VALIDATING", "AI_DRAFT", "FAILED", "APPROVED", "CANCELLED"];
      for (const s of valid) {
        expect(isAiJobState(s)).toBe(true);
      }
    });

    it("STRICTLY REJECTS COMPLETED for quiz-generation jobs", () => {
      // Per contract specification Section 4 & 24:
      // COMPLETED is NOT valid for QUIZ_GENERATION.
      expect(isAiJobState("COMPLETED")).toBe(false);
    });

    it("rejects unknown or invalid states", () => {
      expect(isAiJobState("DONE")).toBe(false);
      expect(isAiJobState("SUCCESS")).toBe(false);
      expect(isAiJobState("PENDING")).toBe(false);
      expect(isAiJobState(null)).toBe(false);
      expect(isAiJobState(undefined)).toBe(false);
    });

    it("defines terminal states that stop polling", () => {
      expect(TERMINAL_AI_JOB_STATES.has("AI_DRAFT")).toBe(true);
      expect(TERMINAL_AI_JOB_STATES.has("APPROVED")).toBe(true);
      expect(TERMINAL_AI_JOB_STATES.has("FAILED")).toBe(true);
      expect(TERMINAL_AI_JOB_STATES.has("CANCELLED")).toBe(true);
      expect(TERMINAL_AI_JOB_STATES.has("QUEUED")).toBe(false);
      expect(TERMINAL_AI_JOB_STATES.has("PROCESSING")).toBe(false);
      expect(TERMINAL_AI_JOB_STATES.has("VALIDATING")).toBe(false);
    });
  });

  describe("AI Job decoder", () => {
    it("decodes a valid in-flight AI job", () => {
      const job = aiJob({
        jobId: "job-123",
        jobKind: "QUIZ_GENERATION",
        state: "PROCESSING",
        version: 2,
        targetType: "CLASS",
        targetId: "cls-456",
        documentId: "doc-789",
        createdAt: "2026-09-15T10:00:00Z",
        updatedAt: "2026-09-15T10:01:00Z",
      });
      expect(job.jobId).toBe("job-123");
      expect(job.state).toBe("PROCESSING");
      expect(job.targetType).toBe("CLASS");
      expect(job.documentId).toBe("doc-789");
    });

    it("throws ApiError when encountering COMPLETED state", () => {
      expect(() =>
        aiJob({
          jobId: "job-bad",
          jobKind: "QUIZ_GENERATION",
          state: "COMPLETED",
          version: 1,
          targetType: "COURSE",
          targetId: "crs-1",
          documentId: "doc-1",
          createdAt: "2026-09-15T10:00:00Z",
          updatedAt: "2026-09-15T10:00:00Z",
        }),
      ).toThrow();
    });

    it("decodes list of jobs in array and wrapped format", () => {
      const list = [
        {
          jobId: "job-1",
          jobKind: "QUIZ_GENERATION",
          state: "AI_DRAFT",
          version: 1,
          targetType: "COURSE",
          targetId: "c1",
          documentId: "d1",
          createdAt: "2026-09-15T10:00:00Z",
          updatedAt: "2026-09-15T10:00:00Z",
        },
      ];
      expect(aiJobs(list)).toHaveLength(1);
      expect(aiJobs({ items: list })).toHaveLength(1);
    });
  });

  describe("AI Draft & ObjectiveQuiz decoders", () => {
    it("decodes valid objective-v1 quiz content", () => {
      const quiz = objectiveQuiz({
        schemaVersion: "objective-v1",
        title: "AI Generated Quiz",
        questions: [
          {
            id: "q-1",
            order: 1,
            text: "What is React Native?",
            points: "1",
            cognitiveLevel: "RECOGNITION",
            type: "SINGLE_CHOICE",
            options: [
              { id: "opt-1", text: "Framework for mobile" },
              { id: "opt-2", text: "Database engine" },
            ],
            correctAnswer: { optionId: "opt-1" },
          },
        ],
      });
      expect(quiz.title).toBe("AI Generated Quiz");
      expect(quiz.questions[0].cognitiveLevel).toBe("RECOGNITION");
      expect(quiz.questions[0].correctAnswer).toEqual({ optionId: "opt-1" });
    });

    it("decodes list of drafts with aiDrafts", () => {
      const rawDraft = {
        draftId: "d-1",
        draftVersion: 1,
        validationStatus: "VALID",
        questionCount: 0,
        state: "AI_DRAFT",
        checksum: "abc",
        content: { schemaVersion: "objective-v1", title: "T", questions: [] },
      };
      expect(aiDrafts([rawDraft])).toHaveLength(1);
      expect(aiDrafts({ items: [rawDraft] })).toHaveLength(1);
    });

    it("decodes full AI Draft payload", () => {
      const draft = aiDraft({
        draftId: "draft-1",
        draftVersion: 1,
        validationStatus: "VALID",
        questionCount: 1,
        state: "AI_DRAFT",
        checksum: "sha256-hash-xyz",
        content: {
          schemaVersion: "objective-v1",
          title: "Sample Draft",
          questions: [
            {
              id: "q-1",
              order: 1,
              text: "Sample?",
              points: "1",
              type: "TRUE_FALSE",
              correctAnswer: { value: true },
            },
          ],
        },
      });
      expect(draft.draftId).toBe("draft-1");
      expect(draft.content.questions).toHaveLength(1);
    });
  });

  describe("AI Approval & Usage decoders", () => {
    it("decodes AI approval result importing to Assessment", () => {
      const approval = aiApprovalResult({
        jobId: "job-123",
        draftId: "draft-456",
        state: "APPROVED",
        approvedDraftVersion: 2,
        assessment: {
          quizId: "new-quiz-789",
          quizVersion: 1,
          status: "DRAFT",
        },
      });
      expect(approval.state).toBe("APPROVED");
      expect(approval.assessment.quizId).toBe("new-quiz-789");
      expect(approval.assessment.status).toBe("DRAFT");
    });

    it("decodes AI usage limits", () => {
      const usage = aiUsage({
        limit: 100,
        consumed: 25,
        reserved: 5,
        remaining: 70,
      });
      expect(usage.limit).toBe(100);
      expect(usage.remaining).toBe(70);
    });
  });
});
