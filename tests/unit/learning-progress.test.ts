import { describe, expect, it } from "vitest";
import {
  completionSchema,
  progressDto,
  progressFingerprint,
} from "../../apps/learning-service/src/progress/model.js";

describe("P9.2A Learning progress", () => {
  it("uses a strict boolean completion DTO", () => {
    expect(completionSchema.parse({ completed: true })).toEqual({ completed: true });
    expect(() => completionSchema.parse({ completed: true, studentId: crypto.randomUUID() })).toThrow();
    expect(() => completionSchema.parse({ completed: "true" })).toThrow();
  });

  it("returns deterministic zero and exact ratio fields", () => {
    const dto = progressDto({
      studentId: crypto.randomUUID(),
      courseId: crypto.randomUUID(),
      progressVersion: 0,
      courseContentVersion: 7,
      completedCount: 0,
      publishedTotal: 100,
      percent: 0,
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(dto).toMatchObject({ progressVersion: 0, completedCount: 0, publishedTotal: 100, percent: 0 });
    expect(dto.completed).toBe(false);
  });

  it("binds idempotency fingerprint to the canonical request", () => {
    const base = { method: "PUT", route: "/api/v1/lessons/x/completion", actorId: "student" };
    expect(progressFingerprint("secret", { ...base, completed: true })).toBe(
      progressFingerprint("secret", { ...base, completed: true }),
    );
    expect(progressFingerprint("secret", { ...base, completed: true })).not.toBe(
      progressFingerprint("secret", { ...base, completed: false }),
    );
  });
});
