import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsPayload } from "../../packages/contracts/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";
import { ProductAnalyticsService } from "../../apps/learning-service/src/analytics/index.js";

describe("Phase 18C — Product Intelligence, Funnels & Data Minimization", () => {
  it("sanitizes sensitive fields (passwords, tokens, cards, secrets) from payload", () => {
    const rawPayload = {
      courseTitle: "Distributed Systems with Cassandra",
      searchTerm: "ScyllaDB",
      userPassword: "PlainPassword123!",
      userToken: "jwt-secret-token",
      paymentCard: "4111222233334444",
      cvv: "123",
      nested: {
        safeField: "safe-data",
        apiSecret: "super-secret-key",
      },
    };

    const sanitized = sanitizeAnalyticsPayload(rawPayload);

    expect(sanitized.courseTitle).toBe("Distributed Systems with Cassandra");
    expect(sanitized.searchTerm).toBe("ScyllaDB");
    expect(sanitized.userPassword).toBeUndefined();
    expect(sanitized.userToken).toBeUndefined();
    expect(sanitized.paymentCard).toBeUndefined();
    expect(sanitized.cvv).toBeUndefined();
    expect((sanitized.nested as Record<string, unknown>).safeField).toBe("safe-data");
    expect((sanitized.nested as Record<string, unknown>).apiSecret).toBeUndefined();
  });

  it("ingests valid analytics events and rejects malformed events", async () => {
    const service = new ProductAnalyticsService();

    const validEvent = {
      eventId: randomUUID(),
      eventName: "course_viewed",
      eventFamily: "CATALOG",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId: randomUUID(),
      actorRole: "STUDENT",
      payload: { courseTitle: "Distributed Systems" },
    };

    const result = await service.ingestEvent(validEvent);
    expect(result.success).toBe(true);

    const invalidEvent = {
      eventId: "not-a-uuid",
      eventName: "unknown_event_name",
    };

    await expect(service.ingestEvent(invalidEvent)).rejects.toThrow(
      "Analytics event schema validation failed",
    );
  });

  it("calculates catalog, learning, and assistant funnels correctly", async () => {
    const service = new ProductAnalyticsService();
    const actorId = randomUUID();
    const courseId = randomUUID();

    // Ingest catalog journey events
    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "course_searched",
      eventFamily: "CATALOG",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId,
      actorRole: "STUDENT",
      payload: { query: "Databases" },
    });

    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "course_viewed",
      eventFamily: "CATALOG",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId,
      actorRole: "STUDENT",
      courseId,
      payload: {},
    });

    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "checkout_started",
      eventFamily: "CONVERSION",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId,
      actorRole: "STUDENT",
      courseId,
      payload: {},
    });

    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "checkout_completed",
      eventFamily: "CONVERSION",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId,
      actorRole: "STUDENT",
      courseId,
      payload: {},
    });

    // Ingest assistant journey events
    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "assistant_session_started",
      eventFamily: "ASSISTANT",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId,
      actorRole: "STUDENT",
      payload: {},
    });

    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "assistant_tool_invoked",
      eventFamily: "ASSISTANT",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId,
      actorRole: "STUDENT",
      payload: { tool: "get_knowledge_gaps" },
    });

    const adminActor: ActorContext = {
      userId: randomUUID(),
      roles: ["ADMIN"],
      sessionId: "s-admin",
      tokenVersion: 1,
      correlationId: "c-admin",
      issuedAt: 1000,
      expiresAt: 2000,
    };

    const summary = await service.getAdminIntelligence(adminActor);

    expect(summary.catalogFunnel.searched).toBe(1);
    expect(summary.catalogFunnel.viewed).toBe(1);
    expect(summary.catalogFunnel.purchased).toBe(1);
    expect(summary.catalogFunnel.overallConversionRate).toBe(1);

    expect(summary.assistantFunnel.sessionsStarted).toBe(1);
    expect(summary.assistantFunnel.toolsInvoked).toBe(1);
    expect(summary.assistantFunnel.toolAdoptionRate).toBe(1);
  });

  it("enforces lecturer data isolation: lecturer only sees metrics for their authorized courses", async () => {
    const service = new ProductAnalyticsService();
    const lecturerId = randomUUID();
    const courseA = randomUUID(); // Lecturer's course
    const courseB = randomUUID(); // Another lecturer's course

    // Events on course A
    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "course_viewed",
      eventFamily: "CATALOG",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId: randomUUID(),
      actorRole: "STUDENT",
      courseId: courseA,
      payload: {},
    });

    // Events on course B
    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "course_viewed",
      eventFamily: "CATALOG",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId: randomUUID(),
      actorRole: "STUDENT",
      courseId: courseB,
      payload: {},
    });

    const lecturerActor: ActorContext = {
      userId: lecturerId,
      roles: ["LECTURER"],
      sessionId: "s-lec",
      tokenVersion: 1,
      correlationId: "c-lec",
      issuedAt: 1000,
      expiresAt: 2000,
    };

    const lecturerMetrics = await service.getLecturerIntelligence(lecturerActor, [courseA]);

    // Should only see course A's view
    expect(lecturerMetrics.catalogFunnel.viewed).toBe(1);
  });
});
