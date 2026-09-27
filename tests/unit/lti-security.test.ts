import { describe, expect, it } from "vitest";
import {
  validateLtiLaunch,
  type LtiDeploymentConfig,
  type LtiLaunchClaims,
} from "../../packages/contracts/src/interoperability.js";

describe("Phase 21.6: LTI 1.3 Security & Role Escalation Protection", () => {
  const trustedDeployments: LtiDeploymentConfig[] = [
    {
      organizationId: "org-hcmut",
      deploymentId: "dep-100",
      clientId: "canvas-lms-client-1",
      issuer: "https://canvas.instructure.com",
      status: "ACTIVE",
    },
    {
      organizationId: "org-uit",
      deploymentId: "dep-200",
      clientId: "moodle-lms-client-2",
      issuer: "https://moodle.uit.edu.vn",
      status: "SUSPENDED",
    },
  ];

  const validBaseClaims: LtiLaunchClaims = {
    iss: "https://canvas.instructure.com",
    sub: "canvas-user-456",
    aud: "canvas-lms-client-1",
    exp: 2000000000,
    iat: 1700000000,
    nonce: "nonce-xyz-123",
    "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "dep-100",
    "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://ailss.edu.vn/lti/launch",
    "https://purl.imsglobal.org/spec/lti/claim/roles": [
      "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
    ],
  };

  it("validates successful launch with learner role", () => {
    const consumedNonces = new Set<string>();
    const result = validateLtiLaunch({
      claims: validBaseClaims,
      trustedDeployments,
      expectedState: "state-token-abc",
      actualState: "state-token-abc",
      consumedNonces,
      currentTimeSeconds: 1750000000,
    });

    expect(result.valid).toBe(true);
    expect(result.role).toBe("STUDENT");
    expect(result.organizationId).toBe("org-hcmut");
    expect(consumedNonces.has("nonce-xyz-123")).toBe(true);
  });

  it("denies unknown issuer", () => {
    const claims: LtiLaunchClaims = {
      ...validBaseClaims,
      iss: "https://malicious-rogue-lms.com",
    };

    const result = validateLtiLaunch({
      claims,
      trustedDeployments,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("UNKNOWN_ISSUER");
    expect(result.error).toContain("Unrecognized LTI issuer");
  });

  it("denies unknown deployment ID or mismatched client ID", () => {
    const claims: LtiLaunchClaims = {
      ...validBaseClaims,
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "dep-unregistered-999",
    };

    const result = validateLtiLaunch({
      claims,
      trustedDeployments,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("UNKNOWN_CLIENT_OR_DEPLOYMENT");
  });

  it("denies suspended LTI deployments", () => {
    const claims: LtiLaunchClaims = {
      ...validBaseClaims,
      iss: "https://moodle.uit.edu.vn",
      aud: "moodle-lms-client-2",
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id": "dep-200",
    };

    const result = validateLtiLaunch({
      claims,
      trustedDeployments,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("DEPLOYMENT_INACTIVE");
  });

  it("denies replay attacks using consumed nonces", () => {
    const consumedNonces = new Set<string>(["nonce-already-used"]);
    const claims: LtiLaunchClaims = {
      ...validBaseClaims,
      nonce: "nonce-already-used",
    };

    const result = validateLtiLaunch({
      claims,
      trustedDeployments,
      consumedNonces,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("REPLAYED_NONCE");
    expect(result.error).toContain("already been consumed");
  });

  it("denies state mismatch", () => {
    const result = validateLtiLaunch({
      claims: validBaseClaims,
      trustedDeployments,
      expectedState: "legit-state-123",
      actualState: "forged-state-456",
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("INVALID_STATE");
  });

  it("denies expired LTI launch tokens", () => {
    const result = validateLtiLaunch({
      claims: {
        ...validBaseClaims,
        exp: 1700000000,
      },
      trustedDeployments,
      currentTimeSeconds: 1700000010,
    });

    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("TOKEN_EXPIRED");
  });

  it("protects against role escalation: LMS Administrator NEVER escalates to PLATFORM_ADMIN", () => {
    const adminClaims: LtiLaunchClaims = {
      ...validBaseClaims,
      "https://purl.imsglobal.org/spec/lti/claim/roles": [
        "http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator",
      ],
    };

    const result = validateLtiLaunch({
      claims: adminClaims,
      trustedDeployments,
    });

    expect(result.valid).toBe(true);
    // Crucial security requirement: maps strictly to INSTITUTION_ADMIN, never global PLATFORM_ADMIN
    expect(result.role).toBe("INSTITUTION_ADMIN");
    expect((result.role as string)).not.toBe("ADMIN");
    expect((result.role as string)).not.toBe("PLATFORM_ADMIN");
  });
});
