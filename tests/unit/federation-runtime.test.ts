import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FederationService } from "../../apps/identity-service/src/federation/service.js";
import type { FederationRepository, FederationTransaction, LtiDeployment } from "../../apps/identity-service/src/federation/repository.js";

const org = "10000000-0000-4000-8000-000000000001";
const transactions = new Map<string, FederationTransaction>();
let deployment: LtiDeployment;
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let server: ReturnType<typeof createServer>;

const repository = {
  ltiDeployment: async () => deployment,
  createTransaction: async (value: FederationTransaction) => { transactions.set(value.state, value); },
  consumeTransaction: async (state: string, protocol: "SAML" | "LTI") => {
    const value = transactions.get(state); transactions.delete(state);
    return value?.protocol === protocol ? value : undefined;
  },
  resolveUser: async () => ({ userId: "20000000-0000-4000-8000-000000000001", role: "STUDENT", tokenVersion: 1,
    displayName: "Learner", emailMasked: "l***@example.edu" }),
  insertSession: async () => true,
} as unknown as FederationRepository;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256"); privateKey = keys.privateKey;
  const jwk = await exportJWK(keys.publicKey); Object.assign(jwk, { kid: "lms-key-1", alg: "RS256", use: "sig" });
  server = createServer((_req, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("server unavailable");
  deployment = { organizationId: org, issuer: "https://lms.example.edu", clientId: "ailss-client",
    deploymentId: "deployment-1", authLoginUrl: "https://lms.example.edu/authorize",
    jwksUrl: `http://127.0.0.1:${String(address.port)}/jwks`, status: "ACTIVE" };
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

describe("production LTI 1.3 runtime", () => {
  it("creates OIDC state and nonce, verifies JWKS JWT, consumes state once, and issues an AILSS session", async () => {
    const service = new FederationService({ repository, publicBaseUrl: "https://ailss.example.edu", production: false,
      accessTokenTtlSeconds: 900, refreshTokenTtlSeconds: 3600, accessTokenSigner: async () => "ailss-access-token" });
    const authorization = new URL(await service.beginLti({ issuer: deployment.issuer, clientId: deployment.clientId,
      deploymentId: deployment.deploymentId, loginHint: "opaque-login", targetLinkUri: "https://ailss.example.edu/app/course/1" }));
    const state = authorization.searchParams.get("state"), nonce = authorization.searchParams.get("nonce");
    expect(state).toBeTruthy(); expect(nonce).toBeTruthy(); expect(authorization.searchParams.get("response_mode")).toBe("form_post");
    const idToken = await new SignJWT({ nonce, email: "learner@example.edu", name: "Learner",
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id": deployment.deploymentId,
      "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": "https://ailss.example.edu/app/course/1",
      "https://purl.imsglobal.org/spec/lti/claim/roles": ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"] })
      .setProtectedHeader({ alg: "RS256", kid: "lms-key-1" }).setIssuer(deployment.issuer).setAudience(deployment.clientId)
      .setSubject("lms-user-1").setIssuedAt().setExpirationTime("5m").sign(privateKey);
    const result = await service.completeLti(state ?? "", idToken);
    expect(result.accessToken).toBe("ailss-access-token"); expect(result.targetLinkUri).toBe("https://ailss.example.edu/app/course/1");
    await expect(service.completeLti(state ?? "", idToken)).rejects.toMatchObject({ code: "LTI_STATE_INVALID" });
  });
});
