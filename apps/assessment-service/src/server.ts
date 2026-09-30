import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
import {
  loadPublicKey,
  verifyActorContext,
  verifyServiceToken,
} from "../../../packages/security/src/index.js";
import { createAssessmentClients } from "./clients.js";
import { AssessmentRepository } from "./repository.js";
import { assessmentRouter } from "./router.js";
import { AssessmentService } from "./service.js";
import { AssessmentOutboxRelay } from "./relay.js";
import { assessmentAiImportRouter } from "./ai-import-router.js";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { assessmentScheduleInternalRouter } from "./schedule-internal-router.js";
const manifest: ServiceManifest = {
  serviceId: "assessment-service",
  ownerDomain: "Assessment",
  defaultPort: 8104,
  keyspace: "assessment_keyspace",
  cassandraRole: "svc_assessment",
  publicApiIds: Array.from({ length: 10 }, (_, i) => `ASM-${String(i + 1).padStart(2, "0")}`),
  internalApiIds: ["INT-ASMT-01"],
  producedEvents: ["assessment.quiz.submitted.v1", "assessment.quiz.graded.v1", "system.audit.requested.v1"],
  consumedQueues: [],
};
await startService(manifest, {
  configure: async (app, config, context) => {
    if (!context.cassandra) throw new Error("Assessment requires Cassandra");
    if (!config.PASSWORD_IDEMPOTENCY_HMAC_KEY) throw new Error("Assessment requires an idempotency HMAC key");
    if (
      !config.ACTOR_CONTEXT_PUBLIC_KEY_PATH ||
      !config.AI_SERVICE_TOKEN_PUBLIC_KEY_PATH ||
      !config.LEARNING_SERVICE_TOKEN_PUBLIC_KEY_PATH
    )
      throw new Error("Assessment requires Gateway actor-context public key");
    const [actorKey, aiServiceKey, learningServiceKey] = await Promise.all([
        loadPublicKey(config.ACTOR_CONTEXT_PUBLIC_KEY_PATH),
        loadPublicKey(config.AI_SERVICE_TOKEN_PUBLIC_KEY_PATH),
        loadPublicKey(config.LEARNING_SERVICE_TOKEN_PUBLIC_KEY_PATH),
      ]),
      repository = new AssessmentRepository(context.cassandra),
      service = new AssessmentService(
        repository,
        await createAssessmentClients(config),
        config.PASSWORD_IDEMPOTENCY_HMAC_KEY,
        config.PLATFORM_TENANT_ID,
      ),
      verifier = (purpose: string) => (token: string) =>
        verifyActorContext(token, actorKey, {
          issuer: config.ACTOR_CONTEXT_ISSUER,
          audience: "assessment-service",
          purpose,
          kid: config.ACTOR_CONTEXT_KID,
          clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
        });
    app.use(
      assessmentRouter(
        service,
        {
          create: verifier("assessment.quiz.create"),
          detail: verifier("assessment.quiz.detail"),
          update: verifier("assessment.quiz.update"),
          publish: verifier("assessment.quiz.publish"),
          list: verifier("assessment.quiz.list"),
          attemptStart: verifier("assessment.attempt.start"),
          attemptDetail: verifier("assessment.attempt.detail"),
          submit: verifier("assessment.attempt.submit"),
          result: verifier("assessment.attempt.result"),
          results: verifier("assessment.quiz.results"),
          gradeAttempt: verifier("assessment.grade.record"),
          listGrades: verifier("assessment.grade.list"),
        },
        context.metrics,
      ),
    );
    app.use(
      assessmentAiImportRouter(
        service,
        (token) =>
          verifyServiceToken(token, aiServiceKey, {
            issuer: config.SERVICE_TOKEN_ISSUER,
            audience: "assessment-service",
            purpose: "assessment.ai-draft.import",
            kid: config.AI_SERVICE_TOKEN_KID,
          }),
        verifier("assessment.ai-draft.import"),
        config.NODE_ENV === "test" && config.ASSESSMENT_ACCEPTANCE_DELAY_AFTER_IMPORT_DRAFT_ID
          ? async (draftId, replayed) => {
              if (!replayed && draftId === config.ASSESSMENT_ACCEPTANCE_DELAY_AFTER_IMPORT_DRAFT_ID)
                await new Promise((resolve) => setTimeout(resolve, 2_500));
            }
          : undefined,
      ),
    );
    app.use(
      assessmentScheduleInternalRouter(repository, (token) =>
        verifyServiceToken(token, learningServiceKey, {
          issuer: config.SERVICE_TOKEN_ISSUER,
          audience: "assessment-service",
          purpose: "assessment.schedule.read",
          kid: config.LEARNING_SERVICE_TOKEN_KID,
        }),
      ),
    );
    const relay = config.ENABLE_RABBITMQ
      ? new AssessmentOutboxRelay(repository, authenticatedRabbitUrl(config), context.logger)
      : undefined;
    relay?.start();
    return relay ? () => relay.close() : undefined;
  },
});

function authenticatedRabbitUrl(config: AppConfig) {
  if (!config.RABBITMQ_USERNAME || !config.RABBITMQ_PASSWORD)
    throw new Error("RabbitMQ credentials were not validated");
  const url = new URL(config.RABBITMQ_URL);
  url.username = config.RABBITMQ_USERNAME;
  url.password = config.RABBITMQ_PASSWORD;
  return url.toString();
}
