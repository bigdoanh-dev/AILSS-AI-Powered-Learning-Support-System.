export interface FinOpsUsageEvent {
  readonly tenantId: string;
  readonly service: "AI_SERVICE" | "SEARCH_SERVICE" | "STORAGE_SERVICE" | "NOTIFICATION_WORKER";
  readonly operation:
    | "CHAT_COMPLETION"
    | "RAG_RETRIEVAL"
    | "DOCUMENT_EMBEDDING"
    | "DOCUMENT_EXTRACTION"
    | "SMS_DISPATCH"
    | "PUSH_DISPATCH";
  readonly model?: string;
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly latencyMs: number;
  readonly timestamp: string;
}

export interface TenantFinOpsQuota {
  readonly tenantId: string;
  readonly monthlyTokenLimit: number;
  readonly monthlyStorageBytesLimit: number;
  readonly maxRps: number;
}

export interface FinOpsQuotaCheckResult {
  readonly allowed: boolean;
  readonly reason?: "QUOTA_EXCEEDED" | "RATE_LIMIT_EXCEEDED";
  readonly currentUsageTokens: number;
  readonly remainingTokens: number;
}

export class FinOpsTracker {
  readonly #usageMap = new Map<string, number>(); // tenantId -> currentTokens
  readonly #quotas = new Map<string, TenantFinOpsQuota>();

  public setTenantQuota(quota: TenantFinOpsQuota): void {
    this.#quotas.set(quota.tenantId, quota);
  }

  public recordUsage(event: FinOpsUsageEvent): void {
    const totalUnits = event.inputUnits + event.outputUnits;
    const current = this.#usageMap.get(event.tenantId) ?? 0;
    this.#usageMap.set(event.tenantId, current + totalUnits);
  }

  public checkQuota(tenantId: string, requestedUnits = 0): FinOpsQuotaCheckResult {
    const quota = this.#quotas.get(tenantId);
    const current = this.#usageMap.get(tenantId) ?? 0;

    if (!quota) {
      // Default unthrottled if no institutional quota configured
      return {
        allowed: true,
        currentUsageTokens: current,
        remainingTokens: Number.POSITIVE_INFINITY,
      };
    }

    if (current + requestedUnits > quota.monthlyTokenLimit) {
      return {
        allowed: false,
        reason: "QUOTA_EXCEEDED",
        currentUsageTokens: current,
        remainingTokens: Math.max(0, quota.monthlyTokenLimit - current),
      };
    }

    return {
      allowed: true,
      currentUsageTokens: current,
      remainingTokens: quota.monthlyTokenLimit - (current + requestedUnits),
    };
  }
}
