import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertIntegrationScope,
  integrationRegistrationSchema,
  type IntegrationRegistration,
} from "../../packages/contracts/src/index.js";

describe("Phase 21E: Integration Registry Contracts & Governance", () => {
  it("validates and approves valid integration registration", () => {
    const raw = {
      id: randomUUID(),
      organizationId: "org-hcmut",
      integrationType: "LTI_1_3",
      name: "Canvas LMS Production Link",
      description: "LTI 1.3 Advantage link for automated roster and grade passback",
      status: "ACTIVE",
      scopes: ["roster:read", "grades:write"],
      endpointUrl: "https://canvas.hcmut.edu.vn/api/lti",
      clientId: "canvas-hcmut-prod-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const parsed = integrationRegistrationSchema.parse(raw);
    expect(parsed.integrationType).toBe("LTI_1_3");
    expect(parsed.status).toBe("ACTIVE");
    expect(parsed.scopes).toContain("grades:write");

    // Authorize valid scope
    expect(() => assertIntegrationScope(parsed, "grades:write")).not.toThrow();
  });

  it("rejects unauthorized scope access", () => {
    const integration: IntegrationRegistration = {
      id: randomUUID(),
      organizationId: "org-stanford",
      integrationType: "WEBHOOK",
      name: "Student Events Webhook",
      status: "ACTIVE",
      scopes: ["roster:read"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => assertIntegrationScope(integration, "grades:write")).toThrow(
      /lacks required scope "grades:write"/u,
    );
  });

  it("rejects inactive or pending integrations regardless of scopes", () => {
    const integration: IntegrationRegistration = {
      id: randomUUID(),
      organizationId: "org-mit",
      integrationType: "ONEROSTER_SIS",
      name: "OneRoster SIS Sync",
      status: "PENDING_VERIFICATION",
      scopes: ["roster:read", "grades:write"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(() => assertIntegrationScope(integration, "roster:read")).toThrow(
      /is not active/u,
    );
  });
});
