/**
 * Settings configuration and persistence for AILSS Mobile.
 * Provides system security policies, notifications, and UI preferences.
 */

import type { SupportedLanguage } from "./i18n";

export interface SystemSettings {
  language: SupportedLanguage;
  requireLoginOnColdStart: boolean;
  pushNotifications: boolean;
  learningReminders: boolean;
  highContrast: boolean;
  cacheClearedAt: string | null;
}

let settingsState: SystemSettings = {
  language: "vi",
  // Requirement 4: Require login again after exiting app (cold start)
  requireLoginOnColdStart: true,
  pushNotifications: true,
  learningReminders: true,
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
    pushNotifications: true,
    learningReminders: true,
    highContrast: false,
    cacheClearedAt: null,
  };
  listeners.clear();
}
