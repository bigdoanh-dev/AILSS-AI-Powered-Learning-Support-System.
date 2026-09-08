import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { ObjectStorage } from "../../packages/storage/src/index.js";
import type { AiDocumentRepository } from "../../apps/ai-service/src/documents/repository.js";
import type { AiIdentityClient } from "../../apps/ai-service/src/identity-client.js";
import type { AiAssessmentClient } from "../../apps/ai-service/src/quiz/assessment-client.js";
import {
  ASSESSMENT_AI_IMPORT_NAMESPACE,
  sha256,
  uuidV5,
  type ApprovalResponse,
  type QuizJob,
} from "../../apps/ai-service/src/quiz/model.js";
import type { ApprovalRecord, AiQuizRepository } from "../../apps/ai-service/src/quiz/repository.js";
import { AiQuizService } from "../../apps/ai-service/src/quiz/service.js";
import type { AiTargetClient } from "../../apps/ai-service/src/quiz/target-client.js";

const lecturerId = randomUUID(),
  draftId = randomUUID(),
  jobId = randomUUID(),
  correlationId = randomUUID();
const quiz = {
  schemaVersion: "objective-v1" as const,
  title: "Reviewed quiz",
  questions: [
    {
      id: "q1",
      order: 1,
      text: "Pick",
      points: "1.00",
      type: "SINGLE_CHOICE" as const,
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      correctAnswer: { optionId: "a" },
    },
  ],
};
const actor: ActorContext = {
  userId: lecturerId,
  roles: ["LECTURER"],
  sessionId: randomUUID(),
  tokenVersion: 1,
  correlationId,
  issuedAt: 1,
  expiresAt: 2,
};

class ApprovalStore {
  jobValue: QuizJob = {
    jobId,
    lecturerId,
    documentId: randomUUID(),
    targetType: "COURSE",
    targetId: randomUUID(),
    state: "AI_DRAFT",
    operationId: randomUUID(),
    version: 4,
    constraints: {
      documentId: randomUUID(),
      targetType: "COURSE",
      targetId: randomUUID(),
      questionCount: 1,
      questionTypes: ["SINGLE_CHOICE"],
      difficulty: "EASY",
    },
    generationEventId: randomUUID(),
    draftId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  generatedBytes = Buffer.from(JSON.stringify(quiz));
  approvalValue?: ApprovalRecord;
  imports = 0;
  approvedSnapshots = 0;
  async jobForDraft(id: string) {
    return id === draftId ? this.jobValue : undefined;
  }
  async generatedDraft() {
    return {
      draft_id: draftId,
      draft_version: 1,
      draft_object_key: "v1",
      draft_checksum: sha256(this.generatedBytes),
      validation_status: "VALID",
      state: "AI_DRAFT",
    };
  }
  async reserveApproval(input: {
    operationId: string;
    key: string;
    actorId: string;
    fingerprint: string;
    generatedChecksum: string;
    importOperationId: string;
  }) {
    if (this.approvalValue) return false;
    this.approvalValue = { ...input, idempotencyKey: input.key, state: "RESERVED" };
    return true;
  }
  async approval() {
    return this.approvalValue;
  }
  async storeApprovedDraft(input: { checksum: string; objectKey: string }) {
    this.approvedSnapshots++;
    const approval = requiredApproval(this.approvalValue);
    this.approvalValue = {
      ...approval,
      approvedChecksum: input.checksum,
      approvedObjectKey: input.objectKey,
      state: "SNAPSHOT_STORED",
    };
    return true;
  }
  async linkAssessment(input: { quizId: string }) {
    this.approvalValue = {
      ...requiredApproval(this.approvalValue),
      assessmentQuizId: input.quizId,
      state: "IMPORTED",
    };
    return true;
  }
  async job() {
    return this.jobValue;
  }
  async approveJob() {
    this.jobValue = { ...this.jobValue, state: "APPROVED", version: 5 };
    return true;
  }
  async completeApproval(_draftId: string, _operationId: string, response: ApprovalResponse) {
    this.approvalValue = { ...requiredApproval(this.approvalValue), response, state: "COMPLETE" };
    return true;
  }
}

function fixture() {
  const repo = new ApprovalStore(),
    objects = new Map<string, Buffer>([["v1", repo.generatedBytes]]),
    assessmentQuizId = randomUUID();
  const service = new AiQuizService(
    repo as unknown as AiQuizRepository,
    {} as AiDocumentRepository,
    {
      read: async (key: string) => {
        const value = objects.get(key);
        if (!value) throw new Error("MISSING_TEST_OBJECT");
        return value;
      },
      writePrivate: async (key: string, value: Buffer) => {
        objects.set(key, value);
      },
    } as unknown as ObjectStorage,
    { eligible: async () => undefined } as unknown as AiIdentityClient,
    { owned: async () => ({ version: 7 }) } as unknown as AiTargetClient,
    {
      importDraft: async () => {
        repo.imports++;
        return {
          draftId,
          approvedDraftVersion: 2,
          quizId: assessmentQuizId,
          quizVersion: 1,
          status: "DRAFT",
        };
      },
    } as unknown as AiAssessmentClient,
    "secret",
    50,
    "cursor",
    60,
  );
  return { repo, service, assessmentQuizId };
}

function requiredApproval(value: ApprovalRecord | undefined): ApprovalRecord {
  if (!value) throw new Error("MISSING_TEST_APPROVAL");
  return value;
}

describe("P10.3 AI approval", () => {
  it("uses stable UUIDv5 import identity and returns one historical approval", async () => {
    const { repo, service, assessmentQuizId } = fixture(),
      command = {
        actor,
        draftId,
        body: { reviewedDraft: quiz },
        key: randomUUID(),
        ifMatch: '"v1"',
        assessmentActorContext: "signed",
        correlationId,
      };
    const first = await service.approve(command),
      replay = await service.approve(command);
    expect(first.body).toMatchObject({
      jobId,
      draftId,
      state: "APPROVED",
      approvedDraftVersion: 2,
      assessment: { quizId: assessmentQuizId, quizVersion: 1, status: "DRAFT" },
    });
    expect(replay).toEqual({ body: first.body, replayed: true });
    expect(repo.imports).toBe(1);
    expect(repo.approvedSnapshots).toBe(1);
    expect(repo.approvalValue?.importOperationId).toBe(
      uuidV5(ASSESSMENT_AI_IMPORT_NAMESPACE, `${draftId}:2`),
    );
  });

  it("rejects stale versions and a conflicting reviewed command without import", async () => {
    const { repo, service } = fixture(),
      key = randomUUID();
    await expect(
      service.approve({
        actor,
        draftId,
        body: { reviewedDraft: quiz },
        key,
        ifMatch: '"v2"',
        assessmentActorContext: "signed",
        correlationId,
      }),
    ).rejects.toMatchObject({ code: "AI_DRAFT_VERSION_CONFLICT", status: 409 });
    await service.approve({
      actor,
      draftId,
      body: { reviewedDraft: quiz },
      key,
      ifMatch: '"v1"',
      assessmentActorContext: "signed",
      correlationId,
    });
    await expect(
      service.approve({
        actor,
        draftId,
        body: { reviewedDraft: { ...quiz, title: "Changed" } },
        key,
        ifMatch: '"v1"',
        assessmentActorContext: "signed",
        correlationId,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect(repo.imports).toBe(1);
  });
});
