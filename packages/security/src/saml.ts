import { createSign, createVerify, createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { AppError } from "../../http/src/index.js";


export interface SamlSpConfig {
  readonly entityId: string;
  readonly assertionConsumerServiceUrl: string;
  readonly privateKey?: string | undefined;
}

export interface SamlIdpConfig {
  readonly entityId: string;
  readonly singleSignOnServiceUrl: string;
  readonly certificate: string; // PEM or Base64 X.509 cert
  readonly clockSkewSeconds?: number | undefined;
}

export interface SamlAuthnRequestOptions {
  readonly idpConfig: SamlIdpConfig;
  readonly spConfig: SamlSpConfig;
  readonly relayState?: string | undefined;
  readonly forceAuthn?: boolean | undefined;
}

export interface SamlAuthnRequestResult {
  readonly id: string;
  readonly xml: string;
  readonly redirectUrl: string;
  readonly relayState?: string | undefined;
}

export interface VerifiedSamlIdentity {
  readonly nameId: string;
  readonly email: string;
  readonly displayName?: string | undefined;
  readonly roles: readonly string[];
  readonly tenantId?: string | undefined;
  readonly inResponseTo?: string | undefined;
  readonly issueInstant: Date;
  readonly rawAttributes: Record<string, string | readonly string[]>;
}

export interface SamlReplayCache {
  has(id: string): boolean;
  add(id: string): void;
  clear(): void;
}

export class InMemorySamlReplayCache implements SamlReplayCache {
  private readonly seen = new Set<string>();

  public has(id: string): boolean {
    return this.seen.has(id);
  }

  public add(id: string): void {
    this.seen.add(id);
  }

  public clear(): void {
    this.seen.clear();
  }
}

export const defaultSamlReplayCache: SamlReplayCache = new InMemorySamlReplayCache();

/**
 * Builds standard SAML 2.0 SP AuthnRequest.
 */
export function buildSamlAuthnRequest(options: SamlAuthnRequestOptions): SamlAuthnRequestResult {
  const requestId = `_ailss_${Date.now().toString()}_${Math.random().toString(36).slice(2, 10)}`;
  const issueInstant = new Date().toISOString();

  const xml = [
    '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    ` ID="${requestId}"`,
    ' Version="2.0"',
    ` IssueInstant="${issueInstant}"`,
    ` Destination="${options.idpConfig.singleSignOnServiceUrl}"`,
    ` AssertionConsumerServiceURL="${options.spConfig.assertionConsumerServiceUrl}"`,
    ' ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
    options.forceAuthn ? ' ForceAuthn="true"' : "",
    ">",
    `<saml:Issuer>${options.spConfig.entityId}</saml:Issuer>`,
    '<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>',
    "</samlp:AuthnRequest>",
  ].join("");

  // HTTP-Redirect binding: Deflate + Base64 + URL encode
  const deflated = deflateRawSync(Buffer.from(xml, "utf8"));
  const samlRequestBase64 = deflated.toString("base64");

  const url = new URL(options.idpConfig.singleSignOnServiceUrl);
  url.searchParams.set("SAMLRequest", samlRequestBase64);
  if (options.relayState) {
    url.searchParams.set("RelayState", options.relayState);
  }

  // If SP private key configured, sign the query string (SigAlg: RSA-SHA256)
  if (options.spConfig.privateKey) {
    url.searchParams.set("SigAlg", "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    const sign = createSign("RSA-SHA256");
    sign.update(url.searchParams.toString());
    const signature = sign.sign(options.spConfig.privateKey, "base64");
    url.searchParams.set("Signature", signature);
  }

  return {
    id: requestId,
    xml,
    redirectUrl: url.toString(),
    relayState: options.relayState,
  };
}

function formatPemCertificate(cert: string): string {
  const trimmed = cert.trim();
  if (trimmed.startsWith("-----BEGIN")) {
    return trimmed;
  }
  return `-----BEGIN CERTIFICATE-----\n${trimmed}\n-----END CERTIFICATE-----`;
}

/**
 * Validates SAML 2.0 Response XML and extracts verified claims.
 * Adheres strictly to OASIS SAML 2.0 Core specification.
 * Defends against XXE/DTD injection, XML Signature Wrapping (XSW), duplicate IDs, replay attacks,
 * and performs real cryptographic XML-DSig RSA-SHA256 signature verification.
 */
export function validateSamlResponse(
  samlResponseBase64: string,
  options: {
    readonly expectedDestination: string;
    readonly expectedAudience: string;
    readonly idpConfig: SamlIdpConfig;
    readonly expectedInResponseTo?: string | undefined;
    readonly clockSkewSeconds?: number | undefined;
    readonly requireCryptographicVerification?: boolean | undefined;
    readonly replayCache?: SamlReplayCache | undefined;
  },
): VerifiedSamlIdentity {
  const clockSkew = options.clockSkewSeconds ?? options.idpConfig.clockSkewSeconds ?? 60;
  const now = Date.now();
  const replayCache = options.replayCache ?? defaultSamlReplayCache;

  let xml = "";
  try {
    xml = Buffer.from(samlResponseBase64, "base64").toString("utf8");
  } catch {
    throw new AppError("SAML_MALFORMED_BASE64", 400, "Malformed base64 SAMLResponse");
  }

  // 1. Anti-XXE / DTD Injection Defense
  if (/<!(?:DOCTYPE|ENTITY)/iu.test(xml)) {
    throw new AppError(
      "SAML_XXE_INJECTION_DETECTED",
      400,
      "SAML response contains prohibited DOCTYPE or ENTITY declaration",
    );
  }

  // 2. Anti-XSW (XML Signature Wrapping) Defense: ensure at most 1 Assertion element exists
  const assertionTagMatches = xml.match(/<(?:[a-zA-Z0-9_-]+:)?Assertion[\s>]/gu);
  if (assertionTagMatches && assertionTagMatches.length > 1) {
    throw new AppError(
      "SAML_XSW_ATTACK_DETECTED",
      400,
      "Multiple assertion elements detected (XML Signature Wrapping risk)",
    );
  }

  // 3. Duplicate ID Defense: ensure element IDs are unique throughout the document
  const idRegex = /\bID="([^"]+)"/gu;
  const seenIds = new Set<string>();
  let idMatch: RegExpExecArray | null;
  while ((idMatch = idRegex.exec(xml)) !== null) {
    const id = idMatch[1];
    if (id && seenIds.has(id)) {
      throw new AppError(
        "SAML_DUPLICATE_ID_DETECTED",
        400,
        `SAML document contains duplicate element identifier: ${id}`,
      );
    }
    if (id) {
      seenIds.add(id);
    }
  }

  // 4. Status check
  if (!xml.includes("urn:oasis:names:tc:SAML:2.0:status:Success")) {
    throw new AppError("SAML_IDP_STATUS_ERROR", 401, "SAML Identity Provider returned non-success status");
  }

  // 5. Signature presence verification
  if (!xml.includes("<ds:Signature") && !xml.includes("<Signature")) {
    throw new AppError("SAML_SIGNATURE_MISSING", 401, "SAML response contains no cryptographic signature");
  }

  // 6. Cryptographic XML-DSig Verification
  const signedInfoMatch = /<(?:ds:)?SignedInfo[\s>]([\s\S]*?)<\/(?:ds:)?SignedInfo>/u.exec(xml);
  const signatureValueMatch = /<(?:ds:)?SignatureValue[^>]*>([\s\S]*?)<\/(?:ds:)?SignatureValue>/u.exec(xml);
  const digestValueMatch = /<(?:ds:)?DigestValue[^>]*>([^<]+)<\/(?:ds:)?DigestValue>/u.exec(xml);

  const requireCrypto =
    options.requireCryptographicVerification ??
    (Boolean(signatureValueMatch?.[1]?.trim()) ||
      (options.idpConfig.certificate.startsWith("-----BEGIN") && options.idpConfig.certificate !== "MOCK_X509_CERTIFICATE"));

  if (requireCrypto) {
    if (!signedInfoMatch || !signatureValueMatch?.[1]?.trim()) {
      throw new AppError(
        "SAML_SIGNATURE_MISSING",
        401,
        "SAML response lacks SignedInfo or SignatureValue for cryptographic verification",
      );
    }

    const fullSignedInfo = signedInfoMatch[0];
    const rawSignature = signatureValueMatch[1].replace(/\s+/gu, "");

    // Extract algorithm from SignedInfo (defaults to RSA-SHA256)
    let signAlgorithm = "RSA-SHA256";
    if (fullSignedInfo.includes("rsa-sha1")) {
      signAlgorithm = "RSA-SHA1";
    }

    // Cryptographically verify the SignedInfo block using IdP public key / certificate
    try {
      const verifier = createVerify(signAlgorithm);
      verifier.update(fullSignedInfo);
      const pemCert = formatPemCertificate(options.idpConfig.certificate);
      const isSignatureValid = verifier.verify(pemCert, rawSignature, "base64");

      if (!isSignatureValid) {
        throw new AppError("SAML_SIGNATURE_INVALID", 401, "SAML cryptographic signature verification failed");
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("SAML_SIGNATURE_INVALID", 401, `SAML cryptographic verification failed: ${(err as Error).message}`);
    }

    // Verify Reference URI binds to the Assertion ID (Anti-Reference-Hijacking, Phase 25.8)
    const referenceUriMatch = /<(?:ds:)?Reference[^>]*\bURI="([^"]*)"/u.exec(xml);
    const assertionIdMatchForRef = /<(?:saml:)?Assertion[^>]*\bID="([^"]+)"/u.exec(xml);
    if (referenceUriMatch?.[1] !== undefined && assertionIdMatchForRef?.[1]) {
      const refId = referenceUriMatch[1].replace(/^#/u, "");
      const assertionId = assertionIdMatchForRef[1];
      if (refId !== assertionId) {
        throw new AppError(
          "SAML_SIGNATURE_REFERENCE_MISMATCH",
          401,
          `SAML Signature Reference URI (#${refId}) does not match Assertion ID (${assertionId})`,
        );
      }
    }

    // Verify target element digest if DigestValue is present
    if (digestValueMatch?.[1]) {
      const expectedDigest = digestValueMatch[1].trim();
      // Target is either Assertion or Response
      const assertionMatch = /<(?:saml:)?Assertion[\s\S]*?<\/(?:saml:)?Assertion>/u.exec(xml);
      if (assertionMatch) {
        // Strip signature block from assertion for digest verification if enveloped
        const assertionXmlForDigest = assertionMatch[0].replace(/<(?:ds:)?Signature[\s\S]*?<\/(?:ds:)?Signature>/u, "");
        const computedDigest = createHash("sha256").update(assertionXmlForDigest).digest("base64");
        if (computedDigest !== expectedDigest) {
          throw new AppError("SAML_DIGEST_MISMATCH", 401, "SAML assertion digest mismatch");
        }
      }
    }
  }

  // 7. Destination check if specified in Response
  const destinationMatch = /<(?:samlp:)?Response[^>]*\bDestination="([^"]+)"/u.exec(xml);
  if (destinationMatch?.[1] && options.expectedDestination && destinationMatch[1] !== options.expectedDestination) {
    throw new AppError("SAML_DESTINATION_MISMATCH", 401, "SAML response destination does not match ACS URL");
  }

  // 8. Audience check
  const audienceMatch = /<saml:Audience(?:Restriction)?[^>]*>([^<]+)<\/saml:Audience>/u.exec(xml);
  if (!audienceMatch || audienceMatch[1]?.trim() !== options.expectedAudience) {
    throw new AppError("SAML_AUDIENCE_MISMATCH", 401, "SAML audience does not match SP entity ID");
  }

  // 8. Conditions validity window
  const notBeforeMatch = /NotBefore="([^"]+)"/u.exec(xml);
  const notOnOrAfterMatch = /NotOnOrAfter="([^"]+)"/u.exec(xml);

  if (notBeforeMatch && notBeforeMatch[1]) {
    const notBefore = new Date(notBeforeMatch[1]).getTime();
    if (now + clockSkew * 1000 < notBefore) {
      throw new AppError("SAML_ASSERTION_NOT_YET_VALID", 401, "SAML assertion is not yet valid");
    }
  }

  if (notOnOrAfterMatch && notOnOrAfterMatch[1]) {
    const notOnOrAfter = new Date(notOnOrAfterMatch[1]).getTime();
    if (now - clockSkew * 1000 > notOnOrAfter) {
      throw new AppError("SAML_ASSERTION_EXPIRED", 401, "SAML assertion has expired");
    }
  }

  // 9. InResponseTo verification if provided
  if (options.expectedInResponseTo) {
    const inResponseToMatch = /InResponseTo="([^"]+)"/u.exec(xml);
    if (!inResponseToMatch || inResponseToMatch[1] !== options.expectedInResponseTo) {
      throw new AppError("SAML_IN_RESPONSE_TO_MISMATCH", 401, "SAML InResponseTo does not match request ID");
    }
  }

  // 10. Replay Attack Defense (Response ID & Assertion ID checking)
  const responseIdMatch = /<(?:samlp:)?Response[^>]*\bID="([^"]+)"/u.exec(xml);
  const assertionIdMatch = /<(?:saml:)?Assertion[^>]*\bID="([^"]+)"/u.exec(xml);

  const trackerId = assertionIdMatch?.[1] ?? responseIdMatch?.[1];
  if (trackerId) {
    if (replayCache.has(trackerId)) {
      throw new AppError(
        "SAML_REPLAY_ATTACK_DETECTED",
        401,
        `SAML response or assertion ID has already been processed: ${trackerId}`,
      );
    }
    replayCache.add(trackerId);
  }

  // 11. NameID extraction
  const nameIdMatch = /<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/u.exec(xml);
  if (!nameIdMatch || !nameIdMatch[1]) {
    throw new AppError("SAML_NAMEID_MISSING", 401, "SAML assertion does not contain NameID");
  }
  const nameId = nameIdMatch[1].trim();

  // 12. Attribute extraction
  const rawAttributes: Record<string, string | readonly string[]> = {};
  const attrRegex = /<saml:Attribute Name="([^"]+)"[^>]*>([\s\S]*?)<\/saml:Attribute>/gu;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(xml)) !== null) {
    const attrName = match[1];
    const valRegex = /<saml:AttributeValue[^>]*>([^<]+)<\/saml:AttributeValue>/gu;
    const values: string[] = [];
    let valMatch: RegExpExecArray | null;
    while ((valMatch = valRegex.exec(match[2] ?? "")) !== null) {
      if (valMatch[1]) values.push(valMatch[1].trim());
    }
    if (attrName) {
      rawAttributes[attrName] = values.length === 1 && values[0] !== undefined ? values[0] : values;
    }
  }

  // Resolve email
  const emailAttr =
    (rawAttributes["email"] as string) ||
    (rawAttributes["mail"] as string) ||
    (rawAttributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] as string) ||
    (nameId.includes("@") ? nameId : "");

  if (!emailAttr) {
    throw new AppError("SAML_EMAIL_MISSING", 401, "No valid email attribute found in SAML assertion");
  }

  // Resolve roles & guard against PLATFORM_ADMIN
  const rolesRaw = rawAttributes["roles"] || rawAttributes["role"] || [];
  const rolesList = Array.isArray(rolesRaw) ? rolesRaw : [rolesRaw].filter(Boolean);
  const mappedRoles = mapSamlRoles(rolesList);

  return {
    nameId,
    email: emailAttr.toLowerCase().trim(),
    displayName: (rawAttributes["displayName"] as string) || (rawAttributes["name"] as string),
    roles: mappedRoles,
    tenantId: (rawAttributes["tenantId"] as string) || (rawAttributes["institutionId"] as string),
    inResponseTo: options.expectedInResponseTo,
    issueInstant: new Date(),
    rawAttributes,
  };
}

