import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AUTHORITATIVE_REPLAY_BACKENDS,
  CassandraSamlReplayStore,
  DurableCrossProcessReplayCluster,
  DistributedSamlReplayStore,
  validateSamlResponse,
  signSamlXml,
  SamlIdpMetadataResolver,
  type SamlIdpConfig,
  type SamlReplayRecord,
} from "../../packages/security/src/saml.js";

describe("Phase 28.4 & 28.5: Authoritative SAML Replay & IdP Certificate Rotation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ailss-p28-saml-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("Phase 28.4: Authoritative SAML Replay Backend Specification", () => {
    it("strictly declares authoritative replay backends per environment", () => {
      expect(AUTHORITATIVE_REPLAY_BACKENDS.LOCAL).toBe("DURABLE_CROSS_PROCESS_FS");
      expect(AUTHORITATIVE_REPLAY_BACKENDS.TEST).toBe("DURABLE_CROSS_PROCESS_FS");
      expect(AUTHORITATIVE_REPLAY_BACKENDS.PILOT).toBe("CASSANDRA");
      expect(AUTHORITATIVE_REPLAY_BACKENDS.PRODUCTION).toBe("CASSANDRA");
    });

    it("Cassandra replay store enforces Paxos LWT with serial consistency", async () => {
      let capturedOptions: Record<string, unknown> | undefined;
      const mockClient = {
        execute: async (_query: string, _params: unknown[], options?: unknown) => {
          capturedOptions = options as Record<string, unknown>;
          return { wasApplied: () => true };
        },
      };

      const store = new CassandraSamlReplayStore({
        client: mockClient,
        tenantId: "tenant-pilot-polytech",
        serialConsistency: "LOCAL_SERIAL",
      });

      expect(store.backendClassification).toBe("CASSANDRA");
      expect(store.serialConsistency).toBe("LOCAL_SERIAL");

      const now = new Date();
      const record: SamlReplayRecord = {
        tenantId: "tenant-pilot-polytech",
        assertionId: "AS-PAXOS-001",
        idpIssuer: "https://idp.polytech.edu.vn",
        responseId: "RESP-001",
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 300_000),
        consumedAt: now,
      };

      const accepted = await store.consume(record);
      expect(accepted).toBe(true);
      expect(capturedOptions?.prepare).toBe(true);
      expect(capturedOptions?.serialConsistency).toBe("LOCAL_SERIAL");
    });

    it("simulates multi-node cluster resilience: Node A consumes, Node B rejects, Node A dies, Node C rejects", async () => {
      const cluster = new DurableCrossProcessReplayCluster(tempDir);
      const tenantId = "tenant-pilot-polytech";
      const assertionId = "AS-CLUSTER-RESILIENCE-99";
      const now = new Date();

      const record: SamlReplayRecord = {
        tenantId,
        assertionId,
        idpIssuer: "https://idp.polytech.edu.vn",
        responseId: "RESP-CLUSTER-99",
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 600_000),
        consumedAt: now,
      };

      // 1. Node A receives and consumes
      const nodeA = new DistributedSamlReplayStore(cluster, { tenantId });
      expect(nodeA.consume(record)).toBe(true);

      // 2. Node B (another cluster member sharing durable state) receives replay -> rejected
      const nodeB = new DistributedSamlReplayStore(cluster, { tenantId });
      expect(nodeB.has(assertionId)).toBe(true);
      expect(nodeB.consume(record)).toBe(false);

      // 3. Node A abruptly crashes/dies (reference destroyed)
      // 4. Node C spins up fresh on another host/container pointing to shared storage
      const nodeC = new DistributedSamlReplayStore(
        new DurableCrossProcessReplayCluster(tempDir),
        { tenantId },
      );
      expect(nodeC.has(assertionId)).toBe(true);
      expect(nodeC.consume(record)).toBe(false);
    });
  });

  describe("Phase 28.5: IdP Certificate Rotation & Resilient Rollover", () => {
    // Generate RSA keypairs for rotation testing
    const primaryKeys = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const nextKeys = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const untrustedKeys = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    function createTestSamlResponseXml(assertionId: string, privateKeyPem: string): string {
      const issueInstant = new Date().toISOString();
      const notOnOrAfter = new Date(Date.now() + 300_000).toISOString();

      const assertionContent = [
        `<saml:Issuer>https://idp.polytech.edu.vn</saml:Issuer>`,
        `<saml:Subject>`,
        `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">alex.turner@polytech.edu.vn</saml:NameID>`,
        `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">`,
        `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="https://ailss.polytech.edu.vn/api/v1/auth/saml/callback" InResponseTo="_req_123"/>`,
        `</saml:SubjectConfirmation>`,
        `</saml:Subject>`,
        `<saml:Conditions NotBefore="${issueInstant}" NotOnOrAfter="${notOnOrAfter}">`,
        `<saml:AudienceRestriction>`,
        `<saml:Audience>https://ailss.polytech.edu.vn/sp</saml:Audience>`,
        `</saml:AudienceRestriction>`,
        `</saml:Conditions>`,
        `<saml:AuthnStatement AuthnInstant="${issueInstant}">`,
        `<saml:AuthnContext>`,
        `<saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>`,
        `</saml:AuthnContext>`,
        `</saml:AuthnStatement>`,
        `<saml:AttributeStatement>`,
        `<saml:Attribute Name="email"><saml:AttributeValue>alex.turner@polytech.edu.vn</saml:AttributeValue></saml:Attribute>`,
        `<saml:Attribute Name="role"><saml:AttributeValue>STUDENT</saml:AttributeValue></saml:Attribute>`,
        `</saml:AttributeStatement>`,
      ].join("");

      const assertionWithoutSig = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" IssueInstant="${issueInstant}" Version="2.0">${assertionContent}</saml:Assertion>`;
      const sig = signSamlXml(assertionWithoutSig, privateKeyPem, assertionId);

      const completeAssertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" IssueInstant="${issueInstant}" Version="2.0">${sig}${assertionContent}</saml:Assertion>`;

      return [
        `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp_${assertionId}" Version="2.0" IssueInstant="${issueInstant}" Destination="https://ailss.polytech.edu.vn/api/v1/auth/saml/callback" InResponseTo="_req_123">`,
        `<saml:Issuer>https://idp.polytech.edu.vn</saml:Issuer>`,
        `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`,
        completeAssertion,
        `</samlp:Response>`,
      ].join("");
    }

    it("accepts signatures signed by primary certificate", () => {
      const assertionId = "_as_primary_cert_01";
      const xml = createTestSamlResponseXml(assertionId, primaryKeys.privateKey);
      const b64 = Buffer.from(xml).toString("base64");

      const idpConfig: SamlIdpConfig = {
        entityId: "https://idp.polytech.edu.vn",
        singleSignOnServiceUrl: "https://idp.polytech.edu.vn/sso",
        certificate: primaryKeys.publicKey,
      };

      const result = validateSamlResponse(b64, {
        expectedDestination: "https://ailss.polytech.edu.vn/api/v1/auth/saml/callback",
        expectedAudience: "https://ailss.polytech.edu.vn/sp",
        expectedInResponseTo: "_req_123",
        idpConfig,
      });

      expect(result.nameId).toBe("alex.turner@polytech.edu.vn");
      expect(result.email).toBe("alex.turner@polytech.edu.vn");
      expect(result.roles).toContain("STUDENT");
    });

    it("accepts signatures signed by next/rollover certificate during key rotation window", () => {
      const assertionId = "_as_next_cert_02";
      // Signed with NEW key
      const xml = createTestSamlResponseXml(assertionId, nextKeys.privateKey);
      const b64 = Buffer.from(xml).toString("base64");

      // IdP config has primary (old) + secondary (new rollover)
      const idpConfig: SamlIdpConfig = {
        entityId: "https://idp.polytech.edu.vn",
        singleSignOnServiceUrl: "https://idp.polytech.edu.vn/sso",
        certificate: primaryKeys.publicKey,
        secondaryCertificates: [nextKeys.publicKey],
      };

      const result = validateSamlResponse(b64, {
        expectedDestination: "https://ailss.polytech.edu.vn/api/v1/auth/saml/callback",
        expectedAudience: "https://ailss.polytech.edu.vn/sp",
        expectedInResponseTo: "_req_123",
        idpConfig,
      });

      expect(result.nameId).toBe("alex.turner@polytech.edu.vn");
      expect(result.email).toBe("alex.turner@polytech.edu.vn");
      expect(result.roles).toContain("STUDENT");
    });

    it("rejects unknown certificate not in candidate set", () => {
      const assertionId = "_as_untrusted_03";
      const xml = createTestSamlResponseXml(assertionId, untrustedKeys.privateKey);
      const b64 = Buffer.from(xml).toString("base64");

      const idpConfig: SamlIdpConfig = {
        entityId: "https://idp.polytech.edu.vn",
        singleSignOnServiceUrl: "https://idp.polytech.edu.vn/sso",
        certificate: primaryKeys.publicKey,
        secondaryCertificates: [nextKeys.publicKey],
      };

      expect(() => {
        validateSamlResponse(b64, {
          expectedDestination: "https://ailss.polytech.edu.vn/api/v1/auth/saml/callback",
          expectedAudience: "https://ailss.polytech.edu.vn/sp",
          expectedInResponseTo: "_req_123",
          idpConfig,
        });
      }).toThrow(/SAML cryptographic signature verification failed across 2 candidate certificate/);
    });

    it("metadata resolver falls back to cached certificates without authentication outage when endpoint fails", async () => {
      const sampleMetadataXml = `
        <EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.polytech.edu.vn">
          <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
            <KeyDescriptor use="signing">
              <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
                <ds:X509Data>
                  <ds:X509Certificate>MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA012345</ds:X509Certificate>
                </ds:X509Data>
              </ds:KeyInfo>
            </KeyDescriptor>
            <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.polytech.edu.vn/sso"/>
          </IDPSSODescriptor>
        </EntityDescriptor>
      `;

      let shouldFail = false;
      const mockFetcher = async () => {
        if (shouldFail) throw new Error("Connection refused by upstream IdP (503 Service Unavailable)");
        return sampleMetadataXml;
      };

      const resolver = new SamlIdpMetadataResolver(mockFetcher);

      // 1. Initial successful resolution
      const firstResult = await resolver.resolve("https://idp.polytech.edu.vn/saml/metadata");
      expect(firstResult.source).toBe("FETCHED");
      expect(firstResult.signingCertificates).toHaveLength(1);
      expect(firstResult.entityId).toBe("https://idp.polytech.edu.vn");

      // 2. Upstream IdP goes down / network hiccup
      shouldFail = true;
      const fallbackResult = await resolver.resolve("https://idp.polytech.edu.vn/saml/metadata");
      expect(fallbackResult.source).toBe("CACHE_FALLBACK");
      expect(fallbackResult.signingCertificates).toHaveLength(1);
      expect(fallbackResult.entityId).toBe("https://idp.polytech.edu.vn");
    });
  });
});
