import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { AiDocumentRelay } from "../../apps/ai-service/src/documents/relay.js";
import { RabbitPublisher } from "../../packages/rabbitmq/src/index.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";

describe("AI outbox exchange routing", () => {
  it.each([
    ["ai.document.extract.v1", "ailss.ai.jobs"],
    ["ai.quiz.generate.v1", "ailss.ai.jobs"],
    ["ai.quiz.generated.v1", "ailss.domain.events"],
    ["ai.job.failed.v1", "ailss.domain.events"],
  ])("routes %s to %s", async (eventType, exchange) => {
    const event = {
      specVersion: "1.0",
      eventId: randomUUID(),
      eventType,
      occurredAt: new Date().toISOString(),
      producer: "ai-service",
      correlationId: randomUUID(),
      aggregate: { type: "AI_JOB", id: randomUUID(), version: 1 },
      data: {},
    };
    const execute = vi
      .fn()
      .mockResolvedValue([])
      .mockResolvedValueOnce([
        { state: "READY", lease_fence: 0, event_id: event.eventId, payload_json: JSON.stringify(event) },
      ])
      .mockResolvedValueOnce([{ "[applied]": true }]);
    const publish = vi.fn().mockResolvedValue(undefined),
      close = vi.fn().mockResolvedValue(undefined);
    const connect = vi
      .spyOn(RabbitPublisher, "connect")
      .mockResolvedValue({ publish, close } as unknown as RabbitPublisher);
    const relay = new AiDocumentRelay({ execute } as unknown as CassandraClient, "unused");
    try {
      await relay.poll();
      expect(publish).toHaveBeenCalledWith(exchange, eventType, event);
    } finally {
      await relay.close();
      connect.mockRestore();
    }
  });

  it("recovers from a background poll timeout and continues polling", async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error("CASSANDRA_TIMEOUT")).mockResolvedValue([]);
    const onPollError = vi.fn();
    const relay = new AiDocumentRelay({ execute } as unknown as CassandraClient, "unused", onPollError);
    try {
      relay.start();
      await vi.waitFor(() => expect(onPollError).toHaveBeenCalledTimes(1));
      await expect(relay.poll()).resolves.toBeUndefined();
      expect(execute).toHaveBeenCalledTimes(33);
    } finally {
      await relay.close();
    }
  });
});
