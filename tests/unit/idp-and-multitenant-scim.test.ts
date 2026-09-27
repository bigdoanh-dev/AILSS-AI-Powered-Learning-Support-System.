/**
 * Phase 26.4 & Phase 26.7: External IdP Federation (OIDC vs SAML) & Multi-Tenant SCIM Cross-Enrollment
 *
 * Validates:
 * 1. External IdP Contract Flows:
 *    - OIDC ID Token flow with cryptographic verification (RS256, JWKS, nonce, state, audience, issuer)
 *    - SAML 2.0 SP-initiated assertion flow with XML-DSig signature & distributed anti-replay
 *    - Normalized identity resolution to authoritative institutional membership
 * 2. Multi-Tenant SCIM Cross-Enrollment:
 *    - Single user identity enrolled across two distinct institutional tenants:
 *      Institution A (Polytechnic): STUDENT
 *      Institution B (HCMUT): LECTURER
 *    - Complete tenant isolation: no cross-tenant overwrite, no group pollution
 *    - Independent lifecycle: deactivation/revocation in Institution A leaves Institution B active
 *    - Anti-privilege escalation: role upgrade in Institution B does not leak to Institution A
 */

import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { SignJWT, generateKeyPair as generateJoseKeyPair } from "jose";
import { verifyOidcIdToken } from "../../packages/security/src/oidc.js";
import {
  buildSamlAuthnRequest,
  validateSamlResponse,
  signSamlElement,
  DistributedSamlReplayStore,
  SharedReplayStateCluster,
} from "../../packages/security/src/saml.js";
import { TenantAwareScimRepository } from "../../apps/identity-service/src/scim/repository.js";
import { InMemoryTenantRepository } from "../../apps/identity-service/src/tenant/repository.js";
import { SCIM_USER_SCHEMA_URI } from "../../packages/contracts/src/scim.js";

