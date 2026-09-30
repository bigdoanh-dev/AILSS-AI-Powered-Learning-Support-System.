import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "../../packages/http/src/index.js";
import {
  AssistantOrchestrator,
  IntegrationOnlyAssistantLlmProvider,
  type AssistantDomainClient,
  type AssistantLlmProvider,
  type AssistantRepository,
  type ConversationMessage,
  type ConversationSummary,
  type CreateConversationInput,
  type AppendMessageInput,
  type LogToolInvocationInput,
  ToolRunner,
} from "../../apps/ai-service/src/assistant/index.js";

describe("Phase 16B & 17 — Assistant Orchestrator (Study Buddy & Lecturer Copilot)", () => {
  function createMockRepo() {
    const conversations = new Map<string, ConversationSummary>();
    const messages = new Map<string, ConversationMessage[]>();
    const toolLogs: LogToolInvocationInput[] = [];

    const repo: AssistantRepository = {
      getConversation: (id: string) => Promise.resolve(conversations.get(id) ?? null),
      createConversation: (input: CreateConversationInput) => {
        const conv: ConversationSummary = {
          conversationId: input.conversationId,
          userId: input.userId,
          role: input.role,
          mode: input.mode,
          title: input.title,
          createdAt: input.now,
          updatedAt: input.now,
          ...(input.courseId ? { courseId: input.courseId } : {}),
        };
        conversations.set(input.conversationId, conv);
        return Promise.resolve(conv);
      },
      touchConversation: () => Promise.resolve(),
      listUserConversations: (userId: string) =>
        Promise.resolve([...conversations.values()].filter((c) => c.userId === userId)),
      appendMessage: (input: AppendMessageInput) => {
        const list = messages.get(input.conversationId) ?? [];
        const msg: ConversationMessage = {
          messageId: input.messageId,
          conversationId: input.conversationId,
          sender: input.sender,
          content: input.content,
          createdAt: input.now,
          ...(input.toolCalls ? { toolCalls: input.toolCalls } : {}),
          ...(input.toolResults ? { toolResults: input.toolResults } : {}),
          ...(input.citations ? { citations: input.citations } : {}),
        };
        list.push(msg);
        messages.set(input.conversationId, list);
        return Promise.resolve(msg);
      },
      getRecentMessages: (id: string) => Promise.resolve(messages.get(id) ?? []),
      logToolInvocation: (input: LogToolInvocationInput) => {
        toolLogs.push(input);
        return Promise.resolve();
      },
    } as unknown as AssistantRepository;

    return { repo, conversations, messages, toolLogs };
  }

  const courseId = randomUUID();
  const domainClient: AssistantDomainClient = {
    searchCourses: () => Promise.resolve([]),
    getCourseDetails: () => Promise.resolve(null),
    compareCourses: () => Promise.resolve([]),
    getKnowledgeGaps: () =>
      Promise.resolve([
        {
          topic: "Sharding & Consistency",
          cognitiveLevel: "APPLICATION",
          accuracyRate: 0.4,
          recommendation: "Review Cassandra replication factor and quorum writes.",
        },
      ]),
    searchCourseMaterials: (_uid, cid, topic) =>
      Promise.resolve([
        {
          courseId: cid,
          lessonId: "lesson-05-consistency",
          courseVersion: 1,
          lessonVersion: 1,
          title: "Quorum and Tunable Consistency",
          contentSnippet: `In ScyllaDB/Cassandra, LOCAL_QUORUM ensures strong consistency within a datacenter when R + W > N. Topic: ${topic}`,
          sourceObjectId: "a".repeat(64),
          retrievalScore: 3,
          sourceType: "LESSON_OBJECT" as const,
        },
      ]),
    generateQuizDraft: () => Promise.resolve({}),
    diagnoseCohortGaps: () => Promise.resolve({}),
    hasActiveAssessmentAttempt: () => Promise.resolve(false),
    getStudentMastery: (_studentId, cid) => Promise.resolve([{ courseId: cid, masteryScore: 45 }]),
    getRecommendedLearningPath: (studentId, cid) =>
      Promise.resolve({ planId: randomUUID(), studentId, courseId: cid, items: [] }),
  };

  it("Study Buddy executes search_course_materials and returns verified lesson citations", async () => {
    const studentId = randomUUID();
    const mockRepo = createMockRepo();
    let usageContext: { readonly userId: string; readonly sessionId: string } | undefined;

    const mockLlm: AssistantLlmProvider = {
      generate: (req) => {
        usageContext = req.usageContext;
        expect(req.systemPrompt).toContain("Vietnamese learning companion");
        expect(req.systemPrompt).toContain("Never invent scores");
        expect(req.systemPrompt).toContain("Return only the final learner-facing message");
        expect(req.maxTokens).toBe(768);
        return Promise.resolve({
          content:
            "Theo bài học 'Quorum and Tunable Consistency', LOCAL_QUORUM yêu cầu R + W > N để đảm bảo tính nhất quán.",
        });
      },
    };

    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: mockLlm,
    });

    const res = await orchestrator.chat(
      { userId: studentId, role: "STUDENT" },
      {
        mode: "STUDY_BUDDY",
        courseId,
        message: "Giải thích giúp mình tài liệu về tính nhất quán quorum",
      },
    );

    expect(res.citations).toHaveLength(1);
    expect(usageContext).toEqual({ userId: studentId, sessionId: res.conversationId });
    expect(res.citations[0]?.lessonId).toBe("lesson-05-consistency");
    expect(res.citations[0]?.snippet).toContain("LOCAL_QUORUM ensures strong consistency");
    expect(res.toolInvocations.map((call) => call.name)).toEqual([
      "get_course_details",
      "search_course_materials",
    ]);
  });

  it("integration-only provider consumes real tool output and leaves citations to the normal allowlist", async () => {
    const mockRepo = createMockRepo();
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: new IntegrationOnlyAssistantLlmProvider(),
    });

    const response = await orchestrator.chat(
      { userId: randomUUID(), role: "STUDENT" },
      {
        mode: "STUDY_BUDDY",
        courseId,
        message: "Mastery của tôi thế nào, kế hoạch học gì tiếp và giải thích phần tài liệu quorum?",
      },
    );

    expect(response.toolInvocations.map((tool) => tool.name)).toEqual([
      "get_course_details",
      "get_student_mastery",
      "get_recommended_learning_path",
      "search_course_materials",
    ]);
    expect(response.content).toContain("Kiểm thử tích hợp");
    expect(response.content).toContain("LOCAL_QUORUM ensures strong consistency");
    expect(response.content).toContain("score 45");
    expect(response.citations).toHaveLength(1);
    expect(response.citations[0]?.sourceObjectId).toBe("a".repeat(64));
    expect(mockRepo.messages.get(response.conversationId)?.at(-1)?.citations).toEqual(response.citations);
  });

  it("does not persist a successful assistant answer or citations when the provider fails", async () => {
    const mockRepo = createMockRepo();
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: {
        generate: () =>
          Promise.reject(
            new AppError(
              "AI_PROVIDER_INVALID_RESPONSE",
              503,
              "The assistant service is temporarily unavailable",
              true,
            ),
          ),
      },
    });

    await expect(
      orchestrator.chat(
        { userId: randomUUID(), role: "STUDENT" },
        {
          mode: "STUDY_BUDDY",
          courseId,
          message: "Giải thích tài liệu về tính nhất quán quorum",
        },
      ),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_RESPONSE", status: 503, retryable: true });

    const persisted = [...mockRepo.messages.values()];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toHaveLength(1);
    expect(persisted[0]?.[0]?.sender).toBe("USER");
    expect(persisted[0]?.[0]?.citations).toBeUndefined();
    expect(persisted[0]?.some((message) => message.sender === "ASSISTANT")).toBe(false);
  });

  it("Study Buddy detects knowledge gap inquiries and runs get_knowledge_gaps", async () => {
    const studentId = randomUUID();
    const mockRepo = createMockRepo();

    const mockLlm: AssistantLlmProvider = {
      generate: () =>
        Promise.resolve({
          content: "Bạn đang gặp khó khăn ở phần 'Sharding & Consistency' với độ chính xác 40%.",
        }),
    };

    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: mockLlm,
    });

    const res = await orchestrator.chat(
      { userId: studentId, role: "STUDENT" },
      {
        mode: "STUDY_BUDDY",
        courseId,
        message: "Cho mình xem các lỗ hổng kiến thức hiện tại của mình",
      },
    );

    expect(res.toolInvocations.map((call) => call.name)).toEqual([
      "get_course_details",
      "get_knowledge_gaps",
    ]);
    expect(mockRepo.toolLogs.at(-1)?.toolName).toBe("get_knowledge_gaps");
  });

  it("Study Buddy retrieves persisted mastery and Study Plan through registered tools", async () => {
    const mockRepo = createMockRepo();
    let groundingContext = "";
    const boundedDomainClient: AssistantDomainClient = {
      ...domainClient,
      getStudentMastery: () =>
        Promise.resolve(
          Array.from({ length: 14 }, (_, index) => ({
            studentId: "private-student-id",
            tenantId: "private-tenant-id",
            conceptId: `concept-${String(index)}`,
            learningOutcomeId: `outcome-${String(index)}`,
            masteryScore: 50 + index,
            masteryState: "DEVELOPING",
            confidenceScore: 70,
            evidenceCount: 2,
            evidenceIds: ["private-evidence-id"],
            explanation: { whyState: "Two recent evidence items", nextSteps: "Review the topic" },
          })),
        ),
      getRecommendedLearningPath: () =>
        Promise.resolve({
          planId: "private-plan-id",
          studentId: "private-student-id",
          tenantId: "private-tenant-id",
          courseId,
          overallMasteryPercent: 62,
          weekStartDate: "2026-09-21",
          items: Array.from({ length: 10 }, (_, index) => ({
            itemId: `private-item-${String(index)}`,
            title: `Review topic ${String(index)}`,
            description: "Practice one concept",
            action: "REVIEW_CONCEPT",
            status: "PENDING",
            scheduledDate: "2026-09-24",
            estimatedMinutes: 15,
            priority: 2,
            rationale: "The current mastery record shows room to improve",
          })),
          masteryGaps: [],
          upcomingAssessments: [],
        }),
    };
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(boundedDomainClient),
      domainClient: boundedDomainClient,
      llmProvider: {
        generate: (request) => {
          groundingContext =
            request.messages.find(
              (message) =>
                message.role === "system" && message.content.startsWith("Authoritative tool results"),
            )?.content ?? "";
          return Promise.resolve({ content: "Grounded response" });
        },
      },
    });
    const res = await orchestrator.chat(
      { userId: randomUUID(), role: "STUDENT" },
      { mode: "STUDY_BUDDY", courseId, message: "Mastery của tôi thế nào và kế hoạch học gì tiếp?" },
    );
    expect(res.toolInvocations.map((call) => call.name)).toEqual([
      "get_course_details",
      "get_student_mastery",
      "get_recommended_learning_path",
    ]);
    expect(groundingContext).toContain('"omittedRecords":2');
    expect(groundingContext).toContain('"omittedItems":2');
    expect(groundingContext).not.toContain("private-student-id");
    expect(groundingContext).not.toContain("private-tenant-id");
    expect(groundingContext).not.toContain("private-evidence-id");
    expect(groundingContext).not.toContain("private-plan-id");
  });

  it("keeps the larger non-Student output budget for non-Study Buddy modes", async () => {
    const mockRepo = createMockRepo();
    const llmRequests: number[] = [];
    const advisorDomainClient: AssistantDomainClient = {
      ...domainClient,
      searchCourses: () =>
        Promise.resolve([
          {
            courseId,
            title: "Cassandra for Data Engineers",
            description: "",
            priceAmount: 0,
            priceCurrency: "VND",
            level: "UNSPECIFIED",
          },
        ]),
    };
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(advisorDomainClient),
      domainClient: advisorDomainClient,
      llmProvider: {
        generate: (request) => {
          llmRequests.push(request.maxTokens ?? 0);
          return Promise.resolve({ content: "Advisor response" });
        },
      },
    });
    await orchestrator.chat(
      { userId: randomUUID(), role: "STUDENT" },
      { mode: "STUDENT_ADVISOR", message: "Tôi đang tìm khóa học về Cassandra." },
    );
    expect(llmRequests).toEqual([2048]);
  });

  it("fails closed when Study Buddy returns model self-evaluation instead of a learner answer", async () => {
    const mockRepo = createMockRepo();
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: {
        generate: () =>
          Promise.resolve({
            content:
              "The draft is around 140 words. Perfect. Concise, encouraging, has a clear citation, and one actionable next step",
          }),
      },
    });
    await expect(
      orchestrator.chat(
        { userId: randomUUID(), role: "STUDENT" },
        { mode: "STUDY_BUDDY", courseId, message: "Giải thích một khái niệm trong bài học" },
      ),
    ).rejects.toMatchObject({ code: "ASSISTANT_RESPONSE_NOT_STUDENT_FACING", status: 503 });
  });

  it("does not synthesize a student-facing reply when the model returns empty content", async () => {
    const mockRepo = createMockRepo();
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: { generate: () => Promise.resolve({ content: "  \n " }) },
    });
    await expect(
      orchestrator.chat(
        { userId: randomUUID(), role: "STUDENT" },
        { mode: "STUDY_BUDDY", courseId, message: "Giải thích một khái niệm trong bài học" },
      ),
    ).rejects.toMatchObject({ code: "ASSISTANT_RESPONSE_EMPTY", status: 503, retryable: true });
    expect([...mockRepo.messages.values()].flat().some((message) => message.sender === "ASSISTANT")).toBe(
      false,
    );
  });

  it("allows lecturer copilot with only public and conceptual tools", async () => {
    const lecturerId = randomUUID();
    const mockRepo = createMockRepo();

    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: {
        generate: (request) => {
          expect(request.availableTools.map((tool) => tool.name)).toEqual([
            "search_courses",
            "get_course_details",
            "compare_courses",
            "explain_concept",
          ]);
          expect(request.systemPrompt).toContain("no access to live cohort scores");
          return Promise.resolve({ content: "Gợi ý chia bài thành ba phần." });
        },
      },
    });
    const response = await orchestrator.chat(
      { userId: lecturerId, role: "LECTURER" },
      { mode: "LECTURER_COPILOT", message: "Hãy giúp tôi thiết kế khung chương trình" },
    );
    expect(response.mode).toBe("LECTURER_COPILOT");
    expect(response.content).toBe("Gợi ý chia bài thành ba phần.");
    expect(mockRepo.conversations.get(response.conversationId)?.role).toBe("LECTURER");
  });

  it("keeps admin support separate from learner conversations and course data", async () => {
    const mockRepo = createMockRepo();
    const studentId = randomUUID();
    const adminId = randomUUID();
    const studentConversationId = randomUUID();
    mockRepo.conversations.set(studentConversationId, {
      conversationId: studentConversationId,
      userId: studentId,
      role: "STUDENT",
      mode: "STUDY_BUDDY",
      courseId,
      title: "Bài học",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: {
        generate: (request) => {
          expect(request.availableTools).toEqual([]);
          expect(request.systemPrompt).toContain("no access to live user records");
          return Promise.resolve({ content: "Xem thống kê trong bảng điều khiển." });
        },
      },
    });

    await expect(
      orchestrator.chat({ userId: adminId, role: "ADMIN" }, { mode: "STUDY_BUDDY", message: "Hỏi bài" }),
    ).rejects.toMatchObject({ code: "ASSISTANT_MODE_NOT_ALLOWED", status: 403 });
    await expect(
      orchestrator.chat(
        { userId: adminId, role: "ADMIN" },
        { mode: "ADMIN_SUPPORT", courseId, message: "Xem khóa học" },
      ),
    ).rejects.toMatchObject({ code: "ASSISTANT_COURSE_NOT_ALLOWED", status: 403 });
    await expect(
      orchestrator.chat(
        { userId: adminId, role: "ADMIN" },
        { mode: "ADMIN_SUPPORT", conversationId: studentConversationId, message: "Xem đoạn chat" },
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_ACCESS_DENIED", status: 403 });
    const response = await orchestrator.chat(
      { userId: adminId, role: "ADMIN" },
      { mode: "ADMIN_SUPPORT", message: "Xem thống kê AI ở đâu?" },
    );
    expect(response.mode).toBe("ADMIN_SUPPORT");
    expect(response.toolInvocations).toEqual([]);
  });

  it("rejects a conversation from the same account after its role changes", async () => {
    const mockRepo = createMockRepo();
    const userId = randomUUID();
    const conversationId = randomUUID();
    mockRepo.conversations.set(conversationId, {
      conversationId,
      userId,
      role: "STUDENT",
      mode: "STUDY_BUDDY",
      title: "Bài học",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: { generate: () => Promise.resolve({ content: "unused" }) },
    });
    await expect(
      orchestrator.chat(
        { userId, role: "ADMIN" },
        { mode: "ADMIN_SUPPORT", conversationId, message: "Xem lại" },
      ),
    ).rejects.toMatchObject({ code: "CONVERSATION_ACCESS_DENIED", status: 403 });
  });

  it("rejects unauthorized mode for role with 403 AppError", async () => {
    const studentId = randomUUID();
    const mockRepo = createMockRepo();

    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: { generate: () => Promise.resolve({ content: "" }) },
    });

    await expect(
      orchestrator.chat(
        { userId: studentId, role: "STUDENT" },
        {
          mode: "LECTURER_COPILOT", // Forbidden for STUDENT
          message: "Soạn đề cương",
        },
      ),
    ).rejects.toMatchObject({
      code: "ASSISTANT_MODE_NOT_ALLOWED",
      status: 403,
    });
  });
});
