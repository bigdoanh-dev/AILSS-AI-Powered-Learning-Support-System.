import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler, Response as ExpressResponse } from "express";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, errorEnvelope } from "../../../packages/http/src/index.js";
import { PASSWORD_RESET_REQUEST_TIMEOUT_MS } from "./auth-timeouts.js";

/**
 * Tracks circuit breaker probe admittance and single-source result recording per request.
 * Coordinates Express gateway middleware and outbound intercepted fetch calls so that:
 * 1. An admitted HALF_OPEN trial probe is never blocked by nested breaker.fetch().
 * 2. Exactly one result is recorded per upstream service call (no duplicate samples).
 */
class RequestBreakerTracker {
  readonly #probes = new Set<string>();
  readonly #recorded = new Set<string>();
  readonly #middlewareRecorded = new Set<string>();

  public isProbe(service: string): boolean {
    return this.#probes.has(service);
  }

  public markProbe(service: string): void {
    this.#probes.add(service);
  }

  public unmarkProbe(service: string): void {
    this.#probes.delete(service);
  }

  public isRecorded(service: string): boolean {
    return this.#recorded.has(service);
  }

  public markRecorded(service: string): void {
    this.#recorded.add(service);
  }

  public isMiddlewareRecorded(service: string): boolean {
    return this.#middlewareRecorded.has(service);
  }

  public markMiddlewareRecorded(service: string): void {
    this.#middlewareRecorded.add(service);
    this.#recorded.add(service);
  }
}

const requestBreakerStorage = new AsyncLocalStorage<RequestBreakerTracker>();

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type UpstreamService =
  | "identity"
  | "learning"
  | "classroom"
  | "assessment"
  | "interaction"
  | "ai"
  | "notification"
  | "media-delivery"
  | (string & {});

