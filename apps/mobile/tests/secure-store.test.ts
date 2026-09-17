import { expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({
  getItemAsync: vi.fn().mockResolvedValue(null),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 4,
}));
vi.mock("expo-secure-store", () => storage);
import { createRuntime } from "../src/runtime";
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
  expect(key).toContain("ailss.session.research.");
  expect(value).not.toContain("access-memory-only");
  expect(options).toEqual({ keychainAccessible: 4 });
  await session.logout();
  expect(storage.deleteItemAsync).toHaveBeenCalledWith(key, options);
  vi.unstubAllEnvs();
});
