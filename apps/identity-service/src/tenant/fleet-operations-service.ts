import type {
  InstitutionTemplate,
  BulkOperationPreview,
  TenantConfigDriftReport,
} from "../../../../packages/contracts/src/index.js";

export class FleetOperationsService {
  private readonly templates = new Map<string, InstitutionTemplate>();
  private readonly tenantConfigs = new Map<string, Record<string, unknown>>();

  constructor() {
    this.initDefaultTemplates();
  }

  private initDefaultTemplates(): void {
    const higherEdTemplate: InstitutionTemplate = {
      templateId: "tpl-vietnam-higher-ed-v1",
      name: "Vietnam Higher Education Standard",
      description: "Standard configuration for Vietnamese universities and colleges",
      identitySetup: {
        protocol: "OIDC",
        discoveryUrlPattern: "https://sso.{domain}/.well-known/openid-configuration",
        allowedDomainRules: ["*.edu.vn"],
      },
      featurePolicy: {
        ADAPTIVE_LEARNING_V2: true,
        STUDY_PLAN_V2: true,
        AI_TUTOR_V2: true,
        TEACHER_COPILOT: true,
        LEARNING_INTERVENTIONS: true,
        INSTITUTION_ADMIN_V2: true,
        LEARNING_INTELLIGENCE_V2: true,
      },
      aiPolicy: {
        allowedPedagogicalModes: ["EXPLAIN", "SOCRATIC", "HINT_ONLY", "PRACTICE", "REVISION", "EXAM_PREP"],
        requireTeacherReviewForAiContent: true,
        studentDirectChatEnabled: true,
      },
      defaultLearningConfig: {
        gradingScale: "VIETNAM_10_POINT_SCALE",
        masteryPolicyId: "ailss-canonical-mastery-v2",
        passingScore: 5.0,
      },
      notificationConfig: {
        digestFrequency: "DAILY",
        smsEnabled: false,
      },
      createdAt: "2026-09-21T23:30:00Z",
    };

    this.templates.set(higherEdTemplate.templateId, higherEdTemplate);
  }

  public getTemplate(templateId: string): InstitutionTemplate | undefined {
    return this.templates.get(templateId);
  }

  public saveTemplate(template: InstitutionTemplate): void {
    // Assert no raw secrets exist in template
    const rawString = JSON.stringify(template).toLowerCase();
    if (
      rawString.includes("client_secret") ||
      rawString.includes("private_key") ||
      rawString.includes("password")
    ) {
      throw new Error("Security Violation: Templates must never contain secret material!");
    }
    this.templates.set(template.templateId, template);
  }

  public registerTenantConfig(tenantId: string, config: Record<string, unknown>): void {
    this.tenantConfigs.set(tenantId, { ...config });
  }

  public previewBulkOperation(input: {
    targetTenantIds: string[];
    operationType: "CONFIG_VALIDATION" | "FEATURE_ENABLEMENT" | "POLICY_UPDATE";
    payload: Record<string, unknown>;
  }): BulkOperationPreview {
    const issues: { tenantId: string; issue: string }[] = [];

    for (const id of input.targetTenantIds) {
      const existing = this.tenantConfigs.get(id);
      if (!existing) {
        issues.push({ tenantId: id, issue: "Tenant does not exist in registry" });
      }
    }

    return {
      targetTenantCount: input.targetTenantIds.length,
      targetTenantIds: input.targetTenantIds,
      operationType: input.operationType,
      changesSummary: input.payload,
      dryRunPassed: issues.length === 0,
      validationIssues: issues,
    };
  }

  public executeBulkOperation(preview: BulkOperationPreview): {
    successfulCount: number;
    failedCount: number;
  } {
    if (!preview.dryRunPassed) {
      throw new Error("Cannot execute bulk operation: Dry-run preview contained validation errors!");
    }

    let successfulCount = 0;
    for (const tenantId of preview.targetTenantIds) {
      const cfg = this.tenantConfigs.get(tenantId) ?? {};
      this.tenantConfigs.set(tenantId, { ...cfg, ...preview.changesSummary });
      successfulCount++;
    }

    return { successfulCount, failedCount: 0 };
  }

  public detectConfigDrift(
    tenantId: string,
    desiredConfig: Record<string, unknown>,
  ): TenantConfigDriftReport {
    const actual = this.tenantConfigs.get(tenantId);
    if (!actual) {
      return {
        tenantId,
        tenantName: tenantId,
        status: "ERROR",
        driftedFields: [{ field: "TENANT_RECORD", expected: "PRESENT", actual: "MISSING" }],
        inspectedAt: new Date().toISOString(),
      };
    }

    const driftedFields: { field: string; expected: unknown; actual: unknown }[] = [];
    for (const [key, desiredVal] of Object.entries(desiredConfig)) {
      const actualVal = actual[key];
      if (JSON.stringify(actualVal) !== JSON.stringify(desiredVal)) {
        driftedFields.push({ field: key, expected: desiredVal, actual: actualVal });
      }
    }

    return {
      tenantId,
      tenantName: (actual["name"] as string) ?? tenantId,
      status: driftedFields.length === 0 ? "IN_SYNC" : "DRIFTED",
      driftedFields,
      inspectedAt: new Date().toISOString(),
    };
  }
}
