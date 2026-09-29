import { describe, expect, it } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type JWTVerifyGetKey } from "jose";
import { verifyOidcIdToken } from "../../packages/security/src/index.js";
import { InMemoryTenantRepository } from "../../apps/identity-service/src/tenant/repository.js";
import { TenantService } from "../../apps/identity-service/src/tenant/service.js";

describe("OIDC Security Conformance & SAML Reality (P1)", () => {
  describe("SAML legacy API isolation", () => {
    it("routes SAML configuration through the federation API", async () => {
      const repo = new InMemoryTenantRepository();
      const service = new TenantService(repo);

      const org = await service.createOrganization({
        name: "Test University",
        slug: "test-uni",
        domain: "test.edu",
      });

      await expect(
        service.configureInstitutionalSso({
          organizationId: org.organizationId,
          providerType: "SAML",
          issuerUrl: "https://idp.test.edu/saml2",
          clientId: "ailss-sp",
          allowedDomains: ["test.edu"],
        }),
      ).rejects.toMatchObject({
        code: "SAML_CONFIGURATION_REQUIRES_FEDERATION_API",
        status: 422,
      });
    });

    it("rejects the legacy assertion callback in favor of the signed ACS route", async () => {
      const repo = new InMemoryTenantRepository();
      const service = new TenantService(repo);

      const org = await service.createOrganization({
        name: "Test Institute",
        slug: "test-inst",
        domain: "inst.edu",
      });

      // Manually store a SAML config in repo to simulate legacy or misconfigured state
      await repo.saveSsoConfig({
        organizationId: org.organizationId,
        providerType: "SAML",
        issuerUrl: "https://idp.inst.edu/saml",
        clientId: "inst-client",
        allowedDomains: ["inst.edu"],
        createdAt: new Date().toISOString(),
      });

      await expect(
        service.processInstitutionalSsoCallback(org.organizationId, {
          email: "student@inst.edu",
          sub: "saml-subject-123",
          name: "Student One",
        }),
      ).rejects.toMatchObject({
        code: "LEGACY_SAML_CALLBACK_REJECTED",
        status: 400,
      });
    });
  });

  describe("Tenant Domain Collision & Authorization Guard", () => {
    it("rejects organization domain collision across distinct institutions", async () => {
      const repo = new InMemoryTenantRepository();
      const service = new TenantService(repo);

      await service.createOrganization({
        name: "First University",
        slug: "first-uni",
        domain: "harvard.edu",
      });

      await expect(
        service.createOrganization({
          name: "Imposter University",
          slug: "imposter-uni",
          domain: "harvard.edu",
        }),
      ).rejects.toMatchObject({
        code: "ORGANIZATION_DOMAIN_COLLISION",
        status: 409,
      });
    });

    it("rejects SSO callback when email domain does not match institution allowedDomains", async () => {
      const repo = new InMemoryTenantRepository();
      const service = new TenantService(repo);

      const org = await service.createOrganization({
        name: "MIT",
        slug: "mit-main",
        domain: "mit.edu",
      });

      await service.configureInstitutionalSso({
        organizationId: org.organizationId,
        providerType: "OIDC",
        issuerUrl: "https://oidc.mit.edu",
        clientId: "ailss-mit-client",
        allowedDomains: ["mit.edu"],
      });

      await expect(
        service.processInstitutionalSsoCallback(org.organizationId, {
          email: "attacker@gmail.com",
          sub: "user-attacker-1",
        }),
      ).rejects.toMatchObject({
        code: "SSO_DOMAIN_UNAUTHORIZED",
        status: 403,
      });
    });
  });

  describe("OIDC ID Token Conformance (verifyOidcIdToken)", () => {
    const issuer = "https://idp.university.edu";
    const clientId = "ailss-enterprise-client";

    async function setupKeys() {
      const { publicKey, privateKey } = await generateKeyPair("RS256");
      const jwk = await exportJWK(publicKey);
      jwk.kid = "key-valid-01";
      jwk.alg = "RS256";

      const jwksLookup: JWTVerifyGetKey = (protectedHeader) => {
        if (protectedHeader.kid === jwk.kid) {
          return Promise.resolve(publicKey);
        }
        return Promise.reject(new Error("no applicable key in jwks"));
      };

      return { publicKey, privateKey, jwk, jwksLookup };
    }

    it("accepts valid token with matching issuer, audience, nonce, and state", async () => {
      const { privateKey, jwksLookup } = await setupKeys();
      const now = Math.floor(Date.now() / 1000);

      const idToken = await new SignJWT({
        email: "alice@university.edu",
        email_verified: true,
        name: "Alice Professor",
        nonce: "valid-nonce-abc-123",
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-valid-01" })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject("user-sub-001")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);

      const result = await verifyOidcIdToken(
        {
          idToken,
          expectedNonce: "valid-nonce-abc-123",
          state: "csrf-state-xyz",
          expectedState: "csrf-state-xyz",
        },
        {
          issuer,
          clientId,
          jwks: jwksLookup,
        },
      );

      expect(result.sub).toBe("user-sub-001");
      expect(result.email).toBe("alice@university.edu");
      expect(result.name).toBe("Alice Professor");
      expect(result.nonce).toBe("valid-nonce-abc-123");
    });

    it("rejects token when state parameter mismatches (CSRF attack)", async () => {
      const { jwksLookup } = await setupKeys();

      await expect(
        verifyOidcIdToken(
          {
            idToken: "dummy-token",
            state: "attacker-manipulated-state",
            expectedState: "session-bound-state",
          },
          {
            issuer,
            clientId,
            jwks: jwksLookup,
          },
        ),
      ).rejects.toMatchObject({
        code: "OIDC_STATE_MISMATCH",
        status: 400,
      });
    });

    it("rejects expired token with OIDC_TOKEN_EXPIRED", async () => {
      const { privateKey, jwksLookup } = await setupKeys();
      const pastTime = Math.floor(Date.now() / 1000) - 3600;

      const expiredToken = await new SignJWT({
        email: "bob@university.edu",
        email_verified: true,
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-valid-01" })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject("user-sub-002")
        .setIssuedAt(pastTime - 600)
        .setExpirationTime(pastTime)
        .sign(privateKey);

      await expect(
        verifyOidcIdToken({ idToken: expiredToken }, { issuer, clientId, jwks: jwksLookup }),
      ).rejects.toMatchObject({
        code: "OIDC_TOKEN_EXPIRED",
        status: 401,
      });
    });

    it("rejects token with unknown or mismatched JWKS kid with OIDC_KEY_MISMATCH", async () => {
      const { privateKey, jwksLookup } = await setupKeys();
      const now = Math.floor(Date.now() / 1000);

      const mismatchedKidToken = await new SignJWT({
        email: "charlie@university.edu",
        email_verified: true,
      })
        .setProtectedHeader({ alg: "RS256", kid: "unknown-kid-999" })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject("user-sub-003")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);

      await expect(
        verifyOidcIdToken({ idToken: mismatchedKidToken }, { issuer, clientId, jwks: jwksLookup }),
      ).rejects.toMatchObject({
        code: "OIDC_KEY_MISMATCH",
        status: 401,
      });
    });

    it("rejects token with mismatched nonce with OIDC_NONCE_MISMATCH", async () => {
      const { privateKey, jwksLookup } = await setupKeys();
      const now = Math.floor(Date.now() / 1000);

      const tokenWithWrongNonce = await new SignJWT({
        email: "dave@university.edu",
        email_verified: true,
        nonce: "stale-or-foreign-nonce",
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-valid-01" })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject("user-sub-004")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);

      await expect(
        verifyOidcIdToken(
          { idToken: tokenWithWrongNonce, expectedNonce: "expected-active-nonce-777" },
          { issuer, clientId, jwks: jwksLookup },
        ),
      ).rejects.toMatchObject({
        code: "OIDC_NONCE_MISMATCH",
        status: 401,
      });
    });

    it("rejects token with mismatched issuer or audience", async () => {
      const { privateKey, jwksLookup } = await setupKeys();
      const now = Math.floor(Date.now() / 1000);

      const tokenWrongAud = await new SignJWT({
        email: "eve@university.edu",
        email_verified: true,
      })
        .setProtectedHeader({ alg: "RS256", kid: "key-valid-01" })
        .setIssuer(issuer)
        .setAudience("malicious-client-id")
        .setSubject("user-sub-005")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);

      await expect(
        verifyOidcIdToken({ idToken: tokenWrongAud }, { issuer, clientId, jwks: jwksLookup }),
      ).rejects.toMatchObject({
        code: "OIDC_AUDIENCE_MISMATCH",
        status: 401,
      });
    });
  });
});
