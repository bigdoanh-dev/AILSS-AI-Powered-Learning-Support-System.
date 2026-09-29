export interface CurrencyRule {
  readonly currency: string;
  readonly allowFractional: boolean;
  readonly minimumAmountMinor: number;
}

export interface FinancePolicyVersion {
  readonly policyVersion: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date | undefined;
  readonly refundWindowDays: number;
  readonly maxProgressBasisPoints: number; // e.g. 2000 for 20.00%
  readonly lecturerRevenueBasisPoints: number; // e.g. 8000 for 80.00%
  readonly platformRevenueBasisPoints: number; // e.g. 2000 for 20.00%
  readonly currencyRules: readonly CurrencyRule[];
  readonly status: "DRAFT" | "ACTIVE" | "DEPRECATED";
}

export interface FinancePolicyConfig {
  readonly policyVersion: number;
  readonly maxRefundDays: number;
  readonly maxProgressPercentForRefund: number;
  readonly platformFeeBasisPoints: number; // e.g. 2000 for 20.00%
  readonly lecturerShareBasisPoints: number; // e.g. 8000 for 80.00%
}

export const DEFAULT_FINANCE_POLICY: FinancePolicyConfig = {
  policyVersion: 2,
  maxRefundDays: 7,
  maxProgressPercentForRefund: 20.0,
  platformFeeBasisPoints: 1500,
  lecturerShareBasisPoints: 8500,
};
export function platformFeeBasisPointsAt(paidAt: Date): number {
  return paidAt.getTime() >= Date.UTC(2026, 8, 27) ? 1500 : 2000;
}

export class FinancePolicyRegistry {
  private readonly versions = new Map<number, FinancePolicyVersion>();

  public constructor(initialVersions?: readonly FinancePolicyVersion[]) {
    if (initialVersions && initialVersions.length > 0) {
      for (const v of initialVersions) {
        this.versions.set(v.policyVersion, v);
      }
    } else {
      this.registerVersion({
        policyVersion: 1,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveTo: new Date("2026-09-27T00:00:00Z"),
        refundWindowDays: 7,
        maxProgressBasisPoints: 2000,
        lecturerRevenueBasisPoints: 8000,
        platformRevenueBasisPoints: 2000,
        currencyRules: [{ currency: "VND", allowFractional: false, minimumAmountMinor: 10000 }],
        status: "ACTIVE",
      });
      this.registerVersion({
        policyVersion: 2,
        effectiveFrom: new Date("2026-09-27T00:00:00Z"),
        refundWindowDays: 7,
        maxProgressBasisPoints: 2000,
        lecturerRevenueBasisPoints: 8500,
        platformRevenueBasisPoints: 1500,
        currencyRules: [{ currency: "VND", allowFractional: false, minimumAmountMinor: 10000 }],
        status: "ACTIVE",
      });
    }
  }

  public registerVersion(version: FinancePolicyVersion): void {
    this.versions.set(version.policyVersion, version);
  }

  public getVersion(version: number): FinancePolicyVersion | undefined {
    return this.versions.get(version);
  }

  public getActiveVersion(atDate: Date = new Date()): FinancePolicyVersion {
    const active = Array.from(this.versions.values())
      .filter(
        (v) =>
          v.status === "ACTIVE" && v.effectiveFrom <= atDate && (!v.effectiveTo || v.effectiveTo > atDate),
      )
      .sort((a, b) => b.policyVersion - a.policyVersion);

    const latest = active[0];
    if (!latest) {
      throw new Error("No active finance policy version found");
    }
    return latest;
  }

  public toConfig(version: FinancePolicyVersion): FinancePolicyConfig {
    return {
      policyVersion: version.policyVersion,
      maxRefundDays: version.refundWindowDays,
      maxProgressPercentForRefund: version.maxProgressBasisPoints / 100,
      platformFeeBasisPoints: version.platformRevenueBasisPoints,
      lecturerShareBasisPoints: version.lecturerRevenueBasisPoints,
    };
  }
}

export interface RefundEvaluationInput {
  readonly orderState: string;
  readonly paidAt: Date | undefined;
  readonly progressPercent: number;
  readonly existingRefundStatus?: string | undefined;
  readonly policyVersion?: number | undefined;
  readonly now?: Date | undefined;
}

