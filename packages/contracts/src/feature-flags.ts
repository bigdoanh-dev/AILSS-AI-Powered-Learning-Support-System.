import { z } from "zod";

export const PRODUCT_FEATURE_FLAGS = [
  "ADAPTIVE_LEARNING_V2",
  "STUDY_PLAN_V2",
  "AI_TUTOR_V2",
  "TEACHER_COPILOT",
  "LEARNING_INTERVENTIONS",
  "INSTITUTION_ADMIN_V2",
  "LEARNING_INTELLIGENCE_V2",
] as const;

export type ProductFeatureFlag = (typeof PRODUCT_FEATURE_FLAGS)[number];

export const FeatureRolloutModeEnum = z.enum(["OFF", "INTERNAL", "PILOT_TENANTS", "PERCENT_ROLLOUT", "ON"]);
export type FeatureRolloutMode = z.infer<typeof FeatureRolloutModeEnum>;

export interface FeatureFlagPolicy {
  flag: ProductFeatureFlag;
  mode: FeatureRolloutMode;
  allowedTenants: string[];
  rolloutPercentage?: number | undefined; // 0 - 100 for PERCENT_ROLLOUT
  description: string;
  updatedAt: string;
}

export interface TenantFeatureContext {
  tenantId: string;
  userId?: string | undefined;
  isInternalTenant?: boolean | undefined;
}

export class TenantFeatureFlagResolver {
  private readonly policies: Map<ProductFeatureFlag, FeatureFlagPolicy>;

  constructor(initialPolicies?: FeatureFlagPolicy[]) {
    this.policies = new Map();
    if (initialPolicies) {
      for (const p of initialPolicies) {
        this.policies.set(p.flag, p);
      }
    } else {
      this.initDefaultPolicies();
    }
  }

  private initDefaultPolicies(): void {
    const now = "2026-09-21T23:30:00Z";
    const pilotTenants = ["tenant-polytech-hcm", "tenant-vnu-hn", "tenant-pilot-engineering"];

    for (const flag of PRODUCT_FEATURE_FLAGS) {
      this.policies.set(flag, {
        flag,
        mode: "PILOT_TENANTS",
        allowedTenants: pilotTenants,
        rolloutPercentage: 25,
        description: `Pilot policy for ${flag}`,
        updatedAt: now,
      });
    }
  }

  public setPolicy(policy: FeatureFlagPolicy): void {
    this.policies.set(policy.flag, policy);
  }

  public getPolicy(flag: ProductFeatureFlag): FeatureFlagPolicy | undefined {
    return this.policies.get(flag);
  }

  public isEnabled(flag: ProductFeatureFlag, context: TenantFeatureContext): boolean {
    const policy = this.policies.get(flag);
    if (!policy) return false;

    switch (policy.mode) {
      case "OFF":
        return false;
      case "ON":
        return true;
      case "INTERNAL":
        return Boolean(
          context.isInternalTenant ||
          context.tenantId.includes("internal") ||
          context.tenantId.includes("research") ||
          context.tenantId.includes("dev"),
        );
      case "PILOT_TENANTS":
        if (
          context.isInternalTenant ||
          context.tenantId.includes("internal") ||
          context.tenantId.includes("research")
        ) {
          return true;
        }
        return policy.allowedTenants.includes(context.tenantId);
      case "PERCENT_ROLLOUT": {
        if (
          context.isInternalTenant ||
          context.tenantId.includes("internal") ||
          context.tenantId.includes("research")
        ) {
          return true;
        }
        if (policy.allowedTenants.includes(context.tenantId)) {
          return true;
        }
        // Deterministic Murmur-like hash of tenantId + flag
        const target = `${context.tenantId}:${flag}`;
        let hash = 0;
        for (let i = 0; i < target.length; i++) {
          hash = (hash << 5) - hash + target.charCodeAt(i);
          hash |= 0;
        }
        const bucket = Math.abs(hash) % 100;
        return bucket < (policy.rolloutPercentage ?? 0);
      }
      default:
        return false;
    }
  }
}
