import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const optionalInjected = z
  .string()
  .optional()
  .transform((value) => (value === "<INJECTED>" ? undefined : value));

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "research", "production"]).default("development"),
  APP_NAME: z.string().min(1),
  SERVICE_ID: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  HTTP_BODY_LIMIT: z.string().default("1mb"),
  IDENTITY_SERVICE_URL: z.string().url().default("http://127.0.0.1:8101"),
  IDENTITY_PUBLIC_URL: z.string().url().default("http://127.0.0.1:8080"),
  LEARNING_SERVICE_URL: z.string().url().default("http://127.0.0.1:8102"),
  CLASSROOM_SERVICE_URL: z.string().url().default("http://127.0.0.1:8103"),
  ASSESSMENT_SERVICE_URL: z.string().url().default("http://127.0.0.1:8104"),
  INTERACTION_SERVICE_URL: z.string().url().default("http://127.0.0.1:8105"),
  AI_SERVICE_URL: z.string().url().default("http://127.0.0.1:8106"),
  NOTIFICATION_SERVICE_URL: z.string().url().default("http://127.0.0.1:8203"),
  PROMETHEUS_SERVICE_URL: z.string().url().default("http://127.0.0.1:9090"),
  GRAFANA_SERVICE_URL: z.string().url().default("http://127.0.0.1:3001"),
  PROMETHEUS_PUBLIC_URL: z.string().url().default("http://localhost:9090"),
  GRAFANA_PUBLIC_URL: z.string().url().default("http://localhost:3001"),
  INTERNAL_HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(5_000),
  PASSWORD_CHANGE_HTTP_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(60_000).default(20_000),
  IDENTITY_OUTBOX_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(1_000),
  ENABLE_CASSANDRA: bool,
  ENABLE_RABBITMQ: bool,
  CASSANDRA_CONTACT_POINTS: z.string().default("127.0.0.1:9042"),
  CASSANDRA_LOCAL_DC: z.string().default("ailss_dc"),
  CASSANDRA_KEYSPACE: z.string().optional(),
  CASSANDRA_USERNAME: optionalInjected,
  CASSANDRA_PASSWORD: optionalInjected,
  CASSANDRA_TLS_ENABLED: bool,
  CASSANDRA_CA_PATH: z.string().optional(),
  CASSANDRA_TLS_SERVER_NAME: z.string().min(1).default("cassandra"),
  RABBITMQ_URL: z.string().default("amqp://127.0.0.1:5672/%2Failss"),
  RABBITMQ_USERNAME: optionalInjected,
  RABBITMQ_PASSWORD: optionalInjected,
  RABBITMQ_TLS_ENABLED: bool,
  JWT_ISSUER: z.string().url().default("https://identity.ailss.local"),
  JWT_AUDIENCE: z.string().min(1).default("ailss-api"),
  JWT_KID: z.string().min(1).default("dev-user-2026-01"),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  JWT_PUBLIC_KEY_PATH: z.string().optional(),
  JWT_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(300).default(60),
  ACTOR_CONTEXT_PRIVATE_KEY_PATH: z.string().optional(),
  ACTOR_CONTEXT_PUBLIC_KEY_PATH: z.string().optional(),
  ACTOR_CONTEXT_ISSUER: z.string().min(1).default("api-gateway"),
  ACTOR_CONTEXT_AUDIENCE: z.string().min(1).default("identity-service"),
  ACTOR_CONTEXT_PURPOSE: z.string().min(1).default("identity.logout"),
  ACTOR_CONTEXT_KID: z.string().min(1).default("dev-gateway-2026-01"),
  ACTOR_CONTEXT_TTL_SECONDS: z.coerce.number().int().min(1).max(60).default(30),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3_600).max(7_776_000).default(2_592_000),
  PASSWORD_IDEMPOTENCY_HMAC_KEY: optionalInjected,
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: bool,
  SMTP_USER: optionalInjected,
  SMTP_PASS: optionalInjected,
  SMTP_FROM: z.preprocess(
    (value) => (value === "" || value === "<INJECTED>" ? undefined : value),
    z.string().trim().email().optional(),
  ),
  ADMIN_CURSOR_HMAC_KEY: optionalInjected,
  LEARNING_CURSOR_HMAC_KEY: optionalInjected,
  PLATFORM_TENANT_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  AI_CURSOR_HMAC_KEY: optionalInjected,
  NOTIFICATION_TOKEN_SECRET: optionalInjected,
  NOTIFICATION_CURSOR_TTL_SECONDS: z.coerce.number().int().min(1).max(900).default(900),
  AI_CURSOR_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(900),
  AI_DAILY_QUIZ_QUOTA: z.coerce.number().int().min(1).max(10_000).default(200),
  AI_PROVIDER_ENDPOINT: z.string().url().default("https://api.openai.com/v1/chat/completions"),
  AI_PROVIDER_MODEL: z.string().min(1).max(200).default("gpt-5-mini"),
  AI_PROVIDER_API_KEY: optionalInjected,
  AI_PROVIDER_MODE: z.enum(["production", "deterministic-test"]).default("production"),
  AI_ASSISTANT_PROVIDER_MODE: z.enum(["external", "integration-only"]).default("external"),
  AI_ASSISTANT_INTEGRATION_ENABLED: bool,
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  AI_CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
  AI_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  AI_MAX_EXTRACTED_TEXT_BYTES: z.coerce
    .number()
    .int()
    .min(64 * 1024)
    .max(5 * 1024 * 1024)
    .default(1024 * 1024),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  SERVICE_TOKEN_PRIVATE_KEY_PATH: z.string().optional(),
  SERVICE_TOKEN_PUBLIC_KEY_PATH: z.string().optional(),
  SERVICE_TOKEN_ISSUER: z.string().min(1).default("ailss-internal"),
  SERVICE_TOKEN_AUDIENCE: z.string().min(1).default("identity-service"),
  SERVICE_TOKEN_PURPOSE: z.string().min(1).default("identity.public-profile.read"),
  SERVICE_TOKEN_KID: z.string().min(1).default("dev-learning-2026-01"),
  CLASSROOM_SERVICE_TOKEN_PUBLIC_KEY_PATH: z.string().optional(),
  CLASSROOM_SERVICE_TOKEN_KID: z.string().min(1).default("dev-classroom-2026-01"),
  LEARNING_SERVICE_TOKEN_PUBLIC_KEY_PATH: z.string().optional(),
  LEARNING_SERVICE_TOKEN_KID: z.string().min(1).default("dev-learning-2026-01"),
  CLASSROOM_OFFERING_CONTEXT_DEADLINE_MS: z.coerce.number().int().min(100).max(800).default(800),
  ASSESSMENT_SERVICE_TOKEN_PUBLIC_KEY_PATH: z.string().optional(),
  ASSESSMENT_SERVICE_TOKEN_KID: z.string().min(1).default("dev-assessment-2026-01"),
  INTERACTION_SERVICE_TOKEN_PUBLIC_KEY_PATH: z.string().optional(),
  INTERACTION_SERVICE_TOKEN_KID: z.string().min(1).default("dev-interaction-2026-01"),
  AI_SERVICE_TOKEN_PUBLIC_KEY_PATH: z.string().optional(),
  AI_SERVICE_TOKEN_KID: z.string().min(1).default("dev-ai-2026-01"),
  ASSESSMENT_ACCEPTANCE_DELAY_AFTER_IMPORT_DRAFT_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().uuid().optional(),
  ),
  SERVICE_TOKEN_TTL_SECONDS: z.coerce.number().int().min(1).max(60).default(60),
  IDENTITY_PUBLIC_PROFILE_DEADLINE_MS: z.coerce.number().int().min(100).max(500).default(500),
  HTTPS_CERT_PATH: z.string().optional(),
  HTTPS_KEY_PATH: z.string().optional(),
  OBJECT_STORAGE_PUBLIC_URL: z.url().optional(),
  OBJECT_STORAGE_ENDPOINT: z.string().default("127.0.0.1"),
  OBJECT_STORAGE_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  OBJECT_STORAGE_USE_SSL: bool,
  OBJECT_STORAGE_BUCKET: z.string().min(3).default("ailss-documents"),
  OBJECT_STORAGE_ACCESS_KEY: optionalInjected,
  OBJECT_STORAGE_SECRET_KEY: optionalInjected,
  MEDIA_ENABLED: bool,
  MEDIA_STORAGE_BUCKET: z.string().min(3).default("ailss-media"),
  MEDIA_STORAGE_ACCESS_KEY: optionalInjected,
  MEDIA_STORAGE_SECRET_KEY: optionalInjected,
  MEDIA_MAX_SOURCE_BYTES: z.coerce.number().int().positive().max(80_000_000_000).optional(),
  MEDIA_MAX_DURATION_SECONDS: z.coerce.number().int().positive().optional(),
  MEDIA_PLAYBACK_SECRET: optionalInjected,
  MEDIA_DELIVERY_ORIGIN: z.url().optional(),
  MEDIA_ALLOWED_ORIGINS: z.string().default(""),
  MEDIA_ALLOWED_CONTAINERS: z.string().default("mp4,webm"),
  MEDIA_ALLOWED_VIDEO_CODECS: z.string().default("h264,vp9,av1"),
  MEDIA_ALLOWED_AUDIO_CODECS: z.string().default("aac,opus,vorbis,mp3"),
  MEDIA_UPLOAD_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  MEDIA_PROCESSING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(3_600_000).default(600000),
  MEDIA_RENDITION_HEIGHT: z.coerce.number().int().min(2).max(2160).default(360),
  MEDIA_VIDEO_BITRATE: z.coerce.number().int().min(64000).max(20_000_000).default(800000),
  MEDIA_TRANSCODE_PROFILES: z.string().optional(),
  MEDIA_QUOTA_LIMITS: z.string().optional(),
  MEDIA_PLAYBACK_TTL_SECONDS: z.coerce.number().int().min(1).max(300).default(120),
  GOOGLE_CLIENT_IDS: z.string().default(""),
  APPLE_CLIENT_IDS: z.string().default(""),
  SEPAY_WEBHOOK_API_KEY: optionalInjected,
  SEPAY_REFUND_API_URL: z.string().url().optional(),
});

