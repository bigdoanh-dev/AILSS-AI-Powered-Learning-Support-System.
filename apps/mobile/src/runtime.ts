import * as SecureStore from "expo-secure-store";
import { configuration } from "./config";
import { Transport } from "./api";
import { Session } from "./session";
export function createRuntime() {
  const config = configuration(process.env.EXPO_PUBLIC_AILSS_ENV, process.env.EXPO_PUBLIC_AILSS_API_BASE_URL);
  // Namespace credentials by environment and Gateway; never restore into a different target.
  const key = `ailss.session.${config.environment}.${encodeURIComponent(config.origin).replace(/%/g, "_")}`;
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  return new Session(new Transport(config.origin), {
    read: () => SecureStore.getItemAsync(key, options),
    write: (value) => SecureStore.setItemAsync(key, value, options),
    clear: () => SecureStore.deleteItemAsync(key, options),
  });
}
export const runtime = (() => {
  try {
    return createRuntime();
  } catch {
    return null;
  }
})();
