import { describe, it, expect, beforeEach } from "vitest";
import { getFeaturesForRole } from "../src/features";
import {
  getSystemSettings,
  updateSystemSettings,
  resetSettingsForTesting,
  subscribeSystemSettings,
} from "../src/settings";
import {
  resetIntroSessionForTesting,
  getHasPlayedIntroThisSession,
  markIntroAsPlayed,
} from "../src/intro-session";

describe("commercial features and role-based matrix", () => {
  beforeEach(() => {
    resetSettingsForTesting();
    resetIntroSessionForTesting();
  });

  describe("getFeaturesForRole matrix", () => {
    it("provides clean administrative features without student schedule/assessment leaks", () => {
      const adminFeatures = getFeaturesForRole("ADMIN");
      expect(adminFeatures.length).toBe(8);

      const paths = adminFeatures.map((f) => f.path);
      // Ensure no student routes are present
      expect(paths).not.toContain("/classes");
      expect(paths).not.toContain("/assessments");
      expect(paths).not.toContain("/learn");

      // Ensure authoritative admin dashboards are present
      expect(paths).toContain("/admin/users");
      expect(paths).toContain("/admin/lecturers");
      expect(paths).toContain("/admin/moderation");
      expect(paths).toContain("/admin/commerce");
      expect(paths).toContain("/admin/revenue");
      expect(paths).toContain("/admin/stats");
      expect(paths).toContain("/admin/logs");
      expect(paths).toContain("/settings");
    });

    it("provides dedicated lecturer workspace features without student classes route", () => {
      const lecturerFeatures = getFeaturesForRole("LECTURER");
      expect(lecturerFeatures.length).toBe(8);

      const paths = lecturerFeatures.map((f) => f.path);
      // Lecturer must manage via /teaching/classes, not student /classes
      expect(paths).not.toContain("/classes");
      expect(paths).toContain("/teaching");
      expect(paths).toContain("/teaching/classes");
      expect(paths).toContain("/teaching/courses");
      expect(paths).toContain("/teaching/ai");
      expect(paths).toContain("/teaching/assessments");
    });

    it("provides standard student features for learner role or guests", () => {
      const studentFeatures = getFeaturesForRole("STUDENT");
      const paths = studentFeatures.map((f) => f.path);

      expect(paths).toContain("/learn");
      expect(paths).toContain("/courses");
      expect(paths).toContain("/classes?tab=schedule");
      expect(paths).toContain("/classes?tab=attendance");
      expect(paths).toContain("/assessments");
    });
  });

  describe("system settings & cold-start security policy", () => {
    it("defaults to requiring login on cold launch for commercial security", () => {
      const settings = getSystemSettings();
      expect(settings.requireLoginOnColdStart).toBe(true);
      expect(settings.pushNotifications).toBe(true);
      expect(settings.learningReminders).toBe(true);
    });

    it("allows updating settings and notifies subscribers", () => {
      let notified = false;
      const unsubscribe = subscribeSystemSettings(() => {
        notified = true;
      });

      const updated = updateSystemSettings({ requireLoginOnColdStart: false });
      expect(updated.requireLoginOnColdStart).toBe(false);
      expect(notified).toBe(true);

      unsubscribe();
    });

    it("allows recording cache clearance timestamp", () => {
      const updated = updateSystemSettings({ cacheClearedAt: "10:30:00" });
      expect(updated.cacheClearedAt).toBe("10:30:00");
    });
  });

  describe("cinematic intro session lifecycle", () => {
    it("starts unplayed on fresh cold launch", () => {
      expect(getHasPlayedIntroThisSession()).toBe(false);
    });

    it("marks as played and prevents repeat intro in same session", () => {
      expect(getHasPlayedIntroThisSession()).toBe(false);
      markIntroAsPlayed();
      expect(getHasPlayedIntroThisSession()).toBe(true);

      // Subsequent requests in same session remain played
      markIntroAsPlayed();
      expect(getHasPlayedIntroThisSession()).toBe(true);
    });
  });
});

