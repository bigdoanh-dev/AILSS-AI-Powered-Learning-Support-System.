import type { RequestHandler } from "express";
import { errorEnvelope } from "./index.js";

export interface RateLimiter {
  middleware(limitPerMinute: number): RequestHandler;
}

export class InProcessRateLimiter implements RateLimiter {
  readonly #buckets = new Map<string, { count: number; resetAt: number }>();
  readonly #maxBuckets: number;
  #overflowBucket: { count: number; resetAt: number } | undefined;

  public constructor(maxBuckets = 10_000) {
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 1) {
      throw new TypeError("maxBuckets must be a positive safe integer");
    }
    this.#maxBuckets = maxBuckets;
  }

  public get bucketCount(): number {
    return this.#buckets.size;
  }

  #purgeExpired(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) this.#buckets.delete(key);
    }
  }

  public middleware(limitPerMinute: number): RequestHandler {
    return (request, response, next): void => {
      const now = Date.now();
      // Global and route-specific limiter instances already define the policy scope.
      // Excluding raw paths prevents attacker-selected 404s and resource IDs from
      // creating unbounded keys or resetting a logical per-client budget.
      const key = `${request.ip ?? "unknown"}:${request.method}`;
      let current = this.#buckets.get(key);
      if (!current) {
        this.#purgeExpired(now);
        current = this.#buckets.get(key);
      }
      const useOverflow = !current && this.#buckets.size >= this.#maxBuckets;
      const overflow = this.#overflowBucket;
      const bucket = useOverflow
        ? !overflow || overflow.resetAt <= now
          ? { count: 0, resetAt: now + 60_000 }
          : overflow
        : !current || current.resetAt <= now
          ? { count: 0, resetAt: now + 60_000 }
          : current;
      bucket.count += 1;
      if (useOverflow) this.#overflowBucket = bucket;
      else this.#buckets.set(key, bucket);
      response.setHeader("X-RateLimit-Limit", limitPerMinute);
      response.setHeader("X-RateLimit-Remaining", Math.max(0, limitPerMinute - bucket.count));
      if (bucket.count > limitPerMinute) {
        response.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
        response.status(429).json(errorEnvelope("RATE_LIMITED", "Request rate exceeded", [], true));
        return;
      }
      next();
    };
  }
}
