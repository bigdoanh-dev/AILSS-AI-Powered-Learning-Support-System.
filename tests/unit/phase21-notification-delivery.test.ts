import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  notificationDto,
  type Notification,
} from "../../apps/notification-worker/src/model.js";

describe("Phase 21F: Notification Channel Delivery Classification", () => {
  it("defines standard delivery statuses and channels", () => {
    expect(NOTIFICATION_DELIVERY_STATUSES).toEqual(["PENDING", "SENT", "DELIVERED", "FAILED"]);
    expect(NOTIFICATION_CHANNELS).toEqual(["IN_APP", "EMAIL", "PUSH", "SMS"]);
  });

  it("maps explicit deliveryStatus and deliveryChannel in DTO", () => {
    const notification: Notification = {
      notificationId: randomUUID(),
      eventId: randomUUID(),
      userId: randomUUID(),
      type: "ACADEMIC",
      title: "Assignment Graded",
      body: "Your midterm exam has been graded.",
      sourceType: "CLASS_ANNOUNCEMENT",
      sourceId: "src-1",
      sourceContextId: "ctx-1",
      createdAt: new Date(),
      deliveryStatus: "SENT",
      deliveryChannel: "EMAIL",
    };

    const dto = notificationDto(notification, "mock-locator");
    expect(dto.deliveryStatus).toBe("SENT");
    expect(dto.deliveryChannel).toBe("EMAIL");
    expect(dto.locator).toBe("mock-locator");
  });

  it("defaults to DELIVERED and IN_APP when delivery metadata is not set (backwards compatibility)", () => {
    const notification: Notification = {
      notificationId: randomUUID(),
      eventId: randomUUID(),
      userId: randomUUID(),
      type: "SECURITY",
      title: "New Device Login",
      body: "A login was detected from a new location.",
      sourceType: "SECURITY",
      sourceId: "sec-1",
      sourceContextId: "ctx-1",
      createdAt: new Date(),
    };

    const dto = notificationDto(notification, "mock-locator");
    expect(dto.deliveryStatus).toBe("DELIVERED");
    expect(dto.deliveryChannel).toBe("IN_APP");
  });
});