export interface CircuitBreakerLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
  info?(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

export interface StateChangeDetails {
  service: string;
  fromState: CircuitState;
  toState: CircuitState;
  failureRate: number;
  failures: number;
  total: number;
  reason?: string | undefined;
}

export interface CircuitBreakerOptions {
  /** Failure rate threshold between 0 and 1. Default: 0.5 (50%) */
  failureThreshold?: number | undefined;
  /** Sliding window duration in milliseconds. Default: 10_000 (10 seconds) */
  windowDurationMs?: number | undefined;
  /** Minimum number of requests in window required before tripping. Default: 5 */
  volumeThreshold?: number | undefined;
  /** Duration in milliseconds to stay in OPEN state before testing HALF_OPEN. Default: 10_000 (10s) */
  resetTimeoutMs?: number | undefined;
  /** Timeout in milliseconds for hanging requests. Default: 5_000 */
  timeoutMs?: number | undefined;
  /** Custom underlying fetch function (defaults to globalThis.fetch) */
  fetcher?: typeof fetch | undefined;
  /** Logger for recording state transitions */
  logger?: CircuitBreakerLogger | undefined;
  /** Callback fired on every state change */
  onStateChange?: ((from: CircuitState, to: CircuitState, details: StateChangeDetails) => void) | undefined;
}

export interface WindowStats {
  total: number;
  failures: number;
  successes: number;
  clientErrors: number;
  failureRate: number;
}

interface WindowSample {
  timestamp: number;
  type: "failure" | "success" | "clientError";
}

export interface GatewayUpstreamUrls {
  readonly IDENTITY_SERVICE_URL?: string | undefined;
  readonly LEARNING_SERVICE_URL?: string | undefined;
  readonly CLASSROOM_SERVICE_URL?: string | undefined;
  readonly ASSESSMENT_SERVICE_URL?: string | undefined;
  readonly INTERACTION_SERVICE_URL?: string | undefined;
  readonly AI_SERVICE_URL?: string | undefined;
  readonly NOTIFICATION_SERVICE_URL?: string | undefined;
}

/**
 * Resilient, zero-dependency Circuit Breaker for API Gateway upstreams.
 *
 * Implements the standard 3-state machine:
 * - CLOSED: Requests pass through. Failures are tracked in a 10s sliding window.
 *   Trips to OPEN if failure rate >= 50% and minimum sample volume is reached.
 * - OPEN: Immediately returns 503 Service Unavailable without calling upstream.
 * - HALF_OPEN: After resetTimeout expires, allows a single trial request to test upstream health.
 *   Success recovers to CLOSED; failure trips back to OPEN.
 *
 * Client 4xx responses are explicitly excluded from upstream failure counts.
 * Upstream requests are bounded by timeoutMs and genuinely aborted via AbortSignal.
 * Local Gateway errors (e.g. INTERNAL_ERROR) are separated from upstream failures.
 */
export class CircuitBreaker {
  public readonly service: string;
  public readonly failureThreshold: number;
  public readonly windowDurationMs: number;
  public readonly volumeThreshold: number;
  public readonly resetTimeoutMs: number;
  public readonly timeoutMs: number;

  #state: CircuitState = "CLOSED";
  #openedAt = 0;
  #probeInFlight = false;
  #samples: WindowSample[] = [];
  #resetTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  #nativeFetch: typeof fetch;
  readonly #logger: CircuitBreakerLogger | undefined = undefined;
  readonly #onStateChange:
    ((from: CircuitState, to: CircuitState, details: StateChangeDetails) => void) | undefined = undefined;

  public constructor(service: string, options: CircuitBreakerOptions = {}) {
    if (!service || typeof service !== "string") {
      throw new TypeError("CircuitBreaker requires a valid service name");
    }
    this.service = service;
    this.failureThreshold = options.failureThreshold ?? 0.5;
    this.windowDurationMs = options.windowDurationMs ?? 10_000;
    this.volumeThreshold = options.volumeThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 10_000;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.#nativeFetch = options.fetcher ?? globalThis.fetch;
    this.#logger = options.logger;
    this.#onStateChange = options.onStateChange;
  }

  public setNativeFetch(fetcher: typeof fetch): void {
    this.#nativeFetch = fetcher;
  }

  public get state(): CircuitState {
    return this.getState();
  }

  public getState(now = Date.now()): CircuitState {
    if (this.#state === "OPEN" && now >= this.#openedAt + this.resetTimeoutMs) {
      this.#transitionTo("HALF_OPEN", "Reset timeout elapsed", now);
    }
    return this.#state;
  }

  public getRemainingResetTimeMs(now = Date.now()): number {
    if (this.#state !== "OPEN") return 0;
    const remaining = this.#openedAt + this.resetTimeoutMs - now;
    return Math.max(0, remaining);
  }

  #prune(now: number): void {
    const cutoff = now - this.windowDurationMs;
    while (this.#samples.length > 0 && (this.#samples[0]?.timestamp ?? 0) <= cutoff) {
      this.#samples.shift();
    }
  }

  public getStats(now = Date.now()): WindowStats {
    this.#prune(now);
    let failures = 0;
    let successes = 0;
    let clientErrors = 0;
    for (const sample of this.#samples) {
      if (sample.type === "failure") failures += 1;
      else if (sample.type === "success") successes += 1;
      else clientErrors += 1;
    }
    const total = failures + successes + clientErrors;
    const failureRate = total > 0 ? failures / total : 0;
    return { total, failures, successes, clientErrors, failureRate };
  }

  #transitionTo(newState: CircuitState, reason?: string, now = Date.now()): void {
    const fromState = this.#state;
    if (fromState === newState) return;
    this.#state = newState;

    if (this.#resetTimer) {
      clearTimeout(this.#resetTimer);
      this.#resetTimer = undefined;
    }

    if (newState === "OPEN") {
      this.#openedAt = now;
      this.#scheduleResetTimer();
    } else if (newState === "CLOSED") {
      this.#probeInFlight = false;
      this.#samples = [];
    }

    const stats = this.getStats(now);
    const details: StateChangeDetails = {
      service: this.service,
      fromState,
      toState: newState,
      failureRate: stats.failureRate,
      failures: stats.failures,
      total: stats.total,
      reason,
    };

    if (this.#logger) {
      this.#logger.warn(
        {
          circuitBreaker: {
            service: this.service,
            fromState,
            toState: newState,
            failureRate: stats.failureRate,
            failures: stats.failures,
            totalRequests: stats.total,
            reason,
          },
        },
        `Circuit breaker for service "${this.service}" transitioned from ${fromState} to ${newState}`,
      );
    }

    this.#onStateChange?.(fromState, newState, details);
  }

  #scheduleResetTimer(): void {
    this.#resetTimer = setTimeout(() => {
      if (this.#state === "OPEN") {
        this.#transitionTo("HALF_OPEN", "Reset timeout elapsed");
      }
    }, this.resetTimeoutMs);
    this.#resetTimer.unref();
  }

  public recordSuccess(now = Date.now()): void {
    this.#recordResult("success", now);
  }

  public recordFailure(now = Date.now()): void {
    this.#recordResult("failure", now);
  }

  public recordClientError(now = Date.now()): void {
    this.#recordResult("clientError", now);
  }

  #recordResult(type: "failure" | "success" | "clientError", now = Date.now()): void {
    const currentState = this.getState(now);

    if (currentState === "HALF_OPEN") {
      this.#probeInFlight = false;
      if (type === "failure") {
        this.#transitionTo("OPEN", "Half-open trial probe failed", now);
      } else {
        // Both 2xx (success) and 4xx (clientError) confirm the upstream service is responding
        this.#transitionTo("CLOSED", "Half-open trial probe succeeded", now);
      }
      return;
    }

    if (currentState === "CLOSED") {
      this.#samples.push({ timestamp: now, type });
      this.#prune(now);
      const stats = this.getStats(now);
      if (stats.total >= this.volumeThreshold && stats.failureRate >= this.failureThreshold) {
        this.#transitionTo(
          "OPEN",
          `Failure rate ${(stats.failureRate * 100).toFixed(1)}% reached threshold ${(this.failureThreshold * 100).toFixed(1)}% (${String(stats.failures)}/${String(stats.total)} failures)`,
          now,
        );
      }
    }
  }

  public trip(reason = "Manual trip", now = Date.now()): void {
    this.#transitionTo("OPEN", reason, now);
  }

  public reset(): void {
    if (this.#resetTimer) {
      clearTimeout(this.#resetTimer);
      this.#resetTimer = undefined;
    }
    this.#samples = [];
    this.#probeInFlight = false;
    this.#state = "CLOSED";
    this.#openedAt = 0;
  }

  public dispose(): void {
    if (this.#resetTimer) {
      clearTimeout(this.#resetTimer);
      this.#resetTimer = undefined;
    }
  }

  /**
   * Executes an asynchronous operation protected by this circuit breaker.
   * Genuinely aborts hanging execution via AbortSignal.
   */
  public async execute<T>(
    action: (signal: AbortSignal) => Promise<T>,
    timeoutOverrideMs?: number,
  ): Promise<T> {
    const currentState = this.getState();
    if (currentState === "OPEN") {
      throw new AppError(
        "CIRCUIT_BREAKER_OPEN",
        503,
        `Service "${this.service}" is temporarily unavailable due to open circuit breaker`,
        true,
        [{ reason: `Circuit breaker for ${this.service} is OPEN` }],
      );
    }

    if (currentState === "HALF_OPEN") {
      if (this.#probeInFlight) {
        throw new AppError(
          "CIRCUIT_BREAKER_OPEN",
          503,
          `Service "${this.service}" is testing recovery (trial probe in flight)`,
          true,
          [{ reason: `Circuit breaker for ${this.service} is HALF_OPEN and testing upstream` }],
        );
      }
      this.#probeInFlight = true;
    }

    const effectiveTimeout = timeoutOverrideMs ?? this.timeoutMs;
    const controller = new AbortController();
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    if (effectiveTimeout > 0) {
      timeoutTimer = setTimeout(() => {
        controller.abort(new Error("GATEWAY_TIMEOUT"));
      }, effectiveTimeout);
      timeoutTimer.unref();
    }

    try {
      const result = await action(controller.signal);
      this.#recordResult("success");
      return result;
    } catch (error) {
      if (error instanceof AppError && error.status >= 400 && error.status < 500) {
        this.#recordResult("clientError");
        throw error;
      }
      this.#recordResult("failure");
      if (controller.signal.aborted) {
        throw new AppError(
          "GATEWAY_TIMEOUT",
          503,
          `Service "${this.service}" request timed out after ${String(effectiveTimeout)}ms`,
          true,
        );
      }
      throw error;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }
  }

  /**
   * Performs an upstream fetch call protected by this circuit breaker.
   * Directly aborts the upstream network connection via AbortSignal on timeout.
   */
  public async fetch(
    input: string | URL | Request,
    init?: RequestInit & { timeoutMs?: number | undefined },
  ): Promise<Response> {
    const tracker = requestBreakerStorage.getStore();
    const isAdmittedProbe = tracker?.isProbe(this.service) ?? false;
    const currentState = this.getState();

    if (currentState === "OPEN") {
      throw new AppError(
        "CIRCUIT_BREAKER_OPEN",
        503,
        `Service "${this.service}" is temporarily unavailable due to open circuit breaker`,
        true,
        [{ reason: `Circuit breaker for ${this.service} is OPEN` }],
      );
    }

    if (currentState === "HALF_OPEN") {
      if (isAdmittedProbe) {
        // Already admitted as the probe by the middleware, permit upstream request
      } else if (this.#probeInFlight) {
        throw new AppError(
          "CIRCUIT_BREAKER_OPEN",
          503,
          `Service "${this.service}" is testing recovery (trial probe in flight)`,
          true,
          [{ reason: `Circuit breaker for ${this.service} is HALF_OPEN and testing upstream` }],
        );
      } else {
        this.#probeInFlight = true;
        tracker?.markProbe(this.service);
      }
    }

    const effectiveTimeout = init?.timeoutMs ?? this.timeoutMs;
    const timeoutSignal = effectiveTimeout > 0 ? AbortSignal.timeout(effectiveTimeout) : undefined;
    const combinedSignal =
      init?.signal && timeoutSignal
        ? AbortSignal.any([init.signal, timeoutSignal])
        : (init?.signal ?? timeoutSignal);

    const requestInit: RequestInit = { ...init };
    if (combinedSignal) {
      requestInit.signal = combinedSignal;
    }

    try {
      const response = await this.#nativeFetch(input, requestInit);
      // Each outbound call contributes one sample. The tracker only suppresses the
      // Express response sample for the same request, including multi-fetch routes.
      if (!tracker?.isMiddlewareRecorded(this.service)) {
        tracker?.markRecorded(this.service);
        if (response.status >= 500) {
          this.#recordResult("failure");
        } else if (response.status >= 400) {
          this.#recordResult("clientError");
        } else {
          this.#recordResult("success");
        }
      }
      return response;
    } catch (error) {
      if (!tracker?.isMiddlewareRecorded(this.service)) {
        tracker?.markRecorded(this.service);
        this.#recordResult("failure");
      }
      if (timeoutSignal?.aborted) {
        throw new AppError(
          "GATEWAY_TIMEOUT",
          503,
          `Service "${this.service}" request timed out after ${String(effectiveTimeout)}ms`,
          true,
        );
      }
      throw error;
    }
  }

  /**
   * Express middleware for protecting an upstream route.
   * Short-circuits with 503 immediately when OPEN.
   * Excludes Gateway local errors (e.g. INTERNAL_ERROR) from upstream failure calculations.
   */
  public middleware(timeoutMs = this.timeoutMs): RequestHandler {
    return (request, response, next): void => {
      const existingTracker = requestBreakerStorage.getStore();
      const tracker = existingTracker ?? new RequestBreakerTracker();

      const run = (): void => {
        const currentState = this.getState();

        if (currentState === "OPEN") {
          response.setHeader(
            "Retry-After",
            String(Math.max(1, Math.ceil(this.getRemainingResetTimeMs() / 1000))),
          );
          response
            .status(503)
            .json(
              errorEnvelope(
                "CIRCUIT_BREAKER_OPEN",
                `Service "${this.service}" is temporarily unavailable due to open circuit breaker`,
                [{ reason: `Circuit breaker for ${this.service} is OPEN` }],
                true,
              ),
            );
          return;
        }

        if (currentState === "HALF_OPEN") {
          if (this.#probeInFlight) {
            response
              .status(503)
              .json(
                errorEnvelope(
                  "CIRCUIT_BREAKER_OPEN",
                  `Service "${this.service}" is testing recovery (trial probe in flight)`,
                  [{ reason: `Circuit breaker for ${this.service} is HALF_OPEN and testing upstream` }],
                  true,
                ),
              );
            return;
          }
          this.#probeInFlight = true;
          tracker.markProbe(this.service);
        }

        let completed = false;
        let isLocalGatewayError = false;
        let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

        // Intercept json() calls to detect Gateway local INTERNAL_ERROR
        const originalJson = response.json.bind(response);
        response.json = (body: unknown): ExpressResponse => {
          if (
            body &&
            typeof body === "object" &&
            "error" in body &&
            typeof (body as { error?: { code?: string } }).error === "object" &&
            (body as { error?: { code?: string } }).error?.code === "INTERNAL_ERROR"
          ) {
            isLocalGatewayError = true;
          }
          return originalJson(body);
        };

        const cleanupProbe = (): void => {
          if (tracker.isProbe(this.service) && this.#probeInFlight && !tracker.isRecorded(this.service)) {
            this.#probeInFlight = false;
            tracker.unmarkProbe(this.service);
          }
        };

        if (timeoutMs > 0) {
          timeoutTimer = setTimeout(() => {
            if (completed) return;
            completed = true;
            if (!tracker.isRecorded(this.service)) {
              tracker.markMiddlewareRecorded(this.service);
              this.#recordResult("failure");
            }
            cleanupProbe();
            if (!response.headersSent) {
              response
                .status(503)
                .json(
                  errorEnvelope(
                    "GATEWAY_TIMEOUT",
                    `Service "${this.service}" request timed out after ${String(timeoutMs)}ms`,
                    [],
                    true,
                  ),
                );
            } else {
              response.destroy();
            }
          }, timeoutMs);
          timeoutTimer.unref();
        }

        const finishHandler = (): void => {
          if (completed) return;
          completed = true;
          if (timeoutTimer) clearTimeout(timeoutTimer);

          if (tracker.isRecorded(this.service)) {
            cleanupProbe();
            return;
          }

          if (response.writableEnded) {
            const status = response.statusCode;
            // Only record failure for upstream 5xx, NOT local Gateway INTERNAL_ERROR
            if (status >= 500) {
              if (!isLocalGatewayError) {
                tracker.markMiddlewareRecorded(this.service);
                this.#recordResult("failure");
              }
            } else if (status >= 400) {
              tracker.markMiddlewareRecorded(this.service);
              this.#recordResult("clientError");
            } else {
              tracker.markMiddlewareRecorded(this.service);
              this.#recordResult("success");
            }
          }
          cleanupProbe();
        };

        response.once("finish", finishHandler);
        response.once("close", finishHandler);

        next();
      };

      if (!existingTracker) {
        requestBreakerStorage.run(tracker, run);
      } else {
        run();
      }
    };
  }

  /**
   * Wraps an individual RequestHandler with this circuit breaker.
   */
  public wrapHandler(handler: RequestHandler): RequestHandler {
    const mw = this.middleware();
    return (req, res, next): void => {
      mw(req, res, (err) => {
        if (err) {
          next(err);
          return;
        }
        void Promise.resolve(handler(req, res, next)).catch(next);
      });
    };
  }
}

/**
 * Registry managing circuit breakers across all upstream microservices.
 */
export class CircuitBreakerRegistry {
  readonly #breakers = new Map<string, CircuitBreaker>();
  readonly #options: CircuitBreakerOptions;
  #nativeFetch: typeof fetch;

  public constructor(options: CircuitBreakerOptions = {}) {
    this.#options = options;
    this.#nativeFetch = options.fetcher ?? globalThis.fetch;
  }

  public setNativeFetch(fetcher: typeof fetch): void {
    this.#nativeFetch = fetcher;
    for (const breaker of this.#breakers.values()) {
      breaker.setNativeFetch(fetcher);
    }
  }

  public get(service: UpstreamService, overrides?: CircuitBreakerOptions): CircuitBreaker {
    let breaker = this.#breakers.get(service);
    if (!breaker) {
      breaker = new CircuitBreaker(service, {
        fetcher: this.#nativeFetch,
        ...this.#options,
        ...overrides,
      });
      this.#breakers.set(service, breaker);
    }
    return breaker;
  }

  public has(service: UpstreamService): boolean {
    return this.#breakers.has(service);
  }

  public resetAll(): void {
    for (const breaker of this.#breakers.values()) {
      breaker.reset();
    }
  }

  public disposeAll(): void {
    for (const breaker of this.#breakers.values()) {
      breaker.dispose();
    }
    this.#breakers.clear();
  }

  public getAll(): ReadonlyMap<string, CircuitBreaker> {
    return this.#breakers;
  }
}

export interface GatewayCircuitBreakers extends CircuitBreakerRegistry {
  identity: CircuitBreaker;
  learning: CircuitBreaker;
  classroom: CircuitBreaker;
  assessment: CircuitBreaker;
  interaction: CircuitBreaker;
  ai: CircuitBreaker;
  notification: CircuitBreaker;
}

/**
 * Factory for instantiating the 7 standard API Gateway upstream circuit breakers.
 * Reads configuration from environment with fallbacks to AppConfig.
 */
export function createGatewayCircuitBreakers(
  config?: Partial<AppConfig>,
  logger?: CircuitBreakerLogger,
  overrides?: CircuitBreakerOptions,
): GatewayCircuitBreakers {
  const timeoutMs =
    process.env.CIRCUIT_BREAKER_TIMEOUT_MS !== undefined
      ? Number(process.env.CIRCUIT_BREAKER_TIMEOUT_MS)
      : (overrides?.timeoutMs ?? config?.INTERNAL_HTTP_TIMEOUT_MS ?? 5_000);
  const failureThreshold =
    process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD !== undefined
      ? Number(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD)
      : (overrides?.failureThreshold ?? 0.5);
  const windowDurationMs =
    process.env.CIRCUIT_BREAKER_WINDOW_MS !== undefined
      ? Number(process.env.CIRCUIT_BREAKER_WINDOW_MS)
      : (overrides?.windowDurationMs ?? 10_000);
  const volumeThreshold =
    process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD !== undefined
      ? Number(process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD)
      : (overrides?.volumeThreshold ?? 5);
  const resetTimeoutMs =
    process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS !== undefined
      ? Number(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS)
      : (overrides?.resetTimeoutMs ?? 10_000);

  const baseOptions: CircuitBreakerOptions = {
    failureThreshold,
    windowDurationMs,
    volumeThreshold,
    resetTimeoutMs,
    timeoutMs,
    logger,
    ...overrides,
  };

  const registry = new CircuitBreakerRegistry(baseOptions);
  const identity = registry.get("identity");
  const learning = registry.get("learning");
  const classroom = registry.get("classroom");
  const assessment = registry.get("assessment");
  const interaction = registry.get("interaction");
  const ai = registry.get("ai");
  const notification = registry.get("notification");

  return Object.assign(registry, {
    identity,
    learning,
    classroom,
    assessment,
    interaction,
    ai,
    notification,
  });
}

/**
 * Maps incoming HTTP method and path to the targeted upstream microservice.
 * Returns null if the route is handled locally by API Gateway (e.g. /health, /metrics).
 */
export function resolveUpstreamService(_method: string, path: string): UpstreamService | null {
  const normalized = (path.split("?")[0] ?? path).replace(/\/+$/u, "") || "/";

  // Internal gateway local endpoints - bypass circuit breakers
  if (
    normalized.startsWith("/health") ||
    normalized === "/metrics" ||
    normalized === "/api/v1/admin/monitoring" ||
    normalized === "/api/v1/admin/dashboard/operations"
  ) {
    return null;
  }

  // Media delivery streaming
  if (normalized.startsWith("/playback")) {
    return "media-delivery";
  }

  // Auth & Lecturer routes -> identity-service
  if (
    normalized.startsWith("/api/v1/auth") ||
    normalized.startsWith("/api/v1/lecturers") ||
    normalized.startsWith("/api/v1/lecturer-applications")
  ) {
    return "identity";
  }

  // /api/v1/me routes dispatched by resource type
  if (normalized.startsWith("/api/v1/me")) {
    if (
      normalized === "/api/v1/me" ||
      normalized.startsWith("/api/v1/me/lecturer-profile") ||
      normalized.startsWith("/api/v1/me/avatar") ||
      normalized.startsWith("/api/v1/me/password") ||
      normalized.startsWith("/api/v1/me/lecturer-application")
    ) {
      return "identity";
    }

    if (
      normalized.startsWith("/api/v1/me/courses") ||
      normalized.startsWith("/api/v1/me/owned-courses") ||
      normalized.startsWith("/api/v1/me/owned-offerings") ||
      normalized.startsWith("/api/v1/me/dashboard/revenue") ||
      normalized.startsWith("/api/v1/me/payout-account") ||
      normalized.startsWith("/api/v1/me/commission")
    ) {
      return "learning";
    }

    if (
      normalized.startsWith("/api/v1/me/classes") ||
      normalized.startsWith("/api/v1/me/schedule") ||
      normalized.startsWith("/api/v1/me/owned-classes") ||
      normalized.startsWith("/api/v1/me/attendance")
    ) {
      return "classroom";
    }

    return "identity";
  }

  // Admin routes dispatched by domain
  if (normalized.startsWith("/api/v1/admin")) {
    if (
      normalized.startsWith("/api/v1/admin/users") ||
      normalized.startsWith("/api/v1/admin/lecturers") ||
      normalized.startsWith("/api/v1/admin/lecturer-applications") ||
      normalized.startsWith("/api/v1/admin/dashboard/stats")
    ) {
      return "identity";
    }

    if (
      normalized.startsWith("/api/v1/admin/courses") ||
      normalized.startsWith("/api/v1/admin/dashboard/revenue") ||
      normalized.startsWith("/api/v1/admin/payouts") ||
      normalized.startsWith("/api/v1/admin/commission")
    ) {
      return "learning";
    }

    if (normalized.startsWith("/api/v1/admin/reports") || normalized.startsWith("/api/v1/admin/audit-logs")) {
      return "interaction";
    }

    return "identity";
  }

  // Interaction service routes (including course reviews)
  if (
    normalized.startsWith("/api/v1/resources") ||
    normalized.startsWith("/api/v1/comments") ||
    normalized.startsWith("/api/v1/reviews") ||
    normalized.startsWith("/api/v1/reports") ||
    /^\/api\/v1\/courses\/[^/]+\/reviews(?:$|\/)/u.test(normalized)
  ) {
    return "interaction";
  }

  // Learning service routes
  if (
    normalized.startsWith("/api/v1/courses") ||
    normalized.startsWith("/api/v1/offerings") ||
    normalized.startsWith("/api/v1/mastery") ||
    normalized.startsWith("/api/v1/study-plan") ||
    normalized.startsWith("/api/v1/lessons") ||
    normalized.startsWith("/api/v1/orders") ||
    normalized.startsWith("/api/v1/payments/sepay") ||
    normalized.startsWith("/api/v1/media-assets") ||
    normalized.startsWith("/api/v1/learning/refunds")
  ) {
    return "learning";
  }

  // Classroom service routes
  if (normalized.startsWith("/api/v1/classes") || normalized.startsWith("/api/v1/class-sessions")) {
    return "classroom";
  }

  // Assessment service routes
  if (
    normalized.startsWith("/api/v1/quizzes") ||
    normalized.startsWith("/api/v1/attempts") ||
    normalized.startsWith("/api/v1/targets")
  ) {
    return "assessment";
  }

  // AI service routes
  if (normalized.startsWith("/api/v1/ai") || normalized.startsWith("/api/v1/assistant")) {
    return "ai";
  }

  // Notification service routes
  if (normalized.startsWith("/api/v1/notifications")) {
    return "notification";
  }

  return null;
}

/**
 * Installs a global fetch interceptor that routes outbound upstream HTTP requests
 * through the corresponding circuit breaker.
 * Genuinely aborts upstream fetch calls via AbortSignal on timeout.
 */
export function installGatewayFetchInterceptor(
  registry: CircuitBreakerRegistry,
  urls: GatewayUpstreamUrls,
  targetGlobal: typeof globalThis = globalThis,
): () => void {
  const nativeFetch = targetGlobal.fetch;
  registry.setNativeFetch(nativeFetch);
  const urlToService = new Map<string, UpstreamService>();

  const mapping: Array<[string | undefined, UpstreamService]> = [
    [urls.IDENTITY_SERVICE_URL, "identity"],
    [urls.LEARNING_SERVICE_URL, "learning"],
    [urls.CLASSROOM_SERVICE_URL, "classroom"],
    [urls.ASSESSMENT_SERVICE_URL, "assessment"],
    [urls.INTERACTION_SERVICE_URL, "interaction"],
    [urls.AI_SERVICE_URL, "ai"],
    [urls.NOTIFICATION_SERVICE_URL, "notification"],
  ];

  for (const [url, service] of mapping) {
    if (url) {
      try {
        urlToService.set(new URL(url).origin, service);
      } catch {
        // Ignore invalid URL
      }
    }
  }

  const interceptedFetch: typeof globalThis.fetch = async (input, init) => {
    let breaker: CircuitBreaker | undefined;
    try {
      const urlString = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (urlString) {
        const parsed = new URL(urlString);
        // Exclude readiness & health checks from circuit breaking
        if (!parsed.pathname.startsWith("/health/")) {
          const service = urlToService.get(parsed.origin);
          if (service) {
            breaker = registry.get(service);
          }
        }
      }
    } catch {
      // Ignore URL parsing errors and let nativeFetch handle it
    }

    if (breaker) {
      return await breaker.fetch(input, init);
    }

    return await nativeFetch(input, init);
  };

  targetGlobal.fetch = interceptedFetch;

  return () => {
    targetGlobal.fetch = nativeFetch;
  };
}

/**
 * Gateway-wide middleware that routes requests through the upstream service's circuit breaker.
 */
export function gatewayCircuitBreakerMiddleware(
  registry: CircuitBreakerRegistry,
  assistantChatTimeoutMs = 40_000,
): RequestHandler {
  return (request, response, next): void => {
    const existingTracker = requestBreakerStorage.getStore();
    const tracker = existingTracker ?? new RequestBreakerTracker();

    const dispatch = (): void => {
      const service = resolveUpstreamService(request.method, request.path);
      if (!service) {
        next();
        return;
      }
      const breaker = registry.get(service);
      const path = request.path.replace(/\/+$/u, "");
      const timeoutMs =
        request.method !== "POST"
          ? undefined
          : path === "/api/v1/auth/password-reset/request"
            ? PASSWORD_RESET_REQUEST_TIMEOUT_MS
            : path === "/api/v1/assistant/chat"
              ? assistantChatTimeoutMs
              : undefined;
      breaker.middleware(timeoutMs)(request, response, next);
    };

    if (!existingTracker) {
      requestBreakerStorage.run(tracker, dispatch);
    } else {
      dispatch();
    }
  };
}
