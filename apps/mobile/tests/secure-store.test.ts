import { expect, it, vi } from "vitest";
const cipher = vi.hoisted(() => ({ available: true, openCount: 0, statements: [] as string[] }));
const storage = vi.hoisted(() => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 4,
}));
vi.mock("expo-secure-store", () => storage);
vi.mock("expo-crypto", () => ({ getRandomBytes: (size: number) => new Uint8Array(size).fill(7) }));
vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: async () => {},
  openDatabaseAsync: async () => {
    cipher.openCount += 1;
    return {
      execAsync: async (sql: string) => {
        cipher.statements.push(sql);
      },
      runAsync: async () => ({}),
      getFirstAsync: async (sql: string) =>
        sql.includes("cipher_version")
          ? cipher.available
            ? { cipher_version: "4.7.0" }
            : null
          : sql.includes("user_version")
            ? { user_version: 1 }
            : null,
      getAllAsync: async () => [],
    };
  },
}));
import { createRuntime, offlineStore, prepareOfflineStore } from "../src/runtime";
it("uses device-only OS vault for refresh material, scoped to explicit target", async () => {
  vi.stubEnv("EXPO_PUBLIC_AILSS_ENV", "research");
  vi.stubEnv("EXPO_PUBLIC_AILSS_API_BASE_URL", "http://127.0.0.1:8080");
  const session = createRuntime();
  vi.spyOn(session.api, "request").mockImplementation(async (path) =>
    path.endsWith("/me")
      ? {
          userId: "u",
          displayName: "Name",
          emailMasked: "m***@test.invalid",
          role: "STUDENT",
          status: "ACTIVE",
        }
      : { accessToken: "access-memory-only", refreshToken: "refresh", sessionId: "session" },
  );
  await session.login("test", "test");
  const [key, value, options] = storage.setItemAsync.mock.calls[0]!;
  expect(key).toContain("ailss.session.research_");
  expect(value).not.toContain("access-memory-only");
  expect(options).toEqual({ keychainAccessible: 4 });
  await session.logout();
  expect(storage.deleteItemAsync).toHaveBeenCalledWith(key, options);
  vi.unstubAllEnvs();
});

it("keeps online sign-in usable when the native binary has no SQLCipher", async () => {
  vi.stubEnv("EXPO_PUBLIC_AILSS_ENV", "research");
  vi.stubEnv("EXPO_PUBLIC_AILSS_API_BASE_URL", "http://127.0.0.1:8080");
  cipher.available = false;
  cipher.statements.length = 0;
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const session = createRuntime();

  expect(await prepareOfflineStore()).toBeNull();
  expect(offlineStore).toBeNull();
  expect(cipher.statements.join("\n")).not.toContain("CREATE TABLE");
  const openCount = cipher.openCount;
  expect(await prepareOfflineStore()).toBeNull();
  expect(cipher.openCount).toBe(openCount);

  vi.spyOn(session.api, "request").mockImplementation(async (path) =>
    path.endsWith("/me")
      ? {
          userId: "u",
          displayName: "Name",
          emailMasked: "m***@test.invalid",
          role: "STUDENT",
          status: "ACTIVE",
        }
      : { accessToken: "access-memory-only", refreshToken: "refresh", sessionId: "session" },
  );
  await session.login("test", "test");
  expect(session.snapshot.state).toBe("AUTHENTICATED");
  expect(warning).toHaveBeenCalledOnce();
  warning.mockRestore();
  cipher.available = true;
  vi.unstubAllEnvs();
});
