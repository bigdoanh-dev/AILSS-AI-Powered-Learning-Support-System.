import { describe, expect, it, vi } from "vitest";
import {
  DataRetentionRunner,
  type RetentionPolicy,
  type RetentionTargetItem,
} from "../../packages/security/src/index.js";

describe("Phase 21G/H: Data Retention Execution Runner & Compliance", () => {
  const runner = new DataRetentionRunner();
  const now = new Date("2026-09-17T12:00:00Z");

  const policy: RetentionPolicy = {
    category: "EPHEMERAL_UPLOADS",
    retentionWindowDays: 7,
  };

  const items: RetentionTargetItem[] = [
    // 1. Fresh item (3 days old) - KEEP
    {
      id: "item-fresh",
      category: "EPHEMERAL_UPLOADS",
      createdAt: new Date("2026-09-14T12:00:00Z"),
      sizeBytes: 1024,
    },
    // 2. Expired item (14 days old) - PRUNE
    {
      id: "item-expired-1",
      category: "EPHEMERAL_UPLOADS",
      createdAt: new Date("2026-09-03T12:00:00Z"),
      sizeBytes: 2048,
    },
    // 3. Expired item subject to legal hold (20 days old) - KEEP DUE TO LEGAL HOLD
    {
      id: "item-legal-hold",
      category: "EPHEMERAL_UPLOADS",
      createdAt: new Date("2026-08-28T12:00:00Z"),
      hasLegalHold: true,
      sizeBytes: 4096,
    },
    // 4. Item from different category - IGNORE
    {
      id: "item-audit",
      category: "AUDIT_LOGS",
      createdAt: new Date("2026-08-01T12:00:00Z"),
      sizeBytes: 512,
    },
  ];

  it("calculates eligible items and bytes freed in dry-run mode without invoking prune", async () => {
    const pruneSpy = vi.fn();

    const report = await runner.executeRetentionPass(policy, items, {
      dryRun: true,
      now,
      onPrune: pruneSpy,
    });

    expect(report.dryRun).toBe(true);
    expect(report.itemsScanned).toBe(3); // only EPHEMERAL_UPLOADS
    expect(report.itemsEligibleForPrune).toBe(1); // only item-expired-1
    expect(report.itemsPruned).toBe(0); // dryRun
    expect(report.itemsSkippedLegalHold).toBe(1); // item-legal-hold preserved
    expect(report.bytesFreed).toBe(2048);
    expect(pruneSpy).not.toHaveBeenCalled();
  });

  it("executes live pruning pass, invoking onPrune and skipping legal holds", async () => {
    const prunedIds: string[] = [];

    const report = await runner.executeRetentionPass(policy, items, {
      dryRun: false,
      now,
      onPrune: async (id) => {
        prunedIds.push(id);
      },
    });

    expect(report.dryRun).toBe(false);
    expect(report.itemsScanned).toBe(3);
    expect(report.itemsEligibleForPrune).toBe(1);
    expect(report.itemsPruned).toBe(1);
    expect(report.itemsSkippedLegalHold).toBe(1);
    expect(prunedIds).toEqual(["item-expired-1"]);
  });

  it("rejects invalid retention windows with AppError", async () => {
    await expect(
      runner.executeRetentionPass(
        { category: "EPHEMERAL_UPLOADS", retentionWindowDays: 0 },
        [],
      ),
    ).rejects.toMatchObject({
      code: "INVALID_RETENTION_POLICY",
      status: 400,
    });
  });
});
