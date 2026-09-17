import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAiUsage } from "../src/lecturer/useAiUsage";
const { retry } = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock("../src/lecturer/api", () => ({
  useLecturer: () => ({ data: { resetsAt: "2026-09-14T17:00:00.000Z" }, retry }),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  retry.mockClear();
});
it("fetches server usage at Vietnam midnight without resetting counters locally", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T16:59:59.000Z"));
  renderHook(() => useAiUsage());
  act(() => vi.advanceTimersByTime(1250));
  expect(retry).toHaveBeenCalledTimes(1);
});
it("refreshes on job transitions, focus and periodic polling and cleans up on unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T10:00:00Z"));
  const { rerender, unmount } = renderHook(({ state }) => useAiUsage("job-1", state), {
    initialProps: { state: "QUEUED" },
  });
  expect(retry).toHaveBeenCalledTimes(1);
  rerender({ state: "AI_DRAFT" });
  expect(retry).toHaveBeenCalledTimes(2);
  act(() => window.dispatchEvent(new Event("focus")));
  expect(retry).toHaveBeenCalledTimes(3);
  act(() => vi.advanceTimersByTime(30000));
  expect(retry).toHaveBeenCalledTimes(4);
  unmount();
  act(() => vi.advanceTimersByTime(30000));
  expect(retry).toHaveBeenCalledTimes(4);
});
