import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const NOTIFICATION_CATEGORIES = [
  "CLASS_ANNOUNCEMENT",
  "TRANSACTIONAL",
  "ACADEMIC",
  "RECOMMENDATION",
  "MARKETING",
  "SECURITY",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const notificationEventDataSchema = z
  .object({
    recipientId: z.string().uuid(),
    notificationType: z.enum(NOTIFICATION_CATEGORIES),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(500),
    source: z.record(z.string(), z.unknown()),
  })
  .strict();

export const notificationListSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(4096).optional(),
  })
  .strict();

export const NOTIFICATION_DELIVERY_STATUSES = ["PENDING", "SENT", "DELIVERED", "FAILED"] as const;

export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ["IN_APP", "EMAIL", "PUSH", "SMS"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export interface NotificationDeliveryReceipt {
  readonly channel: NotificationChannel;
  readonly status: NotificationDeliveryStatus;
  readonly attemptedAt: string;
  readonly deliveredAt?: string;
  readonly failureReason?: string;
}

export interface Notification {
  notificationId: string;
  eventId: string;
  userId: string;
  type: NotificationCategory;
  title: string;
  body: string;
  sourceType: string;
  sourceId: string;
  sourceContextId: string;
  createdAt: Date;
  readAt?: Date;
  deliveryStatus?: NotificationDeliveryStatus;
  deliveryChannel?: NotificationChannel;
}

export type ListToken = {
  purpose: "NOTIFICATION_LIST";
  actorId: string;
  month: string;
  limit: number;
  pageState: string;
  exp: number;
};
export type LocatorToken = {
  purpose: "NOTIFICATION_READ";
  actorId: string;
  notificationId: string;
  month: string;
  createdAt: string;
  exp: number;
};

export function sealToken(secret: string, value: ListToken | LocatorToken): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function openToken(secret: string, value: string): unknown {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
    const packed = Buffer.from(value, "base64url");
    if (packed.length < 29 || packed.toString("base64url") !== value) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      packed.subarray(0, 12),
    );
    decipher.setAuthTag(packed.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8"),
    );
  } catch {
    throw new Error("INVALID_NOTIFICATION_TOKEN");
  }
}

export function notificationDto(notification: Notification, locator: string) {
  return {
    notificationId: notification.notificationId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    source: {
      type: notification.sourceType,
      id: notification.sourceId,
      contextId: notification.sourceContextId,
    },
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString() ?? null,
    deliveryStatus: notification.deliveryStatus ?? "DELIVERED",
    deliveryChannel: notification.deliveryChannel ?? "IN_APP",
    locator,
  };
}
