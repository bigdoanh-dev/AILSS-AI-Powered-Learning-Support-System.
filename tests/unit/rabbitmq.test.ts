import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "../../packages/contracts/src/index.js";
import { withDeduplication, type DedupStore, type EventHandler } from "../../packages/rabbitmq/src/index.js";

const event: EventEnvelope = {
  specVersion: "1.0",
  eventId: crypto.randomUUID(),
  eventType: "learning.order.paid.v1",
  occurredAt: new Date().toISOString(),
  producer: "learning-service",
  correlationId: crypto.randomUUID(),
  aggregate: { type: "order", id: crypto.randomUUID(), version: 2 },
  data: {},
};

describe("RabbitMQ consumer deduplication", () => {
  it("turns a repeated eventId into one effective handler call", async () => {
    const completed = new Set<string>();
    const store: DedupStore = {
      async claim(eventId) {
        return completed.has(eventId) ? "DUPLICATE" : "CLAIMED";
      },
      async complete(eventId) {
        completed.add(eventId);
      },
    };
    let effects = 0;
    const handler: EventHandler = async () => {
      effects += 1;
      return { kind: "ack" };
    };
    const deduplicated = withDeduplication(store, handler);

    await deduplicated(event);
    await deduplicated(event);

    expect(effects).toBe(1);
    expect(completed).toEqual(new Set([event.eventId]));
  });
});
