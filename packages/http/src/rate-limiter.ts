import type { RequestHandler } from "express";
import { errorEnvelope } from "./index.js";

export interface RateLimiter {
  middleware(limitPerMinute: number): RequestHandler;
}

export class InProcessRateLimiter implements RateLimiter {
  readonly #buckets = new Map<string, { count: number; resetAt: number }>();
  public middleware(limitPerMinute: number): RequestHandler {
    return (request, response, next): void => {
      const now = Date.now();
      const key = `${request.ip ?? "unknown"}:${request.method}:${request.path}`;
      const current = this.#buckets.get(key);
      const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + 60_000 } : current;
      bucket.count += 1;
      this.#buckets.set(key, bucket);
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
