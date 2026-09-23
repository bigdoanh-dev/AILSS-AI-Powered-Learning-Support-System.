import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { AssistantLlmProvider, LlmCompletionRequest, LlmMessage } from "./llm-provider.js";
import type {
  AssistantMode,
  AssistantRole,
  ChatRequest,
  ChatResponse,
  Citation,
  ConversationMessage,
  ToolCall,
  ToolResult,
} from "./model.js";
import type { AssistantRepository } from "./repository.js";
import { isModeAllowedForRole, ROLE_ALLOWED_TOOLS } from "./roles.js";
import { ASSISTANT_TOOLS } from "./tool-registry.js";
import type { ToolRunner, AssistantDomainClient } from "./tool-runner.js";
import { enforceCitationAllowlist } from "./citation-policy.js";
import { extractCatalogSearchTokens } from "./domain-client.js";

import { LearnerSafetyPolicyEngine } from "../safety/index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactGroundingToolResult(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { name, result, error } = value;
  if (name === "get_student_mastery" && Array.isArray(result)) {
    const records = result
      .slice(0, 12)
      .filter(isRecord)
      .map((record) => ({
        conceptId: record.conceptId,
        learningOutcomeId: record.learningOutcomeId,
        masteryScore: record.masteryScore,
        masteryState: record.masteryState,
        confidenceScore: record.confidenceScore,
        evidenceCount: record.evidenceCount,
        explanation: isRecord(record.explanation)
          ? {
              whyState: record.explanation.whyState,
              nextSteps: record.explanation.nextSteps,
            }
          : undefined,
      }));
    return {
      name,
      result: records,
      omittedRecords: Math.max(0, result.length - records.length),
      ...(error ? { error } : {}),
    };
  }
  if (name === "get_recommended_learning_path" && isRecord(result)) {
    const items = Array.isArray(result.items) ? result.items.filter(isRecord) : [];
    const gaps = Array.isArray(result.masteryGaps) ? result.masteryGaps.filter(isRecord) : [];
    const assessments = Array.isArray(result.upcomingAssessments)
      ? result.upcomingAssessments.filter(isRecord)
      : [];
    return {
      name,
      result: {
        overallMasteryPercent: result.overallMasteryPercent,
        weekStartDate: result.weekStartDate,
        items: items.slice(0, 8).map((item) => ({
          title: item.title,
          description: item.description,
          action: item.action,
          status: item.status,
          scheduledDate: item.scheduledDate,
          estimatedMinutes: item.estimatedMinutes,
          priority: item.priority,
          rationale: item.rationale,
        })),
        omittedItems: Math.max(0, items.length - 8),
        masteryGaps: gaps.slice(0, 8).map((gap) => ({
          conceptName: gap.conceptName,
          currentScore: gap.currentScore,
          targetScore: gap.targetScore,
        })),
        upcomingAssessments: assessments.slice(0, 5).map((assessment) => ({
          title: assessment.title,
          dueDate: assessment.dueDate,
        })),
      },
      ...(error ? { error } : {}),
    };
  }
  if (name === "search_course_materials" && Array.isArray(result)) {
    return {
      name,
      result: result
        .slice(0, 5)
        .filter(isRecord)
        .map((material) => ({
          title: material.title,
          sectionTitle: material.sectionTitle,
          contentSnippet:
            typeof material.contentSnippet === "string" ? material.contentSnippet.slice(0, 1600) : "",
        })),
      omittedRecords: Math.max(0, result.length - 5),
      ...(error ? { error } : {}),
    };
  }
  return value;
}

