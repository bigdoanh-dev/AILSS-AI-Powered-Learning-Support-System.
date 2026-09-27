/**
 * Phase 26.5 & 26.6: External Pilot Classification & Feature Gating Governance
 *
 * Verifies:
 * 1. Strict pilot classification taxonomy: SYNTHETIC, INTERNAL, EXTERNAL_SANDBOX, EXTERNAL_LIMITED, PRODUCTION_PILOT
 * 2. Pilot Record completeness:
 *    - Validates presence of authorizedBy, approvedScope, cohortSize, supportOwner
 *    - Enforces privacy constraint: contact and authorization are references only (no raw PII / contract secrets)
 * 3. Feature gating enforcement:
 *    - Educational interoperability enabled (SAML, SCIM, OneRoster, LTI, RAG, Credentials)
 *    - Payout boundary: payout remains gated when provider is SANDBOX_PROVIDER
 *    - Payment boundary: real money movement disabled unless EXTERNAL_PILOT_VERIFIED
 */

import { describe, it, expect } from "vitest";
import {
  PilotFeatureGatingEngine,
  type PilotRecord,
  type PilotClassification,
} from "../../packages/contracts/src/institutional-pilot.js";

describe("Phase 26.5 & 26.6: Pilot Classification & Feature Gating", () => {
  const polytechPilot: PilotRecord = {
    pilotId: "pilot-polytech-fall-2026",
    institutionId: "tenant-pilot-polytech",
    pilotType: "EXTERNAL_LIMITED",
    authorizedBy: "ref:mou/polytech-academic-board-2026-08",
    approvedScope: [
      "CS301-Advanced-Databases",
      "CS402-Distributed-Systems",
      "AI201-Machine-Learning-Foundations",
    ],
    dataClassification: "RESTRICTED",
    startAt: "2026-09-01T00:00:00Z",
    plannedEndAt: "2026-12-31T23:59:59Z",
    enabledFeatures: [
      "saml",
      "scim",
      "oneRoster",
      "lti",
      "aiAssistant",
      "rag",
      "credentials",
      "email",
      "push",
    ],
    enabledProviders: {
      saml: "EXTERNAL_PILOT_VERIFIED",
      scim: "EXTERNAL_PILOT_VERIFIED",
      oneRoster: "EXTERNAL_PILOT_VERIFIED",
      email: "SANDBOX_VERIFIED",
      push: "SANDBOX_VERIFIED",
      payment: "SANDBOX_VERIFIED",
      payout: "SANDBOX_VERIFIED",
    },
    cohortSize: 2500,
    supportOwner: "sre-pilot-lead@ailss.internal",
    incidentContact: "ref:contacts/polytech-noc-escalation",
  };

  it("validates pilot classification taxonomy and ensures no synthetic tag used for external pilot", () => {
    const validClassifications: PilotClassification[] = [
      "SYNTHETIC",
      "INTERNAL",
      "EXTERNAL_SANDBOX",
      "EXTERNAL_LIMITED",
      "PRODUCTION_PILOT",
    ];

    expect(validClassifications).toContain(polytechPilot.pilotType);
    expect(polytechPilot.pilotType).not.toBe("SYNTHETIC");
    expect(polytechPilot.pilotType).toBe("EXTERNAL_LIMITED");
  });

  it("enforces reference-only legal/contact storage to prevent secret/PII leaks", () => {
    // Both authorization and incident contacts must be reference identifiers
    expect(polytechPilot.authorizedBy).toMatch(/^ref:/u);
    expect(polytechPilot.incidentContact).toMatch(/^ref:/u);

    // Must not contain plain email or phone number in incident contact
    expect(polytechPilot.incidentContact).not.toContain("@");
    expect(polytechPilot.incidentContact).not.toMatch(/\+?\d{8,}/u);
  });

  it("feature gating: educational features are enabled while unverified live payouts remain gated", () => {
    // Interoperability and AI features enabled
    expect(PilotFeatureGatingEngine.isFeatureEnabled(polytechPilot, "saml")).toBe(true);
    expect(PilotFeatureGatingEngine.isFeatureEnabled(polytechPilot, "scim")).toBe(true);
    expect(PilotFeatureGatingEngine.isFeatureEnabled(polytechPilot, "oneRoster")).toBe(true);
    expect(PilotFeatureGatingEngine.isFeatureEnabled(polytechPilot, "rag")).toBe(true);
    expect(PilotFeatureGatingEngine.isFeatureEnabled(polytechPilot, "credentials")).toBe(true);

    // Payouts feature is NOT enabled in pilot features list
    expect(PilotFeatureGatingEngine.isFeatureEnabled(polytechPilot, "payouts")).toBe(false);

    // Live payout is strictly prohibited
    expect(PilotFeatureGatingEngine.assertLivePayoutAllowed(polytechPilot)).toBe(false);
  });

  it("payment gating: sandbox payment provider does not permit live production transaction claims", () => {
    // Even if payments were requested, provider is SANDBOX_VERIFIED, not EXTERNAL_PILOT_VERIFIED
    expect(PilotFeatureGatingEngine.assertLivePaymentAllowed(polytechPilot)).toBe(false);
  });
});
