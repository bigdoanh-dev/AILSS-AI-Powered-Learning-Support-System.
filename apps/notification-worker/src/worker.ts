import { createHash } from "node:crypto";
import type { EventEnvelope } from "../../../packages/contracts/src/index.js";
import type { ConsumerDisposition } from "../../../packages/rabbitmq/src/index.js";
import { notificationEventDataSchema } from "./model.js";
import type { NotificationRepository } from "./repository.js";

function stableUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class NotificationWorker {
  public constructor(private readonly repository: NotificationRepository) {}
  async handle(event: EventEnvelope): Promise<ConsumerDisposition> {
    if (event.eventType !== "system.notification.requested.v1")
      return { kind: "dead-letter", reason: "UNSUPPORTED_EVENT" };
    const parsed = notificationEventDataSchema.safeParse(event.data);
    if (!parsed.success) return { kind: "dead-letter", reason: "INVALID_NOTIFICATION_EVENT" };
    const data = parsed.data,
      notificationId = stableUuid(`${event.eventId}:${data.recipientId}`);
    try {
      await this.repository.reserve(
        event.eventId,
        data.recipientId,
        notificationId,
        new Date(event.occurredAt),
      );
      const dedup = await this.repository.dedup(event.eventId, data.recipientId);
      if (!dedup || String(dedup.notification_id) !== notificationId)
        return { kind: "dead-letter", reason: "DEDUP_IDENTITY_CONFLICT" };
      const canonical = {
        notificationId,
        eventId: event.eventId,
        userId: data.recipientId,
        type: data.notificationType,
        title: data.title.normalize("NFC"),
        body: data.body.normalize("NFC"),
        sourceType: "CLASS_ANNOUNCEMENT" as const,
        sourceId: data.source.announcementId,
        sourceContextId: data.source.classId,
        createdAt: new Date(String(dedup.created_at)),
      };
      let row = await this.repository.get(
        data.recipientId,
        canonical.createdAt.toISOString().slice(0, 7),
        canonical.createdAt,
        notificationId,
      );
      if (!row) {
        await this.repository.materialize(canonical);
        row = await this.repository.get(
          data.recipientId,
          canonical.createdAt.toISOString().slice(0, 7),
          canonical.createdAt,
          notificationId,
        );
      }
      if (!row || !sameLogicalEffect(row, canonical))
        return { kind: "dead-letter", reason: "MATERIALIZATION_CONFLICT" };
      if (String(dedup.state) !== "MATERIALIZED")
        await this.repository.complete(event.eventId, data.recipientId);
      return { kind: "ack" };
    } catch {
      return { kind: "retry", reason: "NOTIFICATION_STORAGE_UNAVAILABLE" };
    }
  }
}

function sameLogicalEffect(
  left: {
    eventId: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    sourceId: string;
    sourceContextId: string;
  },
  right: {
    eventId: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    sourceId: string;
    sourceContextId: string;
  },
): boolean {
  return (
    left.eventId === right.eventId &&
    left.userId === right.userId &&
    left.type === right.type &&
    left.title === right.title &&
    left.body === right.body &&
    left.sourceId === right.sourceId &&
    left.sourceContextId === right.sourceContextId
  );
}
