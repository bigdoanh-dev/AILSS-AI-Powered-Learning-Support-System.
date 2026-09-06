/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import type { ObjectStorage } from "../../../../packages/storage/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import { fingerprint, keyHash } from "../documents/model.js";
import type { AiDocumentRepository } from "../documents/repository.js";
import type { AiIdentityClient } from "../identity-client.js";
import {
  decodeCursor,
  encodeCursor,
  generationIds,
  jobDto,
  sha256,
  type CreateQuizJob,
  type QuizJobState,
} from "./model.js";
import type { AiQuizRepository } from "./repository.js";
import type { AiTargetClient } from "./target-client.js";
export class AiQuizService {
  constructor(
    private readonly repo: AiQuizRepository,
    private readonly commands: AiDocumentRepository,
    private readonly storage: ObjectStorage,
    private readonly identity: AiIdentityClient,
    private readonly target: AiTargetClient,
    private readonly secret: string,
    private readonly dailyQuota: number,
    private readonly cursorSecret: string,
    private readonly cursorTtlSeconds: number,
  ) {}
  private async lecturer(actor: ActorContext, correlationId: string) {
    if (!actor.roles.includes("LECTURER"))
      throw new AppError("LECTURER_REQUIRED", 403, "Verified Lecturer required");
    try {
      await this.identity.eligible(actor.userId, correlationId);
    } catch (e) {
      throw new AppError(
        e instanceof Error && e.message === "REJECTED" ? "LECTURER_NOT_ELIGIBLE" : "IDENTITY_UNAVAILABLE",
        e instanceof Error && e.message === "REJECTED" ? 403 : 503,
        "Lecturer eligibility unavailable",
        true,
      );
    }
  }
  async create(input: { actor: ActorContext; body: CreateQuizJob; key: string; correlationId: string }) {
    await this.lecturer(input.actor, input.correlationId);
    const d = await this.repo.document(input.body.documentId);
    if (!d || d.ownerId !== input.actor.userId)
      throw new AppError("DOCUMENT_NOT_FOUND", 404, "Document not found");
    if (d.status !== "EXTRACTED" || !d.extractionObjectKey || !d.extractionChecksum)
      throw new AppError("DOCUMENT_NOT_EXTRACTED", 409, "Document must be extracted");
    let context;
    try {
      context = await this.target.owned(
        input.body.targetType,
        input.body.targetId,
        input.actor.userId,
        input.correlationId,
      );
    } catch (e) {
      throw new AppError(
        e instanceof Error && e.message === "REJECTED" ? "TARGET_NOT_FOUND" : "TARGET_CONTEXT_UNAVAILABLE",
        e instanceof Error && e.message === "REJECTED" ? 404 : 503,
        "Target context unavailable",
        true,
      );
    }
    const scope = `lecturer:${input.actor.userId}:AI-01`,
      hash = keyHash(this.secret, input.key),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/ai/quiz-jobs",
        actor: input.actor.userId,
        body: input.body,
      }),
      ids = generationIds(),
      now = new Date(),
      won = await this.commands.reserve(
        scope,
        hash,
        input.key,
        { operationId: ids.operationId, documentId: ids.jobId },
        fp,
        now,
      ),
      receipt = await this.commands.idempotency(scope, hash, input.key);
    if (!receipt || receipt.fingerprint !== fp)
      throw new AppError("IDEMPOTENCY_CONFLICT", 409, "Idempotency key conflicts with another request");
    if (!won && receipt.status === "COMPLETE") return { body: receipt.responseBody, replayed: true };
    let job = await this.repo.job(receipt.resourceId);
    if (!job) {
      if (
        !(await this.repo.reserveQuota(
          input.actor.userId,
          receipt.operationId,
          input.body.questionCount,
          this.dailyQuota,
          now,
        ))
      )
        throw new AppError("AI_QUOTA_EXCEEDED", 429, "Daily AI quiz quota exceeded");
      await this.repo.createJob(
        { jobId: receipt.resourceId, operationId: receipt.operationId, eventId: ids.eventId },
        input.actor.userId,
        input.body,
        sha256(JSON.stringify(input.body)),
        now,
      );
      job = await this.repo.job(receipt.resourceId);
    }
    if (!job) throw new AppError("AI_JOB_CREATE_UNCERTAIN", 503, "AI job reservation unavailable", true);
    await this.repo.project(job);
    const event: EventEnvelope = {
      specVersion: "1.0",
      eventId: job.generationEventId,
      eventType: "ai.quiz.generate.v1",
      occurredAt: job.createdAt.toISOString(),
      producer: "ai-service",
      correlationId: input.correlationId,
      aggregate: { type: "AI_JOB", id: job.jobId, version: job.version },
      data: {
        jobId: job.jobId,
        operationId: job.operationId,
        documentId: job.documentId,
        targetType: job.targetType,
        targetId: job.targetId,
        targetVersion: context.version,
        requestHash: sha256(JSON.stringify(input.body)),
        questionCount: input.body.questionCount,
        questionTypes: input.body.questionTypes,
        difficulty: input.body.difficulty,
      },
    };
    await this.repo.prepare(event, job.createdAt);
    const body = jobDto(job);
    await this.commands.completeCommand(scope, hash, input.key, receipt.operationId, 202, body);
    return { body, replayed: !won };
  }
  async get(actor: ActorContext, id: string) {
    const j = await this.repo.job(id);
    if (!j || j.lecturerId !== actor.userId) throw new AppError("AI_JOB_NOT_FOUND", 404, "AI job not found");
    return jobDto(j);
  }
  async list(actor: ActorContext, state: QuizJobState, month: string, limit: number, cursor?: string) {
    let pageState: string | undefined;
    if (cursor) {
      try {
        const c = decodeCursor(this.cursorSecret, cursor) as {
          owner: string;
          state: string;
          month: string;
          pageState: string;
          exp: number;
        };
        if (
          c.owner !== actor.userId ||
          c.state !== state ||
          c.month !== month ||
          c.exp < Date.now() ||
          typeof c.pageState !== "string" ||
          c.pageState.length > 4096
        )
          throw new Error();
        pageState = c.pageState;
      } catch {
        throw new AppError("INVALID_CURSOR", 400, "Invalid or expired cursor");
      }
    }
    const page = await this.repo.list(actor.userId, state, month, limit, pageState),
      items = await Promise.all(page.rows.map(async (r) => this.get(actor, String(r.job_id))));
    return {
      items,
      ...(page.pageState
        ? {
            nextCursor: encodeCursor(this.cursorSecret, {
              owner: actor.userId,
              state,
              month,
              pageState: page.pageState,
              exp: Date.now() + this.cursorTtlSeconds * 1000,
            }),
          }
        : {}),
    };
  }
  async drafts(actor: ActorContext, jobId: string) {
    await this.get(actor, jobId);
    const rows = await this.repo.drafts(jobId);
    return Promise.all(
      rows.map(async (r) => {
        const content = JSON.parse(
          (await this.storage.read(String(r.draft_object_key), 1024 * 1024)).toString("utf8"),
        );
        return {
          draftId: String(r.draft_id),
          draftVersion: Number(r.draft_version),
          validationStatus: String(r.validation_status),
          questionCount: Number(r.question_count),
          state: String(r.state),
          checksum: String(r.draft_checksum),
          content,
          createdAt: new Date(String(r.created_at)).toISOString(),
        };
      }),
    );
  }
  async cancel(actor: ActorContext, id: string) {
    for (let n = 0; n < 3; n++) {
      const j = await this.repo.job(id);
      if (!j || j.lecturerId !== actor.userId)
        throw new AppError("AI_JOB_NOT_FOUND", 404, "AI job not found");
      if (j.state === "AI_DRAFT")
        throw new AppError("AI_DRAFT_NOT_CANCELLABLE", 409, "Generated draft cannot be cancelled");
      if (j.state === "FAILED" || j.state === "CANCELLED") return jobDto(j);
      if (await this.repo.cancel(j, new Date())) {
        if (j.state === "QUEUED") await this.repo.releaseQuota(j.lecturerId, j.operationId, new Date());
        await this.repo.moveProjection(j, "CANCELLED", j.version + 1);
        return this.get(actor, id);
      }
    }
    throw new AppError("AI_JOB_VERSION_CONFLICT", 409, "Cancellation lost a concurrent state transition");
  }
  async quota(actor: ActorContext, correlationId: string) {
    await this.lecturer(actor, correlationId);
    const q = await this.repo.quota(actor.userId, new Date());
    return q.limit ? q : { ...q, limit: this.dailyQuota, remaining: this.dailyQuota };
  }
}
