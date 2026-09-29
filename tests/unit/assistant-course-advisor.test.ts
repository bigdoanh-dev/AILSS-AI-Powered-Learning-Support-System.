import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AssistantOrchestrator,
  type AssistantDomainClient,
  type AssistantLlmProvider,
  type AssistantRepository,
  type ConversationMessage,
  type ConversationSummary,
  type CourseCatalogItem,
  ToolRunner,
  type CreateConversationInput,
  type AppendMessageInput,
  type LogToolInvocationInput,
} from "../../apps/ai-service/src/assistant/index.js";

const COURSE_1_ID = randomUUID();
const COURSE_2_ID = randomUUID();

describe("Phase 17 — Student Course Advisor & Grounded Recommendations", () => {
  const mockCatalogCourses: readonly CourseCatalogItem[] = [
    {
      courseId: COURSE_1_ID,
      title: "Cơ sở dữ liệu nâng cao",
      description: "Chuyên sâu về phân tán, ScyllaDB, Cassandra và tối ưu truy vấn",
      priceAmount: 890000,
      priceCurrency: "VND",
      level: "ADVANCED",
      syllabusOutline: ["Chương 1: Kiến trúc phân tán", "Chương 2: ScyllaDB Internals"],
      instructorName: "TS. Nguyễn Văn A",
    },
    {
      courseId: COURSE_2_ID,
      title: "Nhập môn Lập trình Web",
      description: "Học HTML, CSS, React và Node.js từ cơ bản",
      priceAmount: 450000,
      priceCurrency: "VND",
      level: "BEGINNER",
      syllabusOutline: ["Chương 1: HTML & CSS", "Chương 2: JavaScript cơ bản"],
      instructorName: "ThS. Trần Thị B",
    },
  ];

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
      logToolInvocation: (input: LogToolInvocationInput) => {
        toolLogs.push(input);
        return Promise.resolve();
      },
    } as unknown as AssistantRepository;

    return { repo, conversations, messages, toolLogs };
  }

  it("queries real course catalog and includes live tool results when student asks for recommendations", async () => {
    const studentId = randomUUID();
    const mockRepo = createMockRepo();

    let searchCalled = false;
    const domainClient: AssistantDomainClient = {
      searchCourses: (_q, _lvl, _max) => {
        searchCalled = true;
        return Promise.resolve(mockCatalogCourses);
      },
      getCourseDetails: (id) => Promise.resolve(mockCatalogCourses.find((c) => c.courseId === id) ?? null),
      compareCourses: (ids) => Promise.resolve(mockCatalogCourses.filter((c) => ids.includes(c.courseId))),
      getKnowledgeGaps: () => Promise.resolve([]),
      searchCourseMaterials: () => Promise.resolve([]),
      generateQuizDraft: () => Promise.resolve({}),
      diagnoseCohortGaps: () => Promise.resolve({}),
      hasActiveAssessmentAttempt: () => Promise.resolve(false),
    };

    const mockLlm: AssistantLlmProvider = {
      generate: (req) => {
        // Assert that tool execution results were fed into LLM system prompt context
        const hasToolContext = req.messages.some(
          (m) => m.role === "system" && m.content.includes("search_courses"),
        );
        expect(hasToolContext).toBe(true);

        return Promise.resolve({
          content: "Khóa 'Cơ sở dữ liệu nâng cao' hiện có trong danh mục với giá 890.000 VND.",
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
        mode: "STUDENT_ADVISOR",
        message: "Hãy gợi ý khóa học Cassandra cho tôi với",
      },
    );

    expect(searchCalled).toBe(true);
    expect(res.toolInvocations).toHaveLength(1);
    expect(res.toolInvocations[0]?.name).toBe("search_courses");
    expect(res.catalogCourses).toEqual(
      mockCatalogCourses.map(({ courseId, title, priceAmount, priceCurrency }) => ({
        courseId,
        title,
        priceAmount,
        priceCurrency,
      })),
    );
    expect(res.catalogCourses?.[0]).not.toHaveProperty("instructorName");
    expect(res.catalogCourses?.[0]).not.toHaveProperty("level");
    expect(mockRepo.toolLogs).toHaveLength(1);
    expect(mockRepo.toolLogs[0]?.toolName).toBe("search_courses");
    expect(mockRepo.toolLogs[0]?.status).toBe("SUCCESS");
  });

  it("asks about goals before searching, then reuses the chosen subject after a qualification answer", async () => {
    const mockRepo = createMockRepo();
    const queries: string[] = [];
    const domainClient: AssistantDomainClient = {
      searchCourses: (query) => {
        queries.push(query ?? "");
        return Promise.resolve(mockCatalogCourses.slice(0, 1));
      },
      getCourseDetails: () => Promise.resolve(null),
      compareCourses: () => Promise.resolve([]),
      getKnowledgeGaps: () => Promise.resolve([]),
      searchCourseMaterials: () => Promise.resolve([]),
      generateQuizDraft: () => Promise.resolve({}),
      diagnoseCohortGaps: () => Promise.resolve({}),
      hasActiveAssessmentAttempt: () => Promise.resolve(false),
    };
    let completionCount = 0;
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: {
        generate: () => {
          completionCount += 1;
          return Promise.resolve({ content: "Tôi đã kiểm tra khóa học Cassandra đang được xuất bản." });
        },
      },
    });
    const student = { userId: randomUUID(), role: "STUDENT" as const };
    const greeting = await orchestrator.chat(student, {
      mode: "STUDENT_ADVISOR",
      message: "Tôi không biết chọn khóa học nào",
    });
    expect(greeting.content).toContain("Bạn muốn học để đạt mục tiêu gì");
    expect(greeting.toolInvocations).toHaveLength(0);
    expect(greeting.catalogCourses).toBeUndefined();
    expect(queries).toEqual([]);

    const mobilePrompt = await orchestrator.chat(student, {
      mode: "STUDENT_ADVISOR",
      message: "Tìm khóa học phù hợp với người mới bắt đầu",
    });
    expect(mobilePrompt.content).toContain("Bạn muốn học để đạt mục tiêu gì");
    expect(mobilePrompt.toolInvocations).toHaveLength(0);
    expect(queries).toEqual([]);

    const topic = await orchestrator.chat(student, {
      mode: "STUDENT_ADVISOR",
      conversationId: greeting.conversationId,
      message: "Tôi muốn học Cassandra",
    });
    expect(topic.toolInvocations.map((call) => call.name)).toEqual(["search_courses"]);

    const availability = await orchestrator.chat(student, {
      mode: "STUDENT_ADVISOR",
      conversationId: greeting.conversationId,
      message: "Tôi chỉ rảnh buổi tối",
    });
    expect(availability.toolInvocations.map((call) => call.name)).toEqual(["search_courses"]);

    const qualification = await orchestrator.chat(student, {
      mode: "STUDENT_ADVISOR",
      conversationId: greeting.conversationId,
      message: "Em mới bắt đầu, mỗi tuần học 4 giờ",
    });
    expect(qualification.toolInvocations.map((call) => call.name)).toEqual(["search_courses"]);
    const budget = await orchestrator.chat(student, {
      mode: "STUDENT_ADVISOR",
      conversationId: greeting.conversationId,
      message: "Ngân sách dưới 500 nghìn",
    });
    expect(budget.toolInvocations.map((call) => call.name)).toEqual(["search_courses"]);
    expect(queries).toEqual(Array.from({ length: 4 }, () => "Tôi muốn học Cassandra"));
    expect(completionCount).toBe(4);
  });

  it("does not invent a course when the live catalog is empty or unavailable", async () => {
    const mockRepo = createMockRepo();
    const domainClient: AssistantDomainClient = {
      searchCourses: () => Promise.resolve([]),
      getCourseDetails: () => Promise.resolve(null),
      compareCourses: () => Promise.resolve([]),
      getKnowledgeGaps: () => Promise.resolve([]),
      searchCourseMaterials: () => Promise.resolve([]),
      generateQuizDraft: () => Promise.resolve({}),
      diagnoseCohortGaps: () => Promise.resolve({}),
      hasActiveAssessmentAttempt: () => Promise.resolve(false),
    };
    let completionCount = 0;
    const orchestrator = new AssistantOrchestrator({
      repository: mockRepo.repo,
      toolRunner: new ToolRunner(domainClient),
      domainClient,
      llmProvider: {
        generate: () => {
          completionCount += 1;
          return Promise.resolve({ content: "fabricated offer" });
        },
      },
    });
    const student = { userId: randomUUID(), role: "STUDENT" as const };
    const empty = await orchestrator.chat(student, {
      mode: "STUDENT_ADVISOR",
      message: "Tôi muốn học Cassandra",
    });
    expect(empty.content).toContain("chưa thấy khóa học đã xuất bản");
    expect(completionCount).toBe(0);

    const failedClient: AssistantDomainClient = {
      ...domainClient,
      searchCourses: () => Promise.reject(new Error("CATALOG_UNAVAILABLE")),
    };
    const unavailableOrchestrator = new AssistantOrchestrator({
      repository: createMockRepo().repo,
      toolRunner: new ToolRunner(failedClient),
      domainClient: failedClient,
      llmProvider: {
        generate: () => {
          completionCount += 1;
          return Promise.resolve({ content: "fabricated offer" });
        },
      },
    });
    const unavailable = await unavailableOrchestrator.chat(student, {
      mode: "STUDENT_ADVISOR",
      message: "Tôi muốn học Cassandra",
    });
    expect(unavailable.content).toContain("tạm thời không khả dụng");
    expect(unavailable.toolInvocations).toHaveLength(1);
    expect(completionCount).toBe(0);
  });

  it("compares courses using live metadata via tool runner", async () => {
    const studentId = randomUUID();
    const domainClient: AssistantDomainClient = {
      searchCourses: () => Promise.resolve([]),
      getCourseDetails: (id) => Promise.resolve(mockCatalogCourses.find((c) => c.courseId === id) ?? null),
      compareCourses: (ids) => Promise.resolve(mockCatalogCourses.filter((c) => ids.includes(c.courseId))),
      getKnowledgeGaps: () => Promise.resolve([]),
      searchCourseMaterials: () => Promise.resolve([]),
      generateQuizDraft: () => Promise.resolve({}),
      diagnoseCohortGaps: () => Promise.resolve({}),
      hasActiveAssessmentAttempt: () => Promise.resolve(false),
    };

    const runner = new ToolRunner(domainClient);
    const comparison = await runner.executeTool(
      "cmp-1",
      "compare_courses",
      {
        courseIds: [COURSE_1_ID, COURSE_2_ID],
      },
      { userId: studentId, role: "STUDENT" },
    );

    expect(comparison.error).toBeUndefined();
    const courses = comparison.result as readonly CourseCatalogItem[];
    expect(courses).toHaveLength(2);
    expect(courses[0]?.title).toBe("Cơ sở dữ liệu nâng cao");
    expect(courses[1]?.title).toBe("Nhập môn Lập trình Web");
  });
});
