import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
import { MinioStorage } from "../../../packages/storage/src/index.js";
import { RabbitConsumer } from "../../../packages/rabbitmq/src/index.js";
import { DocumentWorkerRepository } from "./repository.js";
import { DocumentExtractionWorker } from "./worker.js";
const manifest: ServiceManifest = {
  serviceId: "document-worker",
  ownerDomain: "AI support",
  defaultPort: 8202,
  keyspace: "ai_keyspace",
  cassandraRole: "svc_ai",
  publicApiIds: [],
  internalApiIds: [],
  producedEvents: ["ai.job.failed.v1", "system.audit.requested.v1"],
  consumedQueues: ["ai.document.extract.q"],
};
await startService(manifest, {
  configure: async (_app, config, context) => {
    if (!context.cassandra || !config.OBJECT_STORAGE_ACCESS_KEY || !config.OBJECT_STORAGE_SECRET_KEY)
      throw new Error("Document worker requires Cassandra and private storage");
    if (!config.RABBITMQ_USERNAME || !config.RABBITMQ_PASSWORD)
      throw new Error("Document worker requires RabbitMQ credentials");
    const storage = new MinioStorage(config.OBJECT_STORAGE_BUCKET, {
      endPoint: config.OBJECT_STORAGE_ENDPOINT,
      port: config.OBJECT_STORAGE_PORT,
      useSSL: config.OBJECT_STORAGE_USE_SSL,
      accessKey: config.OBJECT_STORAGE_ACCESS_KEY,
      secretKey: config.OBJECT_STORAGE_SECRET_KEY,
    });
    const worker = new DocumentExtractionWorker(
        new DocumentWorkerRepository(context.cassandra),
        storage,
        context.logger,
      ),
      url = new URL(config.RABBITMQ_URL);
    url.username = config.RABBITMQ_USERNAME;
    url.password = config.RABBITMQ_PASSWORD;
    const consumer = await RabbitConsumer.connect(url.toString()),
      tag = await consumer.consume("ai.document.extract.q", 1, (event) => worker.handle(event));
    return async () => {
      await consumer.cancel(tag);
      await consumer.close();
    };
  },
});
