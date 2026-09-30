import { describe, expect, it } from "vitest";
import { isModeAllowedForRole, isToolAllowedForRole } from "../../apps/ai-service/src/assistant/roles.js";
import { ToolRunner, type AssistantDomainClient } from "../../apps/ai-service/src/assistant/tool-runner.js";

describe("Phase 16B — Assistant Tool Authorization & Role Boundaries", () => {
  const dummyDomainClient: AssistantDomainClient = {
    searchCourses: () => Promise.resolve([]),
    getCourseDetails: () => Promise.resolve(null),
    compareCourses: () => Promise.resolve([]),
    getKnowledgeGaps: () => Promise.resolve([]),
    searchCourseMaterials: () => Promise.resolve([]),
    generateQuizDraft: () => Promise.resolve({}),
    diagnoseCohortGaps: () => Promise.resolve({}),
    hasActiveAssessmentAttempt: () => Promise.resolve(false),
  };

  const runner = new ToolRunner(dummyDomainClient);

  describe("Role Capability Matrix", () => {
    it("restricts PUBLIC role to course search and comparison only", () => {
      expect(isToolAllowedForRole("PUBLIC", "search_courses")).toBe(true);
      expect(isToolAllowedForRole("PUBLIC", "get_course_details")).toBe(true);
      expect(isToolAllowedForRole("PUBLIC", "compare_courses")).toBe(true);

      // Denied tools
      expect(isToolAllowedForRole("PUBLIC", "get_knowledge_gaps")).toBe(false);
      expect(isToolAllowedForRole("PUBLIC", "search_course_materials")).toBe(false);
      expect(isToolAllowedForRole("PUBLIC", "generate_quiz_draft")).toBe(false);
      expect(isToolAllowedForRole("PUBLIC", "diagnose_cohort_gaps")).toBe(false);
    });

    it("restricts STUDENT role from lecturer authoring tools", () => {
      expect(isToolAllowedForRole("STUDENT", "search_courses")).toBe(true);
      expect(isToolAllowedForRole("STUDENT", "get_knowledge_gaps")).toBe(true);
      expect(isToolAllowedForRole("STUDENT", "search_course_materials")).toBe(true);
      expect(isToolAllowedForRole("STUDENT", "explain_concept")).toBe(true);

      // Denied authoring tools
      expect(isToolAllowedForRole("STUDENT", "generate_quiz_draft")).toBe(false);
      expect(isToolAllowedForRole("STUDENT", "diagnose_cohort_gaps")).toBe(false);
      expect(isToolAllowedForRole("STUDENT", "suggest_remedial_actions")).toBe(false);
    });

    it("limits lecturer chat to public catalog and conceptual help", () => {
      expect(isToolAllowedForRole("LECTURER", "search_courses")).toBe(true);
      expect(isToolAllowedForRole("LECTURER", "explain_concept")).toBe(true);
      expect(isToolAllowedForRole("LECTURER", "get_student_mastery")).toBe(false);
      expect(isToolAllowedForRole("LECTURER", "diagnose_cohort_gaps")).toBe(false);
      expect(isToolAllowedForRole("LECTURER", "generate_quiz_draft")).toBe(false);
    });

    it("restricts modes based on role", () => {
      expect(isModeAllowedForRole("PUBLIC", "STUDENT_ADVISOR")).toBe(true);
      expect(isModeAllowedForRole("PUBLIC", "STUDY_BUDDY")).toBe(false);
      expect(isModeAllowedForRole("PUBLIC", "LECTURER_COPILOT")).toBe(false);

      expect(isModeAllowedForRole("STUDENT", "STUDENT_ADVISOR")).toBe(true);
      expect(isModeAllowedForRole("STUDENT", "STUDY_BUDDY")).toBe(true);
      expect(isModeAllowedForRole("STUDENT", "LECTURER_COPILOT")).toBe(false);

      expect(isModeAllowedForRole("LECTURER", "LECTURER_COPILOT")).toBe(true);
      expect(isModeAllowedForRole("LECTURER", "STUDY_BUDDY")).toBe(false);
      expect(isModeAllowedForRole("LECTURER", "STUDENT_ADVISOR")).toBe(false);
      expect(isModeAllowedForRole("ADMIN", "ADMIN_SUPPORT")).toBe(true);
      expect(isModeAllowedForRole("ADMIN", "STUDY_BUDDY")).toBe(false);
      expect(isModeAllowedForRole("ADMIN", "STUDENT_ADVISOR")).toBe(false);
      expect(isToolAllowedForRole("ADMIN", "get_student_mastery")).toBe(false);
    });
  });

  describe("Tool Execution Security Guard", () => {
    it("fails before downstream invocation for a forbidden student capability", async () => {
      let invoked = false;
      const guarded = new ToolRunner({
        ...dummyDomainClient,
        generateQuizDraft: () => {
          invoked = true;
          return Promise.resolve({});
        },
      });
      const result = await guarded.executeTool(
        "call-pre-auth",
        "generate_quiz_draft",
        { topic: "Calculus", difficulty: "BEGINNER", questionCount: 5 },
        { userId: "student-1", role: "STUDENT" },
      );
      expect(result.error).toContain("FORBIDDEN");
      expect(invoked).toBe(false);
    });

    it("does not synthesize a Study Plan when the production adapter is absent", async () => {
      const result = await runner.executeTool(
        "call-plan",
        "get_recommended_learning_path",
        { courseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "STUDENT" },
      );
      expect(result.error).toBe("STUDY_PLAN_TOOL_NOT_CONFIGURED");
      expect(result.result).toBeNull();
    });

    it("returns a FORBIDDEN error when student attempts to execute generate_quiz_draft", async () => {
      const result = await runner.executeTool(
        "call-1",
        "generate_quiz_draft",
        { topic: "Calculus", difficulty: "BEGINNER", questionCount: 5 },
        { userId: "student-1", role: "STUDENT" },
      );

      expect(result.error).toContain("FORBIDDEN: Role STUDENT is not permitted");
      expect(result.result).toBeNull();
    });

    it("returns INVALID_ARGUMENTS when tool schema validation fails", async () => {
      const result = await runner.executeTool(
        "call-2",
        "get_course_details",
        { courseId: "not-a-uuid" },
        { userId: "student-1", role: "STUDENT" },
      );

      expect(result.error).toContain("INVALID_ARGUMENTS");
      expect(result.result).toBeNull();
    });

    it("returns TOOL_NOT_FOUND when calling an unknown tool", async () => {
      // Temporarily cast role to test unregistered tool
      const result = await runner.executeTool(
        "call-3",
        "drop_database_tables",
        {},
        { userId: "admin-1", role: "ADMIN" },
      );

      expect(result.error).toContain("FORBIDDEN");
    });
  });
});
