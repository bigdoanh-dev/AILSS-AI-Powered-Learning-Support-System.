import * as SecureStore from "expo-secure-store";
import { configuration } from "./config";
import { profile, Transport } from "./api";
import { Session } from "./session";
import { OfflineStore } from "./offline-store";
import {
  persistColdStartLoginPreference,
  restoreColdStartLoginPreference,
  REQUIRE_LOGIN_ON_COLD_START_KEY,
  LANGUAGE_PREFERENCE_KEY,
  persistLanguagePreference,
  restoreLanguagePreference,
} from "./settings";
import type { SupportedLanguage } from "./i18n";

const preferenceOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function restoreMobilePreferences(): Promise<void> {
  await Promise.all([
    restoreColdStartLoginPreference({
      read: () => SecureStore.getItemAsync(REQUIRE_LOGIN_ON_COLD_START_KEY, preferenceOptions),
    }),
    restoreLanguagePreference({
      read: () => SecureStore.getItemAsync(LANGUAGE_PREFERENCE_KEY, preferenceOptions),
    }),
  ]);
}

export function setAppLanguage(value: SupportedLanguage): Promise<void> {
  return persistLanguagePreference(value, {
    write: (stored) => SecureStore.setItemAsync(LANGUAGE_PREFERENCE_KEY, stored, preferenceOptions),
  });
}

export function setRequireLoginOnColdStart(value: boolean): Promise<void> {
  return persistColdStartLoginPreference(value, {
    write: (stored) => SecureStore.setItemAsync(REQUIRE_LOGIN_ON_COLD_START_KEY, stored, preferenceOptions),
  });
}

export let offlineStore: OfflineStore | null = null;
let pendingOfflineStore: OfflineStore | null = null;
let offlineStoreFlight: Promise<OfflineStore | null> | null = null;

export function prepareOfflineStore(): Promise<OfflineStore | null> {
  if (offlineStore) return Promise.resolve(offlineStore);
  if (!pendingOfflineStore) return Promise.resolve(null);
  if (offlineStoreFlight) return offlineStoreFlight;

  const candidate = pendingOfflineStore;
  offlineStoreFlight = candidate
    .purgeExpiredCache()
    .then(() => {
      if (pendingOfflineStore === candidate) offlineStore = candidate;
      return offlineStore;
    })
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === "SQLCIPHER_REQUIRED_FOR_OFFLINE_STORAGE") {
        // Expo Go and native clients built before useSQLCipher cannot persist private data.
        // Keep the online app usable without ever falling back to plaintext SQLite.
        pendingOfflineStore = null;
        console.warn(
          "Encrypted offline storage is unavailable. Rebuild the native development client to enable SQLCipher.",
        );
      }
      return null;
    })
    .finally(() => {
      offlineStoreFlight = null;
    });
  return offlineStoreFlight;
}

export function createRuntime() {
  const config = configuration(process.env.EXPO_PUBLIC_AILSS_ENV, process.env.EXPO_PUBLIC_AILSS_API_BASE_URL);
  // Namespace credentials by environment and Gateway; never restore into a different target.
  const target = new URL(config.origin);
  const scope =
    `${config.environment}_${target.protocol.replace(":", "")}_${target.hostname}_${target.port || "default"}`
      .replace(/[^A-Za-z0-9_-]/gu, "_")
      .slice(0, 200);
  const key = `ailss.session.${scope}`;
  const identityKey = `ailss.offline.identity.${scope}`;
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const privateStore = new OfflineStore(scope);
  pendingOfflineStore = privateStore;
  offlineStore = null;
  offlineStoreFlight = null;
  return new Session(
    new Transport(config.origin),
    {
      read: () => SecureStore.getItemAsync(key, options),
      write: (value) => SecureStore.setItemAsync(key, value, options),
      clear: () => SecureStore.deleteItemAsync(key, options),
    },
    {
      readLastIdentity: async () => {
        const value = await SecureStore.getItemAsync(identityKey, options);
        if (!value) return null;
        try {
          return profile(JSON.parse(value));
        } catch {
          await SecureStore.deleteItemAsync(identityKey, options);
          return null;
        }
      },
      saveLastIdentity: (user) => SecureStore.setItemAsync(identityKey, JSON.stringify(user), options),
      clearLastIdentity: () => SecureStore.deleteItemAsync(identityKey, options),
      clearUserData: async (userId) => {
        const store = await prepareOfflineStore();
        if (store) await store.clearUserData(userId);
      },
      hasOfflineData: async (userId) => {
        const store = await prepareOfflineStore();
        return store ? store.hasUserData(userId) : false;
      },
    },
  );
}
export const runtime = (() => {
  try {
    return createRuntime();
  } catch {
    return null;
  }
})();
