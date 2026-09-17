import { describe, expect, it } from "vitest";
import {
  buildSamlAuthnRequest,
  mapSamlRoles,
  validateSamlResponse,
} from "../../packages/security/src/saml.js";

describe("Phase 23D: SAML 2.0 Enterprise Federation & Assertion Validation", () => {
  const spConfig = {
    entityId: "https://ailss.edu.vn/saml/metadata",
    assertionConsumerServiceUrl: "https://ailss.edu.vn/api/v1/auth/saml/acs",
  };

  const idpConfig = {
    entityId: "https://idp.polytech.edu.vn/saml/metadata",
    singleSignOnServiceUrl: "https://idp.polytech.edu.vn/saml/sso",
    certificate: "MOCK_X509_CERTIFICATE",
  };

  it("buildSamlAuthnRequest generates compliant AuthnRequest and HTTP-Redirect parameters", () => {
    const request = buildSamlAuthnRequest({
      spConfig,
      idpConfig,
      relayState: "tenant-polytech",
    });

    expect(request.id).toMatch(/^_ailss_\d+_[a-z0-9]+$/u);
    expect(request.xml).toContain('<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"');
    expect(request.xml).toContain(`Destination="${idpConfig.singleSignOnServiceUrl}"`);
    expect(request.xml).toContain(`<saml:Issuer>${spConfig.entityId}</saml:Issuer>`);

    const url = new URL(request.redirectUrl);
    expect(url.searchParams.get("SAMLRequest")).toBeTruthy();
    expect(url.searchParams.get("RelayState")).toBe("tenant-polytech");
  });

  it("validateSamlResponse rejects responses lacking cryptographic signature", () => {
    const unsignedXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
        <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
        <saml:Assertion>
          <saml:NameID>student@polytech.edu.vn</saml:NameID>
        </saml:Assertion>
      </samlp:Response>
    `;
    const b64 = Buffer.from(unsignedXml).toString("base64");

    expect(() =>
      validateSamlResponse(b64, {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
      }),
    ).toThrowError("SAML response contains no cryptographic signature");
  });

  it("validateSamlResponse rejects audience mismatch", () => {
    const xml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
        <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>
        <saml:Assertion>
          <saml:Conditions>
            <saml:AudienceRestriction>
              <saml:Audience>https://wrong-audience.org</saml:Audience>
            </saml:AudienceRestriction>
          </saml:Conditions>
          <saml:NameID>student@polytech.edu.vn</saml:NameID>
        </saml:Assertion>
      </samlp:Response>
    `;
    const b64 = Buffer.from(xml).toString("base64");

    expect(() =>
      validateSamlResponse(b64, {
        expectedDestination: spConfig.assertionConsumerServiceUrl,
        expectedAudience: spConfig.entityId,
        idpConfig,
      }),
    ).toThrowError("SAML audience does not match SP entity ID");
  });

  it("validateSamlResponse parses valid signed response and extracts verified claims", () => {
    const validXml = `
      <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">
        <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"/>
        <saml:Assertion>
          <saml:Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2035-01-01T00:00:00Z">
            <saml:AudienceRestriction>
              <saml:Audience>${spConfig.entityId}</saml:Audience>
            </saml:AudienceRestriction>
          </saml:Conditions>
          <saml:Subject>
            <saml:NameID>sv01@polytech.edu.vn</saml:NameID>
            <saml:SubjectConfirmationData InResponseTo="_req_123" />
          </saml:Subject>
          <saml:AttributeStatement>
            <saml:Attribute Name="email">
              <saml:AttributeValue>sv01@polytech.edu.vn</saml:AttributeValue>
            </saml:Attribute>
            <saml:Attribute Name="displayName">
              <saml:AttributeValue>Nguyen Van A</saml:AttributeValue>
            </saml:Attribute>
            <saml:Attribute Name="roles">
              <saml:AttributeValue>Staff</saml:AttributeValue>
              <saml:AttributeValue>Platform_Admin</saml:AttributeValue>
            </saml:Attribute>
          </saml:AttributeStatement>
        </saml:Assertion>
      </samlp:Response>
    `;
    const b64 = Buffer.from(validXml).toString("base64");

    const identity = validateSamlResponse(b64, {
      expectedDestination: spConfig.assertionConsumerServiceUrl,
      expectedAudience: spConfig.entityId,
      idpConfig,
      expectedInResponseTo: "_req_123",
    });

    expect(identity.email).toBe("sv01@polytech.edu.vn");
    expect(identity.displayName).toBe("Nguyen Van A");
    // Verifies anti-escalation: Staff -> INSTITUTION_ADMIN; Platform_Admin is stripped!
    expect(identity.roles).toContain("INSTITUTION_ADMIN");
    expect(identity.roles).not.toContain("PLATFORM_ADMIN");
  });

  describe("mapSamlRoles Anti-Privilege Escalation", () => {
    it("never grants PLATFORM_ADMIN via SAML attributes", () => {
      const roles = mapSamlRoles(["SuperAdmin", "Administrator", "PLATFORM_ADMIN", "Faculty"]);
      expect(roles).toContain("INSTITUTION_ADMIN");
      expect(roles).toContain("LECTURER");
      expect(roles).not.toContain("PLATFORM_ADMIN");
    });
  });
});
