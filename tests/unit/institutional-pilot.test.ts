import { describe, expect, it } from "vitest";
import {
  INCIDENT_SLA_TAXONOMY,
  IncidentLifecycleManager,
  POLYTECH_PILOT_CONFIG,
  type IncidentRecord,
} from "../../packages/contracts/src/institutional-pilot.js";

describe("Phase 23T-23W: Institutional Pilot & Incident Severity SLA Governance", () => {
  it("verifies Polytechnic pilot configuration and quota limits", () => {
    expect(POLYTECH_PILOT_CONFIG.tenantId).toBe("tenant-pilot-polytech");
    expect(POLYTECH_PILOT_CONFIG.rootDomain).toBe("polytech.edu.vn");
    expect(POLYTECH_PILOT_CONFIG.quota.maxActiveStudents).toBe(2500);
    expect(POLYTECH_PILOT_CONFIG.quota.maxMonthlyAiTokens).toBe(50_000_000);
    expect(POLYTECH_PILOT_CONFIG.enabledFeatures).toContain("LTI_1_3");
    expect(POLYTECH_PILOT_CONFIG.enabledFeatures).toContain("ONEROSTER_SIS");
    expect(POLYTECH_PILOT_CONFIG.pilotStatus).toBe("ACTIVE");
  });

  it("verifies Incident SLA taxonomy definitions (SEV0 - SEV3)", () => {
    expect(INCIDENT_SLA_TAXONOMY.SEV0.mttdMinutes).toBe(5);
    expect(INCIDENT_SLA_TAXONOMY.SEV0.mttrMinutes).toBe(30);
    expect(INCIDENT_SLA_TAXONOMY.SEV0.pagerDutyPaging).toBe(true);

    expect(INCIDENT_SLA_TAXONOMY.SEV1.mttdMinutes).toBe(15);
    expect(INCIDENT_SLA_TAXONOMY.SEV1.mttrMinutes).toBe(120);

    expect(INCIDENT_SLA_TAXONOMY.SEV2.mttdMinutes).toBe(60);
    expect(INCIDENT_SLA_TAXONOMY.SEV2.mttrMinutes).toBe(480);

    expect(INCIDENT_SLA_TAXONOMY.SEV3.mttdMinutes).toBe(1440);
    expect(INCIDENT_SLA_TAXONOMY.SEV3.mttrMinutes).toBe(4320);
  });

  it("IncidentLifecycleManager computes SLA compliance correctly for SEV0", () => {
    const detectedAt = new Date("2026-09-01T10:00:00Z");

    // Compliant incident: Ack in 3 mins (<=5), Resolved in 20 mins (<=30)
    const compliantIncident: IncidentRecord = {
      incidentId: "inc-sev0-01",
      severity: "SEV0",
      title: "API Gateway Down",
      description: "Gateway unresponsive due to network partition",
      affectedServices: ["api-gateway"],
      detectedAt,
      acknowledgedAt: new Date("2026-09-01T10:03:00Z"),
      resolvedAt: new Date("2026-09-01T10:20:00Z"),
      rootCause: "BGP route re-convergence resolved",
    };

    const compResult = IncidentLifecycleManager.calculateSlaCompliance(compliantIncident);
    expect(compResult.mttdCompliant).toBe(true);
    expect(compResult.mttrCompliant).toBe(true);
    expect(compResult.actualMttdMinutes).toBe(3);
    expect(compResult.actualMttrMinutes).toBe(20);

    // Breached incident: Ack in 10 mins (>5), Resolved in 45 mins (>30)
    const breachedIncident: IncidentRecord = {
      incidentId: "inc-sev0-02",
      severity: "SEV0",
      title: "Cassandra Quorum Lost",
      description: "Storage layer unavailable",
      affectedServices: ["cassandra"],
      detectedAt,
      acknowledgedAt: new Date("2026-09-01T10:10:00Z"),
      resolvedAt: new Date("2026-09-01T10:45:00Z"),
    };

    const breachResult = IncidentLifecycleManager.calculateSlaCompliance(breachedIncident);
    expect(breachResult.mttdCompliant).toBe(false);
    expect(breachResult.mttrCompliant).toBe(false);
    expect(breachResult.actualMttdMinutes).toBe(10);
    expect(breachResult.actualMttrMinutes).toBe(45);
  });
});
