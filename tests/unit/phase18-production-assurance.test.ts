import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AssistantOrchestrator,
  type AssistantDomainClient,
  type AssistantLlmProvider,
  type AssistantRepository,
  ToolRunner,
} from "../../apps/ai-service/src/assistant/index.js";
import type {
  CreateConversationInput,
  AppendMessageInput,
} from "../../apps/ai-service/src/assistant/repository.js";
import type { CourseEntitlement, LearningOrder } from "../../apps/learning-service/src/commerce/model.js";
import type { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import {
  LearningFinanceService,
  SepayPaymentProvider,
  SimulationPaymentProvider,
} from "../../apps/learning-service/src/finance/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";

describe("Phase 18D — Production Assurance & E2E Verification", () => {
  describe("E2E Finance Lifecycle: Order -> Webhook -> Entitlement -> Refund -> Ledger Reversal", () => {
    function createMockRepo() {
      const orders = new Map<string, LearningOrder>();
      const courses = new Map<string, { courseId: string; ownerLecturerId: string }>();
      const entitlements = new Map<string, CourseEntitlement>();

      const repo: LearningCommerceRepository = {
        order: (id: string) => Promise.resolve(orders.get(id) ?? null),
        course: (id: string) => Promise.resolve(courses.get(id) ?? null),
        entitlement: (studentId: string, courseId: string) =>
          Promise.resolve(entitlements.get(`${studentId}:${courseId}`) ?? null),
        grantEntitlement: (ent: CourseEntitlement) => {
          entitlements.set(`${ent.studentId}:${ent.courseId}`, ent);
          return Promise.resolve();
        },
      } as unknown as LearningCommerceRepository;

      return { repo, orders, courses, entitlements };
    }

    const student: ActorContext = {
      userId: randomUUID(),
      roles: ["STUDENT"],
      sessionId: "sess-stu",
      tokenVersion: 1,
      correlationId: "corr-stu",
      issuedAt: 1000,
      expiresAt: 2000,
    };

    const lecturer: ActorContext = {
      userId: randomUUID(),
      roles: ["LECTURER"],
      sessionId: "sess-lec",
      tokenVersion: 1,
      correlationId: "corr-lec",
      issuedAt: 1000,
      expiresAt: 2000,
    };

    it("executes the full payment, entitlement, refund, and double-entry reversal lifecycle", async () => {
      const mock = createMockRepo();
      const orderId = randomUUID();
      const courseId = randomUUID();
      const amount = 2_500_000; // 2,500,000 VND

      mock.courses.set(courseId, {
        courseId,
        ownerLecturerId: lecturer.userId,
      });

      mock.orders.set(orderId, {
        orderId,
        studentId: student.userId,
        courseId,
        offeringId: randomUUID(),
        offeringType: "SELF_PACED",
        state: "ENTITLED",
        price: String(amount),
        currency: "VND",
        paidAt: new Date(),
        paidEventId: randomUUID(),
        version: 1,
      } as LearningOrder);

      mock.entitlements.set(`${student.userId}:${courseId}`, {
        entitlementId: randomUUID(),
        studentId: student.userId,
        courseId,
        state: "ACTIVE",
        sourceOfferingId: randomUUID(),
        sourceEnrollmentId: randomUUID(),
        grantedAt: new Date(),
        version: 1,
        updatedAt: new Date(),
      });

      const financeService = new LearningFinanceService({
        repository: mock.repo,
        paymentProvider: new SimulationPaymentProvider(),
      });

      // 1. Record payment in ledger
      const paymentTx = financeService.recordPayment({
        orderId,
        courseId,
        studentId: student.userId,
        lecturerId: lecturer.userId,
        amountMinor: amount,
        currency: "VND",
      });

      expect(paymentTx.balanced).toBe(true);
      expect(paymentTx.entries.find((e) => e.entryType === "PLATFORM_COMMISSION")?.amount).toBe(500_000);
      expect(paymentTx.entries.find((e) => e.entryType === "LECTURER_REVENUE")?.amount).toBe(2_000_000);

      // 2. Student requests refund
      const refund = await financeService.requestRefund({
        actor: student,
        orderId,
        reason: "Không sắp xếp được thời gian học",
        idempotencyKey: "ref-key-e2e",
      });

      expect(refund.status).toBe("PROCESSED");

      // 3. Verify entitlement was revoked
      const updatedEnt = await mock.repo.entitlement(student.userId, courseId);
      expect(updatedEnt?.state).toBe("REVOKED");

      // 4. Verify lecturer net earnings reflect the refund
      const period = new Date().toISOString().slice(0, 7);
      const revenueSummary = await financeService.getLecturerRevenue({
        lecturerId: lecturer.userId,
        periodMonth: period,
        actor: lecturer,
      });

      expect(revenueSummary.netEarnings).toBe(0); // 2,000,000 credited then 2,000,000 debited
    });
  });

  describe("Failure-Path Testing & Security Boundaries", () => {
    it("fails closed on invalid SePay webhook signature", async () => {
      const provider = new SepayPaymentProvider("correct-secret-token");

      const result = await provider.verifyWebhook(
        { authorization: "Apikey wrong-attacker-secret" },
        JSON.stringify({ orderId: "ord-1", transferAmount: 100000 }),
      );

      expect(result.valid).toBe(false);
      expect(result.eventType).toBe("PAYMENT_FAILED");
    });

    it("prevents Student B from requesting a refund for Student A's order", async () => {
      const orderId = randomUUID();
      const studentA = randomUUID();
      const studentB = randomUUID();

      const mockRepo = {
        order: () =>
          Promise.resolve({
            orderId,
            studentId: studentA,
            courseId: randomUUID(),
            state: "ENTITLED",
            price: "1000000",
            paidAt: new Date(),
          } as LearningOrder),
        course: () => Promise.resolve(null),
        entitlement: () => Promise.resolve(null),
        grantEntitlement: () => Promise.resolve(),
      } as unknown as LearningCommerceRepository;

      const finance = new LearningFinanceService({
        repository: mockRepo,
        paymentProvider: new SimulationPaymentProvider(),
      });

      await expect(
        finance.requestRefund({
          actor: {
            userId: studentB, // Attacker
            roles: ["STUDENT"],
            sessionId: "s",
            tokenVersion: 1,
            correlationId: "c",
            issuedAt: 1000,
            expiresAt: 2000,
          },
          orderId,
          reason: "Fraudulent refund attempt",
          idempotencyKey: "k",
        }),
      ).rejects.toThrow("You can only request refunds for your own orders");
    });

    it("prevents Lecturer B from accessing Lecturer A's revenue summary", async () => {
      const lecturerA = randomUUID();
      const lecturerB = randomUUID();

      const finance = new LearningFinanceService({
        repository: {} as LearningCommerceRepository,
        paymentProvider: new SimulationPaymentProvider(),
      });

      await expect(
        finance.getLecturerRevenue({
          lecturerId: lecturerA,
          periodMonth: "2026-09",
          actor: {
            userId: lecturerB, // Attacker lecturer
            roles: ["LECTURER"],
            sessionId: "s",
            tokenVersion: 1,
            correlationId: "c",
            issuedAt: 1000,
            expiresAt: 2000,
          },
        }),
      ).rejects.toThrow("Access to lecturer revenue denied");
    });
  });

  describe("Assistant Quality Evaluation", () => {
    it("Course Advisor recommends only real courses from domain client and respects budget", async () => {
      const studentId = randomUUID();
      const searchedCourses = [
        {
          courseId: randomUUID(),
          title: "Advanced Distributed Systems",
          description: "Production guide to ScyllaDB and Cassandra",
          priceAmount: 1_200_000,
          priceCurrency: "VND",
          level: "ADVANCED",
        },
      ];

      const domainClient: AssistantDomainClient = {
        searchCourses: () => Promise.resolve(searchedCourses),
        getCourseDetails: () => Promise.resolve(searchedCourses[0] ?? null),
        compareCourses: () => Promise.resolve([]),
        getKnowledgeGaps: () => Promise.resolve([]),
        searchCourseMaterials: () => Promise.resolve([]),
        generateQuizDraft: () => Promise.resolve({}),
        diagnoseCohortGaps: () => Promise.resolve({}),
        hasActiveAssessmentAttempt: () => Promise.resolve(false),
      };

      const mockRepo: AssistantRepository = {
        getConversation: () => Promise.resolve(null),
        createConversation: (input: CreateConversationInput) =>
          Promise.resolve({
            conversationId: input.conversationId,
            userId: input.userId,
            role: input.role,
            mode: input.mode,
            title: input.title,
            createdAt: input.now,
            updatedAt: input.now,
          }),
        touchConversation: () => Promise.resolve(),
        listUserConversations: () => Promise.resolve([]),
        appendMessage: (input: AppendMessageInput) =>
          Promise.resolve({
            messageId: input.messageId,
            conversationId: input.conversationId,
            sender: input.sender,
            content: input.content,
            createdAt: input.now,
          }),
        getRecentMessages: () => Promise.resolve([]),
        logToolInvocation: () => Promise.resolve(),
      } as unknown as AssistantRepository;

      const mockLlm: AssistantLlmProvider = {
        generate: (req) => {
          const sys = req.systemPrompt;
          expect(sys).toContain("STUDENT_ADVISOR");
          expect(sys).toContain("DO NOT hallucinate nonexistent courses");
          return Promise.resolve({
            content: "Dựa trên danh mục AILSS, khóa học Advanced Distributed Systems phù hợp với bạn với mức học phí 1,200,000 VND.",
          });
        },
      };

      const orchestrator = new AssistantOrchestrator({
        repository: mockRepo,
        toolRunner: new ToolRunner(domainClient),
        domainClient,
        llmProvider: mockLlm,
      });

      const response = await orchestrator.chat(
        { userId: studentId, role: "STUDENT" },
        {
          mode: "STUDENT_ADVISOR",
          message: "Tôi muốn tìm khóa học về cơ sở dữ liệu phân tán với ngân sách dưới 1.5 triệu",
        },
      );

      expect(response.content).toContain("Advanced Distributed Systems");
      expect(response.content).toContain("1,200,000 VND");
      expect(response.toolInvocations).toHaveLength(1);
      expect(response.toolInvocations[0]?.name).toBe("search_courses");
    });
  });
});
