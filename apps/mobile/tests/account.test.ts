import { describe, it, expect } from "vitest";
import {
  userProfile,
  profileUpdateResponse,
  avatarResponse,
  passwordChangeResponse,
  validateDisplayName,
  validatePasswordChange,
  validateAvatarDataUrl,
} from "../src/account";
import { ApiError } from "../src/api";

describe("account domain", () => {
  const sampleProfile = {
    userId: "usr-001",
    displayName: "Nguyễn Văn A",
    emailMasked: "n***a@ailss.local",
    role: "STUDENT",
    status: "ACTIVE",
    lecturerVerified: false,
    profileVersion: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };

  describe("userProfile decoder", () => {
    it("decodes valid user profile", () => {
      const p = userProfile(sampleProfile);
      expect(p.userId).toBe("usr-001");
      expect(p.displayName).toBe("Nguyễn Văn A");
      expect(p.emailMasked).toBe("n***a@ailss.local");
      expect(p.role).toBe("STUDENT");
      expect(p.status).toBe("ACTIVE");
      expect(p.lecturerVerified).toBe(false);
      expect(p.profileVersion).toBe(1);
    });

    it("throws ApiError on missing required fields", () => {
      expect(() => userProfile({ userId: "123" })).toThrow(ApiError);
      expect(() => userProfile(null)).toThrow(ApiError);
    });
  });

  describe("profileUpdateResponse decoder", () => {
    it("decodes profile update response", () => {
      const res = profileUpdateResponse({
        userId: "usr-001",
        profileVersion: 2,
        updated: true,
        noOp: false,
      });
      expect(res.userId).toBe("usr-001");
      expect(res.profileVersion).toBe(2);
      expect(res.updated).toBe(true);
      expect(res.noOp).toBe(false);
    });
  });

  describe("avatarResponse decoder", () => {
    it("decodes avatar with dataUrl", () => {
      const res = avatarResponse({
        dataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      });
      expect(res.dataUrl).toContain("data:image/png;base64,");
    });

    it("decodes null dataUrl", () => {
      const res = avatarResponse({ dataUrl: null });
      expect(res.dataUrl).toBeNull();
    });
  });

  describe("passwordChangeResponse decoder", () => {
    it("decodes password change success", () => {
      const res = passwordChangeResponse({ passwordChanged: true });
      expect(res.passwordChanged).toBe(true);
    });
  });

  describe("validation helpers", () => {
    it("validates displayName", () => {
      expect(validateDisplayName("Nguyễn Văn B")).toEqual({ valid: true });
      expect(validateDisplayName("").valid).toBe(false);
      expect(validateDisplayName("   ").valid).toBe(false);
      expect(validateDisplayName("a".repeat(101)).valid).toBe(false);
    });

    it("validates password change", () => {
      expect(validatePasswordChange("OldPass123!", "NewPass456!")).toEqual({ valid: true });
      expect(validatePasswordChange("", "NewPass456!").valid).toBe(false);
      expect(validatePasswordChange("OldPass123!", "short").valid).toBe(false);
      expect(validatePasswordChange("SamePass123!", "SamePass123!").valid).toBe(false);
    });

    it("validates avatar dataUrl", () => {
      expect(validateAvatarDataUrl(null)).toEqual({ valid: true });
      const validPng =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      expect(validateAvatarDataUrl(validPng)).toEqual({ valid: true });

      const invalidMime = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
      expect(validateAvatarDataUrl(invalidMime).valid).toBe(false);

      // Oversized data URL (> 256 KiB)
      const hugeBase64 = "data:image/png;base64," + "A".repeat(400000);
      expect(validateAvatarDataUrl(hugeBase64).valid).toBe(false);
    });
  });
});
