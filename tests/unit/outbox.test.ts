import { describe, expect, it } from "vitest";
import {
  OutboxRelay,
  assertOutboxTransition,
  preparedRecoveryDecision,
  type OutboxLease,
  type OutboxStore,
} from "../../packages/outbox/src/index.js";
import type { EventEnvelope } from "../../packages/contracts/src/index.js";

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

describe("outbox safety", () => {
  it("enforces transitions and PREPARED recovery", () => {
    expect(() => assertOutboxTransition("PREPARED", "PUBLISHED")).toThrow();
    expect(
      preparedRecoveryDecision({
        canonicalExists: true,
        canonicalVersion: 2,
        intendedVersion: 2,
        observationCount: 0,
        maxObservations: 3,
      }),
    ).toBe("PROMOTE_READY");
    expect(
      preparedRecoveryDecision({
        canonicalExists: false,
        intendedVersion: 2,
        observationCount: 1,
        maxObservations: 3,
      }),
    ).toBe("RESCHEDULE");
    expect(
      preparedRecoveryDecision({
        canonicalExists: false,
        intendedVersion: 2,
        observationCount: 3,
        maxObservations: 3,
      }),
    ).toBe("CANCEL");
  });

  it("recovers the same eventId after broker failure and completes the state path", async () => {
    for (const [from, to] of [
      ["PREPARED", "READY"],
      ["READY", "PUBLISHING"],
      ["PUBLISHING", "PUBLISHED"],
    ] as const)
      assertOutboxTransition(from, to);

    const lease: OutboxLease = {
      eventId: event.eventId,
      event,
      leaseOwner: "relay-1",
      leaseUntil: new Date(Date.now() + 1_000),
      leaseFence: 1n,
    };
    const observedEventIds: string[] = [];
    let due = true;
    let published = false;
    const store: OutboxStore = {
      async prepare() {},
      async markReady() {},
      async claimDue() {
        return due ? [lease] : [];
      },
      async markPublished(value) {
        observedEventIds.push(value.event.eventId);
        published = true;
        due = false;
      },
      async releaseForRetry(value) {
        observedEventIds.push(value.event.eventId);
        due = true;
      },
      async markTerminal() {},
    };
    let brokerAvailable = false;
    const relay = new OutboxRelay(store, {
      async publish(value) {
        observedEventIds.push(value.eventId);
        if (!brokerAvailable) throw new Error("broker unavailable");
      },
    });
    expect(
      await relay.runBatch("relay-1", new Date(), {
        leaseMs: 1_000,
        limit: 10,
        retryDelayMs: 50,
        maxAttempts: 4,
      }),
    ).toEqual({ published: 0, retried: 1, terminal: 0 });
    expect(due).toBe(true);
    expect(published).toBe(false);

    brokerAvailable = true;
    expect(
      await relay.runBatch("relay-1", new Date(), {
        leaseMs: 1_000,
        limit: 10,
        retryDelayMs: 50,
        maxAttempts: 4,
      }),
    ).toEqual({ published: 1, retried: 0, terminal: 0 });
    expect(published).toBe(true);
    expect(new Set(observedEventIds)).toEqual(new Set([event.eventId]));
  });
});