describe("Phase 26.4: External IdP Federation — OIDC vs SAML Contract Flows", () => {
  describe("OIDC External IdP Verification Flow", () => {
    const oidcIssuer = "https://sso.polytech.edu.vn/oauth2/v1";
    const clientId = "ailss-production-client-id";

    it("verifies valid external IdP OIDC ID Token and extracts normalized claims", async () => {
      const oidcKeyPair = await generateJoseKeyPair("RS256");
      const jwksResolver = async () => oidcKeyPair.publicKey;

      const expectedNonce = "nonce-xyz-789";
      const expectedState = "state-csrf-safe-123";

      const idToken = await new SignJWT({
        sub: "poly-user-8849",
        email: "alex.turner@polytech.edu.vn",
        email_verified: true,
        name: "Alex Turner",
        nonce: expectedNonce,
      })
        .setProtectedHeader({ alg: "RS256", kid: "polytech-key-2026" })
        .setIssuer(oidcIssuer)
        .setAudience(clientId)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(oidcKeyPair.privateKey);

      const verified = await verifyOidcIdToken(
        {
          idToken,
          expectedNonce,
          state: expectedState,
          expectedState,
        },
        {
          issuer: oidcIssuer,
          clientId,
          jwks: jwksResolver,
        },
      );

      expect(verified.sub).toBe("poly-user-8849");
      expect(verified.email).toBe("alex.turner@polytech.edu.vn");
      expect(verified.emailVerified).toBe(true);
      expect(verified.name).toBe("Alex Turner");
    });

    it("rejects OIDC token when audience or state does not match", async () => {
      const oidcKeyPair = await generateJoseKeyPair("RS256");
      const jwksResolver = async () => oidcKeyPair.publicKey;

      const idToken = await new SignJWT({
        sub: "poly-user-8849",
        email: "alex.turner@polytech.edu.vn",
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(oidcIssuer)
        .setAudience("malicious-foreign-client")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(oidcKeyPair.privateKey);

      await expect(
        verifyOidcIdToken(
          { idToken, state: "bad-state", expectedState: "good-state" },
          { issuer: oidcIssuer, clientId, jwks: jwksResolver },
        ),
      ).rejects.toThrowError(/CSRF/u);
    });
  });

  describe("SAML 2.0 External IdP Verification Flow", () => {
    // Generate RSA keypair for XML-DSig
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const spConfig = {
      entityId: "https://ailss.edu.vn/saml/metadata",
      assertionConsumerServiceUrl: "https://ailss.edu.vn/api/v1/auth/saml/acs",
    };
    const idpConfig = {
      entityId: "https://idp.polytech.edu.vn/saml/metadata",
      singleSignOnServiceUrl: "https://idp.polytech.edu.vn/saml/sso",
      certificate: publicKey,
    };

    it("verifies signed SAML assertion and stores replay record in distributed cluster", async () => {
      const replayCluster = new SharedReplayStateCluster();
      const replayStore = new DistributedSamlReplayStore(replayCluster, { tenantId: "tenant-pilot-polytech" });

      const authnRequest = buildSamlAuthnRequest({
        spConfig,
        idpConfig,
      });

      const assertionId = "AS-PHASE26-ASSERTION-999";
      const assertionXml = [
        `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" IssueInstant="2026-09-18T00:00:00Z">`,
        `<saml:Issuer>${idpConfig.entityId}</saml:Issuer>`,
        '<saml:Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2035-01-01T00:00:00Z">',
        `<saml:AudienceRestriction><saml:Audience>${spConfig.entityId}</saml:Audience></saml:AudienceRestriction>`,
        "</saml:Conditions>",
        "<saml:Subject>",
        "<saml:NameID>alex.turner@polytech.edu.vn</saml:NameID>",
        `<saml:SubjectConfirmationData InResponseTo="${authnRequest.id}" />`,
        "</saml:Subject>",
        "<saml:AttributeStatement>",
        '<saml:Attribute Name="email"><saml:AttributeValue>alex.turner@polytech.edu.vn</saml:AttributeValue></saml:Attribute>',
        '<saml:Attribute Name="role"><saml:AttributeValue>STUDENT</saml:AttributeValue></saml:Attribute>',
        "</saml:AttributeStatement>",
        "</saml:Assertion>",
      ].join("");

      const signatureXml = signSamlElement(assertionXml, privateKey, {
        referenceUri: `#${assertionId}`,
      });

      const responseXml = [
        `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="RESP-PHASE26-01" Destination="${spConfig.assertionConsumerServiceUrl}">`,
        '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
        assertionXml.replace("</saml:Assertion>", `${signatureXml}</saml:Assertion>`),
        "</samlp:Response>",
      ].join("");

      const samlResponseBase64 = Buffer.from(responseXml).toString("base64");

      const validated = validateSamlResponse(samlResponseBase64, {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
        expectedInResponseTo: authnRequest.id,
        replayCache: replayStore,
        tenantId: "tenant-pilot-polytech",
      });

      expect(validated.nameId).toBe("alex.turner@polytech.edu.vn");
      expect(validated.email).toBe("alex.turner@polytech.edu.vn");
      expect(validated.roles).toContain("STUDENT");

      // Attempting replay of identical assertion fails
      expect(() =>
        validateSamlResponse(samlResponseBase64, {
          expectedDestination: spConfig.assertionConsumerServiceUrl,
          expectedAudience: spConfig.entityId,
          idpConfig,
          expectedInResponseTo: authnRequest.id,
          replayCache: replayStore,
          tenantId: "tenant-pilot-polytech",
        }),
      ).toThrowError(/already been processed/u);
    });
  });
});

describe("Phase 26.7: Multi-Tenant SCIM Cross-Enrollment Isolation", () => {
  let tenantRepo: InMemoryTenantRepository;
  let scimRepoPolytech: TenantAwareScimRepository;
  let scimRepoHcmut: TenantAwareScimRepository;

  beforeEach(() => {
    tenantRepo = new InMemoryTenantRepository();
    // Two independent pilot institutional tenants sharing the authoritative identity keyspace
    scimRepoPolytech = new TenantAwareScimRepository("tenant-pilot-polytech", tenantRepo);
    scimRepoHcmut = new TenantAwareScimRepository("tenant-pilot-hcmut", tenantRepo);
  });

  it("provisions the same user across two institutions with independent roles and group memberships", async () => {
    // Alex Turner is a STUDENT at Polytech
    const polyUser = await scimRepoPolytech.saveUser({
      schemas: [SCIM_USER_SCHEMA_URI],
      id: "usr-alex-turner",
      externalId: "poly-alex-001",
      userName: "alex.turner@polytech.edu.vn",
      emails: [{ value: "alex.turner@polytech.edu.vn", type: "work", primary: true }],
      active: true,
      roles: [{ value: "STUDENT" }],
    });

    // Alex Turner is also an adjunct LECTURER at HCMUT
    const hcmutUser = await scimRepoHcmut.saveUser({
      schemas: [SCIM_USER_SCHEMA_URI],
      id: "usr-alex-turner",
      externalId: "hcmut-alex-002",
      userName: "alex.turner@hcmut.edu.vn",
      emails: [{ value: "alex.turner@hcmut.edu.vn", type: "work", primary: true }],
      active: true,
      roles: [{ value: "LECTURER" }],
    });

    expect(polyUser.id).toBe("usr-alex-turner");
    expect(hcmutUser.id).toBe("usr-alex-turner");

    // Check authoritative tenant memberships: distinct role per institution
    const polyMembership = await tenantRepo.findMembership("usr-alex-turner", "tenant-pilot-polytech");
    const hcmutMembership = await tenantRepo.findMembership("usr-alex-turner", "tenant-pilot-hcmut");

    expect(polyMembership).not.toBeNull();
    expect(polyMembership?.role).toBe("STUDENT");
    expect(polyMembership?.status).toBe("ACTIVE");

    expect(hcmutMembership).not.toBeNull();
    expect(hcmutMembership?.role).toBe("LECTURER");
    expect(hcmutMembership?.status).toBe("ACTIVE");

    // Group memberships are isolated per tenant
    const polyGroups = await scimRepoPolytech.listGroups();
    const polyStudentGroup = polyGroups.find((g) => g.id === "group-students");
    const polyFacultyGroup = polyGroups.find((g) => g.id === "group-faculty");
    expect(polyStudentGroup?.members?.some((m) => m.value === "usr-alex-turner")).toBe(true);
    expect(polyFacultyGroup?.members?.some((m) => m.value === "usr-alex-turner")).toBe(false);

    const hcmutGroups = await scimRepoHcmut.listGroups();
    const hcmutStudentGroup = hcmutGroups.find((g) => g.id === "group-students");
    const hcmutFacultyGroup = hcmutGroups.find((g) => g.id === "group-faculty");
    expect(hcmutStudentGroup?.members?.some((m) => m.value === "usr-alex-turner")).toBe(false);
    expect(hcmutFacultyGroup?.members?.some((m) => m.value === "usr-alex-turner")).toBe(true);

    // List all memberships for Alex Turner: returns both institutional roles
    const allMemberships = await tenantRepo.listMembershipsByUser("usr-alex-turner");
    expect(allMemberships).toHaveLength(2);
  });

  it("deactivation or deletion in Tenant A does not cascade or affect Tenant B", async () => {
    // Provision in both tenants
    await scimRepoPolytech.saveUser({
      schemas: [SCIM_USER_SCHEMA_URI],
      id: "usr-shared-01",
      externalId: "poly-shared-01",
      userName: "shared@polytech.edu.vn",
      emails: [{ value: "shared@polytech.edu.vn", type: "work", primary: true }],
      active: true,
      roles: [{ value: "STUDENT" }],
    });

    await scimRepoHcmut.saveUser({
      schemas: [SCIM_USER_SCHEMA_URI],
      id: "usr-shared-01",
      externalId: "hcmut-shared-01",
      userName: "shared@hcmut.edu.vn",
      emails: [{ value: "shared@hcmut.edu.vn", type: "work", primary: true }],
      active: true,
      roles: [{ value: "LECTURER" }],
    });

    // Tenant A deletes the user
    const deleted = await scimRepoPolytech.deleteUser("usr-shared-01");
    expect(deleted).toBe(true);

    // In Tenant A, membership is REVOKED
    const polyMem = await tenantRepo.findMembership("usr-shared-01", "tenant-pilot-polytech");
    expect(polyMem?.status).toBe("REVOKED");

    // In Tenant B, membership remains ACTIVE LECTURER
    const hcmutMem = await tenantRepo.findMembership("usr-shared-01", "tenant-pilot-hcmut");
    expect(hcmutMem?.status).toBe("ACTIVE");
    expect(hcmutMem?.role).toBe("LECTURER");

    // User is still present and discoverable in Tenant B's SCIM store
    const userInB = await scimRepoHcmut.findUserById("usr-shared-01");
    expect(userInB).not.toBeNull();
    expect(userInB?.userName).toBe("shared@hcmut.edu.vn");
  });

  it("role escalation in Tenant B does not affect Tenant A permissions", async () => {
    // Provision student in Polytech and lecturer in HCMUT
    await scimRepoPolytech.saveUser({
      schemas: [SCIM_USER_SCHEMA_URI],
      id: "usr-priv-01",
      externalId: "poly-priv-01",
      userName: "priv@polytech.edu.vn",
      emails: [{ value: "priv@polytech.edu.vn", type: "work", primary: true }],
      active: true,
      roles: [{ value: "STUDENT" }],
    });

    await scimRepoHcmut.saveUser({
      schemas: [SCIM_USER_SCHEMA_URI],
      id: "usr-priv-01",
      externalId: "hcmut-priv-01",
      userName: "priv@hcmut.edu.vn",
      emails: [{ value: "priv@hcmut.edu.vn", type: "work", primary: true }],
      active: true,
      roles: [{ value: "INSTITUTION_ADMIN" }], // Promoted to admin at HCMUT
    });

    const polyMem = await tenantRepo.findMembership("usr-priv-01", "tenant-pilot-polytech");
    const hcmutMem = await tenantRepo.findMembership("usr-priv-01", "tenant-pilot-hcmut");

    expect(polyMem?.role).toBe("STUDENT"); // STRICT NO-PRIVILEGE ESCALATION
    expect(hcmutMem?.role).toBe("INSTITUTION_ADMIN");
  });
});