export type AppConfig = z.infer<typeof baseSchema>;

export class ConfigurationError extends Error {
  public constructor(public readonly issues: readonly string[]) {
    super("Environment configuration is invalid");
    this.name = "ConfigurationError";
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = baseSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  if (result.data.ENABLE_CASSANDRA && (!result.data.CASSANDRA_USERNAME || !result.data.CASSANDRA_PASSWORD)) {
    throw new ConfigurationError(["Cassandra is enabled but per-process credentials are missing"]);
  }
  if (result.data.ENABLE_RABBITMQ && (!result.data.RABBITMQ_USERNAME || !result.data.RABBITMQ_PASSWORD)) {
    throw new ConfigurationError(["RabbitMQ is enabled but per-process credentials are missing"]);
  }
  if (result.data.NODE_ENV === "production" && result.data.NOTIFICATION_CURSOR_TTL_SECONDS !== 900) {
    throw new ConfigurationError(["Notification cursor TTL override is disabled in production"]);
  }
  if (result.data.NODE_ENV === "production" && result.data.AI_PROVIDER_MODE !== "production") {
    throw new ConfigurationError(["Deterministic AI provider is disabled in production"]);
  }
  const productionLike =
    result.data.NODE_ENV === "production" ||
    source.AILSS_PROFILE?.trim().toLowerCase() === "production" ||
    source.DEPLOYMENT_ENV?.trim().toLowerCase() === "production";
  if (
    productionLike &&
    (result.data.AI_ASSISTANT_PROVIDER_MODE !== "external" || result.data.AI_ASSISTANT_INTEGRATION_ENABLED)
  ) {
    throw new ConfigurationError([
      "Integration-only assistant model adapter is disabled in production-like profiles",
    ]);
  }
  if (
    result.data.AI_ASSISTANT_PROVIDER_MODE === "integration-only" &&
    (!result.data.AI_ASSISTANT_INTEGRATION_ENABLED ||
      !["development", "research"].includes(result.data.NODE_ENV))
  ) {
    throw new ConfigurationError([
      "Integration-only assistant model adapter requires explicit enablement in development or research",
    ]);
  }
  if (
    result.data.AI_ASSISTANT_INTEGRATION_ENABLED &&
    result.data.AI_ASSISTANT_PROVIDER_MODE !== "integration-only"
  ) {
    throw new ConfigurationError([
      "Assistant integration adapter enablement requires integration-only provider mode",
    ]);
  }
  if (
    result.data.NODE_ENV === "production" &&
    result.data.SERVICE_ID === "ai-worker" &&
    !result.data.AI_PROVIDER_API_KEY
  ) {
    throw new ConfigurationError(["Production AI worker provider credential is missing"]);
  }
  if (result.data.NODE_ENV === "production" && result.data.MEDIA_ENABLED) {
    if (!result.data.MEDIA_STORAGE_ACCESS_KEY || !result.data.MEDIA_STORAGE_SECRET_KEY) {
      throw new ConfigurationError(["Production media storage credentials are missing"]);
    }
    if (!result.data.OBJECT_STORAGE_USE_SSL) {
      throw new ConfigurationError(["Production object storage must use SSL"]);
    }
    if (result.data.MEDIA_DELIVERY_ORIGIN && !result.data.MEDIA_DELIVERY_ORIGIN.startsWith("https://")) {
      throw new ConfigurationError(["Production media delivery origin must use HTTPS"]);
    }
  }
  return result.data;
}

export function parseContactPoints(value: string): readonly { host: string; port: number }[] {
  return value.split(",").map((entry) => {
    const [host, portText = "9042"] = entry.trim().split(":");
    const port = Number(portText);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ConfigurationError([`Invalid Cassandra contact point: ${entry}`]);
    }
    return { host, port };
  });
}
