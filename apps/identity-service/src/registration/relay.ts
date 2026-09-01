import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { eventEnvelopeSchema } from "../../../../packages/contracts/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { RabbitPublisher } from "../../../../packages/rabbitmq/src/index.js";
import type { DueOutboxEvent, IdentityRegistrationRepository } from "./repository.js";

const LEASE_MS = 15_000;
const MAX_BACKOFF_MS = 60_000;

export interface IdentityOutboxRelayOptions {
  readonly repository: IdentityRegistrationRepository;
  readonly rabbitUrl: string;
  readonly pollMs: number;
  readonly logger: Logger;
  readonly metrics: ReturnType<typeof createMetrics>;
}

export class IdentityOutboxRelay {
  readonly #repository: IdentityRegistrationRepository;
  readonly #rabbitUrl: string;
  readonly #pollMs: number;
  readonly #logger: Logger;
  readonly #metrics: ReturnType<typeof createMetrics>;
  readonly #owner = `identity-relay-${randomUUID()}`;
  #publisher: RabbitPublisher | undefined;
  #timer: NodeJS.Timeout | undefined;
  #running = false;
  #closed = false;

  public constructor(options: IdentityOutboxRelayOptions) {
    this.#repository = options.repository;
    this.#rabbitUrl = options.rabbitUrl;
    this.#pollMs = options.pollMs;
    this.#logger = options.logger;
    this.#metrics = options.metrics;
  }

  public start(): void {
    if (this.#timer || this.#closed) return;
    this.#timer = setInterval(() => void this.poll(), this.#pollMs);
    this.#timer.unref();
    void this.poll();
  }

  public async poll(): Promise<void> {
    if (this.#running || this.#closed) return;
    this.#running = true;
    try {
      const now = new Date();
      const due = await this.#repository.listDue(now);
      const ready = due.filter(
        (item) => item.state === "READY" && (!item.leaseUntil || item.leaseUntil.getTime() <= now.getTime()),
      );
      const oldest = ready.reduce(
        (age, item) => Math.max(age, (now.getTime() - item.nextAttemptAt.getTime()) / 1_000),
        0,
      );
      this.#metrics.outboxReadyAge.set(oldest);

      for (const item of due) {
        if (item.state === "PREPARED") {
          const isRegistrationRecovery =
            item.event.eventType === "identity.user.registered.v1" ||
            (item.event.eventType === "system.audit.requested.v1" &&
              item.event.data.action === "USER_REGISTERED");
          if (isRegistrationRecovery) {
            const user = await this.#repository.getUser(item.event.aggregate.id);
            if (user) await this.#repository.markOutboxReady(item);
          }
          continue;
        }
        if (item.state === "PUBLISHING" && item.leaseUntil && item.leaseUntil.getTime() <= now.getTime()) {
          await this.#repository.recoverExpiredClaim(item);
          continue;
        }
        if (item.state !== "READY" || (item.leaseUntil && item.leaseUntil.getTime() > now.getTime())) {
          continue;
        }
        await this.#publish(item, now);
      }
    } catch (error) {
      this.#metrics.dependencyErrors.inc({ dependency: "outbox", code: "poll_failed" });
      this.#logger.warn(
        { operation: "identity.outbox.poll", err: safeError(error) },
        "identity outbox poll failed",
      );
      await this.#discardPublisher();
    } finally {
      this.#running = false;
    }
  }

  public async close(): Promise<void> {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#discardPublisher();
  }

  async #publish(item: DueOutboxEvent, now: Date): Promise<void> {
    const claimed = await this.#repository.claim(item, this.#owner, now, LEASE_MS);
    if (!claimed) return;
    try {
      const publisher = await this.#getPublisher();
      const event = eventEnvelopeSchema.parse(item.event);
      await publisher.publish(exchangeFor(event.eventType), event.eventType, event);
      await this.#repository.markPublished(item, new Date());
      this.#metrics.publishConfirms.inc({ result: "confirmed" });
      this.#logger.info(
        { operation: "identity.outbox.publish", eventId: item.eventId, eventType: event.eventType },
        "identity outbox event confirmed",
      );
    } catch (error) {
      const delay = Math.min(1_000 * 2 ** Math.min(item.retryCount, 6), MAX_BACKOFF_MS);
      await this.#repository.releaseForRetry(item, new Date(Date.now() + delay));
      this.#metrics.publishConfirms.inc({ result: "failed" });
      this.#logger.warn(
        {
          operation: "identity.outbox.publish",
          eventId: item.eventId,
          eventType: item.event.eventType,
          retryCount: item.retryCount + 1,
          err: safeError(error),
        },
        "identity outbox publish will retry",
      );
      await this.#discardPublisher();
    }
  }

  async #getPublisher(): Promise<RabbitPublisher> {
    this.#publisher ??= await RabbitPublisher.connect(this.#rabbitUrl);
    return this.#publisher;
  }

  async #discardPublisher(): Promise<void> {
    const publisher = this.#publisher;
    this.#publisher = undefined;
    if (!publisher) return;
    try {
      await publisher.close();
    } catch {
      // A failed broker connection is already represented by the retryable outbox row.
    }
  }
}

function exchangeFor(eventType: string): string {
  if (eventType.startsWith("ai.")) return "ailss.ai.jobs";
  if (eventType === "system.notification.requested.v1") return "ailss.notifications";
  if (eventType === "system.projection.reconcile.v1") return "ailss.system.jobs";
  return "ailss.domain.events";
}
