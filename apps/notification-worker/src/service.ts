import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../../packages/http/src/index.js";
import type { NotificationRepository } from "./repository.js";
import { notificationDto, openToken, sealToken, type ListToken, type LocatorToken } from "./model.js";

const listTokenSchema = z
  .object({
    purpose: z.literal("NOTIFICATION_LIST"),
    actorId: z.string().uuid(),
    month: z.string(),
    limit: z.number().int(),
    pageState: z.string().min(1),
    exp: z.number().int(),
  })
  .strict();
const locatorSchema = z
  .object({
    purpose: z.literal("NOTIFICATION_READ"),
    actorId: z.string().uuid(),
    notificationId: z.string().uuid(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
    createdAt: z.string().datetime(),
    exp: z.number().int(),
  })
  .strict();

export class NotificationService {
  public constructor(
    private readonly repository: NotificationRepository,
    private readonly secret: string,
    private readonly cursorTtlSeconds = 900,
    private readonly locatorTtlSeconds = 86400,
  ) {}

  async list(actorId: string, month: string, limit: number, cursor?: string) {
    let pageState: string | undefined;
    if (cursor) {
      const token = this.parseList(cursor);
      if (token.actorId !== actorId || token.month !== month || token.limit !== limit)
        throw new AppError("INVALID_NOTIFICATION_CURSOR", 400, "Invalid notification cursor");
      pageState = token.pageState;
    }
    const page = await this.repository.list(actorId, month, limit, pageState);
    const now = Math.floor(Date.now() / 1000);
    return {
      items: page.items.map((item) =>
        notificationDto(
          item,
          sealToken(this.secret, {
            purpose: "NOTIFICATION_READ",
            actorId,
            notificationId: item.notificationId,
            month,
            createdAt: item.createdAt.toISOString(),
            exp: now + this.locatorTtlSeconds,
          }),
        ),
      ),
      ...(page.pageState
        ? {
            nextCursor: sealToken(this.secret, {
              purpose: "NOTIFICATION_LIST",
              actorId,
              month,
              limit,
              pageState: page.pageState,
              exp: now + this.cursorTtlSeconds,
            }),
          }
        : {}),
    };
  }

  async markRead(actorId: string, notificationId: string, locator: string) {
    const token = this.parseLocator(locator);
    if (token.actorId !== actorId || token.notificationId !== notificationId)
      throw new AppError("INVALID_NOTIFICATION_LOCATOR", 400, "Invalid notification locator");
    const createdAt = new Date(token.createdAt);
    let notification = await this.repository.get(actorId, token.month, createdAt, notificationId);
    if (!notification) throw new AppError("NOTIFICATION_NOT_FOUND", 404, "Notification not found");
    if (!notification.readAt) {
      await this.repository.markRead(actorId, token.month, createdAt, notificationId, new Date());
      notification = await this.repository.get(actorId, token.month, createdAt, notificationId);
    }
    if (!notification?.readAt)
      throw new AppError("NOTIFICATION_READ_FAILED", 503, "Notification could not be marked read", true);
    return notificationDto(notification, locator);
  }

  private parseList(value: string): ListToken {
    try {
      const token = listTokenSchema.parse(openToken(this.secret, value));
      if (token.exp < Math.floor(Date.now() / 1000)) throw new Error();
      return token;
    } catch {
      throw new AppError("INVALID_NOTIFICATION_CURSOR", 400, "Invalid notification cursor");
    }
  }
  private parseLocator(value: string): LocatorToken {
    try {
      const token = locatorSchema.parse(openToken(this.secret, value));
      if (token.exp < Math.floor(Date.now() / 1000)) throw new Error();
      return token;
    } catch {
      throw new AppError("INVALID_NOTIFICATION_LOCATOR", 400, "Invalid notification locator");
    }
  }
}

export const newNotificationId = () => randomUUID();
