/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/restrict-template-expressions */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { EventEnvelope } from "../../../packages/contracts/src/index.js";
import type { ObjectStorage } from "../../../packages/storage/src/index.js";
import type { ConsumerDisposition } from "../../../packages/rabbitmq/src/index.js";
import { validateObjectiveQuiz } from "./objective-v1.js";
import { ProviderFailure, type QuizProvider } from "./provider.js";
import type { QuizWorkerRepository } from "./repository.js";
import type { AiTargetClient } from "../../ai-service/src/quiz/target-client.js";
const dataSchema = z
  .object({
    jobId: z.string().uuid(),
    operationId: z.string().uuid(),
    documentId: z.string().uuid(),
    targetType: z.enum(["COURSE", "CLASS"]),
    targetId: z.string().uuid(),
    targetVersion: z.number().int().positive(),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/u),
    questionCount: z.number().int().min(1).max(50),
    questionTypes: z
      .array(z.enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]))
      .min(1)
      .max(4),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  })
  .strict();
export class QuizGenerationWorker {
  constructor(
    private readonly repo: QuizWorkerRepository,
    private readonly storage: ObjectStorage,
    private readonly provider: QuizProvider,
    private readonly target: Pick<AiTargetClient, "owned">,
    private readonly logger: { info(v: object, m: string): void; warn(v: object, m: string): void },
  ) {}
  async handle(event: EventEnvelope): Promise<ConsumerDisposition> {
    if (event.eventType !== "ai.quiz.generate.v1")
      return { kind: "dead-letter", reason: "UNEXPECTED_EVENT_TYPE" };
    const parsed = dataSchema.safeParse(event.data);
    if (!parsed.success) return { kind: "dead-letter", reason: "INVALID_EVENT_DATA" };
    const d = parsed.data;
    let job = await this.repo.job(d.jobId);
    if (!job) return { kind: "dead-letter", reason: "JOB_NOT_FOUND" };
    if (job.operationId !== d.operationId || job.documentId !== d.documentId)
      return { kind: "dead-letter", reason: "OPERATION_BINDING_MISMATCH" };
    if (["AI_DRAFT", "FAILED", "CANCELLED"].includes(job.state)) {
      await this.repo.syncProjection(job.jobId);
      return { kind: "ack" };
    }
    const source = await this.repo.source(d.documentId);
    if (!source || source.ownerId !== job.lecturerId || source.status !== "EXTRACTED" || !source.key)
      return { kind: "dead-letter", reason: "SOURCE_NOT_EXTRACTED" };
    try {
      const context = await this.target.owned(d.targetType, d.targetId, job.lecturerId, event.correlationId);
      if (context.version !== d.targetVersion)
        return { kind: "dead-letter", reason: "TARGET_VERSION_MISMATCH" };
    } catch {
      return { kind: "retry", reason: "TARGET_CONTEXT_UNAVAILABLE" };
    }
    if (job.state === "QUEUED") {
      if (!(await this.repo.transition(job, "PROCESSING", new Date())))
        return { kind: "retry", reason: "STATE_CONTENTION" };
      job = (await this.repo.job(job.jobId))!;
    }
    const providerKey = `ailss:${job.operationId}`,
      fence = await this.repo.acquire(
        job.operationId,
        job.jobId,
        d.requestHash,
        providerKey,
        `ai-worker:${process.pid}`,
        new Date(),
      );
    let result: { quiz: unknown; inputUnits: number; outputUnits: number; provider: string; model: string };
    try {
      if (fence.state === "RESULT_STORED" && fence.resultRef) {
        result = {
          quiz: JSON.parse((await this.storage.read(fence.resultRef, 1024 * 1024)).toString("utf8")),
          inputUnits: fence.inputUnits,
          outputUnits: fence.outputUnits,
          provider: fence.provider,
          model: fence.model,
        };
      } else {
        const text = (await this.storage.read(source.key, 1024 * 1024)).toString("utf8"),
          provided = await this.provider.generate({
            idempotencyKey: providerKey,
            sourceText: text,
            questionCount: d.questionCount,
            questionTypes: d.questionTypes,
            difficulty: d.difficulty,
          }),
          bytes = Buffer.from(JSON.stringify(provided.quiz)),
          ref = `provider-results/${job.lecturerId}/${job.operationId}.json`,
          checksum = createHash("sha256").update(bytes).digest("hex");
        await this.storage.writePrivate(ref, bytes, "application/json");
        if (
          !(await this.repo.providerResult(
            job.operationId,
            fence.fence,
            {
              ref,
              checksum,
              provider: provided.provider,
              model: provided.model,
              inputUnits: provided.inputUnits,
              outputUnits: provided.outputUnits,
            },
            new Date(),
          ))
        )
          return { kind: "retry", reason: "PROVIDER_FENCE_CONTENTION" };
        result = provided;
      }
    } catch (e) {
      if (e instanceof ProviderFailure && e.retryable) return { kind: "retry", reason: e.code };
      await this.repo.fail(
        job,
        "PROVIDER_OUTPUT_REJECTED",
        stableUuid(`${job.operationId}:failed`),
        event.correlationId,
        new Date(),
      );
      return { kind: "ack" };
    }
    job = (await this.repo.job(job.jobId))!;
    if (job.state === "CANCELLED") {
      await this.repo.finalizeUsage(job, result, new Date());
      return { kind: "ack" };
    }
    if (job.state === "PROCESSING") {
      if (!(await this.repo.transition(job, "VALIDATING", new Date())))
        return { kind: "retry", reason: "VALIDATING_CONTENTION" };
      job = (await this.repo.job(job.jobId))!;
    }
    if (result.provider === "deterministic-test") await new Promise((resolve) => setTimeout(resolve, 250));
    let quiz;
    try {
      quiz = validateObjectiveQuiz(result.quiz, { count: d.questionCount, types: d.questionTypes });
    } catch {
      await this.repo.finalizeUsage(job, result, new Date());
      await this.repo.fail(
        job,
        "OBJECTIVE_V1_INVALID",
        stableUuid(`${job.operationId}:failed`),
        event.correlationId,
        new Date(),
      );
      return { kind: "ack" };
    }
    const current = await this.repo.job(job.jobId);
    if (!current || current.state === "CANCELLED") return { kind: "ack" };
    if (current.state !== "VALIDATING") return { kind: "retry", reason: "STATE_CONTENTION" };
    const draftId = job.operationId,
      bytes = Buffer.from(JSON.stringify(quiz)),
      key = `quiz-drafts/${job.lecturerId}/${job.jobId}/1.json`,
      checksum = createHash("sha256").update(bytes).digest("hex");
    await this.storage.writePrivate(key, bytes, "application/json");
    await this.repo.saveDraft(
      job,
      {
        id: draftId,
        key,
        checksum,
        sourceChecksum: source.checksum,
        bytes: bytes.length,
        count: quiz.questions.length,
      },
      new Date(),
    );
    const generatedEventId = stableUuid(`${job.operationId}:generated`);
    if (!(await this.repo.commitDraft(current, draftId, generatedEventId, new Date()))) {
      const latest = await this.repo.job(job.jobId);
      return latest?.state === "CANCELLED"
        ? { kind: "ack" }
        : { kind: "retry", reason: "DRAFT_COMMIT_CONTENTION" };
    }
    const committed = (await this.repo.job(job.jobId))!;
    await this.repo.finalizeUsage(committed, result, new Date());
    await this.repo.prepare(
      {
        specVersion: "1.0",
        eventId: generatedEventId,
        eventType: "ai.quiz.generated.v1",
        occurredAt: new Date().toISOString(),
        producer: "ai-worker",
        correlationId: event.correlationId,
        causationId: event.eventId,
        aggregate: { type: "AI_JOB", id: job.jobId, version: committed.version },
        data: {
          jobId: job.jobId,
          draftId,
          draftVersion: 1,
          targetType: job.targetType,
          targetId: job.targetId,
          questionCount: quiz.questions.length,
          draftChecksum: checksum,
        },
      },
      new Date(),
    );
    this.logger.info(
      {
        operation: "ai.quiz.generate",
        jobId: job.jobId,
        state: "AI_DRAFT",
        questionCount: quiz.questions.length,
      },
      "quiz generation completed",
    );
    return { kind: "ack" };
  }
}
function stableUuid(value: string) {
  const b = createHash("sha256").update(value).digest().subarray(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
