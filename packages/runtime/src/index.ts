import { createServer, type Server } from "node:http";
import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import { loadConfig, type AppConfig } from "../../config/src/index.js";
import { CassandraClient } from "../../cassandra/src/index.js";
import { errorEnvelope, errorMiddleware, requestContextMiddleware } from "../../http/src/index.js";
import { createLogger, httpRequestSerializer, safeError } from "../../logger/src/index.js";
import { createMetrics } from "../../observability/src/index.js";
import { httpMetricsMiddleware } from "../../observability/src/http.js";
import { RabbitHealthClient } from "../../rabbitmq/src/index.js";
import type { ReadinessSnapshot, ServiceId } from "../../types/src/index.js";
import { hydrateRuntimeSecrets } from "../../security/src/index.js";

export interface ServiceManifest {
  readonly serviceId: ServiceId;
  readonly ownerDomain: string;
  readonly defaultPort: number;
  readonly keyspace?: string;
  readonly cassandraRole?: string;
  readonly publicApiIds: readonly string[];
  readonly internalApiIds: readonly string[];
  readonly producedEvents: readonly string[];
  readonly consumedQueues: readonly string[];
}

export interface RuntimeHooks {
  readonly configure?: (
    app: Express,
    config: AppConfig,
    context: RuntimeContext,
  ) => Promise<RuntimeCleanup | undefined> | RuntimeCleanup | undefined;
  readonly onServer?: (
    server: Server,
    config: AppConfig,
    context: RuntimeContext,
  ) => Promise<RuntimeCleanup | undefined> | RuntimeCleanup | undefined;
}

export type RuntimeCleanup = () => Promise<void> | void;

export interface RuntimeContext {
  readonly cassandra?: CassandraClient;
  readonly logger: ReturnType<typeof createLogger>;
  readonly metrics: ReturnType<typeof createMetrics>;
}

function effectiveEnvironment(manifest: ServiceManifest): NodeJS.ProcessEnv {
  return {
    APP_NAME: manifest.serviceId,
    SERVICE_ID: manifest.serviceId,
    PORT: String(manifest.defaultPort),
    CASSANDRA_KEYSPACE: manifest.keyspace,
    CASSANDRA_USERNAME: manifest.cassandraRole,
    ...process.env,
  };
}

