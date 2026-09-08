import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
import { loadPublicKey, verifyActorContext } from "../../../packages/security/src/index.js";
import { RabbitConsumer } from "../../../packages/rabbitmq/src/index.js";
import { NotificationRepository } from "./repository.js";
import { NotificationService } from "./service.js";
import { notificationRouter } from "./router.js";
import { NotificationWorker } from "./worker.js";
const manifest: ServiceManifest = {
  serviceId: "notification-worker",
  ownerDomain: "Notification support",
  defaultPort: 8203,
  keyspace: "notification_keyspace",
  cassandraRole: "svc_notification",
  publicApiIds: ["NOT-01", "NOT-02"],
  internalApiIds: [],
  producedEvents: ["system.audit.requested.v1"],
  consumedQueues: ["notification.q"],
};
await startService(manifest, {
  configure: async (app, config, context) => {
    if (!context.cassandra || !config.ACTOR_CONTEXT_PUBLIC_KEY_PATH || !config.NOTIFICATION_TOKEN_SECRET)
      throw new Error("Notification runtime requires Cassandra, actor key and token secret");
    const actorKey = await loadPublicKey(config.ACTOR_CONTEXT_PUBLIC_KEY_PATH);
    const repository = new NotificationRepository(context.cassandra);
    app.use(
      notificationRouter(
        new NotificationService(
          repository,
          config.NOTIFICATION_TOKEN_SECRET,
          config.NOTIFICATION_CURSOR_TTL_SECONDS,
        ),
        (token, purpose) =>
          verifyActorContext(token, actorKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: "notification-worker",
            purpose,
            kid: config.ACTOR_CONTEXT_KID,
            clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          }),
      ),
    );
    if (!config.ENABLE_RABBITMQ) return;
    if (!config.RABBITMQ_USERNAME || !config.RABBITMQ_PASSWORD)
      throw new Error("RabbitMQ credentials required");
    const url = new URL(config.RABBITMQ_URL);
    url.username = config.RABBITMQ_USERNAME;
    url.password = config.RABBITMQ_PASSWORD;
    const consumer = await RabbitConsumer.connect(url.toString());
    const worker = new NotificationWorker(repository);
    const tag = await consumer.consume("notification.q", 16, (event) => worker.handle(event), {
      exchange: "ailss.notifications",
      routingKey: "system.notification.requested.v1",
      attempts: 4,
    });
    return async () => {
      await consumer.cancel(tag);
      await consumer.close();
    };
  },
});
