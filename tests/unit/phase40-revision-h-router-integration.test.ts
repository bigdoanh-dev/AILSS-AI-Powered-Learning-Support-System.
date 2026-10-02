import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { generateKeyPair, type CryptoKey } from "jose";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

import { requestContextMiddleware, errorMiddleware } from "../../packages/http/src/index.js";
import {
  signServiceToken,
  verifyServiceToken,
  signActorContext,
  verifyActorContext,
  type ActorContext,
} from "../../packages/security/src/index.js";
import { adaptiveInternalRouter } from "../../apps/learning-service/src/adaptive/internal-router.js";
import {
  lecturerMasteryRouter,
  authorizeCourseMastery,
  type CourseAuthority,
} from "../../apps/learning-service/src/adaptive/lecturer-mastery-router.js";
import { HttpAssistantDomainClient } from "../../apps/ai-service/src/assistant/domain-client.js";
import { ToolRunner } from "../../apps/ai-service/src/assistant/tool-runner.js";
import { ASSISTANT_TOOLS } from "../../apps/ai-service/src/assistant/tool-registry.js";
import { isModeAllowedForRole, isToolAllowedForRole } from "../../apps/ai-service/src/assistant/roles.js";
import { AssessmentService, type AssessmentStore } from "../../apps/assessment-service/src/service.js";
import {
  AssessmentDependencyError,
  type AssessmentClients,
  type TargetFacts,
} from "../../apps/assessment-service/src/clients.js";
import {
  snapshotChecksum,
  type Quiz,
  type Attempt,
  type AssessmentResult,
} from "../../apps/assessment-service/src/model.js";
import type { AdaptiveRuntimeRepository } from "../../apps/learning-service/src/adaptive/runtime-repository.js";
import type {
  MasteryIngestionRepository,
  AuthoritativeMasteryEvidence,
} from "../../apps/learning-service/src/adaptive/mastery-ingestion-repository.js";
import type {
  MasteryRecordV2,
  MultiFactorEvidence,
  StudyPlanV2,
} from "../../packages/contracts/src/index.js";

