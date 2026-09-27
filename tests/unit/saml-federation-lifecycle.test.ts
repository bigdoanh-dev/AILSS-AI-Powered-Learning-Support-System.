/**
 * Phase 25.7 & 25.8: SAML External IdP Validation & Cryptographic Security
 *
 * Validates:
 * 1. Complete SP-Initiated SAML 2.0 Flow:
 *    SP AuthnRequest -> External IdP Signing -> ACS Response Validation -> Session Creation
 * 2. Cryptographic and Protocol Security (Phase 25.8 Review):
 *    - InResponseTo binding validation against original request ID
 *    - Signature digest scope: signature must cover the exact Assertion ID
 *    - Reference URI hijacking detection
 *    - Anti-XSW (XML Signature Wrapping) defense
 *    - Anti-replay cache prevents assertion reuse
 */

import { generateKeyPairSync } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildSamlAuthnRequest,
  validateSamlResponse,
  signSamlElement,
  InMemorySamlReplayCache,
} from "../../packages/security/src/saml.js";

describe("Phase 25.7 & 25.8: SAML External IdP Lifecycle & Cryptographic Verification", () => {
  const spConfig = {
    entityId: "https://ailss.edu.vn/saml/metadata",
    assertionConsumerServiceUrl: "https://ailss.edu.vn/api/v1/auth/saml/acs",
  };

  // Generate real RSA 2048 keypair representing the Institutional IdP (e.g. Polytechnic University)
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

  let replayCache: InMemorySamlReplayCache;

  beforeEach(() => {
    replayCache = new InMemorySamlReplayCache();
  });

  function buildAssertion(params: {
    assertionId: string;
    inResponseTo: string;
    email: string;
    role: string;
  }): string {
    return [
      `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${params.assertionId}" IssueInstant="2026-09-17T00:00:00Z">`,
      `<saml:Issuer>${idpConfig.entityId}</saml:Issuer>`,
      '<saml:Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2035-01-01T00:00:00Z">',
      `<saml:AudienceRestriction><saml:Audience>${spConfig.entityId}</saml:Audience></saml:AudienceRestriction>`,
      "</saml:Conditions>",
      "<saml:Subject>",
      `<saml:NameID>${params.email}</saml:NameID>`,
      `<saml:SubjectConfirmationData InResponseTo="${params.inResponseTo}" />`,
      "</saml:Subject>",
      "<saml:AttributeStatement>",
      '<saml:Attribute Name="email">',
      `<saml:AttributeValue>${params.email}</saml:AttributeValue>`,
      "</saml:Attribute>",
      '<saml:Attribute Name="role">',
      `<saml:AttributeValue>${params.role}</saml:AttributeValue>`,
      "</saml:Attribute>",
      "</saml:AttributeStatement>",
      "</saml:Assertion>",
    ].join("");
  }

  function buildSignedResponseBase64(params: {
    responseId: string;
    assertionXml: string;
    targetElementId: string;
  }): string {
    const signatureXml = signSamlElement(params.assertionXml, privateKey, {
      referenceUri: `#${params.targetElementId}`,
    });

    const responseXml = [
      `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${params.responseId}" Destination="${spConfig.assertionConsumerServiceUrl}">`,
      "<samlp:Status>",
      '<samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>',
      "</samlp:Status>",
      signatureXml,
      params.assertionXml,
      "</samlp:Response>",
    ].join("");

    return Buffer.from(responseXml, "utf8").toString("base64");
  }

  it("completes full SP-initiated SAML flow: AuthnRequest -> Signed Response -> Valid Session", () => {
    // 1. SP creates AuthnRequest
    const authnReq = buildSamlAuthnRequest({
      idpConfig,
      spConfig,
      relayState: "tenant=tenant-pilot-polytech",
    });

    expect(authnReq.id).toMatch(/^_/u);
    expect(authnReq.redirectUrl).toContain("SAMLRequest=");
    expect(authnReq.relayState).toBe("tenant=tenant-pilot-polytech");

    // 2. IdP creates signed SAML Response with assertion matching inResponseTo
    const assertionId = "_asst_pilot_001";
    const assertionXml = buildAssertion({
      assertionId,
      inResponseTo: authnReq.id,
      email: "le.giang@polytech.edu.vn",
      role: "Lecturer",
    });

    const responseBase64 = buildSignedResponseBase64({
      responseId: "_resp_pilot_001",
      assertionXml,
      targetElementId: assertionId,
    });

    // 3. SP ACS validates Response
    const identity = validateSamlResponse(responseBase64, {
      expectedDestination: spConfig.assertionConsumerServiceUrl,
      expectedAudience: spConfig.entityId,
      idpConfig,
      expectedInResponseTo: authnReq.id,
      replayCache,
    });

    expect(identity.email).toBe("le.giang@polytech.edu.vn");
    expect(identity.nameId).toBe("le.giang@polytech.edu.vn");
    expect(identity.roles).toContain("LECTURER");
  });

  it("rejects SAML response when InResponseTo does not match original request ID", () => {
    const authnReq = buildSamlAuthnRequest({
      idpConfig,
      spConfig,
    });

    const assertionId = "_asst_unsolicited_001";
    const assertionXml = buildAssertion({
      assertionId,
      inResponseTo: "_ATTACKER_CHOSEN_REQUEST_ID",
      email: "victim@polytech.edu.vn",
      role: "Student",
    });

    const responseBase64 = buildSignedResponseBase64({
      responseId: "_resp_bad_req_001",
      assertionXml,
      targetElementId: assertionId,
    });

    expect(() =>
      validateSamlResponse(responseBase64, {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
        expectedInResponseTo: authnReq.id, // Expects original request ID
        replayCache,
      }),
    ).toThrowError(/InResponseTo does not match/u);
  });

  it("rejects response when Signature Reference URI does not match Assertion ID", () => {
    const assertionId = "_asst_ref_check_001";
    const assertionXml = buildAssertion({
      assertionId,
      inResponseTo: "_req_001",
      email: "student@polytech.edu.vn",
      role: "Student",
    });

    // Sign with reference to a different element ID (#_fake_element_id)
    const responseBase64 = buildSignedResponseBase64({
      responseId: "_resp_hijack_001",
      assertionXml,
      targetElementId: "_fake_element_id",
    });

    expect(() =>
      validateSamlResponse(responseBase64, {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
        expectedInResponseTo: "_req_001",
        replayCache,
      }),
    ).toThrowError(/Signature Reference URI.*does not match Assertion ID/u);
  });

  it("rejects replayed SAML response presented a second time", () => {
    const assertionId = "_asst_replay_test_001";
    const assertionXml = buildAssertion({
      assertionId,
      inResponseTo: "_req_replay",
      email: "replay.user@polytech.edu.vn",
      role: "Student",
    });

    const responseBase64 = buildSignedResponseBase64({
      responseId: "_resp_replay_001",
      assertionXml,
      targetElementId: assertionId,
    });

    // First presentation succeeds
    const firstResult = validateSamlResponse(responseBase64, {
      expectedDestination: spConfig.assertionConsumerServiceUrl,
      expectedAudience: spConfig.entityId,
      idpConfig,
      expectedInResponseTo: "_req_replay",
      replayCache,
    });
    expect(firstResult.email).toBe("replay.user@polytech.edu.vn");

    // Second presentation with same assertion must be rejected by anti-replay cache
    expect(() =>
      validateSamlResponse(responseBase64, {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
        expectedInResponseTo: "_req_replay",
        replayCache,
      }),
    ).toThrowError(/already been processed/u);
  });
});
