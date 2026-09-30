import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "../../packages/contracts/src/index.js";
import { NotificationWorker } from "../../apps/notification-worker/src/worker.js";
import type { Notification, NotificationCategory } from "../../apps/notification-worker/src/model.js";
import type { NotificationRepository } from "../../apps/notification-worker/src/repository.js";

class MemoryNotificationRepo {
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
    if (!this.rows.some((row) => row.notificationId === value.notificationId)) {
      this.rows.push(value);
    }
  }
  async complete(event: string, user: string) {
    const row = this.dedupRows.get(`${event}:${user}`);
    if (row) row.state = "MATERIALIZED";
  }
  async get(user: string, _month: string, createdAt: Date, id: string) {
    return this.rows.find(
      (row) =>
        row.userId === user && row.notificationId === id && row.createdAt.getTime() === createdAt.getTime(),
    );
  }
}

describe("Phase 20F & 20G: Centralized Notifications & Worker Governance", () => {
  const recipientId = "11111111-1111-4111-8111-111111111111";

  it.each([
    ["TRANSACTIONAL", "Xác nhận hoàn tiền 450.000 ₫", "Yêu cầu hoàn tiền khóa học CSDL đã được xử lý."],
    [
      "ACADEMIC",
      "Điểm bài thi AI: 9.5 / 10",
      "Bạn đã hoàn thành xuất sắc bài kiểm tra trắc nghiệm Bloom cấp 5.",
    ],
    [
      "RECOMMENDATION",
      "Lộ trình học mới đề xuất",
      "Dựa trên điểm năng lực, bạn nên ôn tập Tối ưu hóa B-Tree Index.",
    ],
    ["MARKETING", "Mở đăng ký kỳ học mới 2026", "Ưu đãi 20% cho học viên sớm đăng ký chuyên ngành AI."],
    ["SECURITY", "Đăng nhập mới từ thiết bị lạ", "Phát hiện đăng nhập từ IP 118.69.12.34 vào lúc 15:30."],
  ] as [NotificationCategory, string, string][])(
    "materializes notification for category: %s",
    async (category, title, body) => {
      const repo = new MemoryNotificationRepo();
      const worker = new NotificationWorker(repo as unknown as NotificationRepository);

      const event: EventEnvelope = {
        specVersion: "1.0",
        eventId: "33333333-3333-4333-8333-333333333333",
        correlationId: "44444444-4444-4444-8444-444444444444",
        eventType: "system.notification.requested.v1",
        occurredAt: "2026-09-17T12:00:00.000Z",
        producer: "ailss-test",
        aggregate: { type: "notification", id: "55555555-5555-4555-8555-555555555555", version: 1 },
        data: {
          recipientId,
          notificationType: category,
          title,
          body,
          source: { sourceType: category, entityId: "entity-123" },
        },
      };

      const disposition = await worker.handle(event);
      expect(disposition).toEqual({ kind: "ack" });

      expect(repo.rows).toHaveLength(1);
      expect(repo.rows[0]?.type).toBe(category);
      expect(repo.rows[0]?.title).toBe(title);

      // Idempotency: replaying same event produces ack and does not duplicate
      const replayDisposition = await worker.handle(event);
      expect(replayDisposition).toEqual({ kind: "ack" });
      expect(repo.rows).toHaveLength(1);
    },
  );

  it("dead-letters unsupported notification category or invalid schema", async () => {
    const repo = new MemoryNotificationRepo();
    const worker = new NotificationWorker(repo as unknown as NotificationRepository);

    const invalidEvent: EventEnvelope = {
      specVersion: "1.0",
      eventId: "33333333-3333-4333-8333-333333333333",
      correlationId: "44444444-4444-4444-8444-444444444444",
      eventType: "system.notification.requested.v1",
      occurredAt: "2026-09-17T12:00:00.000Z",
      producer: "ailss-test",
      aggregate: { type: "notification", id: "55555555-5555-4555-8555-555555555555", version: 1 },
      data: {
        recipientId,
        notificationType: "INVALID_UNSUPPORTED_CATEGORY",
        title: "Test",
        body: "Test",
        source: {},
      },
    };

    const disposition = await worker.handle(invalidEvent);
    expect(disposition).toEqual({ kind: "dead-letter", reason: "INVALID_NOTIFICATION_EVENT" });
  });
});
