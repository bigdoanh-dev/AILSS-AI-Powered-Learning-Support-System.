/**
 * Settings configuration and persistence for AILSS Mobile.
 * Provides system security policies, notifications, and UI preferences.
 */

import type { SupportedLanguage } from "./i18n";

export interface SystemSettings {
  language: SupportedLanguage;
  requireLoginOnColdStart: boolean;
  highContrast: boolean;
  cacheClearedAt: string | null;
}

export const REQUIRE_LOGIN_ON_COLD_START_KEY = "ailss.mobile.settings.requireLoginOnColdStart.v1";

type PreferenceStorage = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
};

let settingsState: SystemSettings = {
  language: "vi",
  // Requirement 4: Require login again after exiting app (cold start)
  requireLoginOnColdStart: true,
  highContrast: false,
  cacheClearedAt: null,
};

const listeners = new Set<() => void>();

export function getSystemSettings(): SystemSettings {
  return settingsState;
}

export function updateSystemSettings(patch: Partial<SystemSettings>): SystemSettings {
  settingsState = { ...settingsState, ...patch };
  listeners.forEach((fn) => fn());
  return settingsState;
}

/**
 * Restores only the explicitly persisted cold-start policy. Unknown or unavailable
 * values keep the secure default (login required).
 */
export async function restoreColdStartLoginPreference(
  storage: Pick<PreferenceStorage, "read">,
): Promise<void> {
  try {
    const stored = await storage.read();
    if (stored === "true" || stored === "false") {
      updateSystemSettings({ requireLoginOnColdStart: stored === "true" });
      return;
    }
  } catch {
    // Fail closed: unreadable settings must not silently keep a session open.
  }
  updateSystemSettings({ requireLoginOnColdStart: true });
}

/** Persist before publishing so the UI never claims an unsaved policy is active. */
export async function persistColdStartLoginPreference(
  value: boolean,
  storage: Pick<PreferenceStorage, "write">,
): Promise<void> {
  await storage.write(String(value));
  updateSystemSettings({ requireLoginOnColdStart: value });
}

export function subscribeSystemSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSettingsForTesting(): void {
  settingsState = {
    language: "vi",
    requireLoginOnColdStart: true,
    highContrast: false,
    cacheClearedAt: null,
  };
  listeners.clear();
}
