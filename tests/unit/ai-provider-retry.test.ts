import { afterEach, expect, it, vi } from "vitest";
import {
  CircuitBreakingQuizProvider,
  HttpQuizProvider,
  ProviderFailure,
  RetryingQuizProvider,
} from "../../apps/ai-worker/src/provider.js";
const request = {
  idempotencyKey: "same-operation",
  sourceText: "private",
  questionCount: 1,
  questionTypes: ["TRUE_FALSE"],
  difficulty: "EASY",
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("waits before retrying a transient failure and preserves the operation", async () => {
  vi.useFakeTimers();
  const onRetry = vi.fn();
  const result = { quiz: {}, inputUnits: 1, outputUnits: 1, provider: "test", model: "test" };
  const generate = vi
    .fn()
    .mockRejectedValueOnce(new ProviderFailure("PROVIDER_UNAVAILABLE", true, 503))
    .mockResolvedValue(result);
  const pending = new RetryingQuizProvider({ generate }, onRetry).generate(request);
  await vi.advanceTimersByTimeAsync(1999);
  expect(generate).toHaveBeenCalledTimes(1);
  await vi.runAllTimersAsync();
  await expect(pending).resolves.toEqual(result);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(onRetry).toHaveBeenCalledWith("PROVIDER_UNAVAILABLE");
  expect(generate.mock.calls.every(([value]) => value === request)).toBe(true);
});
it("stops after three failures and preserves the actual status", async () => {
  vi.useFakeTimers();
  const generate = vi.fn().mockRejectedValue(new ProviderFailure("PROVIDER_UNAVAILABLE", true, 503));
  const checked = expect(new RetryingQuizProvider({ generate }).generate(request)).rejects.toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
    httpStatus: 503,
    retryable: false,
  });
  await vi.runAllTimersAsync();
  await checked;
  expect(generate).toHaveBeenCalledTimes(3);
});
it.each([
  [404, "PROVIDER_NOT_FOUND"],
  [403, "PROVIDER_ACCESS_DENIED"],
  [400, "PROVIDER_BAD_REQUEST"],
])("does not retry HTTP %s or disclose the response", async (status, code) => {
  const fetch = vi.fn().mockResolvedValue(new Response("private-secret", { status }));
  vi.stubGlobal("fetch", fetch);
  const provider = new RetryingQuizProvider(
    new HttpQuizProvider({
      endpoint: "https://provider.invalid/v1",
      model: "m",
      apiKey: "secret",
      timeoutMs: 1000,
    }),
  );
  await expect(provider.generate(request)).rejects.toMatchObject({
    code,
    httpStatus: status,
    retryable: false,
    message: code,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("opens the provider circuit and admits one recovery probe after cooldown", async () => {
  let now = 1_000;
  const onReject = vi.fn();
  const result = { quiz: {}, inputUnits: 1, outputUnits: 1, provider: "test", model: "test" };
  const generate = vi
    .fn()
    .mockRejectedValueOnce(new ProviderFailure("PROVIDER_UNAVAILABLE", true, 503))
    .mockRejectedValueOnce(new ProviderFailure("RATE_LIMITED", true, 429))
    .mockResolvedValue(result);
  const provider = new CircuitBreakingQuizProvider(
    { generate },
    { failureThreshold: 2, cooldownMs: 5_000 },
    () => now,
    onReject,
  );
  await expect(provider.generate(request)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  await expect(provider.generate(request)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  await expect(provider.generate(request)).rejects.toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
    retryable: false,
  });
  expect(generate).toHaveBeenCalledTimes(2);
  expect(onReject).toHaveBeenCalledTimes(1);
  now += 5_000;
  await expect(provider.generate(request)).resolves.toEqual(result);
  expect(generate).toHaveBeenCalledTimes(3);
});
