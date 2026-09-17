import { describe, it, expect } from "vitest";
import {
  notificationItem,
  notificationList,
  notificationReadResult,
  formatCurrentMonth,
  formatDisplayMonth,
  isValidMonth,
  isRead,
  resolveNotificationRoute,
  type NotificationItem,
} from "../src/notifications";
import { ApiError } from "../src/api";

describe("notifications domain", () => {
  const sampleNotification = {
    notificationId: "notif-001",
    type: "CLASS_ANNOUNCEMENT",
    title: "Thông báo kiểm tra giữa kỳ",
    body: "Lớp CS101 sẽ có bài kiểm tra tuần tới.",
    source: {
      type: "CLASS_ANNOUNCEMENT",
      id: "announcement-555",
      contextId: "class-777",
    },
    createdAt: "2026-09-15T08:00:00.000Z",
    readAt: null,
    locator: "locator-token-xyz-123",
  };

  describe("notificationItem decoder", () => {
    it("decodes valid unread notification item", () => {
      const item = notificationItem(sampleNotification);
      expect(item.notificationId).toBe("notif-001");
      expect(item.title).toBe("Thông báo kiểm tra giữa kỳ");
      expect(item.source.contextId).toBe("class-777");
      expect(item.readAt).toBeNull();
      expect(item.locator).toBe("locator-token-xyz-123");
    });

    it("decodes read notification item with non-null readAt", () => {
      const item = notificationItem({
        ...sampleNotification,
        readAt: "2026-09-15T08:30:00.000Z",
      });
      expect(item.readAt).toBe("2026-09-15T08:30:00.000Z");
    });

    it("throws ApiError on malformed notification item", () => {
      expect(() => notificationItem({ notificationId: "only-id" })).toThrow(ApiError);
      expect(() => notificationItem(null)).toThrow(ApiError);
    });
  });

  describe("notificationList decoder", () => {
    it("decodes list with items and pagination page", () => {
      const res = notificationList({
        items: [sampleNotification],
        page: {
          month: "2026-09",
          nextCursor: "cursor-next-456",
        },
      });

      expect(res.items).toHaveLength(1);
      expect(res.month).toBe("2026-09");
      expect(res.nextCursor).toBe("cursor-next-456");
    });

    it("handles data wrapper with meta pagination", () => {
      const res = notificationList({
        data: [sampleNotification],
        meta: {
          page: {
            month: "2026-09",
            nextCursor: "cursor-meta-789",
          },
        },
      });

      expect(res.items).toHaveLength(1);
      expect(res.nextCursor).toBe("cursor-meta-789");
    });
  });

  describe("notificationReadResult decoder", () => {
    it("decodes canonical read result", () => {
      const res = notificationReadResult({
        notificationId: "notif-001",
        state: "READ",
        readAt: "2026-09-15T09:00:00.000Z",
      });

      expect(res.notificationId).toBe("notif-001");
      expect(res.state).toBe("READ");
      expect(res.readAt).toBe("2026-09-15T09:00:00.000Z");
    });
  });

  describe("helpers", () => {
    it("formats current month in YYYY-MM", () => {
      const fixedDate = new Date(Date.UTC(2026, 8, 15)); // Month index 8 = September
      expect(formatCurrentMonth(fixedDate)).toBe("2026-09");
    });

    it("formats month for UI display in Vietnamese Tháng MM/YYYY", () => {
      expect(formatDisplayMonth("2026-09")).toBe("Tháng 09/2026");
      expect(formatDisplayMonth("2026-12")).toBe("Tháng 12/2026");
      expect(formatDisplayMonth("")).toBe("");
    });

    it("validates month string format", () => {
      expect(isValidMonth("2026-09")).toBe(true);
      expect(isValidMonth("2026-12")).toBe(true);
      expect(isValidMonth("2026-00")).toBe(false);
      expect(isValidMonth("2026-13")).toBe(false);
      expect(isValidMonth("2026-9")).toBe(false);
      expect(isValidMonth("invalid")).toBe(false);
    });

    it("checks isRead correctly", () => {
      const unread: NotificationItem = {
        ...sampleNotification,
        readAt: null,
      };
      const read: NotificationItem = {
        ...sampleNotification,
        readAt: "2026-09-15T08:00:00.000Z",
      };
      expect(isRead(unread)).toBe(false);
      expect(isRead(read)).toBe(true);
    });

    it("resolves route safely for CLASS_ANNOUNCEMENT", () => {
      const notif: NotificationItem = {
        ...sampleNotification,
        source: {
          type: "CLASS_ANNOUNCEMENT",
          id: "ann-1",
          contextId: "cls-999",
        },
      };
      expect(resolveNotificationRoute(notif)).toBe("/classes/cls-999");
    });

    it("returns null safely for unknown notification types", () => {
      const unknownNotif: NotificationItem = {
        ...sampleNotification,
        source: {
          type: "UNKNOWN_FUTURE_TYPE",
          id: "x",
          contextId: "y",
        },
      };
      expect(resolveNotificationRoute(unknownNotif)).toBeNull();
    });
  });
});
