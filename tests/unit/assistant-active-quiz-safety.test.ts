import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AssistantOrchestrator,
  type AssistantDomainClient,
  type AssistantLlmProvider,
  type AssistantRepository,
  type ConversationMessage,
  type ConversationSummary,
  ToolRunner,
} from "../../apps/ai-service/src/assistant/index.js";

import type {
  CreateConversationInput,
  AppendMessageInput,
} from "../../apps/ai-service/src/assistant/repository.js";

describe("Phase 17 — Active Assessment Anti-Cheat Safety Guard", () => {
  function createMockRepo() {
    const conversations = new Map<string, ConversationSummary>();
    const messages = new Map<string, ConversationMessage[]>();

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
      listUserConversations: () => Promise.resolve([]),
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
      logToolInvocation: () => Promise.resolve(),
    } as unknown as AssistantRepository;

    return { repo, conversations, messages };
  }

  const mockLlm: AssistantLlmProvider = {
    generate: (req) =>
      Promise.resolve({
        content: `Grounded answer to: ${req.messages[req.messages.length - 1]?.content ?? ""}`,
      }),
  };

  it("blocks and refuses to assist when student has an IN_PROGRESS assessment and asks for answers", async () => {
    const studentId = randomUUID();
    const mockRepo = createMockRepo();

    const domainClient: AssistantDomainClient = {
      searchCourses: () => Promise.resolve([]),
      getCourseDetails: () => Promise.resolve(null),
      compareCourses: () => Promise.resolve([]),
      getKnowledgeGaps: () => Promise.resolve([]),
      searchCourseMaterials: () => Promise.resolve([]),
      generateQuizDraft: () => Promise.resolve({}),
      diagnoseCohortGaps: () => Promise.resolve({}),
      hasActiveAssessmentAttempt: (id) => Promise.resolve(id === studentId), // ACTIVE attempt!
    };

    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: mockLlm,
    });

    const response = await orchestrator.chat(
      { userId: studentId, role: "STUDENT" },
      {
        mode: "STUDY_BUDDY",
        message: "Cho mình xin đáp án câu hỏi trắc nghiệm số 3 trong quiz với",
      },
    );

    expect(response.safetyBlocked).toBe(true);
    expect(response.content).toContain("trung thực học thuật");
    expect(response.content).toContain("bài kiểm tra đang diễn ra");
  });

  it("allows normal study buddy assistance when student has no active assessment attempt", async () => {
    const studentId = randomUUID();
    const mockRepo = createMockRepo();

    const domainClient: AssistantDomainClient = {
      searchCourses: () => Promise.resolve([]),
      getCourseDetails: () => Promise.resolve(null),
      compareCourses: () => Promise.resolve([]),
      getKnowledgeGaps: () => Promise.resolve([]),
      searchCourseMaterials: () => Promise.resolve([]),
      generateQuizDraft: () => Promise.resolve({}),
      diagnoseCohortGaps: () => Promise.resolve({}),
      hasActiveAssessmentAttempt: () => Promise.resolve(false), // No active attempt
    };

    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: mockLlm,
    });

    const response = await orchestrator.chat(
      { userId: studentId, role: "STUDENT" },
      {
        mode: "STUDY_BUDDY",
        message: "Giải thích giúp mình khái niệm ACID trong cơ sở dữ liệu",
      },
    );

    expect(response.safetyBlocked).toBe(false);
    expect(response.content).toContain("ACID");
  });
});