function isTutorMetaCommentary(content: string): boolean {
  const firstLine = content.trim().split(/\r?\n/u, 1)[0] ?? "";
  return (
    /^(?:the )?draft is around \d{1,4} words\b/iu.test(firstLine) ||
    /^(?:perfect|great)[.!]?\s+(?:concise|encouraging|has a clear citation|one actionable next step)\b/iu.test(
      firstLine,
    ) ||
    /^this (?:answer|response) (?:is|will be) (?:concise|encouraging|around \d{1,4} words)\b/iu.test(
      firstLine,
    )
  );
}

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
      request.mode,
      recentHistory,
      userMsgId,
      user,
      request.courseId,
      conversationId,
      allowedToolNames,
    );

    const materialResult = toolResults.find((result) => result.name === "search_course_materials");
    if (
      materialResult?.error ||
      (materialResult && Array.isArray(materialResult.result) && materialResult.result.length === 0)
    ) {
      const content =
        materialResult.error === "RAG_TOOL_FORBIDDEN"
          ? "RAG_TOOL_FORBIDDEN: Bạn không có quyền truy cập tài liệu của khóa học này."
          : materialResult.error
            ? `${materialResult.error}: Tài liệu khóa học hiện không khả dụng; tôi không thể coi đây là kết quả không tìm thấy.`
            : "INSUFFICIENT_EVIDENCE: Không tìm thấy đoạn tài liệu phù hợp, nên tôi chưa thể trả lời câu hỏi này như một kết luận đã được kiểm chứng.";
      const messageId = randomUUID();
      await this.#repo.appendMessage({
        messageId,
        conversationId,
        sender: "ASSISTANT",
        content,
        ...(toolCalls.length ? { toolCalls } : {}),
        now: this.#now(),
      });
      return {
        conversationId,
        messageId,
        content,
        toolInvocations: toolCalls,
        citations: [],
        mode: request.mode,
        safetyBlocked: false,
      };
    }

    if (request.mode === "STUDENT_ADVISOR") {
      const catalogResult = toolResults.find(
        (result) => isRecord(result) && result.name === "search_courses",
      ) as { result?: unknown; error?: string } | undefined;
      let content: string | undefined;
      if (!catalogResult) {
        content =
          "Bạn muốn học để đạt mục tiêu gì và hiện đã biết những gì? Mình sẽ hỏi tiếp về thời gian và ngân sách trước khi tìm khóa học phù hợp.";
      } else if (catalogResult.error) {
        content =
          "Danh mục khóa học đang tạm thời không khả dụng. Mình chưa thể xác nhận khóa học nào đang được bán; bạn có thể thử lại sau.";
      } else if (!Array.isArray(catalogResult.result) || catalogResult.result.length === 0) {
        content =
          "Mình chưa tìm thấy khóa học đã xuất bản khớp chủ đề bạn quan tâm. Bạn có thể mô tả mục tiêu học hoặc dùng tên lĩnh vực khác để mình tìm lại không?";
      }
      if (content) {
        const messageId = randomUUID();
        await this.#repo.appendMessage({
          messageId,
          conversationId,
          sender: "ASSISTANT",
          content,
          ...(toolCalls.length ? { toolCalls } : {}),
          now: this.#now(),
        });
        return {
          conversationId,
          messageId,
          content,
          toolInvocations: toolCalls,
          citations: [],
          mode: request.mode,
          safetyBlocked: false,
        };
      }
    }

    // Expose only verified public catalog fields to the client so it can link to
    // the actual course. This is a title match, not a claim of personal fit.
    const catalogResult =
      request.mode === "STUDENT_ADVISOR"
        ? toolResults.find((result) => isRecord(result) && result.name === "search_courses")
        : undefined;
    const catalogCourses =
      isRecord(catalogResult) && !catalogResult.error && Array.isArray(catalogResult.result)
        ? catalogResult.result
            .filter(
              (course): course is Record<string, unknown> =>
                isRecord(course) &&
                typeof course.courseId === "string" &&
                typeof course.title === "string" &&
                typeof course.priceAmount === "number" &&
                Number.isFinite(course.priceAmount) &&
                course.priceAmount >= 0 &&
                typeof course.priceCurrency === "string",
            )
            .slice(0, 3)
            .map((course) => ({
              courseId: course.courseId as string,
              title: course.title as string,
              priceAmount: course.priceAmount as number,
              priceCurrency: course.priceCurrency as string,
            }))
        : [];

    // 8. Prepare Messages for LLM
    const llmMessages: LlmMessage[] = recentHistory.map((m) => ({
      role: m.sender === "USER" ? "user" : m.sender === "ASSISTANT" ? "assistant" : "system",
      content: m.content,
    }));

    // If tools were executed, add tool context to conversation
    if (toolResults.length > 0) {
      llmMessages.push({
        role: "system",
        content: `Authoritative tool results for grounding. If a result is empty or failed, state that evidence is insufficient and do not invent data. Lists may be intentionally bounded; never infer omitted records:\n${JSON.stringify(toolResults.map(compactGroundingToolResult))}`,
      });
    }

    const completionReq: LlmCompletionRequest = {
      systemPrompt,
      messages: llmMessages,
      availableTools,
      integrationContext: { mode: request.mode, toolResults },
      temperature: 0.2,
      // Student-facing chat should return promptly; this is ample for a concise grounded answer.
      maxTokens: request.mode === "STUDY_BUDDY" ? 768 : 2048,
    };

    const completion = await this.#llmProvider.generate(completionReq);
    const assistantContent = completion.content.trim();
    if (!assistantContent) {
      throw new AppError(
        "ASSISTANT_RESPONSE_EMPTY",
        503,
        "The Tutor could not produce a usable learner-facing response",
        true,
      );
    }
    if (request.mode === "STUDY_BUDDY" && isTutorMetaCommentary(assistantContent)) {
      throw new AppError(
        "ASSISTANT_RESPONSE_NOT_STUDENT_FACING",
        503,
        "The Tutor could not produce a usable learner-facing response",
        true,
      );
    }
    const materialRecords =
      materialResult && Array.isArray(materialResult.result) ? materialResult.result : [];
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
      ...(catalogCourses.length > 0 ? { catalogCourses } : {}),
    };
  }

  async #inspectIntentAndExecuteTools(
    prompt: string,
    mode: AssistantMode,
    recentHistory: readonly ConversationMessage[],
    currentMessageId: string,
    user: { readonly userId: string; readonly role: AssistantRole },
    courseId: string | undefined,
    conversationId: string,
    allowedTools: readonly string[],
  ): Promise<{ toolCalls: ToolCall[]; toolResults: ToolResult[]; citations: Citation[] }> {
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    const citations: Citation[] = [];
    const lower = prompt.toLowerCase();
    const execute = async (toolName: string, args: Record<string, unknown>) => {
      const callId = randomUUID();
      const start = Date.now();
      const result = await this.#toolRunner.executeTool(callId, toolName, args, user);
      toolCalls.push({ id: callId, name: toolName, arguments: args });
      toolResults.push(result);
      await this.#repo.logToolInvocation({
        conversationId,
        invocationId: callId,
        userId: user.userId,
        toolName,
        status: result.error ? "FAILED" : "SUCCESS",
        executionTimeMs: Date.now() - start,
        ...(result.error ? { errorCode: result.error } : {}),
        now: this.#now(),
      });
    };

    if (
      allowedTools.includes("get_student_mastery") &&
      courseId &&
      (lower.includes("mastery") || lower.includes("mức độ thành thạo") || lower.includes("đang yếu"))
    ) {
      await execute("get_student_mastery", { courseId });
    }

    if (
      allowedTools.includes("get_recommended_learning_path") &&
      courseId &&
      (lower.includes("study plan") || lower.includes("kế hoạch học") || lower.includes("học gì tiếp"))
    ) {
      await execute("get_recommended_learning_path", { courseId });
    }

    // In advisor mode, a later answer about time or experience still searches the
    // most recent subject named by this user in this conversation.
    const currentTopic = extractCatalogSearchTokens(prompt);
    const earlierTopic = recentHistory
      .filter((message) => message.sender === "USER" && message.messageId !== currentMessageId)
      .reverse()
      .find((message) => extractCatalogSearchTokens(message.content).length > 0)?.content;
    const advisorQuery = currentTopic.length > 0 ? prompt : earlierTopic;
    if (
      allowedTools.includes("search_courses") &&
      ((mode === "STUDENT_ADVISOR" && advisorQuery) ||
        (mode !== "STUDENT_ADVISOR" &&
          (lower.includes("tìm khóa học") ||
            lower.includes("khóa học nào") ||
            lower.includes("recommend") ||
            lower.includes("gợi ý khóa"))))
    ) {
      await execute("search_courses", {
        query: (mode === "STUDENT_ADVISOR" ? advisorQuery : prompt)?.slice(0, 300),
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
      toolCalls.push({
        id: callId,
        name: "search_course_materials",
        arguments: { courseId, topic: prompt.slice(0, 40) },
      });
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
        for (const item of result.result as Array<{
          lessonId: string;
          title: string;
          contentSnippet: string;
          sourceObjectId: string;
          retrievalScore: number;
          courseId?: string;
          courseVersion?: number;
          lessonVersion?: number;
        }>) {
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
4. The public course catalog currently confirms only title, price and currency. Do not claim a verified level, instructor, syllabus or prerequisites unless a separate authoritative result provides them.
5. Use the conversation's earlier subject and the student's latest background, time and budget when comparing catalog results. If facts are missing, ask a short follow-up question. Provide balanced comparisons if multiple options exist.`;
    }

    if (mode === "STUDY_BUDDY") {
      return `${base}
Your mission:
1. Act as a patient Socratic tutor.
2. Ground all explanations strictly in course materials and lessons.
3. NEVER provide direct answers to active exams or quizzes. Guide the student with questions and conceptual hints.
4. Include lesson citations whenever referencing specific curriculum points.
5. Keep the response concise (normally under 150 words); prioritize one clear explanation and one actionable next step.
6. Return only the final message addressed to the learner. Never include draft notes, self-evaluation, word counts, tone assessments, or comments about whether your response meets these instructions.`;
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
