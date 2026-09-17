import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AssistantOrchestrator,
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
          lessonId: "lesson-05-consistency",
          title: "Quorum and Tunable Consistency",
          contentSnippet: `In ScyllaDB/Cassandra, LOCAL_QUORUM ensures strong consistency within a datacenter when R + W > N. Topic: ${topic}`,
        },
      ]),
    generateQuizDraft: () => Promise.resolve({}),
    diagnoseCohortGaps: () => Promise.resolve({}),
    hasActiveAssessmentAttempt: () => Promise.resolve(false),
  };

  it("Study Buddy executes search_course_materials and returns verified lesson citations", async () => {
    const studentId = randomUUID();
    const mockRepo = createMockRepo();

    const mockLlm: AssistantLlmProvider = {
      generate: (req) => {
        expect(req.systemPrompt).toContain("Socratic tutor");
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
    expect(res.citations[0]?.lessonId).toBe("lesson-05-consistency");
    expect(res.citations[0]?.snippet).toContain("LOCAL_QUORUM ensures strong consistency");
    expect(res.toolInvocations).toHaveLength(1);
    expect(res.toolInvocations[0]?.name).toBe("search_course_materials");
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

    expect(res.toolInvocations).toHaveLength(1);
    expect(res.toolInvocations[0]?.name).toBe("get_knowledge_gaps");
    expect(mockRepo.toolLogs[0]?.toolName).toBe("get_knowledge_gaps");
  });

  it("Lecturer Copilot accepts LECTURER_COPILOT mode and enforces curriculum design instructions", async () => {
    const lecturerId = randomUUID();
    const mockRepo = createMockRepo();

    const mockLlm: AssistantLlmProvider = {
      generate: (req) => {
        expect(req.systemPrompt).toContain("academic curriculum design expert");
        expect(req.systemPrompt).toContain("Bloom's cognitive taxonomy");
        return Promise.resolve({
          content: "Dưới đây là đề xuất khung chương trình 4 tuần theo chuẩn Bloom.",
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
      { userId: lecturerId, role: "LECTURER" },
      {
        mode: "LECTURER_COPILOT",
        message: "Hãy giúp tôi thiết kế khung chương trình môn Kiến trúc Microservices",
      },
    );

    expect(res.mode).toBe("LECTURER_COPILOT");
    expect(res.content).toContain("chuẩn Bloom");
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
