import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  defaultSamlReplayCache,
  signSamlElement,
  validateSamlResponse,
} from "../../packages/security/src/saml.js";

describe("Phase 24.9: SAML 2.0 Cryptographic Security & Adversarial Protocol Defense", () => {
  const spConfig = {
    entityId: "https://ailss.edu.vn/saml/metadata",
    assertionConsumerServiceUrl: "https://ailss.edu.vn/api/v1/auth/saml/acs",
  };

  // Generate real RSA 2048 keypair for cryptographic verification testing
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

  function buildTestAssertion(id: string, email: string, roles: string[] = ["Student"]): string {
    return [
      `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" IssueInstant="2026-09-17T00:00:00Z">`,
      `<saml:Issuer>${idpConfig.entityId}</saml:Issuer>`,
      '<saml:Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2035-01-01T00:00:00Z">',
      `<saml:AudienceRestriction><saml:Audience>${spConfig.entityId}</saml:Audience></saml:AudienceRestriction>`,
      "</saml:Conditions>",
      "<saml:Subject>",
      `<saml:NameID>${email}</saml:NameID>`,
      '<saml:SubjectConfirmationData InResponseTo="_req_p24" />',
      "</saml:Subject>",
      "<saml:AttributeStatement>",
      '<saml:Attribute Name="email">',
      `<saml:AttributeValue>${email}</saml:AttributeValue>`,
      "</saml:Attribute>",
      '<saml:Attribute Name="roles">',
      ...roles.map((r) => `<saml:AttributeValue>${r}</saml:AttributeValue>`),
      "</saml:Attribute>",
      "</saml:AttributeStatement>",
      "</saml:Assertion>",
    ].join("");
  }

  function wrapInResponse(assertionXml: string, signatureXml: string, responseId: string = "_resp_001"): string {
    return [
      `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${responseId}">`,
      "<samlp:Status>",
      '<samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>',
      "</samlp:Status>",
      signatureXml,
      assertionXml,
      "</samlp:Response>",
    ].join("");
  }

  it("successfully verifies cryptographically valid XML-DSig RSA-SHA256 signed SAML response", () => {
    const assertionId = "_assertion_valid_1";
    const assertionXml = buildTestAssertion(assertionId, "valid_student@polytech.edu.vn");
    const signatureXml = signSamlElement(assertionXml, privateKey, assertionId);
    const fullXml = wrapInResponse(assertionXml, signatureXml, "_resp_valid_1");

    const identity = validateSamlResponse(Buffer.from(fullXml).toString("base64"), {
      expectedDestination: spConfig.assertionConsumerServiceUrl,
      expectedAudience: spConfig.entityId,
      idpConfig,
      expectedInResponseTo: "_req_p24",
      requireCryptographicVerification: true,
    });

    expect(identity.email).toBe("valid_student@polytech.edu.vn");
    expect(identity.roles).toContain("STUDENT");
  });

  it("rejects forged or tampered signature (SAML_SIGNATURE_INVALID)", () => {
    const assertionId = "_assertion_tamper_1";
    const assertionXml = buildTestAssertion(assertionId, "victim@polytech.edu.vn");
    const signatureXml = signSamlElement(assertionXml, privateKey, assertionId);

    // Tamper with assertion after signing
    const tamperedAssertion = assertionXml.replace("victim@polytech.edu.vn", "attacker@polytech.edu.vn");
    const fullXml = wrapInResponse(tamperedAssertion, signatureXml, "_resp_tamper_1");

    expect(() =>
      validateSamlResponse(Buffer.from(fullXml).toString("base64"), {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
        requireCryptographicVerification: true,
      }),
    ).toThrowError("SAML assertion digest mismatch");
  });

  it("rejects response signed with wrong private key", () => {
    const { privateKey: wrongKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const assertionId = "_assertion_wrongkey_1";
    const assertionXml = buildTestAssertion(assertionId, "student@polytech.edu.vn");
    const signatureXml = signSamlElement(assertionXml, wrongKey, assertionId);
    const fullXml = wrapInResponse(assertionXml, signatureXml, "_resp_wrongkey_1");

    expect(() =>
      validateSamlResponse(Buffer.from(fullXml).toString("base64"), {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
        requireCryptographicVerification: true,
      }),
    ).toThrowError("SAML cryptographic signature verification failed");
  });

  it("defends against XXE / DTD injection attacks", () => {
    const xxeXml = `<?xml version="1.0"?>
      <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">
        <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
        <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
          <saml:NameID>&xxe;</saml:NameID>
        </saml:Assertion>
      </samlp:Response>`;

    expect(() =>
      validateSamlResponse(Buffer.from(xxeXml).toString("base64"), {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
      }),
    ).toThrowError("SAML response contains prohibited DOCTYPE or ENTITY declaration");
  });

  it("defends against XML Signature Wrapping (XSW) with multiple assertion elements", () => {
    const assertion1 = buildTestAssertion("_a1", "student@polytech.edu.vn");
    const assertion2 = buildTestAssertion("_a2", "attacker_admin@polytech.edu.vn", ["Administrator"]);
    const xswXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_resp_xsw">
        <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>
        ${assertion1}
        ${assertion2}
      </samlp:Response>
    `;

    expect(() =>
      validateSamlResponse(Buffer.from(xswXml).toString("base64"), {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
      }),
    ).toThrowError("Multiple assertion elements detected (XML Signature Wrapping risk)");
  });

  it("defends against duplicate element IDs", () => {
    const duplicateIdXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_dup_1">
        <samlp:Status ID="_dup_1"><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>
        ${buildTestAssertion("_dup_assertion", "student@polytech.edu.vn")}
      </samlp:Response>
    `;

    expect(() =>
      validateSamlResponse(Buffer.from(duplicateIdXml).toString("base64"), {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
      }),
    ).toThrowError("SAML document contains duplicate element identifier: _dup_1");
  });

  it("defends against replay attacks by blocking duplicated response or assertion IDs", () => {
    const assertionId = "_assertion_replay_target";
    const assertionXml = buildTestAssertion(assertionId, "replay_user@polytech.edu.vn");
    const signatureXml = signSamlElement(assertionXml, privateKey, assertionId);
    const fullXml = wrapInResponse(assertionXml, signatureXml, "_resp_replay_test");

    defaultSamlReplayCache.clear();

    // First time succeeds
    const firstAttempt = validateSamlResponse(Buffer.from(fullXml).toString("base64"), {
      expectedDestination: spConfig.assertionConsumerServiceUrl,
      expectedAudience: spConfig.entityId,
      idpConfig,
      expectedInResponseTo: "_req_p24",
      requireCryptographicVerification: true,
    });
    expect(firstAttempt.email).toBe("replay_user@polytech.edu.vn");

    // Second time throws replay attack detected
    expect(() =>
      validateSamlResponse(Buffer.from(fullXml).toString("base64"), {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
        expectedInResponseTo: "_req_p24",
        requireCryptographicVerification: true,
      }),
    ).toThrowError("SAML response or assertion ID has already been processed: _assertion_replay_target");
  });
});
