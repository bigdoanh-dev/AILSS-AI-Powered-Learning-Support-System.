import { describe, expect, it } from "vitest";
import { FinOpsTracker } from "../../packages/observability/src/finops.js";
import {
  assertOnboardingTransition,
  type TenantOnboardingRecord,
} from "../../packages/contracts/src/onboarding.js";

describe("Phase 22.21 & 22.22: FinOps Token Guardrails & Tenant Onboarding Automation", () => {
  describe("Phase 22.21: FinOps Token Observability & Cost Guardrails", () => {
    it("tracks AI usage events and enforces institutional quota limits", () => {
      const tracker = new FinOpsTracker();
      const tenantId = "org-finops-univ";

      // Set tenant budget: 100,000 tokens / month
      tracker.setTenantQuota({
        tenantId,
        monthlyTokenLimit: 100000,
        monthlyStorageBytesLimit: 10 * 1024 * 1024 * 1024,
        maxRps: 50,
      });

      // Initial check: full quota available
      const check1 = tracker.checkQuota(tenantId, 1000);
      expect(check1.allowed).toBe(true);
      expect(check1.remainingTokens).toBe(99000);

      // Record first batch of AI generation (40,000 input, 20,000 output = 60,000 total)
      tracker.recordUsage({
        tenantId,
        service: "AI_SERVICE",
        operation: "CHAT_COMPLETION",
        model: "gpt-5-mini",
        inputUnits: 40000,
        outputUnits: 20000,
        latencyMs: 1250,
        timestamp: new Date().toISOString(),
      });

      const check2 = tracker.checkQuota(tenantId, 30000);
      expect(check2.allowed).toBe(true);
      expect(check2.currentUsageTokens).toBe(60000);
      expect(check2.remainingTokens).toBe(10000); // 100,000 - 60,000 - 30,000

      // Record second batch (35,000 total) -> Cumulative: 95,000 tokens
      tracker.recordUsage({
        tenantId,
        service: "AI_SERVICE",
        operation: "RAG_RETRIEVAL",
        inputUnits: 25000,
        outputUnits: 10000,
        latencyMs: 800,
        timestamp: new Date().toISOString(),
      });

      // Request exceeding remaining 5,000 quota
      const checkOverLimit = tracker.checkQuota(tenantId, 10000);
      expect(checkOverLimit.allowed).toBe(false);
      expect(checkOverLimit.reason).toBe("QUOTA_EXCEEDED");
      expect(checkOverLimit.currentUsageTokens).toBe(95000);
      expect(checkOverLimit.remainingTokens).toBe(5000);
    });
  });

  describe("Phase 22.22: Tenant Onboarding Lifecycle Transitions", () => {
    function createInitialTenant(): TenantOnboardingRecord {
      return {
        tenantId: "org-onboarding-test",
        institutionName: "Vietnam National University Testbed",
        rootDomain: "vnu-test.edu.vn",
        stage: "CREATED",
        primaryAdminEmail: "admin@vnu-test.edu.vn",
        ssoConfigured: false,
        ltiConfigured: false,
        brandingConfigured: false,
        pilotUserCount: 0,
        healthCheckPassed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    it("enforces sequential stage progression and blocks skipped stages", () => {
      const tenant = createInitialTenant();

      // Skipping directly from CREATED to ACTIVE is blocked
      expect(() => {
        assertOnboardingTransition(tenant, "ACTIVE");
      }).toThrowError(/INVALID_STAGE_TRANSITION/);

      // Step 1: Transition to IDENTITY_CONFIGURED
      expect(() => {
        assertOnboardingTransition(tenant, "IDENTITY_CONFIGURED");
      }).not.toThrow();
      tenant.stage = "IDENTITY_CONFIGURED";

      // Step 2: Transition to INTEGRATIONS_CONFIGURED
      expect(() => {
        assertOnboardingTransition(tenant, "INTEGRATIONS_CONFIGURED");
      }).not.toThrow();
      tenant.stage = "INTEGRATIONS_CONFIGURED";
    });

    it("verifies preconditions before entering PILOT and ACTIVE stages", () => {
      const tenant = createInitialTenant();
      tenant.stage = "ADMIN_VERIFIED";

      // Attempt PILOT without SSO or pilot users: blocked
      expect(() => {
        assertOnboardingTransition(tenant, "PILOT");
      }).toThrowError(/PRECONDITION_FAILED: SSO must be configured/);

      // Satisfy SSO precondition, but missing pilot users: blocked
      tenant.ssoConfigured = true;
      expect(() => {
        assertOnboardingTransition(tenant, "PILOT");
      }).toThrowError(/PRECONDITION_FAILED: At least one pilot user required/);

      // Satisfy both: transition to PILOT permitted
      tenant.pilotUserCount = 25;
      expect(() => {
        assertOnboardingTransition(tenant, "PILOT");
      }).not.toThrow();
      tenant.stage = "PILOT";

      // Attempt ACTIVE without passing health check: blocked
      expect(() => {
        assertOnboardingTransition(tenant, "ACTIVE");
      }).toThrowError(/PRECONDITION_FAILED: Institutional health check must pass/);

      // Pass health check: ACTIVE permitted
      tenant.healthCheckPassed = true;
      expect(() => {
        assertOnboardingTransition(tenant, "ACTIVE");
      }).not.toThrow();
    });
  });
});
