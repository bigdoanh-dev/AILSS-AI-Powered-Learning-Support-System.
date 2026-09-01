import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly startedAt: number;
}

const context = new AsyncLocalStorage<RequestContext>();
const trustedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestContextMiddleware(): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    const requestId = randomUUID();
    const candidate = request.header("x-correlation-id");
    const correlationId = candidate && trustedUuid.test(candidate) ? candidate : randomUUID();
    response.setHeader("X-Request-ID", requestId);
    response.setHeader("X-Correlation-ID", correlationId);
    context.run({ requestId, correlationId, startedAt: Date.now() }, next);
  };
}

export function currentRequestContext(): RequestContext | undefined {
  return context.getStore();
}

export function sanitizeIdentityHeaders(): RequestHandler {
  const forbidden = [
    "x-user-id",
    "x-user-role",
    "x-session-id",
    "x-service-identity",
    "x-actor-context",
    "x-classroom-actor-context",
  ];
  return (request: Request, response: Response, next: NextFunction): void => {
    const forged = forbidden.find((header) => request.headers[header] !== undefined);
    if (forged) {
      response
        .status(400)
        .json(errorEnvelope("UNTRUSTED_IDENTITY_HEADER", `Header ${forged} is not accepted`));
      return;
    }
    next();
  };
}

export interface ErrorDetail {
  readonly field?: string;
  readonly reason: string;
}

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details: readonly ErrorDetail[];
    readonly retryable: boolean;
  };
  readonly meta: { readonly requestId: string };
}

export function errorEnvelope(
  code: string,
  message: string,
  details: readonly ErrorDetail[] = [],
  retryable = false,
): ErrorEnvelope {
  return {
    error: { code, message, details, retryable },
    meta: { requestId: currentRequestContext()?.requestId ?? randomUUID() },
  };
}

export class AppError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly retryable = false,
    public readonly details: readonly ErrorDetail[] = [],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorMiddleware(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    response
      .status(error.status)
      .json(errorEnvelope(error.code, error.message, error.details, error.retryable));
    return;
  }
  if (error instanceof SyntaxError && "type" in error && error.type === "entity.parse.failed") {
    response.status(400).json(errorEnvelope("INVALID_JSON", "Request body is not valid JSON"));
    return;
  }
  if (error instanceof Error && "type" in error && error.type === "entity.too.large") {
    response.status(413).json(errorEnvelope("PAYLOAD_TOO_LARGE", "Request body is too large"));
    return;
  }
  response.status(500).json(errorEnvelope("INTERNAL_ERROR", "An internal error occurred", [], true));
}

export async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
