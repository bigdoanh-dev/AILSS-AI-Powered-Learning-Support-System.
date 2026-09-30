import * as SecureStore from "expo-secure-store";
import { configuration } from "./config";
import { profile, Transport } from "./api";
import { Session } from "./session";
import { OfflineStore } from "./offline-store";
import {
  persistColdStartLoginPreference,
  restoreColdStartLoginPreference,
  REQUIRE_LOGIN_ON_COLD_START_KEY,
} from "./settings";

const preferenceOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export function restoreMobilePreferences(): Promise<void> {
  return restoreColdStartLoginPreference({
    read: () => SecureStore.getItemAsync(REQUIRE_LOGIN_ON_COLD_START_KEY, preferenceOptions),
  });
}

export function setRequireLoginOnColdStart(value: boolean): Promise<void> {
  return persistColdStartLoginPreference(value, {
    write: (stored) => SecureStore.setItemAsync(REQUIRE_LOGIN_ON_COLD_START_KEY, stored, preferenceOptions),
  });
}

export let offlineStore: OfflineStore | null = null;
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
  offlineStore = privateStore;
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
      clearUserData: (userId) => privateStore.clearUserData(userId),
      hasOfflineData: (userId) => privateStore.hasUserData(userId),
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
