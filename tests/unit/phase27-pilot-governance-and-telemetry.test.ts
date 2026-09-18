import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  POLYTECH_PILOT_SCOPE_LOCK,
  MOBILE_PILOT_SCOPE,
  POLYTECH_PILOT_CONFIG,
  PilotAuthorizationValidator,
  type PilotAuthorizationRecord,
} from "../../packages/contracts/src/institutional-pilot.js";
import {
  DataRetentionPolicyEngine,
  PLATFORM_RETENTION_CONSTRAINTS,
} from "../../packages/contracts/src/data-retention-policy.js";
import {
  DISAGGREGATED_STANDARDS_MATRIX,
  DISAGGREGATED_PROVIDER_MATRIX,
} from "../../packages/contracts/src/interoperability.js";

describe("Phase 27 Pilot Governance, Authorization & Telemetry Verification", () => {
  const repoRoot = resolve(__dirname, "../..");
  const authPath = resolve(repoRoot, "contracts/authorizations/pilot-polytech-authorization.json");
  const telemetryPath = resolve(repoRoot, "contracts/telemetry/pilot-telemetry-aggregate.json");

  describe("Phase 27.4 & 27.5: Machine-Readable Authorization Artifact", () => {
    it("should load and structurally validate pilot-polytech-authorization.json", () => {
      expect(existsSync(authPath)).toBe(true);
      const content = JSON.parse(readFileSync(authPath, "utf-8")) as PilotAuthorizationRecord;

      expect(content.authorizationReference).toBe("MOU-2026-POLYTECH-AILSS-001");
      expect(content.authorizationStatus).toBe("EXTERNAL_PILOT_ACTIVE");
      expect(content.institutionReference).toBe("tenant-pilot-polytech");
      expect(content.deliveryChannel).toBe("RESPONSIVE_WEB");
      expect(content.approvedUserCohort.totalAuthorized).toBe(280);

      const validation = PilotAuthorizationValidator.validate(content);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should reject pilot authorization if scope lock constraints are violated", () => {
      const content = JSON.parse(readFileSync(authPath, "utf-8")) as PilotAuthorizationRecord;

      const invalidRecord: PilotAuthorizationRecord = {
        ...content,
        scopeConstraints: {
          ...content.scopeConstraints,
          mobilePilotScope: "IN_SCOPE" as any,
          paymentsScope: "LIVE_PRODUCTION" as any,
        },
      };

      const result = PilotAuthorizationValidator.validate(invalidRecord);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Mobile pilot scope must be explicitly 'NOT_IN_SCOPE'"))).toBe(true);
      expect(result.errors.some((e) => e.includes("Payments scope must be 'SANDBOX_ONLY'"))).toBe(true);
    });
  });

  describe("Phase 27.5: Pilot Scope Lock Enforcement", () => {
    it("should enforce MOBILE_PILOT_SCOPE as NOT_IN_SCOPE across all contracts", () => {
      expect(MOBILE_PILOT_SCOPE).toBe("NOT_IN_SCOPE");
      expect(POLYTECH_PILOT_SCOPE_LOCK.mobile).toBe("NOT_IN_SCOPE");
      expect(POLYTECH_PILOT_SCOPE_LOCK.payments).toBe("SANDBOX_ONLY");
      expect(POLYTECH_PILOT_SCOPE_LOCK.payouts).toBe("GATED");
      expect(POLYTECH_PILOT_SCOPE_LOCK.webApplication).toBe("IN_SCOPE_ACTIVE");
      expect(POLYTECH_PILOT_CONFIG.mobilePilotScope).toBe("NOT_IN_SCOPE");
      expect(POLYTECH_PILOT_CONFIG.authorizationReference).toBe("MOU-2026-POLYTECH-AILSS-001");
    });
  });

  describe("Phase 27.6: Real Pilot Telemetry Artifact Validation", () => {
    it("should load and validate pilot-telemetry-aggregate.json separating virtual load from real usage", () => {
      expect(existsSync(telemetryPath)).toBe(true);
      const telemetry = JSON.parse(readFileSync(telemetryPath, "utf-8"));

      expect(telemetry.authorizationReference).toBe("MOU-2026-POLYTECH-AILSS-001");
      expect(telemetry.participantMetrics.activeUniqueUsers).toBe(248);
      expect(telemetry.participantMetrics.authorizedCohort).toBe(280);
      expect(telemetry.sessionMetrics.totalSuccessfulLogins).toBe(1842);
      expect(telemetry.sessionMetrics.totalLearningSessions).toBe(1420);
      expect(telemetry.sessionMetrics.aiAssistantInteractions.totalAiSessions).toBe(940);
      expect(telemetry.commercialAndSafetyGates.nativeMobileAppTrafficDetected).toBe(0);
      expect(telemetry.commercialAndSafetyGates.realMoneyTransactionsAttempted).toBe(0);
      expect(telemetry.commercialAndSafetyGates.piiExposureIncidents).toBe(0);
      expect(telemetry.telemetryIntegrity.status).toBe("PILOT_TELEMETRY_VALIDATED");
    });
  });

  describe("Phase 27.20: Configurable Per-Institution Data Retention Policy", () => {
    it("should allow safe custom overrides within platform limits", () => {
      const schedule = DataRetentionPolicyEngine.createInstitutionSchedule("tenant-pilot-polytech", {
        AI: 60,            // default 90, min 30, max 365 -> valid
        IDENTITY: 3650,    // default 1825, min 365, max 3650 -> valid
      });

      expect(schedule.schedules.AI).toBe(60);
      expect(schedule.schedules.IDENTITY).toBe(3650);
      expect(schedule.schedules.ACADEMIC).toBe(PLATFORM_RETENTION_CONSTRAINTS.ACADEMIC.defaultDays);
    });

    it("should enforce platform-safe minimums and reject dangerous deletions", () => {
      expect(() => {
        DataRetentionPolicyEngine.createInstitutionSchedule("tenant-unsafe", {
          ACADEMIC: 30, // Academic min is 1825 days (5 years) -> reject
        });
      }).toThrow(/RETENTION_POLICY_VIOLATION.*ACADEMIC.*BELOW_SAFE_MINIMUM/);

      expect(() => {
        DataRetentionPolicyEngine.createInstitutionSchedule("tenant-unsafe", {
          AI: 10, // AI min is 30 days -> reject
        });
      }).toThrow(/RETENTION_POLICY_VIOLATION.*AI.*BELOW_SAFE_MINIMUM/);
    });

    it("should honor Legal Hold overriding normal expiration purge", () => {
      const scheduleWithHold = DataRetentionPolicyEngine.createInstitutionSchedule(
        "tenant-pilot-polytech",
        { AI: 30 },
        true,
        "Formal Higher Ed Academic Audit Hold",
      );

      const oldAiRecordDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000); // 120 days old
      const checkResult = DataRetentionPolicyEngine.isPurgeEligible(scheduleWithHold, "AI", oldAiRecordDate);

      expect(checkResult.eligible).toBe(false);
      expect(checkResult.reason).toContain("LEGAL_HOLD_ACTIVE");

      // Without hold, should be eligible
      const normalSchedule = DataRetentionPolicyEngine.createInstitutionSchedule(
        "tenant-pilot-polytech",
        { AI: 30 },
        false,
      );
      const normalResult = DataRetentionPolicyEngine.isPurgeEligible(normalSchedule, "AI", oldAiRecordDate);
      expect(normalResult.eligible).toBe(true);
      expect(normalResult.reason).toContain("RETENTION_EXPIRED");
    });
  });

  describe("Phase 27.11 & 27.12: Disaggregated Standards & Provider Matrices", () => {
    it("should include all disaggregated columns and truth-in-advertising certification status", () => {
      expect(DISAGGREGATED_STANDARDS_MATRIX.length).toBeGreaterThanOrEqual(13);

      for (const entry of DISAGGREGATED_STANDARDS_MATRIX) {
        expect(typeof entry.standard).toBe("string");
        expect(typeof entry.implemented).toBe("boolean");
        expect(typeof entry.internalTested).toBe("boolean");
        expect(typeof entry.externalSandboxValidated).toBe("boolean");
        expect(typeof entry.institutionPilotValidated).toBe("boolean");
        // No false claims of formal third-party certification
        expect(entry.certified).toBe(false);
      }

      for (const provider of DISAGGREGATED_PROVIDER_MATRIX) {
        expect(typeof provider.providerKey).toBe("string");
        expect(typeof provider.operationalStatus).toBe("string");
        expect(provider.certified).toBe(false);
      }

      // Verify push is explicitly not institution pilot validated because mobile is out of scope
      const pushEntry = DISAGGREGATED_PROVIDER_MATRIX.find((p) => p.serviceCategory === "PUSH");
      expect(pushEntry).toBeDefined();
      expect(pushEntry?.institutionPilotValidated).toBe(false);
      expect(pushEntry?.operationalStatus).toBe("SANDBOX_VERIFIED");

      // Verify payout is strictly GATED
      const payoutEntry = DISAGGREGATED_PROVIDER_MATRIX.find((p) => p.serviceCategory === "PAYOUT");
      expect(payoutEntry).toBeDefined();
      expect(payoutEntry?.operationalStatus).toBe("GATED");
    });
  });
});
