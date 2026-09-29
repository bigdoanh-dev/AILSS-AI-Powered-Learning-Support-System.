import { z } from "zod";
import type { Logger } from "pino";
import { RabbitConsumer } from "../../../../packages/rabbitmq/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { LearnerMasteryServiceV2 } from "../mastery/mastery-service.js";
import type {
  MasteryIngestionRepository,
  AuthoritativeMasteryEvidence,
} from "./mastery-ingestion-repository.js";
import type { AdaptiveRuntimeRepository } from "./runtime-repository.js";
import { StudyPlanService } from "./study-plan-service.js";
import type { AuthoritativePlanContextProvider } from "./plan-context.js";

const dataSchema = z
  .object({
    tenantId: z.string().uuid(),
    studentId: z.string().uuid(),
    courseId: z.string().uuid(),
    learningOutcomeId: z.string().min(1).max(200),
    conceptId: z.string().min(1).max(200),
    sourceType: z.enum([
      "QUIZ",
      "MANUAL_ASSESSMENT",
      "LESSON_COMPLETION",
      "PROCTORED_EXAM",
      "FINAL_PROJECT",
      "LAB",
      "ASSIGNMENT",
      "DIAGNOSTIC",
    ]),
    sourceId: z.string().min(1).max(200),
    rawScorePercent: z.number().min(0).max(100),
    schemaVersion: z.literal("1.0"),
  })
  .passthrough();

export class MasteryRecalculationConsumer {
  private consumer: RabbitConsumer | undefined;
  private tags: string[] = [];
  private closed = false;
  private retry: NodeJS.Timeout | undefined;
  constructor(
    private readonly rabbitUrl: string,
    private readonly repository: MasteryIngestionRepository,
    private readonly adaptive: AdaptiveRuntimeRepository,
    private readonly logger: Logger,
    private readonly metrics: ReturnType<typeof createMetrics>,
    private readonly planContext: AuthoritativePlanContextProvider,
  ) {}

  async start() {
    if (this.closed || this.consumer) return;
    try {
      this.consumer = await RabbitConsumer.connect(this.rabbitUrl);
      this.consumer.onClose(() => {
        this.consumer = undefined;
        this.tags = [];
        this.reconnect();
      });
      for (const config of [
        {
          queue: "assessment.quiz.submitted.mastery.q",
          type: "assessment.quiz.submitted.v1",
          key: "assessment.quiz.submitted.v1",
        },
        {
          queue: "assessment.quiz.graded.mastery.q",
          type: "assessment.quiz.graded.v1",
          key: "assessment.quiz.graded.v1",
        },
        {
          queue: "learning.lesson.completed.mastery.q",
          type: "learning.progress.updated.v1",
          key: "learning.progress.updated.v1",
        },
      ]) {
        this.tags.push(
          await this.consumer.consume(
            config.queue,
            10,
            async (envelope) => {
              const startedAt = performance.now();
              if (envelope.eventType !== config.type) {
                this.metrics.masteryDlq.inc({ reason: "unexpected_event" });
                return { kind: "dead-letter", reason: "UNEXPECTED_EVENT" };
              }
              const parsed = dataSchema.safeParse(envelope.data);
              if (!parsed.success) {
                if (envelope.eventType === "learning.progress.updated.v1") return { kind: "ack" };
                this.metrics.masteryDlq.inc({ reason: "invalid_evidence" });
                return { kind: "dead-letter", reason: "INVALID_MASTERY_EVIDENCE_EVENT" };
              }
              const evidence: AuthoritativeMasteryEvidence = {
                eventId: envelope.eventId,
                occurredAt: envelope.occurredAt,
                correlationId: envelope.correlationId,
                ...parsed.data,
              };
              this.metrics.masteryEventsReceived.inc({ source: evidence.sourceType });
              try {
                const reservation = await this.repository.reserve(evidence);
                if (reservation === "DONE") {
                  this.metrics.masteryEventsDuplicate.inc({ source: evidence.sourceType });
                  return { kind: "ack" };
                }
                await this.repository.persistEvidence(evidence);
                const [allEvidence, current] = await Promise.all([
                  this.repository.evidence(evidence),
                  this.repository.current(evidence),
                ]);
                const latest = Math.max(...allEvidence.map((item) => Date.parse(item.timestamp)));
                const record = new LearnerMasteryServiceV2().calculateMasteryV2({
                  studentId: evidence.studentId,
                  tenantId: evidence.tenantId,
                  courseId: evidence.courseId,
                  conceptId: evidence.conceptId,
                  learningOutcomeId: evidence.learningOutcomeId,
                  evidences: allEvidence,
                  hasMetPrerequisites: true,
                  daysSinceLastActivity: Math.max(0, Math.floor((Date.now() - latest) / 86400000)),
                  previousState: current?.state,
                  previousScore: current?.score,
                  recalculationReason: `AUTHORITATIVE_EVENT:${evidence.sourceType}`,
                });
                await this.repository.saveProjection(record, evidence);
                const mastery = await this.adaptive.mastery(evidence.studentId, evidence.courseId);
                const context = await this.planContext.load(evidence.courseId);
                const plan = new StudyPlanService().generateStudyPlan({
                  planId: evidence.eventId,
                  studentId: evidence.studentId,
                  tenantId: evidence.tenantId,
                  courseId: evidence.courseId,
                  availableHoursPerWeek: 7,
                  masteryRecords: mastery,
                  ...context,
                });
                await this.adaptive.savePlan(plan);
                await this.repository.complete(evidence.eventId);
                this.metrics.masteryRecalculationSuccess.inc({ source: evidence.sourceType });
                this.metrics.masteryProcessingLatency.observe(
                  { source: evidence.sourceType },
                  (performance.now() - startedAt) / 1000,
                );
                this.logger.info(
                  {
                    operation: "mastery.recalculate",
                    eventId: evidence.eventId,
                    correlationId: evidence.correlationId,
                    studentId: evidence.studentId,
                    courseId: evidence.courseId,
                    outcome: "processed",
                  },
                  "mastery evidence processed",
                );
                return { kind: "ack" };
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await this.repository.fail(evidence.eventId, errorMessage).catch(() => undefined);
                this.metrics.masteryRecalculationFailure.inc({ source: evidence.sourceType });
                this.metrics.masteryRetries.inc({ source: evidence.sourceType });
                this.logger.warn(
                  {
                    operation: "mastery.recalculate",
                    eventId: evidence.eventId,
                    correlationId: evidence.correlationId,
                    error: errorMessage,
                  },
                  "mastery evidence processing will retry",
                );
                return { kind: "retry", reason: "MASTERY_RECALCULATION_FAILED" };
              }
            },
            {
              exchange: "ailss.domain.events",
              routingKey: config.key,
              attempts: 3,
              deadLetterExchange: "ailss.dlx",
              deadLetterRoutingKey: config.queue.replace(/\.q$/, ".dlq"),
            },
          ),
        );
      }
    } catch {
      this.consumer = undefined;
      this.tags = [];
      this.reconnect();
    }
  }

  async close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.consumer) for (const tag of this.tags) await this.consumer.cancel(tag).catch(() => undefined);
    await this.consumer?.close().catch(() => undefined);
  }
  private reconnect() {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.start();
    }, 1000);
    this.retry.unref();
  }
}
