import { randomUUID } from "node:crypto";
import { AppError } from "../../http/src/index.js";

export const RETENTION_CATEGORIES = [
  "EPHEMERAL_UPLOADS",
  "DORMANT_USER_ACCOUNTS",
  "AUDIT_LOGS",
  "ANALYTICS_RAW_EVENTS",
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export interface RetentionPolicy {
  readonly category: RetentionCategory;
  readonly retentionWindowDays: number;
  readonly legalHoldExempt?: boolean;
  readonly hardDelete?: boolean;
}

export interface RetentionTargetItem {
  readonly id: string;
  readonly category: RetentionCategory;
  readonly createdAt: Date;
  readonly lastAccessedAt?: Date;
  readonly hasLegalHold?: boolean;
  readonly sizeBytes?: number;
}

export interface RetentionExecutionReport {
  readonly runId: string;
  readonly category: RetentionCategory;
  readonly dryRun: boolean;
  readonly itemsScanned: number;
  readonly itemsEligibleForPrune: number;
  readonly itemsPruned: number;
  readonly itemsSkippedLegalHold: number;
  readonly bytesFreed: number;
  readonly executedAt: string;
}

/**
 * Enterprise Data Retention & Compliance Execution Runner.
 * Scans, evaluates eligibility, honors legal holds, and executes safe data pruning.
 */
export class DataRetentionRunner {
  public async executeRetentionPass(
    policy: RetentionPolicy,
    items: readonly RetentionTargetItem[],
    options?: {
      readonly dryRun?: boolean;
      readonly now?: Date;
      readonly onPrune?: (id: string) => Promise<void>;
    },
  ): Promise<RetentionExecutionReport> {
    if (policy.retentionWindowDays < 1 || !Number.isInteger(policy.retentionWindowDays)) {
      throw new AppError(
        "INVALID_RETENTION_POLICY",
        400,
        "Retention window must be an integer of at least 1 day",
      );
    }

    const runId = randomUUID();
    const now = options?.now ?? new Date();
    const dryRun = options?.dryRun ?? false;
    const cutoffTime = now.getTime() - policy.retentionWindowDays * 24 * 60 * 60 * 1000;

    let itemsScanned = 0;
    let itemsEligibleForPrune = 0;
    let itemsPruned = 0;
    let itemsSkippedLegalHold = 0;
    let bytesFreed = 0;

    for (const item of items) {
      if (item.category !== policy.category) continue;
      itemsScanned++;

      // Effective timestamp: latest of createdAt or lastAccessedAt
      const effectiveTime = Math.max(
        item.createdAt.getTime(),
        item.lastAccessedAt ? item.lastAccessedAt.getTime() : 0,
      );

      // Check if item is older than retention window cutoff
      if (effectiveTime < cutoffTime) {
        // Legal hold guard: Must NEVER prune items subject to legal hold
        if (item.hasLegalHold && !policy.legalHoldExempt) {
          itemsSkippedLegalHold++;
          continue;
        }

        itemsEligibleForPrune++;
        bytesFreed += item.sizeBytes ?? 0;

        if (!dryRun) {
          if (options?.onPrune) {
            await options.onPrune(item.id);
          }
          itemsPruned++;
        }
      }
    }

    const report: RetentionExecutionReport = {
      runId,
      category: policy.category,
      dryRun,
      itemsScanned,
      itemsEligibleForPrune,
      itemsPruned: dryRun ? 0 : itemsPruned,
      itemsSkippedLegalHold,
      bytesFreed,
      executedAt: now.toISOString(),
    };

    return report;
  }
}
