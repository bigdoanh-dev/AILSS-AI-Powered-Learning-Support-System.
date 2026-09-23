import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { AppError } from "../../../../packages/http/src/index.js";
import { validateLtiLaunch, type LtiLaunchClaims } from "../../../../packages/contracts/src/interoperability.js";
import { buildSamlAuthnRequest, validateSamlResponse } from "../../../../packages/security/src/saml.js";
import { newLoginIdentifiers, SESSION_INITIAL_STATE, type LoginSession } from "../login/model.js";
import { newRefreshCredential } from "../login/tokens.js";
import type { FederationRepository, FederatedUser } from "./repository.js";

const token = () => randomBytes(32).toString("base64url");
const safeHttpsUrl = (value: string, production: boolean): URL => {
  const url = new URL(value);
  if ((production && url.protocol !== "https:") || !["https:", "http:"].includes(url.protocol))
    throw new AppError("FEDERATION_URL_REJECTED", 400, "Federation endpoint must use HTTPS");
  if (/^(localhost|127\.|0\.|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/u.test(url.hostname) && production)
    throw new AppError("FEDERATION_URL_REJECTED", 400, "Private federation endpoint is not allowed");
  return url;
};

export interface FederationSessionResult {
  readonly accessToken: string; readonly refreshToken: string; readonly tokenType: "Bearer";
  readonly accessExpiresAt: string; readonly refreshExpiresAt: string;
  readonly user: { readonly userId: string; readonly displayName: string; readonly emailMasked: string; readonly role: string };
  readonly targetLinkUri?: string;
}

export class FederationService {
  public constructor(private readonly options: {
    repository: FederationRepository; publicBaseUrl: string; production: boolean;
    accessTokenTtlSeconds: number; refreshTokenTtlSeconds: number;
    accessTokenSigner: (input: { subject: string; roles: readonly string[]; sessionId: string; tokenVersion: number; issuedAtSeconds: number }) => Promise<string>;
  }) {}

  samlMetadata(organizationId: string): Promise<string> {
    const entityId = `${this.options.publicBaseUrl}/api/v1/auth/saml/${encodeURIComponent(organizationId)}/metadata`;
    const acs = `${this.options.publicBaseUrl}/api/v1/auth/saml/${encodeURIComponent(organizationId)}/acs`;
    return Promise.resolve(`<?xml version="1.0" encoding="UTF-8"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}"><md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat><md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acs}" index="0" isDefault="true"/></md:SPSSODescriptor></md:EntityDescriptor>`);
  }

  async beginSaml(organizationId: string): Promise<string> {
    const config = await this.options.repository.samlConfiguration(organizationId);
    if (!config) throw new AppError("SAML_NOT_CONFIGURED", 404, "SAML is not configured for this organization");
    safeHttpsUrl(config.ssoUrl, this.options.production);
    const relayState = token();
    const sp = { entityId: `${this.options.publicBaseUrl}/api/v1/auth/saml/${organizationId}/metadata`,
      assertionConsumerServiceUrl: `${this.options.publicBaseUrl}/api/v1/auth/saml/${organizationId}/acs` };
    const request = buildSamlAuthnRequest({ idpConfig: { entityId: config.entityId, singleSignOnServiceUrl: config.ssoUrl,
      certificate: config.certificate, secondaryCertificates: config.secondaryCertificates }, spConfig: sp, relayState });
    await this.options.repository.createTransaction({ state: relayState, protocol: "SAML", organizationId,
      issuer: config.entityId, requestId: request.id, expiresAt: new Date(Date.now() + 600_000) });
    return request.redirectUrl;
  }

  async completeSaml(organizationId: string, relayState: string, samlResponse: string): Promise<FederationSessionResult> {
    const transaction = await this.options.repository.consumeTransaction(relayState, "SAML");
    if (!transaction || transaction.organizationId !== organizationId || !transaction.requestId)
      throw new AppError("SAML_STATE_INVALID", 401, "SAML request state is invalid, expired, or already consumed");
    const config = await this.options.repository.samlConfiguration(organizationId);
    if (!config || config.entityId !== transaction.issuer) throw new AppError("SAML_CONFIGURATION_CHANGED", 401, "SAML configuration changed during login");
    const destination = `${this.options.publicBaseUrl}/api/v1/auth/saml/${organizationId}/acs`;
    const identity = validateSamlResponse(samlResponse, {
      expectedDestination: destination,
      expectedAudience: `${this.options.publicBaseUrl}/api/v1/auth/saml/${organizationId}/metadata`,
      expectedInResponseTo: transaction.requestId,
      idpConfig: { entityId: config.entityId, singleSignOnServiceUrl: config.ssoUrl, certificate: config.certificate,
        secondaryCertificates: config.secondaryCertificates },
      replayCache: { has: () => false, add: () => {}, clear: () => {} }, tenantId: organizationId,
      requireCryptographicVerification: true,
    });
    const xml = Buffer.from(samlResponse, "base64").toString("utf8");
    const assertionId = /<(?:saml:)?Assertion[^>]*\bID="([^"]+)"/u.exec(xml)?.[1];
    if (!assertionId) throw new AppError("SAML_ASSERTION_ID_MISSING", 401, "SAML assertion has no replay identifier");
    const expiryText = /NotOnOrAfter="([^"]+)"/u.exec(xml)?.[1];
    const expiry = expiryText ? new Date(expiryText) : new Date(Date.now() + 300_000);
    if (!(await this.options.repository.consumeSamlReplay(organizationId, assertionId, config.entityId, expiry)))
      throw new AppError("SAML_REPLAY_ATTACK_DETECTED", 401, "SAML assertion has already been consumed");
    const user = await this.options.repository.resolveUser({ protocol: "SAML", issuer: config.entityId,
      subject: identity.nameId, email: identity.email.toLowerCase(), displayName: identity.displayName ?? identity.email,
      organizationId, role: identity.roles.includes("LECTURER") ? "LECTURER" : "STUDENT" });
    return this.issueSession(user);
  }

  async beginLti(input: { issuer: string; clientId: string; deploymentId: string; loginHint: string; targetLinkUri: string; ltiMessageHint?: string }): Promise<string> {
    const deployment = await this.options.repository.ltiDeployment(input.issuer, input.clientId, input.deploymentId);
    if (!deployment || deployment.status !== "ACTIVE") throw new AppError("LTI_DEPLOYMENT_UNKNOWN", 401, "LTI deployment is not active");
    const authUrl = safeHttpsUrl(deployment.authLoginUrl, this.options.production);
    const target = safeHttpsUrl(input.targetLinkUri, this.options.production);
    const state = token(), nonce = token();
    await this.options.repository.createTransaction({ state, nonce, protocol: "LTI", organizationId: deployment.organizationId,
      issuer: deployment.issuer, clientId: deployment.clientId, deploymentId: deployment.deploymentId,
      targetLinkUri: target.toString(), expiresAt: new Date(Date.now() + 600_000) });
    authUrl.searchParams.set("scope", "openid"); authUrl.searchParams.set("response_type", "id_token");
    authUrl.searchParams.set("response_mode", "form_post"); authUrl.searchParams.set("prompt", "none");
    authUrl.searchParams.set("client_id", deployment.clientId);
    authUrl.searchParams.set("redirect_uri", `${this.options.publicBaseUrl}/api/v1/auth/lti/launch`);
    authUrl.searchParams.set("login_hint", input.loginHint); authUrl.searchParams.set("state", state); authUrl.searchParams.set("nonce", nonce);
    if (input.ltiMessageHint) authUrl.searchParams.set("lti_message_hint", input.ltiMessageHint);
    return authUrl.toString();
  }

  async completeLti(state: string, idToken: string): Promise<FederationSessionResult> {
    const transaction = await this.options.repository.consumeTransaction(state, "LTI");
    if (!transaction?.clientId || !transaction.deploymentId || !transaction.nonce)
      throw new AppError("LTI_STATE_INVALID", 401, "LTI state is invalid, expired, or already consumed");
    const deployment = await this.options.repository.ltiDeployment(transaction.issuer, transaction.clientId, transaction.deploymentId);
    if (!deployment || deployment.status !== "ACTIVE") throw new AppError("LTI_DEPLOYMENT_UNKNOWN", 401, "LTI deployment is not active");
    const jwks = createRemoteJWKSet(safeHttpsUrl(deployment.jwksUrl, this.options.production), { timeoutDuration: 5_000, cooldownDuration: 30_000 });
    const verified = await jwtVerify(idToken, jwks, { issuer: deployment.issuer, audience: deployment.clientId,
      algorithms: ["RS256", "PS256", "ES256"], clockTolerance: 60, maxTokenAge: "10m" });
    const claims = verified.payload as JWTPayload & LtiLaunchClaims & { email?: string; name?: string };
    if (claims.nonce !== transaction.nonce || !claims.email) throw new AppError("LTI_CLAIMS_INVALID", 401, "LTI nonce or email claim is invalid");
    const validated = validateLtiLaunch({ claims, currentTimeSeconds: Math.floor(Date.now() / 1000), trustedDeployments: [{
      organizationId: deployment.organizationId, issuer: deployment.issuer, clientId: deployment.clientId,
      deploymentId: deployment.deploymentId, jwksUrl: deployment.jwksUrl, authLoginUrl: deployment.authLoginUrl, status: deployment.status,
    }] });
    if (!validated.valid || claims["https://purl.imsglobal.org/spec/lti/claim/target_link_uri"] !== transaction.targetLinkUri)
      throw new AppError("LTI_LAUNCH_INVALID", 401, validated.error ?? "LTI target link does not match initiation");
    // Institution-scoped administrator claims must never mint a platform-wide ADMIN token.
    const role = validated.role === "LECTURER" ? "LECTURER" : "STUDENT";
    const user = await this.options.repository.resolveUser({ protocol: "LTI", issuer: deployment.issuer, subject: claims.sub,
      email: claims.email.toLowerCase(), displayName: claims.name ?? claims.email, organizationId: deployment.organizationId, role });
    return { ...(await this.issueSession(user)), ...(transaction.targetLinkUri ? { targetLinkUri: transaction.targetLinkUri } : {}) };
  }

  private async issueSession(user: FederatedUser): Promise<FederationSessionResult> {
    const now = new Date(), issuedAtSeconds = Math.floor(now.getTime() / 1000), ids = newLoginIdentifiers(), refresh = newRefreshCredential();
    const refreshExpiresAt = new Date(now.getTime() + this.options.refreshTokenTtlSeconds * 1000);
    const session: LoginSession = { sessionId: ids.sessionId, userId: user.userId, tokenFamilyId: ids.tokenFamilyId,
      refreshFingerprint: refresh.fingerprint, generation: 0, state: SESSION_INITIAL_STATE, expiresAt: refreshExpiresAt,
      revokedAt: null, version: 1, authVersion: user.tokenVersion, createdAt: now };
    if (!(await this.options.repository.insertSession(session))) throw new AppError("SESSION_CREATE_FAILED", 503, "Unable to create federated session", true);
    const accessToken = await this.options.accessTokenSigner({ subject: user.userId, roles: [user.role], sessionId: ids.sessionId,
      tokenVersion: user.tokenVersion, issuedAtSeconds });
    return { accessToken, refreshToken: refresh.rawToken, tokenType: "Bearer",
      accessExpiresAt: new Date((issuedAtSeconds + this.options.accessTokenTtlSeconds) * 1000).toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(), user: { userId: user.userId, displayName: user.displayName,
        emailMasked: user.emailMasked, role: user.role } };
  }
}