describe("Phase 40 Revision H: Production HTTP Router & Service Integration", () => {
  const tenantAlpha = "11111111-1111-4111-8111-111111111111";
  const tenantBeta = "11111111-1111-4111-8111-222222222222";
  const courseId = "22222222-2222-4222-8222-222222222222";
  const studentId = "33333333-3333-4333-8333-333333333333";
  const crossTenantStudentId = "33333333-3333-4333-8333-888888888888";
  const inactiveStudentId = "33333333-3333-4333-8333-999999999999";
  const lecturerId = "44444444-4444-4444-8444-444444444444";
  const otherLecturerId = "44444444-4444-4444-8444-555555555555";
  const adminId = "55555555-5555-4555-8555-555555555555";

  const kid = "test-key-1";
  const issuer = "ailss-internal";

  let aiPrivateKey: CryptoKey;
  let aiPublicKey: CryptoKey;
  let actorPrivateKey: CryptoKey;
  let actorPublicKey: CryptoKey;

  let server: Server;
  let baseUrl: string;
  let domainClient: HttpAssistantDomainClient;
  let toolRunner: ToolRunner;

  function makeTestMasteryRecord(
    overrides: Partial<MasteryRecordV2> & { studentId: string; conceptId: string; learningOutcomeId: string },
  ): MasteryRecordV2 {
    const now = new Date().toISOString();
    const { studentId: sId, conceptId: cId, learningOutcomeId: lId, ...rest } = overrides;
    return {
      studentId: sId,
      tenantId: tenantAlpha,
      courseId,
      conceptId: cId,
      learningOutcomeId: lId,
      masteryScore: 60,
      masteryState: "DEVELOPING",
      confidenceScore: 80,
      evidenceCount: 1,
      evidenceIds: ["ev-1"],
      algorithmVersion: "v2.0.0",
      calculatedAt: now,
      lastDecayEvaluationAt: now,
      explanation: {
        whyState: "Test evidence",
        nextSteps: "Continue practice",
        contributingFactors: {
          assessmentPerformance: 80,
          attemptCount: 1,
          recencyStatus: "FRESH",
          prerequisiteFoundationMet: true,
        },
      },
      ...rest,
    };
  }

  // In-memory runtime repositories
  const masteryStore = new Map<string, MasteryRecordV2[]>();
  const planStore = new Map<string, StudyPlanV2>();
  const evidenceStore = new Map<string, MultiFactorEvidence[]>();
  const ingestionReservations = new Set<string>();
  const entitledStudents = new Set<string>([
    `${studentId}:${courseId}`,
    `${crossTenantStudentId}:${courseId}`,
  ]);

  const mockAdaptiveRepo: AdaptiveRuntimeRepository = {
    mastery: async (sId: string, cId: string) => masteryStore.get(`${sId}:${cId}`) ?? [],
    currentPlan: async (sId: string, cId: string) => planStore.get(`${sId}:${cId}`),
    savePlan: async (plan: StudyPlanV2) => {
      planStore.set(`${plan.studentId}:${plan.courseId}`, plan);
    },
    updateItem: async (sId: string, cId: string, itemId: string, status: any, scheduledDate?: string) => {
      const plan = planStore.get(`${sId}:${cId}`);
      if (!plan) return undefined;
      const item = plan.items.find((i: any) => i.itemId === itemId);
      if (!item) return undefined;
      item.status = status;
      if (scheduledDate) item.scheduledDate = scheduledDate;
      return item;
    },
  } as unknown as AdaptiveRuntimeRepository;

  const mockIngestionRepo: MasteryIngestionRepository = {
    reserve: async (ev: AuthoritativeMasteryEvidence) => {
      if (ingestionReservations.has(ev.eventId)) return "DONE";
      ingestionReservations.add(ev.eventId);
      return "RESERVED";
    },
    persistEvidence: async (ev: AuthoritativeMasteryEvidence) => {
      const key = `${ev.studentId}:${ev.courseId}:${ev.conceptId}`;
      const list = evidenceStore.get(key) ?? [];
      list.push({
        evidenceId: ev.eventId,
        evidenceSource: ev.sourceType,
        rawScorePercent: ev.rawScorePercent,
        attemptNumber: list.length + 1,
        timestamp: ev.occurredAt,
        recencyWeight: 1,
      });
      evidenceStore.set(key, list);
    },
    evidence: async (ev: AuthoritativeMasteryEvidence) =>
      evidenceStore.get(`${ev.studentId}:${ev.courseId}:${ev.conceptId}`) ?? [],
    current: async (ev: AuthoritativeMasteryEvidence) => {
      const records = masteryStore.get(`${ev.studentId}:${ev.courseId}`) ?? [];
      const match = records.find((r) => r.conceptId === ev.conceptId);
      return match ? { state: match.masteryState, score: match.masteryScore } : undefined;
    },
    saveProjection: async (record: MasteryRecordV2, ev: AuthoritativeMasteryEvidence) => {
      const key = `${ev.studentId}:${ev.courseId}`;
      const list = masteryStore.get(key) ?? [];
      const idx = list.findIndex((r) => r.conceptId === record.conceptId);
      if (idx >= 0) list[idx] = record;
      else list.push(record);
      masteryStore.set(key, list);
    },
    complete: async () => {},
  } as unknown as MasteryIngestionRepository;

  const mockAuthority: CourseAuthority = {
    course: async (cId: string) => ({
      ownerLecturerId: lecturerId,
      ...(cId === courseId ? { tenantId: tenantAlpha } : {}),
    }),
    entitlement: async (sId: string, _cId: string) => ({
      state: sId === inactiveStudentId ? "INACTIVE" : "ACTIVE",
      tenantId: sId === crossTenantStudentId ? tenantBeta : tenantAlpha,
    }),
    roster: async (_cId: string) => [{ studentId }],
    lookupProducerRecord: async (_cId: string, _type: any, recordId: string) => {
      if (recordId === "valid-assignment-1") {
        return { id: recordId, tenantId: tenantAlpha };
      }
      if (recordId === "cross-tenant-assignment") {
        return { id: recordId, tenantId: tenantBeta };
      }
      return undefined;
    },
    canonicalTenantId: tenantAlpha,
  };

  beforeAll(async () => {
    // Generate real Ed25519 cryptographic keypairs for service and actor JWT signing/verification
    const aiKeys = await generateKeyPair("EdDSA");
    aiPrivateKey = aiKeys.privateKey;
    aiPublicKey = aiKeys.publicKey;

    const actorKeys = await generateKeyPair("EdDSA");
    actorPrivateKey = actorKeys.privateKey;
    actorPublicKey = actorKeys.publicKey;

    const app = express();
    app.use(express.json());
    app.use(requestContextMiddleware());

    // Mount production adaptiveInternalRouter with strict read vs write verifiers
    app.use(
      adaptiveInternalRouter(
        mockAdaptiveRepo,
        {
          read: (token) =>
            verifyServiceToken(token, aiPublicKey, {
              issuer,
              audience: "learning-service",
              purpose: "learning.adaptive.ai.read",
              kid,
            }),
          write: (token) =>
            verifyServiceToken(token, aiPublicKey, {
              issuer,
              audience: "learning-service",
              purpose: "learning.adaptive.ai.write",
              kid,
            }),
        },
        async (sId: string, cId: string) => entitledStudents.has(`${sId}:${cId}`),
        {
          load: async () => ({ courseRequirements: [], upcomingAssessments: [] }),
        },
      ),
    );

    // Mount production lecturerMasteryRouter
    app.use(
      lecturerMasteryRouter(
        mockAdaptiveRepo,
        (token) =>
          verifyActorContext(token, actorPublicKey, {
            issuer,
            audience: "learning-service",
            purpose: "learning.adaptive.lecturer",
            kid,
          }),
        (actor, cId, sId) => authorizeCourseMastery(actor, cId, sId, mockAuthority),
        mockAuthority,
        mockIngestionRepo,
        tenantAlpha,
      ),
    );

    app.use(errorMiddleware);

    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server listen failed");
    baseUrl = `http://127.0.0.1:${address.port}`;

    // Wire production HttpAssistantDomainClient using live server URL and real private key
    domainClient = new HttpAssistantDomainClient({
      learningUrl: baseUrl,
      assessmentUrl: baseUrl,
      classroomUrl: baseUrl,
      key: aiPrivateKey,
      kid,
      deadlineMs: 3000,
    });

    toolRunner = new ToolRunner(domainClient);
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    masteryStore.clear();
    planStore.clear();
    evidenceStore.clear();
    ingestionReservations.clear();
  });

  // Helper to create valid lecturer actor JWT
  async function makeLecturerToken(userId = lecturerId, correlationId = randomUUID()): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const actor: ActorContext = {
      userId,
      roles: ["LECTURER"],
      sessionId: randomUUID(),
      tokenVersion: 1,
      correlationId,
      issuedAt: now,
      expiresAt: now + 50,
    };
    return signActorContext(
      actorPrivateKey,
      kid,
      issuer,
      "learning-service",
      "learning.adaptive.lecturer",
      actor,
    );
  }

  // ==========================================================================
  // 1. Service Token Purpose Separation (Read vs Write)
  // ==========================================================================
  describe("1. Service Token Purpose Enforcement (learning.adaptive.ai.read vs write)", () => {
    it("proves a read token cannot mutate a study plan (POST /generate and PATCH /items)", async () => {
      masteryStore.set(`${studentId}:${courseId}`, [
        makeTestMasteryRecord({
          studentId,
          conceptId: "concept:2pc",
          learningOutcomeId: "outcome:2pc",
          masteryScore: 60,
          masteryState: "DEVELOPING",
        }),
      ]);

      const readToken = await signServiceToken(aiPrivateKey, {
        issuer,
        serviceId: "ai-service",
        audience: "learning-service",
        purpose: "learning.adaptive.ai.read",
        kid,
      });

      // 1. POST /generate with read token must be rejected
      const postRes = await fetch(`${baseUrl}/internal/v1/students/${studentId}/study-plan/generate`, {
        method: "POST",
        headers: {
          authorization: `Service ${readToken}`,
          "content-type": "application/json",
          "x-correlation-id": randomUUID(),
        },
        body: JSON.stringify({ courseId, availableHoursPerWeek: 10 }),
      });
      expect(postRes.status).toBe(401);
      const postErr = (await postRes.json()) as { error: { code: string } };
      expect(postErr.error.code).toBe("INVALID_SERVICE_CREDENTIALS");

      // 2. PATCH /items/:itemId with read token must be rejected
      const patchRes = await fetch(
        `${baseUrl}/internal/v1/students/${studentId}/study-plan/items/${randomUUID()}`,
        {
          method: "PATCH",
          headers: {
            authorization: `Service ${readToken}`,
            "content-type": "application/json",
            "x-correlation-id": randomUUID(),
          },
          body: JSON.stringify({ courseId, status: "COMPLETED" }),
        },
      );
      expect(patchRes.status).toBe(401);
      const patchErr = (await patchRes.json()) as { error: { code: string } };
      expect(patchErr.error.code).toBe("INVALID_SERVICE_CREDENTIALS");
    });

    it("proves a write token can call mutation paths but cannot call read paths", async () => {
      masteryStore.set(`${studentId}:${courseId}`, [
        makeTestMasteryRecord({
          studentId,
          conceptId: "concept:2pc",
          learningOutcomeId: "outcome:2pc",
          masteryScore: 60,
          masteryState: "DEVELOPING",
        }),
      ]);

      const writeToken = await signServiceToken(aiPrivateKey, {
        issuer,
        serviceId: "ai-service",
        audience: "learning-service",
        purpose: "learning.adaptive.ai.write",
        kid,
      });

      // 1. GET /mastery with write token must be rejected
      const getRes = await fetch(`${baseUrl}/internal/v1/students/${studentId}/mastery/${courseId}`, {
        headers: {
          authorization: `Service ${writeToken}`,
          "x-correlation-id": randomUUID(),
        },
      });
      expect(getRes.status).toBe(401);
      const getErr = (await getRes.json()) as { error: { code: string } };
      expect(getErr.error.code).toBe("INVALID_SERVICE_CREDENTIALS");

      // 2. POST /generate with write token succeeds
      const postRes = await fetch(`${baseUrl}/internal/v1/students/${studentId}/study-plan/generate`, {
        method: "POST",
        headers: {
          authorization: `Service ${writeToken}`,
          "content-type": "application/json",
          "x-correlation-id": randomUUID(),
        },
        body: JSON.stringify({ courseId, availableHoursPerWeek: 10 }),
      });
      expect(postRes.status).toBe(201);
      const createdPlan = (await postRes.json()) as { data: StudyPlanV2 };
      expect(createdPlan.data.studentId).toBe(studentId);
      expect(createdPlan.data.items.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // 2. Student Journey: AI Domain Client & Tool Runner over HTTP
  // ==========================================================================
  describe("2. Student Journey: Authoritative Mastery, Study Plan, and AI Tutor", () => {
    it("generates and updates a study plan via HttpAssistantDomainClient calling live HTTP routes", async () => {
      masteryStore.set(`${studentId}:${courseId}`, [
        makeTestMasteryRecord({
          studentId,
          conceptId: "concept:wal",
          learningOutcomeId: "outcome:wal",
          masteryScore: 40,
          masteryState: "INTRODUCED",
        }),
      ]);

      // Call domainClient.generateStudyPlan -> automatically mints write token -> POSTs to live route
      const plan = (await domainClient.generateStudyPlan(studentId, courseId, 8)) as StudyPlanV2;
      expect(plan).toBeDefined();
      expect(plan.courseId).toBe(courseId);
      expect(plan.items.length).toBeGreaterThan(0);

      const targetItemId = plan.items[0]!.itemId;

      // Call domainClient.updateStudyPlanItem -> automatically mints write token -> PATCHes to live route
      const updatedItem = (await domainClient.updateStudyPlanItem(
        studentId,
        courseId,
        targetItemId,
        "COMPLETED",
      )) as StudyPlanV2["items"][number];
      expect(updatedItem.status).toBe("COMPLETED");

      // Call domainClient.getStudentMastery -> mints read token -> GETs from live route
      const mastery = (await domainClient.getStudentMastery(studentId, courseId)) as MasteryRecordV2[];
      expect(mastery).toHaveLength(1);
      expect(mastery[0]!.conceptId).toBe("concept:wal");
    });

    it("executes generate_study_plan tool through ToolRunner and prevents hallucinated data", async () => {
      masteryStore.set(`${studentId}:${courseId}`, [
        makeTestMasteryRecord({
          studentId,
          conceptId: "concept:indexing",
          learningOutcomeId: "outcome:indexing",
          masteryScore: 50,
          masteryState: "DEVELOPING",
        }),
      ]);

      const result = await toolRunner.executeTool(
        "call-1",
        "generate_study_plan",
        { courseId, availableHoursPerWeek: 12 },
        { userId: studentId, role: "STUDENT" },
      );

      expect(result.error).toBeUndefined();
      const planData = result.result as StudyPlanV2;
      expect(planData.studentId).toBe(studentId);

      // Verify that Tutor throws appropriate unavailable errors instead of fabricating questions/diagnostics
      expect(() => domainClient.generateQuizDraft("Databases", "INTERMEDIATE", 5)).toThrow(
        "AUTHORING_SERVICE_UNAVAILABLE",
      );
      expect(() => domainClient.diagnoseCohortGaps(courseId)).toThrow("COHORT_DIAGNOSTICS_UNAVAILABLE");
    });
  });

  // ==========================================================================
  // 3. Teacher / Lecturer Journey & Error Cases
  // ==========================================================================
  describe("3. Teacher / Lecturer Journey: Authority, Tenant Resolution, and Provenance", () => {
    it("records authoritative TEACHER_OBSERVATION with non-empty Idempotency-Key and recalculates mastery", async () => {
      const corrId = randomUUID();
      const token = await makeLecturerToken(lecturerId, corrId);
      const idempotencyKey = randomUUID();

      const response = await fetch(`${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`, {
        method: "POST",
        headers: {
          "x-actor-context": token,
          "x-correlation-id": corrId,
          "idempotency-key": idempotencyKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          learningOutcomeId: "outcome:consensus",
          conceptId: "concept:consensus-raft",
          rawScorePercent: 88,
          sourceType: "TEACHER_OBSERVATION",
          notes: "Student demonstrated clear understanding of leader election",
        }),
      });

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        data: {
          evidence: { sourceId: string; tenantId: string };
          record: { masteryScore: number };
          replayed: boolean;
        };
      };
      expect(body.data.evidence.sourceId).toBe(`lecturer:${lecturerId}`);
      expect(body.data.evidence.tenantId).toBe(tenantAlpha);
      expect(body.data.record.masteryScore).toBeGreaterThanOrEqual(80);
      expect(body.data.replayed).toBe(false);

      // Duplicate retry with same idempotency key succeeds idempotently without re-inserting
      const retryResponse = await fetch(
        `${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`,
        {
          method: "POST",
          headers: {
            "x-actor-context": token,
            "x-correlation-id": corrId,
            "idempotency-key": idempotencyKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            learningOutcomeId: "outcome:consensus",
            conceptId: "concept:consensus-raft",
            rawScorePercent: 88,
            sourceType: "TEACHER_OBSERVATION",
          }),
        },
      );
      expect(retryResponse.status).toBe(200);
      const retryBody = (await retryResponse.json()) as { data: { replayed: boolean } };
      expect(retryBody.data.replayed).toBe(true);
    });

    it("fails closed if the mastery evidence repository is not configured", async () => {
      const isolatedApp = express();
      isolatedApp.use(express.json());
      isolatedApp.use(requestContextMiddleware());
      isolatedApp.use(
        lecturerMasteryRouter(
          mockAdaptiveRepo,
          (token) =>
            verifyActorContext(token, actorPublicKey, {
              issuer,
              audience: "learning-service",
              purpose: "learning.adaptive.lecturer",
              kid,
            }),
          (actor, cId, sId) => authorizeCourseMastery(actor, cId, sId, mockAuthority),
          mockAuthority,
          undefined,
          tenantAlpha,
        ),
      );
      isolatedApp.use(errorMiddleware);

      const isolatedServer = createServer(isolatedApp);
      await new Promise<void>((resolve) => isolatedServer.listen(0, "127.0.0.1", resolve));
      const address = isolatedServer.address();
      if (!address || typeof address === "string") throw new Error("Isolated server listen failed");

      try {
        const corrId = randomUUID();
        const token = await makeLecturerToken(lecturerId, corrId);
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/v1/courses/${courseId}/students/${studentId}/evidence`,
          {
            method: "POST",
            headers: {
              "x-actor-context": token,
              "x-correlation-id": corrId,
              "idempotency-key": randomUUID(),
              "content-type": "application/json",
            },
            body: JSON.stringify({
              learningOutcomeId: "outcome:consensus",
              conceptId: "concept:consensus-raft",
              rawScorePercent: 80,
            }),
          },
        );
        expect(response.status).toBe(503);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
          "MASTERY_INGESTION_UNAVAILABLE",
        );
      } finally {
        isolatedServer.closeAllConnections();
        await new Promise<void>((resolve) => isolatedServer.close(() => resolve()));
      }
    });

    it("rejects evidence submission with missing or empty Idempotency-Key", async () => {
      const corrId = randomUUID();
      const token = await makeLecturerToken(lecturerId, corrId);

      // Missing header
      const resMissing = await fetch(`${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`, {
        method: "POST",
        headers: {
          "x-actor-context": token,
          "x-correlation-id": corrId,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          learningOutcomeId: "outcome:consensus",
          conceptId: "concept:consensus-raft",
          rawScorePercent: 80,
        }),
      });
      expect(resMissing.status).toBe(400);
      expect(((await resMissing.json()) as { error: { code: string } }).error.code).toBe(
        "IDEMPOTENCY_KEY_REQUIRED",
      );

      // Empty string header
      const resEmpty = await fetch(`${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`, {
        method: "POST",
        headers: {
          "x-actor-context": token,
          "x-correlation-id": corrId,
          "idempotency-key": "   ",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          learningOutcomeId: "outcome:consensus",
          conceptId: "concept:consensus-raft",
          rawScorePercent: 80,
        }),
      });
      expect(resEmpty.status).toBe(400);
      expect(((await resEmpty.json()) as { error: { code: string } }).error.code).toBe(
        "IDEMPOTENCY_KEY_REQUIRED",
      );
    });

    it("denies evidence submission for non-owner lecturer (owner denial)", async () => {
      const corrId = randomUUID();
      const token = await makeLecturerToken(otherLecturerId, corrId);

      const res = await fetch(`${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`, {
        method: "POST",
        headers: {
          "x-actor-context": token,
          "x-correlation-id": corrId,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          learningOutcomeId: "outcome:consensus",
          conceptId: "concept:consensus-raft",
          rawScorePercent: 80,
        }),
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("COURSE_MASTERY_FORBIDDEN");
    });

    it("denies evidence submission for non-lecturer role (role denial)", async () => {
      const corrId = randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const studentActor: ActorContext = {
        userId: studentId,
        roles: ["STUDENT"],
        sessionId: randomUUID(),
        tokenVersion: 1,
        correlationId: corrId,
        issuedAt: now,
        expiresAt: now + 50,
      };
      const token = await signActorContext(
        actorPrivateKey,
        kid,
        issuer,
        "learning-service",
        "learning.adaptive.lecturer",
        studentActor,
      );

      const res = await fetch(`${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`, {
        method: "POST",
        headers: {
          "x-actor-context": token,
          "x-correlation-id": corrId,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          learningOutcomeId: "outcome:consensus",
          conceptId: "concept:consensus-raft",
          rawScorePercent: 80,
        }),
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("LECTURER_REQUIRED");
    });

    it("denies evidence submission when student is not active in the course (enrollment denial)", async () => {
      const corrId = randomUUID();
      const token = await makeLecturerToken(lecturerId, corrId);

      const res = await fetch(
        `${baseUrl}/api/v1/courses/${courseId}/students/${inactiveStudentId}/evidence`,
        {
          method: "POST",
          headers: {
            "x-actor-context": token,
            "x-correlation-id": corrId,
            "idempotency-key": randomUUID(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            learningOutcomeId: "outcome:consensus",
            conceptId: "concept:consensus-raft",
            rawScorePercent: 80,
          }),
        },
      );
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "COURSE_STUDENT_ACCESS_DENIED",
      );
    });

    it("denies evidence submission when student and course belong to different tenants (cross-tenant handling)", async () => {
      const corrId = randomUUID();
      const token = await makeLecturerToken(lecturerId, corrId);

      const res = await fetch(
        `${baseUrl}/api/v1/courses/${courseId}/students/${crossTenantStudentId}/evidence`,
        {
          method: "POST",
          headers: {
            "x-actor-context": token,
            "x-correlation-id": corrId,
            "idempotency-key": randomUUID(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            learningOutcomeId: "outcome:consensus",
            conceptId: "concept:consensus-raft",
            rawScorePercent: 80,
          }),
        },
      );
      expect(res.status).toBe(403);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe("CROSS_TENANT_VIOLATION");
    });

    it("requires authoritative producer record verification for ASSIGNMENT/LAB/FINAL_PROJECT", async () => {
      const corrId = randomUUID();
      const token = await makeLecturerToken(lecturerId, corrId);

      // 1. Fails when sourceRecordId is missing
      const resMissingRecord = await fetch(
        `${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`,
        {
          method: "POST",
          headers: {
            "x-actor-context": token,
            "x-correlation-id": corrId,
            "idempotency-key": randomUUID(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            learningOutcomeId: "outcome:lab",
            conceptId: "concept:lab-raft",
            rawScorePercent: 90,
            sourceType: "ASSIGNMENT",
          }),
        },
      );
      expect(resMissingRecord.status).toBe(422);
      expect(((await resMissingRecord.json()) as { error: { code: string } }).error.code).toBe(
        "EVIDENCE_PRODUCER_UNVERIFIED",
      );

      // 2. Fails when sourceRecordId does not exist in producer
      const resNonExistent = await fetch(
        `${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`,
        {
          method: "POST",
          headers: {
            "x-actor-context": token,
            "x-correlation-id": corrId,
            "idempotency-key": randomUUID(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            learningOutcomeId: "outcome:lab",
            conceptId: "concept:lab-raft",
            rawScorePercent: 90,
            sourceType: "ASSIGNMENT",
            sourceRecordId: "non-existent-assignment",
          }),
        },
      );
      expect(resNonExistent.status).toBe(422);
      expect(((await resNonExistent.json()) as { error: { code: string } }).error.code).toBe(
        "EVIDENCE_PRODUCER_UNVERIFIED",
      );

      // 3. Fails when sourceRecord belongs to different tenant
      const resCrossTenantRecord = await fetch(
        `${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`,
        {
          method: "POST",
          headers: {
            "x-actor-context": token,
            "x-correlation-id": corrId,
            "idempotency-key": randomUUID(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            learningOutcomeId: "outcome:lab",
            conceptId: "concept:lab-raft",
            rawScorePercent: 90,
            sourceType: "ASSIGNMENT",
            sourceRecordId: "cross-tenant-assignment",
          }),
        },
      );
      expect(resCrossTenantRecord.status).toBe(403);
      expect(((await resCrossTenantRecord.json()) as { error: { code: string } }).error.code).toBe(
        "CROSS_TENANT_VIOLATION",
      );

      // 4. Succeeds when valid producer record exists
      const resValid = await fetch(`${baseUrl}/api/v1/courses/${courseId}/students/${studentId}/evidence`, {
        method: "POST",
        headers: {
          "x-actor-context": token,
          "x-correlation-id": corrId,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          learningOutcomeId: "outcome:lab",
          conceptId: "concept:lab-raft",
          rawScorePercent: 95,
          sourceType: "ASSIGNMENT",
          sourceRecordId: "valid-assignment-1",
        }),
      });
      expect(resValid.status).toBe(201);
      const validBody = (await resValid.json()) as { data: { evidence: { sourceId: string } } };
      expect(validBody.data.evidence.sourceId).toBe("assignment:valid-assignment-1");
    });
  });

  // ==========================================================================
  // 4. Assessment Service Target Lookup Coverage & Error Visibility
  // ==========================================================================
  describe("4. Assessment Target Lookup Coverage & Error Visibility", () => {
    class TestAssessmentStore {
      readonly commands = new Map<string, any>();
      readonly quizzes = new Map<string, Quiz>();
      readonly questionsMap = new Map<string, any[]>();
      readonly attempts = new Map<string, Attempt>();
      readonly results = new Map<string, AssessmentResult>();
      readonly submittedEvents: any[] = [];
      readonly gradedEvents: any[] = [];

      async reserveCommand(
        scope: string,
        hash: number,
        key: string,
        operationId: string,
        resourceId: string,
        receipt: any,
      ) {
        this.commands.set(`${scope}:${hash}:${key}`, {
          operationId,
          resourceId,
          status: "IN_PROGRESS",
          receipt,
        });
        return true;
      }
      async command(scope: string, hash: number, key: string) {
        return this.commands.get(`${scope}:${hash}:${key}`);
      }
      async checkpoint(scope: string, hash: number, key: string, _operationId: string, receipt: any) {
        const cur = this.commands.get(`${scope}:${hash}:${key}`);
        if (cur) cur.receipt = receipt;
      }
      async completeCommand(
        scope: string,
        hash: number,
        key: string,
        _opId: string,
        _code: number,
        receipt: any,
      ) {
        const cur = this.commands.get(`${scope}:${hash}:${key}`);
        if (cur) {
          cur.status = "COMPLETE";
          cur.receipt = receipt;
        }
      }
      async quiz(id: string) {
        return this.quizzes.get(id);
      }
      async createQuiz(_quiz: any) {}
      async finalizeCreate(_quiz: any) {}
      async reserveVersion(_quiz: any, _next: number) {}
      async finalizeVersion(_quiz: any) {}
      async publish(_quiz: any, _date: Date): Promise<boolean> {
        return true;
      }
      async writeQuestions(quizId: string, v: number, q: any[]) {
        this.questionsMap.set(`${quizId}:${v}`, q);
      }
      async questions(quizId: string, v: number) {
        return this.questionsMap.get(`${quizId}:${v}`) ?? [];
      }
      async deleteProjection(_t: any, _tid: any, _s: any, _qid: any) {}
      async insertProjection(_p: any) {}
      async projectionMatches(_p: any) {
        return true;
      }
      async listProjection(_t: any, _tid: any, _s: any) {
        return [];
      }
      async attempt(attemptId: string) {
        return this.attempts.get(attemptId);
      }
      async guard(_uid: string, _qid: string) {
        return undefined;
      }
      async initializeGuard(_uid: string, _qid: string) {}
      async reserveAttempt(_arg: any) {}
      async createAttempt(attempt: Attempt) {
        this.attempts.set(attempt.attemptId, attempt);
      }
      async startAttempt(_id: string, _s: Date, _d: Date) {}
      async expireAttempt(_a: any, _d: Date) {}
      async writeAttemptProjection(_a: any) {}
      async clearGuard(_a: any, _d: Date) {}
      async reserveSubmit(_a: any, opId: string) {
        const cur = this.attempts.get(_a.attemptId);
        if (cur) this.attempts.set(_a.attemptId, { ...cur, pendingSubmitOperationId: opId });
        return true;
      }
      async writeResultItems() {}
      async createResult(res: any) {
        this.results.set(res.attemptId, res);
        return true;
      }
      async result(attemptId: string) {
        return this.results.get(attemptId);
      }
      async submitAttempt(attempt: Attempt, opId: string, now: Date) {
        this.attempts.set(attempt.attemptId, {
          ...attempt,
          state: "SUBMITTED",
          submittedAt: now,
          submitOperationId: opId,
        });
        return true;
      }
      async writeResultProjection() {}
      async updateResultProjection() {}
      async recordManualGrade(input: any) {
        const res = this.results.get(input.attemptId);
        if (res) {
          res.manualScore = input.manualScore;
          res.resultVersion = input.nextResultVersion;
          return true;
        }
        return false;
      }
      async prepareSubmittedEvent(ev: any) {
        this.submittedEvents.push(ev);
      }
      async readySubmittedEvent() {}
      async prepareGradedEvent(ev: any) {
        this.gradedEvents.push(ev);
      }
      async resultProjectionShard() {
        return 0;
      }
      async reserveAiImport() {}
      async aiImport() {
        return undefined;
      }
      async completeAiImport() {}
    }

    const testClients = {
      eligibleLecturer: async () => {},
      target: async (targetType: "COURSE" | "CLASS", targetId: string): Promise<TargetFacts> => {
        if (targetId === "missing-class") {
          throw new AssessmentDependencyError("CLASSROOM", "UNAVAILABLE", 503);
        }
        if (targetId === "unlinked-class") {
          return {
            targetType,
            targetId,
            ownerLecturerId: lecturerId,
            version: 1,
          };
        }
        return {
          targetType,
          targetId,
          ownerLecturerId: lecturerId,
          version: 1,
          ...(targetType === "CLASS" ? { linkedCourseId: courseId } : {}),
        };
      },
      studentTarget: async () => ({}) as TargetFacts,
    };

    it("preserves reliable error visibility and rejects when class target lookup fails", async () => {
      const store = new TestAssessmentStore();
      const service = new AssessmentService(
        store as unknown as AssessmentStore,
        testClients as unknown as AssessmentClients,
        "secret-key",
        tenantAlpha,
      );

      const quiz: Quiz = {
        quizId: randomUUID(),
        targetType: "CLASS",
        targetId: "missing-class",
        ownerId: lecturerId,
        title: "Distributed Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: 0,
        snapshotChecksum: snapshotChecksum([]),
        snapshotReady: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.quizzes.set(quiz.quizId, quiz);

      const attemptId = randomUUID();
      const attempt: Attempt = {
        attemptId,
        studentId,
        quizId: quiz.quizId,
        quizVersion: 1,
        attemptNo: 1,
        state: "IN_PROGRESS",
        version: 1,
        pinnedQuestionCount: 0,
        pinnedSnapshotChecksum: quiz.snapshotChecksum,
      };
      store.attempts.set(attemptId, attempt);

      const actor: ActorContext = {
        userId: studentId,
        roles: ["STUDENT"],
        sessionId: randomUUID(),
        tokenVersion: 1,
        correlationId: randomUUID(),
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      };

      // Target lookup failure must not be silently caught; it must propagate
      await expect(
        service.submit({
          actor,
          attemptId,
          request: { answers: [], clientSubmittedAt: new Date().toISOString() },
          idempotencyKey: randomUUID(),
          serverReceivedAt: new Date(),
        }),
      ).rejects.toMatchObject({ code: "QUIZ_TARGET_SERVICE_UNAVAILABLE", status: 503 });
    });

    it("rejects when class target has no linkedCourseId rather than silently dropping mastery", async () => {
      const store = new TestAssessmentStore();
      const service = new AssessmentService(
        store as unknown as AssessmentStore,
        testClients as unknown as AssessmentClients,
        "secret-key",
        tenantAlpha,
      );

      const quiz: Quiz = {
        quizId: randomUUID(),
        targetType: "CLASS",
        targetId: "unlinked-class",
        ownerId: lecturerId,
        title: "Unlinked Class Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: 0,
        snapshotChecksum: snapshotChecksum([]),
        snapshotReady: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.quizzes.set(quiz.quizId, quiz);

      const attemptId = randomUUID();
      const attempt: Attempt = {
        attemptId,
        studentId,
        quizId: quiz.quizId,
        quizVersion: 1,
        attemptNo: 1,
        state: "IN_PROGRESS",
        version: 1,
        pinnedQuestionCount: 0,
        pinnedSnapshotChecksum: quiz.snapshotChecksum,
      };
      store.attempts.set(attemptId, attempt);

      const actor: ActorContext = {
        userId: studentId,
        roles: ["STUDENT"],
        sessionId: randomUUID(),
        tokenVersion: 1,
        correlationId: randomUUID(),
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      };

      await expect(
        service.submit({
          actor,
          attemptId,
          request: { answers: [], clientSubmittedAt: new Date().toISOString() },
          idempotencyKey: randomUUID(),
          serverReceivedAt: new Date(),
        }),
      ).rejects.toMatchObject({ code: "CLASS_COURSE_LINK_NOT_FOUND", status: 422 });
    });

    it("does not persist a manual grade when the class-to-course lookup fails", async () => {
      const store = new TestAssessmentStore();
      const service = new AssessmentService(
        store as unknown as AssessmentStore,
        testClients as unknown as AssessmentClients,
        "secret-key",
        tenantAlpha,
      );
      const quiz: Quiz = {
        quizId: randomUUID(),
        targetType: "CLASS",
        targetId: "missing-class",
        ownerId: lecturerId,
        title: "Unavailable class target",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: 0,
        snapshotChecksum: snapshotChecksum([]),
        snapshotReady: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const attemptId = randomUUID();
      const originalResult: AssessmentResult = {
        attemptId,
        quizId: quiz.quizId,
        quizVersion: 1,
        studentId,
        score: "8.0",
        maxScore: "10.0",
        gradingChecksum: "checksum",
        answerCount: 0,
        resultItemsChecksum: "checksum",
        gradingAlgorithmVersion: "objective-v1",
        resultVersion: 1,
        createdAt: new Date(),
      };
      store.quizzes.set(quiz.quizId, quiz);
      store.attempts.set(attemptId, {
        attemptId,
        studentId,
        quizId: quiz.quizId,
        quizVersion: 1,
        attemptNo: 1,
        state: "SUBMITTED",
        version: 1,
        pinnedQuestionCount: 0,
        pinnedSnapshotChecksum: quiz.snapshotChecksum,
        submittedAt: new Date(),
      });
      store.results.set(attemptId, originalResult);
      const actor: ActorContext = {
        userId: lecturerId,
        roles: ["LECTURER"],
        sessionId: randomUUID(),
        tokenVersion: 1,
        correlationId: randomUUID(),
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      };

      await expect(
        service.gradeAttempt({
          actor,
          quizId: quiz.quizId,
          attemptId,
          request: { score: "9.0" },
          requestId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "QUIZ_TARGET_SERVICE_UNAVAILABLE", status: 503 });
      expect(store.results.get(attemptId)).toEqual(originalResult);
      expect(store.gradedEvents).toHaveLength(0);
    });

    it("resolves course target and class-linked target to emit authoritative mastery events", async () => {
      const store = new TestAssessmentStore();
      const service = new AssessmentService(
        store as unknown as AssessmentStore,
        testClients as unknown as AssessmentClients,
        "secret-key",
        tenantAlpha,
      );

      // 1. COURSE quiz submission
      const courseQuiz: Quiz = {
        quizId: randomUUID(),
        targetType: "COURSE",
        targetId: courseId,
        ownerId: lecturerId,
        title: "Course Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: 0,
        snapshotChecksum: snapshotChecksum([]),
        snapshotReady: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.quizzes.set(courseQuiz.quizId, courseQuiz);

      const attempt1Id = randomUUID();
      const attempt1: Attempt = {
        attemptId: attempt1Id,
        studentId,
        quizId: courseQuiz.quizId,
        quizVersion: 1,
        attemptNo: 1,
        state: "IN_PROGRESS",
        version: 1,
        pinnedQuestionCount: 0,
        pinnedSnapshotChecksum: courseQuiz.snapshotChecksum,
      };
      store.attempts.set(attempt1Id, attempt1);

      const actor: ActorContext = {
        userId: studentId,
        roles: ["STUDENT"],
        sessionId: randomUUID(),
        tokenVersion: 1,
        correlationId: randomUUID(),
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      };

      await service.submit({
        actor,
        attemptId: attempt1Id,
        request: { answers: [], clientSubmittedAt: new Date().toISOString() },
        idempotencyKey: randomUUID(),
        serverReceivedAt: new Date(),
      });

      expect(store.submittedEvents).toHaveLength(1);
      expect(store.submittedEvents[0].mastery).toMatchObject({
        tenantId: tenantAlpha,
        courseId,
        sourceType: "QUIZ",
      });

      // 2. CLASS quiz manual grading resolves linkedCourseId
      const classQuiz: Quiz = {
        quizId: randomUUID(),
        targetType: "CLASS",
        targetId: "class-123",
        ownerId: lecturerId,
        title: "Class Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: 0,
        snapshotChecksum: snapshotChecksum([]),
        snapshotReady: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.quizzes.set(classQuiz.quizId, classQuiz);

      const attempt2Id = randomUUID();
      const attempt2: Attempt = {
        attemptId: attempt2Id,
        studentId,
        quizId: classQuiz.quizId,
        quizVersion: 1,
        attemptNo: 1,
        state: "SUBMITTED",
        version: 1,
        pinnedQuestionCount: 0,
        pinnedSnapshotChecksum: classQuiz.snapshotChecksum,
        submittedAt: new Date(),
      };
      store.attempts.set(attempt2Id, attempt2);
      store.results.set(attempt2Id, {
        attemptId: attempt2Id,
        quizId: classQuiz.quizId,
        quizVersion: 1,
        studentId,
        score: "8.0",
        maxScore: "10.0",
        gradingChecksum: "chk",
        answerCount: 0,
        resultItemsChecksum: "chk",
        gradingAlgorithmVersion: "objective-v1",
        resultVersion: 1,
        createdAt: new Date(),
      });

      const lecturerActor: ActorContext = {
        userId: lecturerId,
        roles: ["LECTURER"],
        sessionId: randomUUID(),
        tokenVersion: 1,
        correlationId: randomUUID(),
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      };

      await service.gradeAttempt({
        actor: lecturerActor,
        quizId: classQuiz.quizId,
        attemptId: attempt2Id,
        request: { score: "9.0" },
        requestId: randomUUID(),
      });

      expect(store.gradedEvents).toHaveLength(1);
      expect(store.gradedEvents[0].mastery).toMatchObject({
        tenantId: tenantAlpha,
        courseId,
        sourceType: "MANUAL_ASSESSMENT",
      });
    });
  });

  // ==========================================================================
  // 5. Admin Journey: Support Boundaries & Strict Role Isolation
  // ==========================================================================
  describe("5. Admin Journey: Support Boundaries & Strict Role Isolation", () => {
    it("restricts admin to ADMIN_SUPPORT mode only", () => {
      expect(isModeAllowedForRole("ADMIN", "ADMIN_SUPPORT")).toBe(true);
      expect(isModeAllowedForRole("ADMIN", "STUDY_BUDDY")).toBe(false);
      expect(isModeAllowedForRole("ADMIN", "STUDENT_ADVISOR")).toBe(false);
      expect(isModeAllowedForRole("ADMIN", "LECTURER_COPILOT")).toBe(false);
    });

    it("strictly isolates admin from learner mastery and study-plan tools", async () => {
      expect(isToolAllowedForRole("ADMIN", "get_student_mastery")).toBe(false);
      expect(isToolAllowedForRole("ADMIN", "get_recommended_learning_path")).toBe(false);
      expect(isToolAllowedForRole("ADMIN", "generate_study_plan")).toBe(false);
      expect(isToolAllowedForRole("ADMIN", "update_study_plan_item")).toBe(false);

      const result = await toolRunner.executeTool(
        "call-admin-1",
        "generate_study_plan",
        { courseId, availableHoursPerWeek: 10 },
        { userId: adminId, role: "ADMIN" },
      );

      expect(result.result).toBeNull();
      expect(result.error).toContain(
        "FORBIDDEN: Role ADMIN is not permitted to execute tool generate_study_plan",
      );
    });
  });
});
