export type DataCategory =
  | "IDENTITY"
  | "ACADEMIC"
  | "AI"
  | "ANALYTICS"
  | "NOTIFICATION"
  | "AUDIT_SECURITY";

export interface CategoryRetentionRule {
  readonly category: DataCategory;
  readonly minPlatformSafeDays: number;
  readonly defaultDays: number;
  readonly maxPlatformSafeDays: number;
  readonly exportable: boolean;
  readonly userDeletable: boolean;
  readonly legalHoldSupported: boolean;
}

export const PLATFORM_RETENTION_CONSTRAINTS: Record<DataCategory, CategoryRetentionRule> = {
  IDENTITY: {
    category: "IDENTITY",
    minPlatformSafeDays: 365,       // 1 year minimum for active enrollment verification
    defaultDays: 1825,              // 5 years default
    maxPlatformSafeDays: 3650,      // 10 years maximum
    exportable: true,
    userDeletable: true,
    legalHoldSupported: true,
  },
  ACADEMIC: {
    category: "ACADEMIC",
    minPlatformSafeDays: 1825,      // 5 years minimum per higher ed accreditation requirements
    defaultDays: 3650,              // 10 years default
    maxPlatformSafeDays: 7300,      // 20 years maximum
    exportable: true,
    userDeletable: false,           // Academic records cannot be unilaterally deleted by students
    legalHoldSupported: true,
  },
  AI: {
    category: "AI",
    minPlatformSafeDays: 30,        // 30 days minimum for safety moderation audits
    defaultDays: 90,                // 90 days default
    maxPlatformSafeDays: 365,       // 1 year maximum
    exportable: true,
    userDeletable: true,
    legalHoldSupported: true,
  },
  ANALYTICS: {
    category: "ANALYTICS",
    minPlatformSafeDays: 30,        // 30 days minimum
    defaultDays: 180,               // 180 days default
    maxPlatformSafeDays: 730,       // 2 years maximum
    exportable: false,
    userDeletable: false,
    legalHoldSupported: false,
  },
  NOTIFICATION: {
    category: "NOTIFICATION",
    minPlatformSafeDays: 14,        // 14 days minimum
    defaultDays: 90,                // 90 days default
    maxPlatformSafeDays: 365,       // 1 year maximum
    exportable: false,
    userDeletable: false,
    legalHoldSupported: false,
  },
  AUDIT_SECURITY: {
    category: "AUDIT_SECURITY",
    minPlatformSafeDays: 730,       // 2 years minimum per security audit compliance
    defaultDays: 1825,              // 5 years default
    maxPlatformSafeDays: 3650,      // 10 years maximum
    exportable: true,
    userDeletable: false,
    legalHoldSupported: true,
  },
};

export interface InstitutionRetentionSchedule {
  readonly tenantId: string;
  readonly schedules: Record<DataCategory, number>;
  readonly legalHoldActive: boolean;
  readonly legalHoldReason?: string;
  readonly lastModifiedAt: string;
}

export interface RetentionValidationResult {
  readonly valid: boolean;
  readonly violations: readonly {
    readonly category: DataCategory;
    readonly requestedDays: number;
    readonly allowedRange: readonly [number, number];
    readonly reason: "BELOW_SAFE_MINIMUM" | "EXCEEDS_PLATFORM_MAXIMUM";
  }[];
}

export const DataRetentionPolicyEngine = {
  validateSchedule(schedules: Partial<Record<DataCategory, number>>): RetentionValidationResult {
    const violations: {
      readonly category: DataCategory;
      readonly requestedDays: number;
      readonly allowedRange: readonly [number, number];
      readonly reason: "BELOW_SAFE_MINIMUM" | "EXCEEDS_PLATFORM_MAXIMUM";
    }[] = [];

    for (const [cat, days] of Object.entries(schedules)) {
      const category = cat as DataCategory;
      const constraint = PLATFORM_RETENTION_CONSTRAINTS[category];
      if (!constraint || days === undefined) continue;

      if (days < constraint.minPlatformSafeDays) {
        violations.push({
          category,
          requestedDays: days,
          allowedRange: [constraint.minPlatformSafeDays, constraint.maxPlatformSafeDays],
          reason: "BELOW_SAFE_MINIMUM",
        });
      } else if (days > constraint.maxPlatformSafeDays) {
        violations.push({
          category,
          requestedDays: days,
          allowedRange: [constraint.minPlatformSafeDays, constraint.maxPlatformSafeDays],
          reason: "EXCEEDS_PLATFORM_MAXIMUM",
        });
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  },

  createInstitutionSchedule(
    tenantId: string,
    overrides?: Partial<Record<DataCategory, number>>,
    legalHold = false,
    legalHoldReason?: string,
  ): InstitutionRetentionSchedule {
    if (overrides) {
      const validation = this.validateSchedule(overrides);
      if (!validation.valid) {
        const err = validation.violations[0] ?? {
          category: "IDENTITY" as const,
          requestedDays: 0,
          allowedRange: [365, 3650] as const,
          reason: "BELOW_SAFE_MINIMUM" as const,
        };
        throw new Error(
          `RETENTION_POLICY_VIOLATION: ${err.category} requested ${err.requestedDays} days, outside safe range [${err.allowedRange[0]}, ${err.allowedRange[1]}] (${err.reason})`,
        );
      }
    }

    const defaultSchedules: Record<DataCategory, number> = {
      IDENTITY: PLATFORM_RETENTION_CONSTRAINTS.IDENTITY.defaultDays,
      ACADEMIC: PLATFORM_RETENTION_CONSTRAINTS.ACADEMIC.defaultDays,
      AI: PLATFORM_RETENTION_CONSTRAINTS.AI.defaultDays,
      ANALYTICS: PLATFORM_RETENTION_CONSTRAINTS.ANALYTICS.defaultDays,
      NOTIFICATION: PLATFORM_RETENTION_CONSTRAINTS.NOTIFICATION.defaultDays,
      AUDIT_SECURITY: PLATFORM_RETENTION_CONSTRAINTS.AUDIT_SECURITY.defaultDays,
    };

    return {
      tenantId,
      schedules: {
        ...defaultSchedules,
        ...overrides,
      },
      legalHoldActive: legalHold,
      ...(legalHoldReason ? { legalHoldReason } : {}),
      lastModifiedAt: new Date().toISOString(),
    };
  },

  isPurgeEligible(
    schedule: InstitutionRetentionSchedule,
    category: DataCategory,
    itemCreatedAt: Date,
    now: Date = new Date(),
  ): { readonly eligible: boolean; readonly reason: string } {
    if (schedule.legalHoldActive) {
      return {
        eligible: false,
        reason: `LEGAL_HOLD_ACTIVE: Purge blocked by institution legal hold${schedule.legalHoldReason ? ` (${schedule.legalHoldReason})` : ""}`,
      };
    }

    const retentionDays = schedule.schedules[category] ?? PLATFORM_RETENTION_CONSTRAINTS[category].defaultDays;
    const ageInDays = (now.getTime() - itemCreatedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (ageInDays > retentionDays) {
      return {
        eligible: true,
        reason: `RETENTION_EXPIRED: Item age ${Math.floor(ageInDays)} days exceeds policy of ${retentionDays} days`,
      };
    }

    return {
      eligible: false,
      reason: `RETENTION_ACTIVE: Item age ${Math.floor(ageInDays)} days is within retention window of ${retentionDays} days`,
    };
  },
} as const;
