import pino, { type Logger } from "pino";

const REDACT_PATHS = [
  "req.headers.authorization",
  "headers.authorization",
  'req.headers["authorization"]',
  'headers["authorization"]',
  "req.headers.cookie",
  "headers.cookie",
  'req.headers["cookie"]',
  'headers["cookie"]',
  'req.headers["set-cookie"]',
  'headers["set-cookie"]',
  'req.headers["x-actor-context"]',
  'headers["x-actor-context"]',
  'req.headers["x-assessment-actor-context"]',
  'headers["x-assessment-actor-context"]',
  'req.headers["x-classroom-actor-context"]',
  'headers["x-classroom-actor-context"]',
  'req.headers["x-admin-step-up-proof"]',
  'headers["x-admin-step-up-proof"]',
  'req.headers["x-service-identity"]',
  'headers["x-service-identity"]',
  'req.headers["idempotency-key"]',
  'headers["idempotency-key"]',
  "cookie",
  "setCookie",
  "password",
  "currentPassword",
  "passwordHash",
  "refreshToken",
  "jwt",
  "token",
  "accessToken",
  "bearerToken",
  "proof",
  "stepUpProof",
  "cassandraPassword",
  "rabbitmqPassword",
  "storageSecret",
  "aiApiKey",
  "samlResponse",
  "SAMLResponse",
  "assertionXml",
  "studentAnswers",
  "answers",
  "paymentSecret",
  "privateKey",
  "clientSecret",
  "webhookSecret",
  "rawConversation",
  "conversation",
  "classCode",
  "documentBody",
];

export interface HttpRequestSerializerInput {
  readonly id?: unknown;
  readonly method?: string;
  readonly url?: string;
  readonly query?: unknown;
  readonly params?: unknown;
  readonly headers?: Record<string, unknown>;
  readonly remoteAddress?: string;
  readonly remotePort?: number;
}

export function redactSensitiveUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(
    /([?&](?:cursor|token|uploadId|X-Amz-Signature|X-Amz-Credential)=)[^&]+/giu,
    "$1[REDACTED]",
  );
}

function redactSensitiveQuery(query: unknown): unknown {
  if (!query || typeof query !== "object") return query;
  const record = query as Record<string, unknown>;
  const result = { ...record };
  for (const name of Object.keys(result))
    if (/^(cursor|token|uploadId|x-amz-signature|x-amz-credential)$/i.test(name)) result[name] = "[REDACTED]";
  return result;
}

export function httpRequestSerializer(request: HttpRequestSerializerInput): Record<string, unknown> {
  const serialized: Record<string, unknown> = { ...request };
  serialized.url = redactSensitiveUrl(request.url);
  if (request.query !== undefined) serialized.query = redactSensitiveQuery(request.query);
  return serialized;
}

export interface LoggerOptions {
  readonly service: string;
  readonly environment: string;
  readonly level: string;
  readonly destination?: pino.DestinationStream;
}

export function createLogger(options: LoggerOptions): Logger {
  const loggerOptions: pino.LoggerOptions = {
    level: options.level,
    base: { service: options.service, environment: options.environment },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    serializers: {
      err(error: Error) {
        return { type: error.name, message: error.message, stack: undefined };
      },
    },
  };
  return options.destination ? pino(loggerOptions, options.destination) : pino(loggerOptions);
}

export function safeError(error: unknown): { readonly type: string; readonly message: string } {
  return error instanceof Error
    ? { type: error.name, message: error.message }
    : { type: "UnknownError", message: "Unknown non-error rejection" };
}
