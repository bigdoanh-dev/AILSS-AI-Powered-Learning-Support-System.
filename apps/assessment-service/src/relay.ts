import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { eventEnvelopeSchema } from "../../../packages/contracts/src/index.js";
import { RabbitPublisher } from "../../../packages/rabbitmq/src/index.js";
import { safeError } from "../../../packages/logger/src/index.js";
import type { AssessmentRepository } from "./repository.js";

export class AssessmentOutboxRelay {
  readonly #owner = `assessment-relay-${randomUUID()}`;
  #publisher: RabbitPublisher | undefined;
  #timer: NodeJS.Timeout | undefined;
  #running = false;
  constructor(
    private readonly repo: AssessmentRepository,
    private readonly url: string,
    private readonly logger: Logger,
  ) {}
  start() {
    this.#timer ??= setInterval(() => void this.poll(), 1000);
    this.#timer.unref();
    void this.poll();
  }
  async poll() {
    if (this.#running) return;
    this.#running = true;
    try {
      const now = new Date();
      for (const item of await this.repo.listDue(now)) {
        if (item.state !== "READY" || (item.leaseUntil && item.leaseUntil > now)) continue;
        if (!(await this.repo.claimEvent(item, this.#owner, now))) continue;
        try {
          this.#publisher ??= await RabbitPublisher.connect(this.url);
          const event = eventEnvelopeSchema.parse(item.event);
          await this.#publisher.publish("ailss.domain.events", event.eventType, event);
          await this.repo.publishedEvent(item, new Date());
        } catch (error) {
          await this.repo.retryEvent(
            item,
            new Date(Date.now() + Math.min(1000 * 2 ** Math.min(item.retryCount, 6), 60000)),
          );
          this.logger.warn(
            { operation: "assessment.outbox.publish", eventId: item.eventId, err: safeError(error) },
            "assessment outbox publish will retry",
          );
          await this.#discard();
        }
      }
    } catch (error) {
      this.logger.warn(
        { operation: "assessment.outbox.poll", err: safeError(error) },
        "assessment outbox poll failed",
      );
      await this.#discard();
    } finally {
      this.#running = false;
    }
  }
  async close() {
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
        /* READY row is recoverable */
      }
  }
}
