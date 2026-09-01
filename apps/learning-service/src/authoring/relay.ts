import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { eventEnvelopeSchema } from "../../../../packages/contracts/src/index.js";
import { RabbitPublisher } from "../../../../packages/rabbitmq/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { LearningAuthoringRepository } from "./repository.js";

export class LearningOutboxRelay {
  readonly #owner = `learning-relay-${randomUUID()}`;
  #publisher: RabbitPublisher | undefined;
  #timer: NodeJS.Timeout | undefined;
  #running = false;
  public constructor(
    private readonly repository: LearningAuthoringRepository,
    private readonly rabbitUrl: string,
    private readonly logger: Logger,
    private readonly pollMs = 1000,
  ) {}
  public start() {
    this.#timer ??= setInterval(() => void this.poll(), this.pollMs);
    this.#timer.unref();
    void this.poll();
  }
  public async poll() {
    if (this.#running) return;
    this.#running = true;
    try {
      const now = new Date();
      for (const item of await this.repository.listDue(now)) {
        if (item.state === "PUBLISHING" && item.leaseUntil && item.leaseUntil <= now) {
          await this.repository.recover(item);
          continue;
        }
        if (item.state !== "READY" || (item.leaseUntil && item.leaseUntil > now)) continue;
        if (!(await this.repository.claim(item, this.#owner, now))) continue;
        try {
          this.#publisher ??= await RabbitPublisher.connect(this.rabbitUrl);
          const event = eventEnvelopeSchema.parse(item.event);
          await this.#publisher.publish(
            event.eventType === "system.projection.reconcile.v1"
              ? "ailss.system.jobs"
              : "ailss.domain.events",
            event.eventType,
            event,
          );
          await this.repository.published(item, new Date());
        } catch (error) {
          await this.repository.retry(
            item,
            new Date(Date.now() + Math.min(1000 * 2 ** Math.min(item.retryCount, 6), 60000)),
          );
          this.logger.warn(
            { operation: "learning.outbox.publish", eventId: item.eventId, err: safeError(error) },
            "learning outbox publish will retry",
          );
          await this.#discard();
        }
      }
    } catch (error) {
      this.logger.warn(
        { operation: "learning.outbox.poll", err: safeError(error) },
        "learning outbox poll failed",
      );
      await this.#discard();
    } finally {
      this.#running = false;
    }
  }
  public async close() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#discard();
  }
  async #discard() {
    const p = this.#publisher;
    this.#publisher = undefined;
    if (p)
      try {
        await p.close();
      } catch {
        /* recoverable outbox row remains */
      }
  }
}
