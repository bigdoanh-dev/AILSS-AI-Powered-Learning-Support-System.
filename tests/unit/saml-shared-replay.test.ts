/**
 * Phase 26.3: Multi-Instance Production SAML Replay State & Atomic Consumption
 *
 * Verifies:
 * 1. Multi-instance shared state: Instance A accepts assertion, Instance B rejects it
 * 2. Restart resilience: A new instance created after restart preserves replay history
 * 3. Concurrent duplicate: Two requests racing concurrently result in exactly 1 accepted and 1 rejected
 * 4. Tenant isolation: Same assertion ID across different tenants (Tenant A vs Tenant B) does not collide
 * 5. TTL / Expiration: Expired records are pruned and cannot bypass security
 * 6. Integration with validateSamlResponse using real RSA signatures across multiple service instances
 */

import { generateKeyPairSync } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  SharedReplayStateCluster,
  DistributedSamlReplayStore,
  validateSamlResponse,
  signSamlElement,
  type SamlReplayRecord,
} from "../../packages/security/src/saml.js";

describe("Phase 26.3: Multi-Instance SAML Replay State Productionization", () => {
  let cluster: SharedReplayStateCluster;
  let instanceA: DistributedSamlReplayStore;
  let instanceB: DistributedSamlReplayStore;

  const spConfig = {
    entityId: "https://ailss.edu.vn/saml/metadata",
    assertionConsumerServiceUrl: "https://ailss.edu.vn/api/v1/auth/saml/acs",
  };

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const idpConfig = {
    entityId: "https://idp.polytech.edu.vn/saml/metadata",
    singleSignOnServiceUrl: "https://idp.polytech.edu.vn/saml/sso",
    certificate: publicKey,
  };

  beforeEach(() => {
    cluster = new SharedReplayStateCluster();
    instanceA = new DistributedSamlReplayStore(cluster, { tenantId: "tenant-pilot-polytech" });
    instanceB = new DistributedSamlReplayStore(cluster, { tenantId: "tenant-pilot-polytech" });
  });

  function makeRecord(assertionId: string, tenantId = "tenant-pilot-polytech", offsetMs = 300_000): SamlReplayRecord {
    const now = new Date();
    return {
      tenantId,
      idpIssuer: idpConfig.entityId,
      assertionId,
      responseId: `_resp_${assertionId}`,
      issuedAt: now,
      expiresAt: new Date(now.getTime() + offsetMs),
      consumedAt: now,
    };
  }

  function buildResponseBase64(assertionId: string, email: string): string {
    const assertionXml = [
      `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" IssueInstant="2026-09-18T00:00:00Z">`,
      `<saml:Issuer>${idpConfig.entityId}</saml:Issuer>`,
      '<saml:Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2035-01-01T00:00:00Z">',
      `<saml:AudienceRestriction><saml:Audience>${spConfig.entityId}</saml:Audience></saml:AudienceRestriction>`,
      "</saml:Conditions>",
      "<saml:Subject>",
      `<saml:NameID>${email}</saml:NameID>`,
      '<saml:SubjectConfirmationData InResponseTo="_req_p26" />',
      "</saml:Subject>",
      "<saml:AttributeStatement>",
      '<saml:Attribute Name="email">',
      `<saml:AttributeValue>${email}</saml:AttributeValue>`,
      "</saml:Attribute>",
      "</saml:AttributeStatement>",
      "</saml:Assertion>",
    ].join("");

    const signatureXml = signSamlElement(assertionXml, privateKey, assertionId);

    const responseXml = [
      `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_resp_${assertionId}" Destination="${spConfig.assertionConsumerServiceUrl}">`,
      "<samlp:Status>",
      '<samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>',
      "</samlp:Status>",
      signatureXml,
      assertionXml,
      "</samlp:Response>",
    ].join("");

    return Buffer.from(responseXml, "utf8").toString("base64");
  }

  it("multi-instance: instance A consumes assertion, instance B immediately rejects replay", () => {
    const record = makeRecord("asst-shared-001");

    // Instance A accepts
    const acceptedA = instanceA.consume(record);
    expect(acceptedA).toBe(true);

    // Instance B receives same assertion -> Rejected
    const acceptedB = instanceB.consume(record);
    expect(acceptedB).toBe(false);

    // Verify both instances see it as consumed
    expect(instanceA.has("asst-shared-001")).toBe(true);
    expect(instanceB.has("asst-shared-001")).toBe(true);
  });

  it("restart: a newly spawned instance C inherits cluster state and rejects already consumed assertion", () => {
    const record = makeRecord("asst-restart-001");
    expect(instanceA.consume(record)).toBe(true);

    // Simulate Identity Service node restarting / new replica spawning
    const instanceC = new DistributedSamlReplayStore(cluster, { tenantId: "tenant-pilot-polytech" });

    // New instance must reject replay
    expect(instanceC.has("asst-restart-001")).toBe(true);
    expect(instanceC.consume(record)).toBe(false);
  });

  it("concurrent duplicate: parallel consumption results in exactly 1 accepted and 1 rejected", async () => {
    const record = makeRecord("asst-race-001");

    // Simulate two concurrent requests arriving at Instance A and Instance B simultaneously
    const results = await Promise.all([
      Promise.resolve().then(() => instanceA.consume(record)),
      Promise.resolve().then(() => instanceB.consume(record)),
    ]);

    const acceptedCount = results.filter((r) => r).length;
    const rejectedCount = results.filter((r) => !r).length;

    expect(acceptedCount).toBe(1);
    expect(rejectedCount).toBe(1);
  });

  it("tenant isolation: different tenants using the same opaque assertion ID do not collide", () => {
    const storeTenantPolytech = new DistributedSamlReplayStore(cluster, { tenantId: "tenant-polytech" });
    const storeTenantNational = new DistributedSamlReplayStore(cluster, { tenantId: "tenant-national" });

    const recordPolytech = makeRecord("asst-opaque-999", "tenant-polytech");
    const recordNational = makeRecord("asst-opaque-999", "tenant-national");

    // Tenant Polytech consumes
    expect(storeTenantPolytech.consume(recordPolytech)).toBe(true);

    // Tenant National consumes same opaque ID independently -> Allowed
    expect(storeTenantNational.consume(recordNational)).toBe(true);

    // Replay within same tenant is still rejected
    expect(storeTenantPolytech.consume(recordPolytech)).toBe(false);
    expect(storeTenantNational.consume(recordNational)).toBe(false);
  });

  it("TTL: expired replay record cannot be consumed after expiration", () => {
    // Record that expired 10 seconds ago
    const expiredRecord = makeRecord("asst-expired-001", "tenant-pilot-polytech", -10_000);

    const result = instanceA.consume(expiredRecord);
    expect(result).toBe(false);
    expect(instanceA.has("asst-expired-001")).toBe(false);
  });

  it("full SAML response validation: Instance A accepts valid SAML, Instance B throws SAML_REPLAY_ATTACK_DETECTED", () => {
    const responseBase64 = buildResponseBase64("asst-e2e-replay-001", "student.pilot@polytech.edu.vn");

    // Instance A processes first presentation -> Valid
    const session = validateSamlResponse(responseBase64, {
      expectedDestination: spConfig.assertionConsumerServiceUrl,
      expectedAudience: spConfig.entityId,
      idpConfig,
      replayCache: instanceA,
      tenantId: "tenant-pilot-polytech",
    });

    expect(session.email).toBe("student.pilot@polytech.edu.vn");
    expect(session.nameId).toBe("student.pilot@polytech.edu.vn");

    // Instance B processes duplicate presentation -> Throws SAML_REPLAY_ATTACK_DETECTED
    expect(() =>
      validateSamlResponse(responseBase64, {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
        replayCache: instanceB,
        tenantId: "tenant-pilot-polytech",
      }),
    ).toThrowError(/already been processed/u);
  });
});
