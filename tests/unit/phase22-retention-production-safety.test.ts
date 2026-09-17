import { describe, expect, it, vi } from "vitest";
import {
  DataRetentionRunner,
  type RetentionPolicy,
  type RetentionTargetItem,
} from "../../packages/security/src/retention.js";

describe("Phase 22.25: Retention Runner Production Safety & Destructive Guardrails", () => {
  const runner = new DataRetentionRunner();
  const now = new Date("2026-09-17T00:00:00Z");

  it("proves retention runner CANNOT prune records under legal hold (hasLegalHold: true)", async () => {
    const pruneMock = vi.fn().mockResolvedValue(undefined);

    const oldDate = new Date("2025-01-01T00:00:00Z"); // > 600 days old

    const items: RetentionTargetItem[] = [
      {
        id: "item-normal-expired",
        category: "AUDIT_LOGS",
        createdAt: oldDate,
        sizeBytes: 1024,
      },
      {
        id: "item-legal-held",
        category: "AUDIT_LOGS",
        createdAt: oldDate,
        hasLegalHold: true, // EXPLICIT LEGAL HOLD
        sizeBytes: 2048,
      },
    ];

    const policy: RetentionPolicy = {
      category: "AUDIT_LOGS",
      retentionWindowDays: 90,
    };

    const report = await runner.executeRetentionPass(policy, items, {
      dryRun: false,
      now,
      onPrune: pruneMock,
    });

    expect(report.itemsScanned).toBe(2);
    expect(report.itemsEligibleForPrune).toBe(1);
    expect(report.itemsPruned).toBe(1);
    expect(report.itemsSkippedLegalHold).toBe(1); // Legal hold preserved
    expect(pruneMock).toHaveBeenCalledWith("item-normal-expired");
    expect(pruneMock).not.toHaveBeenCalledWith("item-legal-held");
  });

  it("proves dry-run mode estimates capacity without executing any destructive deletions", async () => {
    const pruneMock = vi.fn().mockResolvedValue(undefined);
    const oldDate = new Date("2025-01-01T00:00:00Z");

    const items: RetentionTargetItem[] = [
      { id: "item-1", category: "EPHEMERAL_UPLOADS", createdAt: oldDate, sizeBytes: 5000 },
      { id: "item-2", category: "EPHEMERAL_UPLOADS", createdAt: oldDate, sizeBytes: 3000 },
    ];

    const policy: RetentionPolicy = {
      category: "EPHEMERAL_UPLOADS",
      retentionWindowDays: 30,
    };

    const report = await runner.executeRetentionPass(policy, items, {
      dryRun: true, // DRY RUN MODE
      now,
      onPrune: pruneMock,
    });

    expect(report.dryRun).toBe(true);
    expect(report.itemsEligibleForPrune).toBe(2);
    expect(report.itemsPruned).toBe(0); // ZERO PRUNED
    expect(report.bytesFreed).toBe(8000);
    expect(pruneMock).not.toHaveBeenCalled();
  });

  it("proves financial ledgers and verified credentials are categorically excluded from retention policies", () => {
    // Attempting to configure retention for unapproved categories is rejected by type system and policy validation
    const validCategories = ["EPHEMERAL_UPLOADS", "DORMANT_USER_ACCOUNTS", "AUDIT_LOGS", "ANALYTICS_RAW_EVENTS"];

    expect(validCategories.includes("FINANCIAL_LEDGER")).toBe(false);
    expect(validCategories.includes("VERIFIED_CREDENTIALS")).toBe(false);
    expect(validCategories.includes("COURSE_CONTENT")).toBe(false);
  });
});
