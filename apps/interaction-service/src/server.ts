import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
import {
  loadPrivateKey,
  loadPublicKey,
  verifyActorContext,
  verifyStepUpProof,
} from "../../../packages/security/src/index.js";
import { InteractionRepository } from "./repository.js";
import { EligibilityClient } from "./eligibility.js";
import { interactionRouter } from "./router.js";
import { ReviewRepository } from "./reviews/repository.js";
import { ReviewService } from "./reviews/service.js";
import { reviewRouter } from "./reviews/router.js";
import { InteractionReviewRelay } from "./reviews/relay.js";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { ModerationRepository } from "./moderation/repository.js";
import { ModerationService } from "./moderation/service.js";
import { moderationRouter } from "./moderation/router.js";
const manifest: ServiceManifest = {
  serviceId: "interaction-service",
  ownerDomain: "Interaction",
  defaultPort: 8105,
  keyspace: "interaction_keyspace",
  cassandraRole: "svc_interaction",
  publicApiIds: Array.from({ length: 11 }, (_, i) => `INT-${String(i + 1).padStart(2, "0")}`),
  internalApiIds: [],
  producedEvents: [
    "interaction.review.created.v1",
    "interaction.report.created.v1",
    "interaction.content.moderated.v1",
    "system.audit.requested.v1",
  ],
  consumedQueues: [],
};
await startService(manifest, {
  configure: async (app, config, context) => {
    if (
      !context.cassandra ||
      !config.SERVICE_TOKEN_PRIVATE_KEY_PATH ||
      !config.ACTOR_CONTEXT_PUBLIC_KEY_PATH ||
      !config.JWT_PUBLIC_KEY_PATH ||
      !config.PASSWORD_IDEMPOTENCY_HMAC_KEY
    )
      throw new Error("Interaction requires Cassandra and signing keys");
    const [privateKey, actorKey, identityKey] = await Promise.all([
      loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH),
      loadPublicKey(config.ACTOR_CONTEXT_PUBLIC_KEY_PATH),
      loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    ]);
    const repository = new InteractionRepository(context.cassandra),
      eligibility = new EligibilityClient(config, privateKey),
      verify = (token: string) =>
        verifyActorContext(token, actorKey, {
          issuer: config.ACTOR_CONTEXT_ISSUER,
          audience: "interaction-service",
          purpose: "interaction.comment.eligibility",
          kid: config.ACTOR_CONTEXT_KID,
          clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
        });
    app.use(interactionRouter(repository, eligibility, verify, config.PASSWORD_IDEMPOTENCY_HMAC_KEY));
    const reviews = new ReviewRepository(context.cassandra);
    app.use(
      reviewRouter(
        new ReviewService(reviews, repository, eligibility, config.PASSWORD_IDEMPOTENCY_HMAC_KEY),
        verify,
      ),
    );
    app.use(
      moderationRouter(
        new ModerationService(
          new ModerationRepository(context.cassandra),
          repository,
          reviews,
          eligibility,
          config.PASSWORD_IDEMPOTENCY_HMAC_KEY,
        ),
        verify,
        (proof, reportId, adminId) =>
          verifyStepUpProof(proof, identityKey, {
            issuer: "identity-service",
            audience: "interaction-service",
            kid: config.JWT_KID,
            action: "INTERACTION_REPORT_MODERATE",
            resourceType: "REPORT",
            resourceId: reportId,
            adminUserId: adminId,
          }),
        (record) => context.logger.info(record, "interaction moderation audit"),
      ),
    );
    const relay = config.ENABLE_RABBITMQ
      ? new InteractionReviewRelay(context.cassandra, authenticatedRabbitUrl(config))
      : undefined;
    relay?.start();
    return async () => relay?.close();
  },
});
function authenticatedRabbitUrl(config: AppConfig) {
  if (!config.RABBITMQ_USERNAME || !config.RABBITMQ_PASSWORD)
    throw new Error("RabbitMQ credentials required");
  const url = new URL(config.RABBITMQ_URL);
  url.username = config.RABBITMQ_USERNAME;
  url.password = config.RABBITMQ_PASSWORD;
  return url.toString();
}
