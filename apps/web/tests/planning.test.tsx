import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { calendarWindow, localDay } from "../src/components/ScheduleCalendar";
import { OperationResult } from "../src/components/OperationResult";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("Schedule ranges", () => {
  it("splits the full month grid into contiguous API ranges of at most 31 days", () => {
    const value = calendarWindow("2026-09-08", "month");
    expect(value.start).toBe("2026-08-31");
    expect(value.end).toBe("2026-10-11");
    const ranges = value.queries.map((q) => new URLSearchParams(q));
    expect(ranges).toHaveLength(2);
    for (const range of ranges)
      expect((Date.parse(range.get("to")!) - Date.parse(range.get("from")!)) / 86400000).toBeLessThan(31);
    expect(Date.parse(ranges[1].get("from")!) - Date.parse(ranges[0].get("to")!)).toBe(86400000);
  });
  it("keeps Monday-Sunday weeks across year boundaries", () => {
    expect(calendarWindow("2027-01-01", "week")).toMatchObject({ start: "2026-12-28", end: "2027-01-03" });
  });
  it("uses Vietnam dates for sessions around midnight", () => {
    expect(localDay(new Date("2026-08-31T18:00:00Z"))).toBe("2026-09-01");
  });
});
it("keeps receipt visible until the user explicitly continues", () => {
  vi.useFakeTimers();
  const done = vi.fn();
  render(
    <OperationResult success title="Thành công" onComplete={done}>
      Đã lưu.
    </OperationResult>,
  );
  act(() => vi.advanceTimersByTime(10000));
  expect(done).not.toHaveBeenCalled();
  expect(screen.getByText("Đã lưu.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
  expect(done).toHaveBeenCalledTimes(1);
});
it("auto redirects on success when autoRedirect is explicitly enabled", () => {
  vi.useFakeTimers();
  const done = vi.fn();
  render(
    <OperationResult success autoRedirect redirectDelayMs={2200} title="Thành công" onComplete={done}>
      Chuyển trang tự động.
    </OperationResult>,
  );
  act(() => vi.advanceTimersByTime(2199));
  expect(done).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(done).toHaveBeenCalledTimes(1);
});
it("cancels navigation if the notification unmounts", () => {
  vi.useFakeTimers();
  const done = vi.fn();
  const view = render(
    <OperationResult success={false} title="Chưa thành công" onComplete={done}>
      Thử lại.
    </OperationResult>,
  );
  view.unmount();
  act(() => vi.advanceTimersByTime(3000));
  expect(done).not.toHaveBeenCalled();
});