export interface RefundEvaluationResult {
  readonly eligible: boolean;
  readonly reasonCode: string;
  readonly userSafeExplanation: string;
  readonly progressPercent: number;
  readonly daysSincePurchase: number;
  readonly policyVersionApplied: number;
}

export class CourseRefundPolicyEngine {
  readonly #config: FinancePolicyConfig;
  readonly #registry?: FinancePolicyRegistry | undefined;

  public constructor(config?: Partial<FinancePolicyConfig>, registry?: FinancePolicyRegistry) {
    this.#config = {
      ...DEFAULT_FINANCE_POLICY,
      ...config,
    };
    this.#registry = registry;
  }

  public get config(): FinancePolicyConfig {
    return this.#config;
  }

  public get registry(): FinancePolicyRegistry | undefined {
    return this.#registry;
  }

  public evaluate(input: RefundEvaluationInput): RefundEvaluationResult {
    const now = input.now ?? new Date();

    // Determine applicable config (either historical pinned version or engine default)
    let activeConfig = this.#config;
    if (input.policyVersion !== undefined && this.#registry) {
      const versionObj = this.#registry.getVersion(input.policyVersion);
      if (versionObj) {
        activeConfig = this.#registry.toConfig(versionObj);
      }
    }

    if (input.existingRefundStatus) {
      return {
        eligible: false,
        reasonCode: "DUPLICATE_REFUND_REQUEST",
        userSafeExplanation: `Đơn hàng đã có yêu cầu hoàn tiền đang ở trạng thái: ${input.existingRefundStatus}.`,
        progressPercent: input.progressPercent,
        daysSincePurchase: 0,
        policyVersionApplied: activeConfig.policyVersion,
      };
    }

    if (!["ENTITLED", "PAID_PENDING_ENTITLEMENT"].includes(input.orderState)) {
      return {
        eligible: false,
        reasonCode: "ORDER_NOT_REFUNDABLE",
        userSafeExplanation: "Chỉ những đơn hàng đã thanh toán thành công mới có thể yêu cầu hoàn tiền.",
        progressPercent: input.progressPercent,
        daysSincePurchase: 0,
        policyVersionApplied: activeConfig.policyVersion,
      };
    }

    if (!input.paidAt) {
      return {
        eligible: false,
        reasonCode: "PAYMENT_DATE_MISSING",
        userSafeExplanation: "Không tìm thấy thời điểm thanh toán hợp lệ của đơn hàng.",
        progressPercent: input.progressPercent,
        daysSincePurchase: 0,
        policyVersionApplied: activeConfig.policyVersion,
      };
    }

    const elapsedMs = now.getTime() - input.paidAt.getTime();
    const daysSincePurchase = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));

    if (daysSincePurchase > activeConfig.maxRefundDays) {
      return {
        eligible: false,
        reasonCode: "REFUND_WINDOW_EXPIRED",
        userSafeExplanation: `Chính sách hoàn tiền chỉ áp dụng trong vòng ${String(activeConfig.maxRefundDays)} ngày kể từ ngày thanh toán (đã trôi qua ${String(daysSincePurchase)} ngày).`,
        progressPercent: input.progressPercent,
        daysSincePurchase,
        policyVersionApplied: activeConfig.policyVersion,
      };
    }

    if (input.progressPercent >= activeConfig.maxProgressPercentForRefund) {
      return {
        eligible: false,
        reasonCode: "PROGRESS_EXCEEDED_THRESHOLD",
        userSafeExplanation: `Bạn đã hoàn thành ${input.progressPercent.toFixed(1)}% nội dung khóa học. Chính sách hoàn tiền yêu cầu tiến độ học tập dưới ${String(activeConfig.maxProgressPercentForRefund)}%.`,
        progressPercent: input.progressPercent,
        daysSincePurchase,
        policyVersionApplied: activeConfig.policyVersion,
      };
    }

    return {
      eligible: true,
      reasonCode: "REFUND_QUALIFIED",
      userSafeExplanation: `Đơn hàng đủ điều kiện hoàn tiền theo chính sách AILSS (trong ${String(activeConfig.maxRefundDays)} ngày và tiến độ dưới ${String(activeConfig.maxProgressPercentForRefund)}%).`,
      progressPercent: input.progressPercent,
      daysSincePurchase,
      policyVersionApplied: activeConfig.policyVersion,
    };
  }
}
