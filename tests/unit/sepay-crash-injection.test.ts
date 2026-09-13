import { afterEach, expect, it, vi } from "vitest";
import { crashAfter } from "../../apps/learning-service/src/commerce/crash-injection.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("keeps crash injection inert outside explicitly guarded dev-async runs", () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  vi.stubEnv("AILSS_TEST_CRASH_BOUNDARY", "A_CANDIDATE");
  vi.stubEnv("AILSS_TEST_CRASH_RUN_ID", "00000000-0000-4000-8000-000000000001");
  vi.stubEnv("AILSS_PROFILE", "dev-async");
  vi.stubEnv("NODE_ENV", "production");
  crashAfter("A_CANDIDATE", {});
  expect(exit).not.toHaveBeenCalled();
});

it("kills the current process only for an exact named dev-async boundary and UUID run", () => {
  const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("AILSS_TEST_CRASH_BOUNDARY", "A_CANDIDATE");
  vi.stubEnv("AILSS_TEST_CRASH_RUN_ID", "00000000-0000-4000-8000-000000000001");
  vi.stubEnv("AILSS_PROFILE", "dev-async");
  vi.stubEnv("NODE_ENV", "development");
  crashAfter("A_CANDIDATE", { transactionId: "123" });
  expect(stdout).toHaveBeenCalledOnce();
  expect(exit).toHaveBeenCalledWith(86);
});
