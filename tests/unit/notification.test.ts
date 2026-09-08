/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "../../packages/contracts/src/index.js";
import { NotificationService } from "../../apps/notification-worker/src/service.js";
import { NotificationWorker } from "../../apps/notification-worker/src/worker.js";
import type { Notification } from "../../apps/notification-worker/src/model.js";
import type { NotificationRepository } from "../../apps/notification-worker/src/repository.js";

const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const announcementId = "44444444-4444-4444-8444-444444444444";
const classId = "55555555-5555-4555-8555-555555555555";

class MemoryRepository {
  dedupRows = new Map<string, { notification_id: string; state: string; created_at: Date }>();
  rows: Notification[] = [];
  async reserve(event: string, user: string, id: string, createdAt: Date) {
    const key = `${event}:${user}`;
    if (this.dedupRows.has(key)) return false;
    this.dedupRows.set(key, { notification_id: id, state: "RESERVED", created_at: createdAt });
    return true;
  }
  async dedup(event: string, user: string) {
    return this.dedupRows.get(`${event}:${user}`);
  }
  async materialize(value: Notification) {
    if (!this.rows.some((row) => row.notificationId === value.notificationId)) this.rows.push(value);
  }
  async complete(event: string, user: string) {
    const row = this.dedupRows.get(`${event}:${user}`);
    if (row) row.state = "MATERIALIZED";
  }
  async list(user: string, month: string, limit: number, pageState?: string) {
    const all = this.rows
      .filter((row) => row.userId === user && row.createdAt.toISOString().startsWith(month))
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() || a.notificationId.localeCompare(b.notificationId),
      );
    const offset = pageState ? Number(pageState) : 0,
      items = all.slice(offset, offset + limit);
    return { items, ...(offset + limit < all.length ? { pageState: String(offset + limit) } : {}) };
  }
  async get(user: string, _month: string, createdAt: Date, id: string) {
    return this.rows.find(
      (row) =>
        row.userId === user && row.notificationId === id && row.createdAt.getTime() === createdAt.getTime(),
    );
  }
  async markRead(user: string, month: string, createdAt: Date, id: string, readAt: Date) {
    const row = await this.get(user, month, createdAt, id);
    if (row && !row.readAt) row.readAt = readAt;
  }
}

const event = (): EventEnvelope => ({
  specVersion: "1.0",
  eventId,
  eventType: "system.notification.requested.v1",
  occurredAt: "2026-09-06T10:00:00.000Z",
  producer: "classroom-service",
  correlationId: "66666666-6666-4666-8666-666666666666",
  aggregate: { type: "CLASS_ANNOUNCEMENT", id: announcementId, version: 1 },
  data: {
    recipientId: userId,
    notificationType: "CLASS_ANNOUNCEMENT",
    title: "Lịch học",
    body: "Thông báo lớp mới: Lịch học",
    source: { announcementId, classId },
  },
});

describe("P11 notification runtime", () => {
  it("materializes once and recovers the same notification identity", async () => {
    const repository = new MemoryRepository(),
      worker = new NotificationWorker(repository as unknown as NotificationRepository);
    expect(await worker.handle(event())).toEqual({ kind: "ack" });
    const firstId = repository.rows[0]?.notificationId;
    expect(await worker.handle(event())).toEqual({ kind: "ack" });
    expect(repository.rows).toHaveLength(1);
    expect(repository.rows[0]?.notificationId).toBe(firstId);
    expect(repository.dedupRows.get(`${eventId}:${userId}`)?.state).toBe("MATERIALIZED");
  });

  it("dead-letters malformed payloads and retries storage failures", async () => {
    const malformed = event();
    malformed.data = { recipientId: "bad" };
    expect(
      await new NotificationWorker(new MemoryRepository() as unknown as NotificationRepository).handle(
        malformed,
      ),
    ).toMatchObject({ kind: "dead-letter" });
    const broken = {
      reserve: async () => {
        throw new Error("down");
      },
    };
    expect(
      await new NotificationWorker(broken as unknown as NotificationRepository).handle(event()),
    ).toMatchObject({ kind: "retry" });
  });

  it("binds opaque cursors and locators to actor/month/limit/path", async () => {
    const repository = new MemoryRepository(),
      worker = new NotificationWorker(repository as unknown as NotificationRepository);
    await worker.handle(event());
    repository.rows.push({
      ...repository.rows[0]!,
      notificationId: "77777777-7777-4777-8777-777777777777",
      eventId: "88888888-8888-4888-8888-888888888888",
      createdAt: new Date("2026-09-06T09:00:00Z"),
    });
    const service = new NotificationService(
      repository as unknown as NotificationRepository,
      "test-secret",
      900,
      86400,
    );
    const page = await service.list(userId, "2026-09", 1);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    expect(page.items[0]?.locator).not.toContain(userId);
    await expect(service.list(otherUserId, "2026-09", 1, page.nextCursor)).rejects.toMatchObject({
      code: "INVALID_NOTIFICATION_CURSOR",
    });
    await expect(service.list(userId, "2026-08", 1, page.nextCursor)).rejects.toMatchObject({
      code: "INVALID_NOTIFICATION_CURSOR",
    });
    await expect(service.list(userId, "2026-09", 2, page.nextCursor)).rejects.toMatchObject({
      code: "INVALID_NOTIFICATION_CURSOR",
    });
    const locator = page.items[0]!.locator;
    await expect(service.markRead(otherUserId, page.items[0]!.notificationId, locator)).rejects.toMatchObject(
      { code: "INVALID_NOTIFICATION_LOCATOR" },
    );
    await expect(service.markRead(userId, otherUserId, locator)).rejects.toMatchObject({
      code: "INVALID_NOTIFICATION_LOCATOR",
    });
    const first = await service.markRead(userId, page.items[0]!.notificationId, locator),
      second = await service.markRead(userId, page.items[0]!.notificationId, locator);
    expect(first.readAt).toBe(second.readAt);
  });
});
