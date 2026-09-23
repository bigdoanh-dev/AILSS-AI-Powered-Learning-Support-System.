import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type {
  AssistantLlmProvider,
  LlmCompletionRequest,
  LlmMessage,
} from "./llm-provider.js";
import type {
  AssistantMode,
  AssistantRole,
  ChatRequest,
  ChatResponse,
  Citation,
  ToolCall,
} from "./model.js";
import type { AssistantRepository } from "./repository.js";
import { isModeAllowedForRole, ROLE_ALLOWED_TOOLS } from "./roles.js";
import { ASSISTANT_TOOLS } from "./tool-registry.js";
import type { ToolRunner, AssistantDomainClient } from "./tool-runner.js";
import { enforceCitationAllowlist } from "./citation-policy.js";

import { LearnerSafetyPolicyEngine } from "../safety/index.js";

export interface AssistantOrchestratorOptions {
  readonly repository: AssistantRepository;
  readonly toolRunner: ToolRunner;
  readonly domainClient: AssistantDomainClient;
  readonly llmProvider: AssistantLlmProvider;
  readonly safetyEngine?: LearnerSafetyPolicyEngine;
  readonly now?: () => Date;
}

export class AssistantOrchestrator {
  readonly #repo: AssistantRepository;
  readonly #toolRunner: ToolRunner;
  readonly #domainClient: AssistantDomainClient;
  readonly #llmProvider: AssistantLlmProvider;
  readonly #safetyEngine: LearnerSafetyPolicyEngine;
  readonly #now: () => Date;

  public constructor(options: AssistantOrchestratorOptions) {
    this.#repo = options.repository;
    this.#toolRunner = options.toolRunner;
    this.#domainClient = options.domainClient;
    this.#llmProvider = options.llmProvider;
    this.#safetyEngine = options.safetyEngine ?? new LearnerSafetyPolicyEngine();
    this.#now = options.now ?? (() => new Date());
  }

  public async chat(
    user: { readonly userId: string; readonly role: AssistantRole },
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const now = this.#now();

    // 1. Validate Mode Authorization
    if (!isModeAllowedForRole(user.role, request.mode)) {
      throw new AppError(
        "ASSISTANT_MODE_NOT_ALLOWED",
        403,
        `Role ${user.role} is not permitted to use mode ${request.mode}`,
      );
    }

    // 2. Comprehensive Learner Safety Policy Engine (Prompt injection, Anti-Cheat, Wellbeing)
    const hasActiveAssessment =
      user.role === "STUDENT" && request.mode === "STUDY_BUDDY"
        ? await this.#domainClient.hasActiveAssessmentAttempt(user.userId)
        : false;

    const safetyResult = this.#safetyEngine.evaluate(
      {
        userId: user.userId,
        role: user.role,
        mode: request.mode,
        message: request.message,
        ...(request.courseId ? { courseId: request.courseId } : {}),
        ...(request.conversationId ? { conversationId: request.conversationId } : {}),
        hasActiveAssessment,
      },
      now,
    );

    if (!safetyResult.allowed) {
      const convId = request.conversationId ?? randomUUID();
      return {
        conversationId: convId,
        messageId: randomUUID(),
        content:
          safetyResult.userSafeExplanation ??
          "Yêu cầu của bạn bị từ chối do vi phạm chính sách an toàn của AILSS.",
        toolInvocations: [],
        citations: [],
        mode: request.mode,
        safetyBlocked: true,
      };
    }

