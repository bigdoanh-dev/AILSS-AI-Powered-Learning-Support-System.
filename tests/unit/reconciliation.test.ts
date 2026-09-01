import { describe, expect, it } from "vitest";
import { decideRepair, validateDueScan } from "../../packages/reconciliation/src/index.js";
import { isCourseContentReadyForReview } from "../../packages/types/src/index.js";
import type { ReconciliationWork } from "../../apps/learning-service/src/reconciliation/repository.js";
import {
  LearningReconciliationRunner,
  type ReconciliationStore,
} from "../../apps/learning-service/src/reconciliation/runner.js";

const base = {
  operationId: crypto.randomUUID(),
  projectionName: "course_by_student",
  canonicalId: crypto.randomUUID(),
  expectedVersion: 4,
  projectionVersion: 3,
  expectedChecksum: "a",
  projectionChecksum: "b",
  attempt: 0,
};
describe("bounded reconciliation", () => {
  it("classifies version and checksum drift", () => {
    expect(decideRepair(base, true, 8)).toBe("REPAIR_VERSION_GAP");
    expect(decideRepair({ ...base, projectionVersion: 4 }, true, 8)).toBe("REPAIR_CHECKSUM_DRIFT");
    expect(decideRepair({ ...base, projectionVersion: 4, projectionChecksum: "a" }, true, 8)).toBe(
      "NO_DRIFT",
    );
  });
  it("prohibits unbounded/full scans", () => {
    expect(() => validateDueScan({ shard: 0, shardCount: 16, pageSize: 200 })).not.toThrow();
    expect(() => validateDueScan({ shard: 0, shardCount: 16, pageSize: 201 })).toThrow(
      "UNBOUNDED_RECONCILE_PAGE",
    );
  });
});

describe("P7.12A Learning owner-local Q-LRN-016 runner", () => {
  it("locks Q-LRN-006 completeness without preview/object-key requirements", () => {
    expect(isCourseContentReadyForReview([])).toBe(false);
    expect(isCourseContentReadyForReview([{ state: "READY" }])).toBe(true);
    expect(isCourseContentReadyForReview([{ state: "READY" }, { state: "DRAFT" }])).toBe(false);
    expect(isCourseContentReadyForReview([{ state: "INCOMPLETE" }])).toBe(false);
  });

  it("leases once, fences completion and removes a completed stale due row", async () => {
    const item = work();
    const store = new MemoryReconciliationStore([item]);
    const runner = new LearningReconciliationRunner(store, async () => item.canonicalVersion);
    await runner.runOnce(new Date("2026-08-30T12:00:00.000Z"));
    expect(store.claimed).toEqual([item.operationId]);
    expect(store.completed).toEqual([{ operationId: item.operationId, version: 4 }]);
    expect(store.retried).toHaveLength(0);

    store.items = [{ ...item, operationState: "COMPLETE", projectionVersion: 4 }];
    await runner.runOnce(new Date("2026-08-30T12:01:00.000Z"));
    expect(store.discarded).toEqual([item.operationId]);
    expect(store.claimed).toHaveLength(1);
  });

  it("uses bounded exponential retry and never runs work under a live lease", async () => {
    const now = new Date("2026-08-30T12:00:00.000Z");
    const live = work({
      operationId: crypto.randomUUID(),
      dueState: "RUNNING",
      operationState: "RUNNING",
      dueLeaseUntil: new Date(now.getTime() + 10_000),
      operationLeaseUntil: new Date(now.getTime() + 10_000),
    });
    const retry = work({ retryCount: 9 });
    const store = new MemoryReconciliationStore([live, retry]);
    const runner = new LearningReconciliationRunner(store, async () => {
      throw new Error("projection unavailable");
    });
    await runner.runOnce(now);
    expect(store.claimed).toEqual([retry.operationId]);
    expect(store.retried).toHaveLength(1);
    const delay = (store.retried[0]?.next.getTime() ?? 0) - Date.now();
    expect(delay).toBeGreaterThan(55_000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });
});

function work(overrides: Partial<ReconciliationWork> = {}): ReconciliationWork {
  const at = new Date("2026-08-30T11:59:00.000Z");
  return {
    operationId: crypto.randomUUID(),
    projectionName: "COURSE_PUBLIC_ARCHIVE_CLEANUP",
    canonicalId: crypto.randomUUID(),
    canonicalVersion: 4,
    checksum: JSON.stringify({
      schemaVersion: 1,
      categoryId: crypto.randomUUID(),
      publishedAt: at.toISOString(),
      searchTokens: ["data"],
    }),
    dueDay: "2026-08-30",
    shard: 0,
    nextAttemptAt: at,
    retryCount: 0,
    dueState: "READY",
    dueLeaseFence: 0,
    operationState: "READY",
    operationLeaseFence: 0,
    operationNextAttemptAt: at,
    projectionVersion: 0,
    ...overrides,
  };
}

class MemoryReconciliationStore implements ReconciliationStore {
  public claimed: string[] = [];
  public completed: Array<{ operationId: string; version: number }> = [];
  public retried: Array<{ operationId: string; next: Date }> = [];
  public discarded: string[] = [];

  public constructor(public items: ReconciliationWork[]) {}
  public async listDue(): Promise<readonly ReconciliationWork[]> {
    return this.items;
  }
  public async claim(item: ReconciliationWork, _owner: string, now: Date): Promise<boolean> {
    const live =
      (item.dueLeaseUntil && item.dueLeaseUntil > now) ||
      (item.operationLeaseUntil && item.operationLeaseUntil > now);
    if (live) return false;
    this.claimed.push(item.operationId);
    return true;
  }
  public async complete(item: ReconciliationWork, version: number): Promise<void> {
    this.completed.push({ operationId: item.operationId, version });
  }
  public async retry(item: ReconciliationWork, _errorCode: string, next: Date): Promise<void> {
    this.retried.push({ operationId: item.operationId, next });
  }
  public async discardCompleted(item: ReconciliationWork): Promise<void> {
    this.discarded.push(item.operationId);
  }
}
