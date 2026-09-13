import { createHash } from "node:crypto";
import { z } from "zod";
import { RabbitConsumer } from "../../../../packages/rabbitmq/src/index.js";
import type { LearningReconciliationRepository } from "../reconciliation/repository.js";
import { crashAfter } from "./crash-injection.js";

const paidData = z.object({ orderId: z.string().uuid(), version: z.number().int().positive() }).passthrough();
export class EntitlementFulfillmentConsumer {
  private consumer: RabbitConsumer | undefined;
  private tag: string | undefined;
  private retry: NodeJS.Timeout | undefined;
  private closed = false;
  public constructor(
    private readonly rabbitUrl: string,
    private readonly reconciliation: LearningReconciliationRepository,
  ) {}
  async start() {
    if (this.closed || this.consumer) return;
    try {
      this.consumer = await RabbitConsumer.connect(this.rabbitUrl);
      this.consumer.onClose(() => {
        this.consumer = undefined;
        this.tag = undefined;
        this.scheduleReconnect();
      });
      this.tag = await this.consumer.consume("learning.entitlement.fulfill.q", 10, async (event) => {
        if (event.eventType !== "learning.order.paid.v1")
          return { kind: "dead-letter", reason: "UNEXPECTED_EVENT" };
        const parsed = paidData.safeParse(event.data);
        if (!parsed.success || event.aggregate.id !== parsed.data.orderId)
          return { kind: "dead-letter", reason: "INVALID_PAID_EVENT" };
        try {
          await this.reconciliation.schedule({
            operationId: event.eventId,
            projectionName: "ENTITLEMENT_FULFILLMENT_V1",
            canonicalId: parsed.data.orderId,
            canonicalVersion: event.aggregate.version,
            checksum: JSON.stringify({ eventId: event.eventId, correlationId: event.correlationId }),
            now: new Date(),
            shard: (createHash("sha256").update(event.eventId).digest()[0] ?? 0) % 16,
          });
          crashAfter("H_ENTITLEMENT_SCHEDULED", { eventId: event.eventId, orderId: parsed.data.orderId });
          return { kind: "ack" };
        } catch {
          return { kind: "retry", reason: "RECONCILIATION_SCHEDULE_UNAVAILABLE" };
        }
      });
    } catch {
      this.consumer = undefined;
      this.tag = undefined;
      this.scheduleReconnect();
    }
  }
  async close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.consumer && this.tag) await this.consumer.cancel(this.tag).catch(() => undefined);
    await this.consumer?.close().catch(() => undefined);
    this.consumer = undefined;
    this.tag = undefined;
  }
  private scheduleReconnect() {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.start();
    }, 1000);
    this.retry.unref();
  }
}