export async function startService(manifest: ServiceManifest, hooks: RuntimeHooks = {}): Promise<void> {
  const environment = await hydrateRuntimeSecrets(manifest.serviceId, effectiveEnvironment(manifest));
  const config = loadConfig(environment);
  const logger = createLogger({
    service: manifest.serviceId,
    environment: config.NODE_ENV,
    level: config.LOG_LEVEL,
  });
  const metrics = createMetrics(manifest.serviceId);
  let cassandra: CassandraClient | undefined;
  let rabbit: RabbitHealthClient | undefined;
  if (config.ENABLE_CASSANDRA) {
    if (!config.CASSANDRA_USERNAME || !config.CASSANDRA_PASSWORD)
      throw new Error("Cassandra credentials were not validated");
    cassandra = await CassandraClient.create({
      contactPoints: config.CASSANDRA_CONTACT_POINTS.split(",").map((value) => value.trim()),
      localDataCenter: config.CASSANDRA_LOCAL_DC,
      ...(config.CASSANDRA_KEYSPACE ? { keyspace: config.CASSANDRA_KEYSPACE } : {}),
      username: config.CASSANDRA_USERNAME,
      password: config.CASSANDRA_PASSWORD,
      startupRetry: {
        attempts: 18,
        initialDelayMs: 500,
        maxDelayMs: 15_000,
        onRetry: ({ attempt, attempts, delayMs, error }) =>
          logger.warn(
            {
              operation: "cassandra.startup.retry",
              attempt,
              attempts,
              retryInMs: delayMs,
              err: safeError(error),
            },
            "Cassandra is not ready; retrying bounded startup connection",
          ),
      },
      ...(config.CASSANDRA_TLS_ENABLED && config.CASSANDRA_CA_PATH
        ? { tls: { caPath: config.CASSANDRA_CA_PATH, serverName: config.CASSANDRA_TLS_SERVER_NAME } }
        : {}),
    });
  }
  if (config.ENABLE_RABBITMQ) {
    if (!config.RABBITMQ_USERNAME || !config.RABBITMQ_PASSWORD)
      throw new Error("RabbitMQ credentials were not validated");
    const url = new URL(config.RABBITMQ_URL);
    url.username = config.RABBITMQ_USERNAME;
    url.password = config.RABBITMQ_PASSWORD;
    rabbit = await RabbitHealthClient.connect(url.toString());
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(httpMetricsMiddleware(metrics));
  app.use(requestContextMiddleware());
  app.use(pinoHttp({ logger, serializers: { req: httpRequestSerializer } }));
  app.use("/api/v1/payments/sepay/webhook", express.json({ limit: "16kb", strict: true }));
  app.use(express.json({ limit: config.HTTP_BODY_LIMIT }));
  app.get("/health/live", (_request, response) =>
    response.json({ status: "UP", service: manifest.serviceId }),
  );
  app.get("/health/ready", async (_request, response) => {
    const dependencies = [
      ...(cassandra ? [{ name: "cassandra", ready: await cassandra.ready() }] : []),
      ...(rabbit ? [{ name: "rabbitmq", ready: rabbit.ready() }] : []),
    ];
    const snapshot: ReadinessSnapshot = {
      service: manifest.serviceId,
      ready: dependencies.every((dependency) => dependency.ready),
      dependencies,
      checkedAt: new Date().toISOString(),
    };
    response.status(snapshot.ready ? 200 : 503).json(snapshot);
  });
  app.get("/metrics", async (_request, response) => {
    response.type(metrics.registry.contentType).send(await metrics.registry.metrics());
  });
  app.get("/__foundation/manifest", (_request, response) => response.json(manifest));
  const serviceCleanup = await hooks.configure?.(app, config, {
    ...(cassandra ? { cassandra } : {}),
    logger,
    metrics,
  });
  app.all("/api/*path", (_request, response) =>
    response
      .status(501)
      .json(
        errorEnvelope("NOT_IMPLEMENTED_PHASE_7", "Business handler is intentionally deferred to Phase 7"),
      ),
  );
  app.use(errorMiddleware);
  const server = createServer(app);
  const serverCleanup = await hooks.onServer?.(server, config, {
    ...(cassandra ? { cassandra } : {}),
    logger,
    metrics,
  });
  await new Promise<void>((resolve) => server.listen(config.PORT, resolve));
  logger.info({ operation: "startup", port: config.PORT, keyspace: manifest.keyspace }, "service started");

  installFatalHandlers(logger, async (signal) => {
    logger.info({ operation: "shutdown", signal }, "graceful shutdown started");
    await closeServer(server, 10_000);
    await serverCleanup?.();
    await serviceCleanup?.();
    if (rabbit) await rabbit.close();
    if (cassandra) await cassandra.close();
  });
}

export function installFatalHandlers(
  logger: ReturnType<typeof createLogger>,
  close: (signal: string) => Promise<void>,
): void {
  let closing = false;
  const shutdown = async (signal: string, error?: unknown): Promise<void> => {
    if (closing) return;
    closing = true;
    if (error) logger.fatal({ err: safeError(error), signal }, "fatal process error");
    try {
      await close(signal);
      process.exitCode = error ? 1 : 0;
    } catch (closeError) {
      logger.fatal({ err: safeError(closeError) }, "shutdown failed");
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("uncaughtException", (error) => void shutdown("uncaughtException", error));
  process.once("unhandledRejection", (error) => void shutdown("unhandledRejection", error));
}

async function closeServer(server: Server, timeoutMs: number): Promise<void> {
  await Promise.race([
    new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    new Promise<void>((_resolve, reject) =>
      setTimeout(() => reject(new Error("HTTP_SHUTDOWN_TIMEOUT")), timeoutMs),
    ),
  ]);
}
