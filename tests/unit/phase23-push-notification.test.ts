import { describe, expect, it } from "vitest";
import {
  DeviceTokenRegistry,
  ExpoPushProvider,
  FcmPushProvider,
  PushPrivacyRedactor,
  SimulationPushProvider,
  isExpoPushToken,
} from "../../apps/notification-worker/src/push/index.js";

describe("Phase 23B: Mobile Push Notification Adapters & Privacy Redaction", () => {
  it("validates Expo Push Token format", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("1234567890123456789012")).toBe(true);
    expect(isExpoPushToken("invalid-plain-token")).toBe(false);
  });

  it("ExpoPushProvider batches valid tokens and segregates invalid tokens", async () => {
    const expo = new ExpoPushProvider();
    const result = await expo.send({
      recipientId: "user-1",
      deviceTokens: [
        "ExponentPushToken[abc123def456ghi789012]",
        "invalid-token-1",
        "ExponentPushToken[xyz987uvw654rst321098]",
      ],
      title: "New Quiz Available",
      body: "Check out your latest assignment",
      category: "ACADEMIC",
    });

    expect(result.success).toBe(true);
    expect(result.ticketIds).toHaveLength(2);
    expect(result.invalidTokens).toEqual(["invalid-token-1"]);
  });

  it("FcmPushProvider formats project message IDs", async () => {
    const fcm = new FcmPushProvider({ projectId: "ailss-production" });
    const result = await fcm.send({
      recipientId: "user-2",
      deviceTokens: ["fcm-token-1", "fcm-token-2"],
      title: "System Update",
      body: "Platform maintenance scheduled",
      category: "SECURITY",
    });

    expect(result.success).toBe(true);
    expect(result.ticketIds).toHaveLength(2);
    expect(result.ticketIds[0]).toContain("projects/ailss-production/messages/");
  });

  it("SimulationPushProvider records sent messages", async () => {
    const sim = new SimulationPushProvider({ allowInProduction: true });
    await sim.send({
      recipientId: "u-3",
      deviceTokens: ["tok-1"],
      title: "Test",
      body: "Simulation test",
      category: "RECOMMENDATION",
    });
    expect(sim.sentPushes).toHaveLength(1);
  });

  describe("DeviceTokenRegistry: Lifecycle Management", () => {
    it("registers, retrieves, and revokes device tokens properly", () => {
      const registry = new DeviceTokenRegistry();
      const userId = "student-100";

      // Register two devices
      registry.register(userId, "token-ios-phone", "IOS");
      registry.register(userId, "token-android-tablet", "ANDROID");

      expect(registry.getActiveTokensForUser(userId)).toEqual(["token-ios-phone", "token-android-tablet"]);

      // Revoke one token
      const revoked = registry.revoke("token-ios-phone");
      expect(revoked).toBe(true);
      expect(registry.getActiveTokensForUser(userId)).toEqual(["token-android-tablet"]);

      // Logout user: revokes all tokens
      registry.register(userId, "token-web-browser", "WEB");
      const revokedCount = registry.revokeAllForUser(userId);
      expect(revokedCount).toBe(2); // android + web
      expect(registry.getActiveTokensForUser(userId)).toEqual([]);
    });
  });

  describe("PushPrivacyRedactor: Lock-Screen Data Leak Prevention", () => {
    it("redacts specific exam scores and grades from push notifications", () => {
      const leaked = PushPrivacyRedactor.redact({
        category: "ACADEMIC",
        title: "Bài kiểm tra Giữa kỳ",
        body: "Bạn đã nhận được điểm 9.5/10 cho bài thi môn Cơ sở dữ liệu!",
      });

      expect(leaked.safeBody).not.toContain("9.5/10");
      expect(leaked.safeBody).toContain("Kết quả học tập mới đã được cập nhật");
      expect(leaked.deepLink).toBe("ailss://academic/grades");
    });

    it("redacts transaction payment sums from lock-screen alert body", () => {
      const paymentLeak = PushPrivacyRedactor.redact({
        category: "TRANSACTIONAL",
        title: "Thanh toán thành công",
        body: "Bạn đã thanh toán 1.500.000 VND cho khóa học AI Nâng cao",
      });

      expect(paymentLeak.safeBody).not.toContain("1.500.000");
      expect(paymentLeak.safeBody).not.toContain("VND");
      expect(paymentLeak.safeBody).toContain("Biên nhận giao dịch mới đã có");
      expect(paymentLeak.deepLink).toBe("ailss://account/billing");
    });

    it("preserves non-sensitive push bodies intact", () => {
      const clean = PushPrivacyRedactor.redact({
        category: "CLASS_ANNOUNCEMENT",
        title: "Lịch học tuần mới",
        body: "Lớp học sẽ bắt đầu vào 8:00 sáng Thứ Hai tại phòng Lab 3",
      });

      expect(clean.safeBody).toBe("Lớp học sẽ bắt đầu vào 8:00 sáng Thứ Hai tại phòng Lab 3");
      expect(clean.deepLink).toBe("ailss://notifications");
    });
  });
});
