import { describe, expect, it } from "vitest";
import {
  createReportSchema,
  moderateSchema,
  reason,
  reportDto,
} from "../../apps/interaction-service/src/moderation/model.js";

describe("Phase 9.3 moderation primitives", () => {
  it("locks report targets and strict DTOs", () => {
    expect(
      createReportSchema.parse({
        targetType: "COMMENT",
        targetId: "00000000-0000-4000-8000-000000000001",
        reason: "spam",
      }).targetType,
    ).toBe("COMMENT");
    expect(() =>
      createReportSchema.parse({
        targetType: "USER",
        targetId: "00000000-0000-4000-8000-000000000001",
        reason: "x",
      }),
    ).toThrow();
    expect(() => moderateSchema.parse({ action: "DELETE", reason: "x" })).toThrow();
  });
  it("normalizes and bounds safe reasons", () => {
    expect(reason("  Cafe\u0301\r\n  ")).toBe("Café");
    expect(() => reason("x".repeat(1001))).toThrow("INVALID_REPORT_REASON");
  });
  it("omits reporter identity and reason from DTO", () => {
    const dto = reportDto({
      reportId: "r",
      reporterId: "private",
      targetType: "REVIEW",
      targetId: "t",
      reason: "private",
      state: "OPEN",
      decision: null,
      moderatorId: null,
      version: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    expect(dto).not.toHaveProperty("reporterId");
    expect(dto).not.toHaveProperty("reason");
  });
});
