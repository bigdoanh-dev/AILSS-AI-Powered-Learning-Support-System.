import { describe, expect, it } from "vitest";
import {
  deterministicUuid,
  sessionsOverlap,
  utcDatesTouched,
} from "../../apps/classroom-service/src/model.js";

describe("P7.16 Student schedule primitives", () => {
  it("uses the exact strict overlap predicate", () => {
    const a = new Date("2026-09-07T12:00:00.000Z"),
      b = new Date("2026-09-07T14:00:00.000Z");
    expect(
      sessionsOverlap(a, b, new Date("2026-09-07T13:00:00.000Z"), new Date("2026-09-07T15:00:00.000Z")),
    ).toBe(true);
    expect(sessionsOverlap(a, b, b, new Date("2026-09-07T16:00:00.000Z"))).toBe(false);
  });

  it("creates at most two UTC-day segments for the locked duration bound", () => {
    expect(
      utcDatesTouched(new Date("2026-09-07T19:00:00.000Z"), new Date("2026-09-08T02:00:00.000Z")),
    ).toEqual(["2026-09-07", "2026-09-08"]);
  });

  it("does not allocate a segment for an end-at-midnight endpoint", () => {
    expect(
      utcDatesTouched(new Date("2026-09-07T20:00:00.000Z"), new Date("2026-09-08T00:00:00.000Z")),
    ).toEqual(["2026-09-07"]);
  });

  it("derives a stable UUID for replay and distinct namespace IDs", () => {
    const first = deterministicUuid("secret", "schedule-reservation", "operation");
    expect(deterministicUuid("secret", "schedule-reservation", "operation")).toBe(first);
    expect(deterministicUuid("secret", "schedule-entry", "operation")).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
});