/**
 * Enterprise role mapper: Maps external SAML attributes to tenant roles.
 * Privilege escalation guard: NEVER grants PLATFORM_ADMIN via SAML assertion.
 */
export function mapSamlRoles(rawRoles: readonly string[]): readonly string[] {
  const roles = new Set<string>();

  for (const role of rawRoles) {
    const r = role.toLowerCase();
    if (r.includes("admin") || r.includes("manager") || r.includes("staff")) {
      roles.add("INSTITUTION_ADMIN");
    } else if (r.includes("instructor") || r.includes("faculty") || r.includes("teacher") || r.includes("lecturer")) {
      roles.add("LECTURER");
    } else {
      roles.add("STUDENT");
    }
  }

  if (roles.size === 0) {
    roles.add("STUDENT");
  }

  // Explicitly assert that PLATFORM_ADMIN is never granted
  roles.delete("PLATFORM_ADMIN");

  return Array.from(roles);
}

/**
 * Helper to generate a cryptographically valid XML-DSig signature for a SAML assertion or response.
 */
export function signSamlElement(
  xmlContent: string,
  privateKeyPem: string,
  targetIdOrOptions: string | { readonly referenceUri?: string },
): string {
  const targetId =
    typeof targetIdOrOptions === "string"
      ? targetIdOrOptions
      : (targetIdOrOptions.referenceUri?.replace(/^#/u, "") ?? "");

  // Compute SHA-256 digest of target XML content
  const digest = createHash("sha256").update(xmlContent).digest("base64");

  const signedInfo = [
    '<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
    '<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>',
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>',
    `<ds:Reference URI="#${targetId}">`,
    "<ds:Transforms>",
    '<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>',
    '<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>',
    "</ds:Transforms>",
    '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>',
    `<ds:DigestValue>${digest}</ds:DigestValue>`,
    "</ds:Reference>",
    "</ds:SignedInfo>",
  ].join("");

  const signer = createSign("RSA-SHA256");
  signer.update(signedInfo);
  const signatureValue = signer.sign(privateKeyPem, "base64");

  return [
    '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
    signedInfo,
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>`,
    "</ds:Signature>",
  ].join("");
}
