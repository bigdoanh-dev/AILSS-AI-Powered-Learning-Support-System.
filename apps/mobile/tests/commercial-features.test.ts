import { describe, it, expect, beforeEach, vi } from "vitest";
import { getFeaturesForRole } from "../src/features";
import {
  getSystemSettings,
  updateSystemSettings,
  restoreColdStartLoginPreference,
  persistColdStartLoginPreference,
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
    it("does not expose deferred administrative features in the Phase 41 Mobile navigation", () => {
      expect(getFeaturesForRole("ADMIN")).toEqual([]);
    });

    it("does not expose deferred lecturer features in the Phase 41 Mobile navigation", () => {
      expect(getFeaturesForRole("LECTURER")).toEqual([]);
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
      expect(settings).not.toHaveProperty("pushNotifications");
      expect(settings).not.toHaveProperty("learningReminders");
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

    it.each(["true", "false"])("restores a persisted cold-start choice (%s)", async (stored) => {
      await restoreColdStartLoginPreference({ read: async () => stored });
      expect(getSystemSettings().requireLoginOnColdStart).toBe(stored === "true");
    });

    it("fails closed to login-required when the persisted choice is absent, invalid, or unavailable", async () => {
      updateSystemSettings({ requireLoginOnColdStart: false });
      await restoreColdStartLoginPreference({ read: async () => "unexpected" });
      expect(getSystemSettings().requireLoginOnColdStart).toBe(true);

      updateSystemSettings({ requireLoginOnColdStart: false });
      await restoreColdStartLoginPreference({
        read: async () => {
          throw new Error("Keychain unavailable");
        },
      });
      expect(getSystemSettings().requireLoginOnColdStart).toBe(true);
    });

    it("persists a cold-start choice before publishing it and leaves state unchanged on storage failure", async () => {
      const write = vi.fn(async () => {});
      await persistColdStartLoginPreference(false, { write });
      expect(write).toHaveBeenCalledWith("false");
      expect(getSystemSettings().requireLoginOnColdStart).toBe(false);

      await expect(
        persistColdStartLoginPreference(true, {
          write: async () => {
            throw new Error("Keychain full");
          },
        }),
      ).rejects.toThrow("Keychain full");
      expect(getSystemSettings().requireLoginOnColdStart).toBe(false);
    });

    it("restores the saved cold-start choice after simulated process recreation", async () => {
      let securePreference: string | null = null;
      await persistColdStartLoginPreference(false, {
        write: async (value) => {
          securePreference = value;
        },
      });
      resetSettingsForTesting();
      await restoreColdStartLoginPreference({ read: async () => securePreference });
      expect(getSystemSettings().requireLoginOnColdStart).toBe(false);
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
