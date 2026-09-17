/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
import { MinioStorage } from "../../../packages/storage/src/index.js";
import { RabbitConsumer } from "../../../packages/rabbitmq/src/index.js";
import { QuizWorkerRepository } from "./repository.js";
import { QuizGenerationWorker } from "./worker.js";
import {
  CircuitBreakingQuizProvider,
  DeterministicQuizProvider,
  HttpQuizProvider,
  RetryingQuizProvider,
} from "./provider.js";
import { loadPrivateKey } from "../../../packages/security/src/index.js";
import { AiTargetClient } from "../../ai-service/src/quiz/target-client.js";
const manifest: ServiceManifest = {
  serviceId: "ai-worker",
  ownerDomain: "AI support",
  defaultPort: 8201,
  keyspace: "ai_keyspace",
  cassandraRole: "svc_ai",
  publicApiIds: [],
  internalApiIds: ["INT-LRN-04", "INT-CLS-03", "INT-ASMT-01"],
  producedEvents: ["ai.quiz.generated.v1", "ai.job.failed.v1", "system.audit.requested.v1"],
  consumedQueues: ["ai.quiz.generate.q"],
};
await startService(manifest, {
  configure: async (_app, config, context) => {
    if (
      !context.cassandra ||
      !config.OBJECT_STORAGE_ACCESS_KEY ||
      !config.OBJECT_STORAGE_SECRET_KEY ||
      !config.RABBITMQ_USERNAME ||
      !config.RABBITMQ_PASSWORD ||
      !config.SERVICE_TOKEN_PRIVATE_KEY_PATH
    )
      throw new Error("AI worker requires Cassandra, RabbitMQ and private storage");
    if (config.AI_PROVIDER_MODE === "production" && !config.AI_PROVIDER_API_KEY)
      throw new Error("Production AI provider API key required");
    const storage = new MinioStorage(config.OBJECT_STORAGE_BUCKET, {
        endPoint: config.OBJECT_STORAGE_ENDPOINT,
        port: config.OBJECT_STORAGE_PORT,
        useSSL: config.OBJECT_STORAGE_USE_SSL,
        accessKey: config.OBJECT_STORAGE_ACCESS_KEY,
        secretKey: config.OBJECT_STORAGE_SECRET_KEY,
      }),
      serviceKey = await loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH),
      provider =
        config.AI_PROVIDER_MODE === "deterministic-test"
          ? new DeterministicQuizProvider()
          : new HttpQuizProvider({
              endpoint: config.AI_PROVIDER_ENDPOINT,
              model: config.AI_PROVIDER_MODEL,
              apiKey: config.AI_PROVIDER_API_KEY!,
              timeoutMs: config.AI_PROVIDER_TIMEOUT_MS,
            }),
      worker = new QuizGenerationWorker(
        new QuizWorkerRepository(context.cassandra),
        storage,
        new RetryingQuizProvider(
          new CircuitBreakingQuizProvider(
            provider,
            {
              failureThreshold: config.AI_CIRCUIT_BREAKER_FAILURE_THRESHOLD,
              cooldownMs: config.AI_CIRCUIT_BREAKER_COOLDOWN_MS,
            },
            Date.now,
            () => context.metrics.aiCircuitRejections.inc(),
          ),
          (reason) => context.metrics.aiGenerationRetries.inc({ reason }),
        ),
        new AiTargetClient({
          learningUrl: config.LEARNING_SERVICE_URL,
          classroomUrl: config.CLASSROOM_SERVICE_URL,
          key: serviceKey,
          kid: config.AI_SERVICE_TOKEN_KID,
          deadlineMs: config.INTERNAL_HTTP_TIMEOUT_MS,
        }),
        context.logger,
        context.metrics,
        config.AI_MAX_EXTRACTED_TEXT_BYTES,
      ),
      url = new URL(config.RABBITMQ_URL);
    url.username = config.RABBITMQ_USERNAME;
    url.password = config.RABBITMQ_PASSWORD;
    const consumer = await RabbitConsumer.connect(url.toString()),
      tag = await consumer.consume("ai.quiz.generate.q", 1, (e) => worker.handle(e));
    return async () => {
      await consumer.cancel(tag);
      await consumer.close();
    };
  },
});
