import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { loadPrivateKey, loadPublicKey, verifyActorContext } from "../../../packages/security/src/index.js";
import { MinioStorage } from "../../../packages/storage/src/index.js";
import { AiDocumentRepository } from "./documents/repository.js";
import { AiDocumentService } from "./documents/service.js";
import { aiDocumentRouter } from "./documents/router.js";
import { AiIdentityClient } from "./identity-client.js";
import { AiDocumentRelay } from "./documents/relay.js";
import { safeError } from "../../../packages/logger/src/index.js";
import { AppError } from "../../../packages/http/src/index.js";
import { AiQuizRepository } from "./quiz/repository.js";
import { AiQuizService } from "./quiz/service.js";
import { AiTargetClient } from "./quiz/target-client.js";
import { AiAssessmentClient } from "./quiz/assessment-client.js";
import { aiQuizRouter } from "./quiz/router.js";
import {
  AssistantRepository,
  AssistantOrchestrator,
  CassandraAssistantResponseCache,
  ToolRunner,
  HttpAssistantLlmProvider,
  IntegrationOnlyAssistantLlmProvider,
  assistantRouter,
  type AssistantRole,
} from "./assistant/index.js";
import { HttpAssistantDomainClient } from "./assistant/domain-client.js";
const manifest: ServiceManifest = {
  serviceId: "ai-service",
  ownerDomain: "AI",
  defaultPort: 8106,
  keyspace: "ai_keyspace",
  cassandraRole: "svc_ai",
  publicApiIds: Array.from({ length: 10 }, (_, i) => `AI-${String(i + 1).padStart(2, "0")}`),
  internalApiIds: [],
  producedEvents: ["ai.document.extract.v1", "ai.quiz.generate.v1", "system.audit.requested.v1"],
  consumedQueues: [],
};
await startService(manifest, {
  configure: async (app, config, context) => {
    if (
      !context.cassandra ||
      !config.ACTOR_CONTEXT_PUBLIC_KEY_PATH ||
      !config.SERVICE_TOKEN_PRIVATE_KEY_PATH ||
      !config.OBJECT_STORAGE_ACCESS_KEY ||
      !config.OBJECT_STORAGE_SECRET_KEY ||
      !config.PASSWORD_IDEMPOTENCY_HMAC_KEY ||
      !config.AI_CURSOR_HMAC_KEY
    )
      throw new Error("AI documents require Cassandra, identity keys, MinIO and idempotency secret");
    const [actorKey, serviceKey] = await Promise.all([
      loadPublicKey(config.ACTOR_CONTEXT_PUBLIC_KEY_PATH),
      loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH),
    ]);
    const storage = new MinioStorage(
      config.OBJECT_STORAGE_BUCKET,
      {
        endPoint: config.OBJECT_STORAGE_ENDPOINT,
        port: config.OBJECT_STORAGE_PORT,
        useSSL: config.OBJECT_STORAGE_USE_SSL,
        accessKey: config.OBJECT_STORAGE_ACCESS_KEY,
        secretKey: config.OBJECT_STORAGE_SECRET_KEY,
      },
      config.OBJECT_STORAGE_PUBLIC_URL,
    );
    const repository = new AiDocumentRepository(context.cassandra);
    const service = new AiDocumentService(
      repository,
      storage,
      new AiIdentityClient({
        baseUrl: config.IDENTITY_SERVICE_URL,
        key: serviceKey,
        kid: config.AI_SERVICE_TOKEN_KID,
        deadlineMs: config.IDENTITY_PUBLIC_PROFILE_DEADLINE_MS,
      }),
      config.PASSWORD_IDEMPOTENCY_HMAC_KEY,
    );
    app.use(
      aiDocumentRouter(service, (token) =>
        verifyActorContext(token, actorKey, {
          issuer: config.ACTOR_CONTEXT_ISSUER,
          audience: "ai-service",
          purpose: "ai.document.access",
          kid: config.ACTOR_CONTEXT_KID,
          clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
        }),
      ),
    );
    const quizService = new AiQuizService(
      new AiQuizRepository(context.cassandra),
      repository,
      storage,
      new AiIdentityClient({
        baseUrl: config.IDENTITY_SERVICE_URL,
        key: serviceKey,
        kid: config.AI_SERVICE_TOKEN_KID,
        deadlineMs: config.IDENTITY_PUBLIC_PROFILE_DEADLINE_MS,
      }),
      new AiTargetClient({
        learningUrl: config.LEARNING_SERVICE_URL,
        classroomUrl: config.CLASSROOM_SERVICE_URL,
        key: serviceKey,
        kid: config.AI_SERVICE_TOKEN_KID,
        deadlineMs: config.INTERNAL_HTTP_TIMEOUT_MS,
      }),
      new AiAssessmentClient({
        baseUrl: config.ASSESSMENT_SERVICE_URL,
        key: serviceKey,
        kid: config.AI_SERVICE_TOKEN_KID,
        issuer: config.SERVICE_TOKEN_ISSUER,
        ttlSeconds: config.SERVICE_TOKEN_TTL_SECONDS,
        deadlineMs: 2_000,
      }),
      config.PASSWORD_IDEMPOTENCY_HMAC_KEY,
      config.AI_DAILY_QUIZ_QUOTA,
      config.AI_CURSOR_HMAC_KEY,
      config.AI_CURSOR_TTL_SECONDS,
    );
    app.use(
      aiQuizRouter(quizService, (token) =>
        verifyActorContext(token, actorKey, {
          issuer: config.ACTOR_CONTEXT_ISSUER,
          audience: "ai-service",
          purpose: "ai.document.access",
          kid: config.ACTOR_CONTEXT_KID,
          clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
        }),
      ),
    );
    const assistantRepo = new AssistantRepository(context.cassandra);
    const assistantDomainClient = new HttpAssistantDomainClient({
      learningUrl: config.LEARNING_SERVICE_URL,
      assessmentUrl: config.ASSESSMENT_SERVICE_URL,
      classroomUrl: config.CLASSROOM_SERVICE_URL,
      key: serviceKey,
      kid: config.AI_SERVICE_TOKEN_KID,
      deadlineMs: config.INTERNAL_HTTP_TIMEOUT_MS,
    });
    const assistantToolRunner = new ToolRunner(assistantDomainClient);
    const assistantLlmProvider =
      config.AI_ASSISTANT_PROVIDER_MODE === "integration-only"
        ? new IntegrationOnlyAssistantLlmProvider()
        : new HttpAssistantLlmProvider({
            endpoint:
              config.AI_PROVIDER_ENDPOINT ||
              "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
            apiKey: config.AI_PROVIDER_API_KEY || "synthetic-api-key",
            model: config.AI_PROVIDER_MODEL || "gemini-1.5-flash",
            timeoutMs: config.AI_PROVIDER_TIMEOUT_MS,
            tokenUsageRepository: assistantRepo,
            onTokenUsageError: (error) => {
              context.logger.error(
                { operation: "ai.assistant.token_usage.save", err: safeError(error) },
                "AI assistant token usage write failed",
              );
            },
          });
    const assistantOrchestrator = new AssistantOrchestrator({
      repository: assistantRepo,
      toolRunner: assistantToolRunner,
      domainClient: assistantDomainClient,
      llmProvider: assistantLlmProvider,
      responseCache: new CassandraAssistantResponseCache(context.cassandra),
      responseCacheTtlSeconds: config.AI_ASSISTANT_CACHE_TTL_SECONDS,
      tenantId: config.AI_ASSISTANT_CACHE_TENANT_ID,
      providerIdentity: `${config.AI_ASSISTANT_PROVIDER_MODE}:${config.AI_PROVIDER_ENDPOINT}:${config.AI_PROVIDER_MODEL}`,
    });
    app.use(
      assistantRouter(
        assistantOrchestrator,
        assistantRepo,
        async (token) => {
          const verified = await verifyActorContext(token, actorKey, {
            issuer: config.ACTOR_CONTEXT_ISSUER,
            audience: "ai-service",
            purpose: "ai.document.access",
            kid: config.ACTOR_CONTEXT_KID,
            clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          });
          return {
            userId: verified.userId,
            role: (verified.roles[0] ?? "STUDENT") as AssistantRole,
          };
        },
        context.metrics,
      ),
    );
    app.use((error: unknown, _request: unknown, _response: unknown, next: (error: unknown) => void) => {
      context.logger.error(
        {
          operation: "ai.request",
          ...(error instanceof AppError ? { errorCode: error.code, statusCode: error.status } : {}),
          err: safeError(error),
        },
        "AI request failed",
      );
      next(error);
    });
    const relay = config.ENABLE_RABBITMQ
      ? new AiDocumentRelay(context.cassandra, authenticatedRabbitUrl(config), (error) => {
          context.logger.warn(
            { operation: "ai.document.relay.poll", err: safeError(error) },
            "AI document relay poll failed; retrying",
          );
        })
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