    // 3. Resolve or Create Conversation
    let conversationId = request.conversationId;
    if (!conversationId) {
      conversationId = randomUUID();
      const title = request.message.slice(0, 60).trim();
      await this.#repo.createConversation({
        conversationId,
        userId: user.userId,
        role: user.role,
        mode: request.mode,
        ...(request.courseId ? { courseId: request.courseId } : {}),
        title: title || "New Conversation",
        now,
      });
    } else {
      const existing = await this.#repo.getConversation(conversationId);
      if (existing && existing.userId !== user.userId && user.role !== "ADMIN") {
        throw new AppError("CONVERSATION_ACCESS_DENIED", 403, "Access to conversation denied");
      }
      await this.#repo.touchConversation(conversationId, user.userId, existing?.title ?? "Conversation", now);
    }

    // 4. Save User Message
    const userMsgId = randomUUID();
    await this.#repo.appendMessage({
      messageId: userMsgId,
      conversationId,
      sender: "USER",
      content: request.message,
      now,
    });

    // 5. Load History
    const recentHistory = await this.#repo.getRecentMessages(conversationId, request.historyLimit ?? 20);

    // 6. Build System Instructions & Available Tools
    const systemPrompt = this.#buildSystemPrompt(request.mode, user.role);
    const allowedToolNames = ROLE_ALLOWED_TOOLS[user.role];
    const availableTools = allowedToolNames
      .map((name) => ASSISTANT_TOOLS[name])
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));

    // 7. Conversational Intent & Tool Execution
    // Check if user prompt requires course catalog, knowledge gap or materials lookup
    const { toolCalls, toolResults, citations } = await this.#inspectIntentAndExecuteTools(
      request.message,
      user,
      request.courseId,
      conversationId,
      allowedToolNames,
    );

    const materialResult = toolResults.find((result) =>
      typeof result === "object" && result !== null && (result as { name?: unknown }).name === "search_course_materials",
    ) as { result?: unknown; error?: string } | undefined;
    if (materialResult?.error || (materialResult && Array.isArray(materialResult.result) && materialResult.result.length === 0)) {
      const content = materialResult.error === "RAG_TOOL_FORBIDDEN"
        ? "RAG_TOOL_FORBIDDEN: Bạn không có quyền truy cập tài liệu của khóa học này."
        : materialResult.error
          ? `${materialResult.error}: Tài liệu khóa học hiện không khả dụng; tôi không thể coi đây là kết quả không tìm thấy.`
          : "INSUFFICIENT_EVIDENCE: Không tìm thấy đoạn tài liệu phù hợp, nên tôi chưa thể trả lời câu hỏi này như một kết luận đã được kiểm chứng.";
      const messageId = randomUUID();
      await this.#repo.appendMessage({ messageId, conversationId, sender: "ASSISTANT", content, ...(toolCalls.length ? { toolCalls } : {}), now: this.#now() });
      return { conversationId, messageId, content, toolInvocations: toolCalls, citations: [], mode: request.mode, safetyBlocked: false };
    }

    // 8. Prepare Messages for LLM
    const llmMessages: LlmMessage[] = recentHistory.map((m) => ({
      role: m.sender === "USER" ? "user" : m.sender === "ASSISTANT" ? "assistant" : "system",
      content: m.content,
    }));

    // If tools were executed, add tool context to conversation
    if (toolResults.length > 0) {
      llmMessages.push({
        role: "system",
        content: `Authoritative tool results for grounding. If a result is empty or failed, state that evidence is insufficient and do not invent data:\n${JSON.stringify(toolResults)}`,
      });
    }

    const completionReq: LlmCompletionRequest = {
      systemPrompt,
      messages: llmMessages,
      availableTools,
      temperature: 0.2,
      maxTokens: 2048,
    };

    const completion = await this.#llmProvider.generate(completionReq);
    const assistantContent = completion.content || "Tôi đã nhận được yêu cầu của bạn và đã tra cứu thông tin.";
    const materialRecords = materialResult && Array.isArray(materialResult.result) ? materialResult.result : [];
    const acceptedCitations = enforceCitationAllowlist(citations, materialRecords);

    // 9. Persist Assistant Response
    const assistantMsgId = randomUUID();
    await this.#repo.appendMessage({
      messageId: assistantMsgId,
      conversationId,
      sender: "ASSISTANT",
      content: assistantContent,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(acceptedCitations.length > 0 ? { citations: acceptedCitations } : {}),
      now: this.#now(),
    });

    return {
      conversationId,
      messageId: assistantMsgId,
      content: assistantContent,
      toolInvocations: toolCalls,
      citations: acceptedCitations,
      mode: request.mode,
      safetyBlocked: false,
    };
  }

  async #inspectIntentAndExecuteTools(
    prompt: string,
    user: { readonly userId: string; readonly role: AssistantRole },
    courseId: string | undefined,
    conversationId: string,
    allowedTools: readonly string[],
  ): Promise<{ toolCalls: ToolCall[]; toolResults: unknown[]; citations: Citation[] }> {
    const toolCalls: ToolCall[] = [];
    const toolResults: unknown[] = [];
    const citations: Citation[] = [];
    const lower = prompt.toLowerCase();
    const execute = async (toolName: string, args: Record<string, unknown>) => {
      const callId = randomUUID();
      const start = Date.now();
      const result = await this.#toolRunner.executeTool(callId, toolName, args, user);
      toolCalls.push({ id: callId, name: toolName, arguments: args });
      toolResults.push(result);
      await this.#repo.logToolInvocation({
        conversationId, invocationId: callId, userId: user.userId, toolName,
        status: result.error ? "FAILED" : "SUCCESS", executionTimeMs: Date.now() - start,
        ...(result.error ? { errorCode: result.error } : {}), now: this.#now(),
      });
    };

    if (allowedTools.includes("get_student_mastery") && courseId &&
      (lower.includes("mastery") || lower.includes("mức độ thành thạo") || lower.includes("đang yếu"))) {
      await execute("get_student_mastery", { courseId });
    }

    if (allowedTools.includes("get_recommended_learning_path") && courseId &&
      (lower.includes("study plan") || lower.includes("kế hoạch học") || lower.includes("học gì tiếp"))) {
      await execute("get_recommended_learning_path", { courseId });
    }

    // Catalog search intent
    if (
      allowedTools.includes("search_courses") &&
      (lower.includes("tìm khóa học") || lower.includes("khóa học nào") || lower.includes("recommend") || lower.includes("gợi ý khóa"))
    ) {
      const callId = randomUUID();
      const start = Date.now();
      const result = await this.#toolRunner.executeTool(
        callId,
        "search_courses",
        { query: prompt.slice(0, 50) },
        user,
      );
      toolCalls.push({ id: callId, name: "search_courses", arguments: { query: prompt.slice(0, 50) } });
      toolResults.push(result);
      await this.#repo.logToolInvocation({
        conversationId,
        invocationId: callId,
        userId: user.userId,
        toolName: "search_courses",
        status: result.error ? "FAILED" : "SUCCESS",
        executionTimeMs: Date.now() - start,
        ...(result.error ? { errorCode: result.error } : {}),
        now: this.#now(),
      });
    }

    // Knowledge gaps intent
    if (
      allowedTools.includes("get_knowledge_gaps") &&
      (lower.includes("lỗ hổng") || lower.includes("kiến thức yếu") || lower.includes("knowledge gap"))
    ) {
      const callId = randomUUID();
      const start = Date.now();
      const result = await this.#toolRunner.executeTool(
        callId,
        "get_knowledge_gaps",
        courseId ? { courseId } : {},
        user,
      );
      toolCalls.push({ id: callId, name: "get_knowledge_gaps", arguments: courseId ? { courseId } : {} });
      toolResults.push(result);
      await this.#repo.logToolInvocation({
        conversationId,
        invocationId: callId,
        userId: user.userId,
        toolName: "get_knowledge_gaps",
        status: result.error ? "FAILED" : "SUCCESS",
        executionTimeMs: Date.now() - start,
        ...(result.error ? { errorCode: result.error } : {}),
        now: this.#now(),
      });
    }

    // Course materials study intent
    if (
      allowedTools.includes("search_course_materials") &&
      courseId &&
      (lower.includes("tài liệu") || lower.includes("bài học") || lower.includes("giải thích phần"))
    ) {
      const callId = randomUUID();
      const start = Date.now();
      const result = await this.#toolRunner.executeTool(
        callId,
        "search_course_materials",
        { courseId, topic: prompt.slice(0, 40) },
        user,
      );
      toolCalls.push({ id: callId, name: "search_course_materials", arguments: { courseId, topic: prompt.slice(0, 40) } });
      toolResults.push(result);
      await this.#repo.logToolInvocation({
        conversationId,
        invocationId: callId,
        userId: user.userId,
        toolName: "search_course_materials",
        status: result.error ? "FAILED" : "SUCCESS",
        executionTimeMs: Date.now() - start,
        ...(result.error ? { errorCode: result.error } : {}),
        now: this.#now(),
      });

      if (Array.isArray(result.result)) {
        for (const item of result.result as Array<{ lessonId: string; title: string; contentSnippet: string; sourceObjectId: string; retrievalScore: number; courseId?: string; courseVersion?: number; lessonVersion?: number }>) {
          if (item.courseId && item.courseId !== courseId) continue;
          citations.push({
            sourceId: item.lessonId,
            title: item.title,
            lessonId: item.lessonId,
            courseId,
            ...(item.courseVersion ? { courseVersion: item.courseVersion } : {}),
            ...(item.lessonVersion ? { lessonVersion: item.lessonVersion } : {}),
            sourceObjectId: item.sourceObjectId,
            retrievalScore: item.retrievalScore,
            snippet: item.contentSnippet,
          });
        }
      }
    }

    return { toolCalls, toolResults, citations };
  }

  #buildSystemPrompt(mode: AssistantMode, role: AssistantRole): string {
    const base = `You are AILSS Intelligent Assistant, an expert AI educational partner in the AILSS ecosystem. Role: ${role}. Mode: ${mode}.`;

    if (mode === "STUDENT_ADVISOR") {
      return `${base}
Your mission:
1. Act as an empathetic, pedagogical course advisor.
2. Ask clarifying questions about student's goals, prior background, budget, and available weekly time before recommending.
3. Only recommend courses returned by actual catalog tools. DO NOT hallucinate nonexistent courses, unrealistic discounts, or false instructor credentials.
4. Provide structured, balanced comparisons if multiple options exist.`;
    }

    if (mode === "STUDY_BUDDY") {
      return `${base}
Your mission:
1. Act as a patient Socratic tutor.
2. Ground all explanations strictly in course materials and lessons.
3. NEVER provide direct answers to active exams or quizzes. Guide the student with questions and conceptual hints.
4. Include lesson citations whenever referencing specific curriculum points.`;
    }

    if (mode === "LECTURER_COPILOT") {
      return `${base}
Your mission:
1. Act as an academic curriculum design expert.
2. Assist lecturers in structuring lesson modules, Bloom's cognitive taxonomy distribution (RECOGNITION, UNDERSTANDING, APPLICATION, ADVANCED_APPLICATION), and formative assessment drafting.
3. Analyze cohort performance trends and suggest concrete pedagogical interventions.`;
    }

    return base;
  }
}
