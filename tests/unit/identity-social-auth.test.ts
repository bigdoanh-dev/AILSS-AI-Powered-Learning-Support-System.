import { randomUUID } from "node:crypto";
import { generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  SocialAuthError,
  verifyAppleIdToken,
  verifyGoogleIdToken,
  type SocialVerificationConfig,
} from "../../packages/security/src/index.js";
import type {
  ExternalIdentityRecord,
  SocialProvider,
  UserLinkedProvider,
} from "../../apps/identity-service/src/external-auth/model.js";
import type {
  CreateSocialUserInput,
  IdentityExternalAuthRepository,
  StoredUser,
} from "../../apps/identity-service/src/external-auth/repository.js";
import { IdentityExternalAuthService } from "../../apps/identity-service/src/external-auth/service.js";
import type { LoginSession } from "../../apps/identity-service/src/login/model.js";
import type { IdentityLoginStore } from "../../apps/identity-service/src/login/service.js";
import { createLogger } from "../../packages/logger/src/index.js";

type GeneratedKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

const GOOGLE_CLIENT_ID = "ailss-web-google-client-id";
const APPLE_CLIENT_ID = "com.ailss.web";

describe("Phase 16A — Social Authentication & Account Linking", () => {
  let googlePrivateKey: GeneratedKey;
  let googlePublicKey: GeneratedKey;
  let applePrivateKey: GeneratedKey;
  let applePublicKey: GeneratedKey;
  let verificationConfig: SocialVerificationConfig;

  beforeAll(async () => {
    const googleKeys = await generateKeyPair("RS256");
    googlePrivateKey = googleKeys.privateKey;
    googlePublicKey = googleKeys.publicKey;

    const appleKeys = await generateKeyPair("RS256");
    applePrivateKey = appleKeys.privateKey;
    applePublicKey = appleKeys.publicKey;

    verificationConfig = {
      googleClientIds: [GOOGLE_CLIENT_ID],
      appleClientIds: [APPLE_CLIENT_ID],
      clockToleranceSeconds: 5,
      customGoogleJwks: () => Promise.resolve(googlePublicKey),
      customAppleJwks: () => Promise.resolve(applePublicKey),
    };
  });

  async function createGoogleToken(claims: Record<string, unknown>, expSeconds = 3600): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const sub = typeof claims.sub === "string" ? claims.sub : "google-sub-12345";
    return new SignJWT({
      email: "student.google@example.com",
      email_verified: true,
      name: "Google Student",
      given_name: "Google",
      family_name: "Student",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://accounts.google.com")
      .setAudience(GOOGLE_CLIENT_ID)
      .setSubject(sub)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + expSeconds)
      .sign(googlePrivateKey);
  }

  async function createAppleToken(claims: Record<string, unknown>, expSeconds = 3600): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const sub = typeof claims.sub === "string" ? claims.sub : "apple-sub-67890";
    return new SignJWT({
      email: "student.apple@example.com",
      email_verified: true,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://appleid.apple.com")
      .setAudience(APPLE_CLIENT_ID)
      .setSubject(sub)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + expSeconds)
      .sign(applePrivateKey);
  }

  describe("Token Verification Engine", () => {
    it("verifies a valid Google ID token with expected claims", async () => {
      const token = await createGoogleToken({ sub: "google-101", name: "Nguyễn Văn A" });
      const verified = await verifyGoogleIdToken(token, verificationConfig);
      expect(verified).toMatchObject({
        provider: "GOOGLE",
        providerSubject: "google-101",
        email: "student.google@example.com",
        emailVerified: true,
        displayName: "Nguyễn Văn A",
      });
    });

    it("rejects an expired Google token", async () => {
      const expiredToken = await createGoogleToken({ sub: "google-102" }, -60);
      await expect(verifyGoogleIdToken(expiredToken, verificationConfig)).rejects.toThrow(SocialAuthError);
    });

    it("rejects a token with audience mismatch", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const wrongAudToken = await new SignJWT({
        email: "student@example.com",
        email_verified: true,
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer("https://accounts.google.com")
        .setAudience("unauthorized-client-id")
        .setSubject("google-sub-bad-aud")
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + 3600)
        .sign(googlePrivateKey);

      await expect(verifyGoogleIdToken(wrongAudToken, verificationConfig)).rejects.toThrow(
        "Google token audience does not match configured client IDs",
      );
    });

    it("rejects an unverified Google email", async () => {
      const unverifiedToken = await createGoogleToken({ sub: "google-103", email_verified: false });
      await expect(verifyGoogleIdToken(unverifiedToken, verificationConfig)).rejects.toThrow(
        "Google email is not verified",
      );
    });

    it("verifies an Apple ID token and supports client profile on first login", async () => {
      const token = await createAppleToken({
        sub: "apple-201",
        email: "relay123@privaterelay.appleid.com",
        is_private_email: true,
      });
      const verified = await verifyAppleIdToken(token, verificationConfig, {
        firstName: "Trần",
        lastName: "Thị B",
      });
      expect(verified).toMatchObject({
        provider: "APPLE",
        providerSubject: "apple-201",
        email: "relay123@privaterelay.appleid.com",
        emailVerified: true,
        isPrivateRelay: true,
        displayName: "Trần Thị B",
        givenName: "Trần",
        familyName: "Thị B",
      });
    });
  });

  describe("IdentityExternalAuthService Operations", () => {
    function createMockRepo() {
      const users = new Map<string, StoredUser>();
      const externalIdentities = new Map<string, ExternalIdentityRecord>();
      const userIdentities = new Map<string, UserLinkedProvider[]>();
      const credentialsByEmail = new Map<string, { userId: string; status: string }>();

      const repo = {
        findExternalIdentity: (provider: SocialProvider, subject: string): Promise<ExternalIdentityRecord | null> => {
          return Promise.resolve(externalIdentities.get(`${provider}:${subject}`) ?? null);
        },
        findExternalIdentitiesByUser: (userId: string): Promise<UserLinkedProvider[]> => {
          return Promise.resolve(userIdentities.get(userId) ?? []);
        },
        findCredentialByEmail: (email: string): Promise<{ userId: string; status: string } | null> => {
          return Promise.resolve(credentialsByEmail.get(email) ?? null);
        },
        findUserById: (userId: string): Promise<StoredUser | null> => {
          return Promise.resolve(users.get(userId) ?? null);
        },
        updateLastLogin: (_provider: SocialProvider, _subject: string, _now: Date): Promise<void> => {
          return Promise.resolve();
        },
        createSocialUser: (input: CreateSocialUserInput): Promise<StoredUser> => {
          const user: StoredUser = {
            userId: input.userId,
            emailMasked: input.email.replace(/(.).*(@.*)/, "$1***$2"),
            displayName: input.displayName,
            role: "STUDENT",
            status: "ACTIVE",
            lecturerVerified: false,
            tokenVersion: 1,
            profileVersion: 1,
            normalizedEmail: input.email,
            credentialVersion: 0,
          };
          users.set(user.userId, user);
          const linkRecord: ExternalIdentityRecord = {
            provider: input.provider,
            providerSubject: input.providerSubject,
            userId: input.userId,
            emailAtLinkTime: input.email,
            createdAt: input.now,
            lastLoginAt: input.now,
          };
          externalIdentities.set(`${input.provider}:${input.providerSubject}`, linkRecord);
          const userLinks = userIdentities.get(input.userId) ?? [];
          userLinks.push({
            provider: input.provider,
            providerSubject: input.providerSubject,
            emailAtLinkTime: input.email,
            linkedAt: input.now,
          });
          userIdentities.set(input.userId, userLinks);
          return Promise.resolve(user);
        },
        linkExternalIdentity: (
          userId: string,
          provider: SocialProvider,
          subject: string,
          email: string,
          _snapshot?: string,
          now = new Date(),
        ): Promise<void> => {
          externalIdentities.set(`${provider}:${subject}`, {
            provider,
            providerSubject: subject,
            userId,
            emailAtLinkTime: email,
            createdAt: now,
            lastLoginAt: now,
          });
          const list = userIdentities.get(userId) ?? [];
          list.push({ provider, providerSubject: subject, emailAtLinkTime: email, linkedAt: now });
          userIdentities.set(userId, list);
          return Promise.resolve();
        },
        unlinkExternalIdentity: (
          userId: string,
          provider: SocialProvider,
          subject: string,
        ): Promise<void> => {
          externalIdentities.delete(`${provider}:${subject}`);
          const list = userIdentities.get(userId) ?? [];
          userIdentities.set(
            userId,
            list.filter((item) => !(item.provider === provider && item.providerSubject === subject)),
          );
          return Promise.resolve();
        },
      };

      return {
        users,
        externalIdentities,
        userIdentities,
        credentialsByEmail,
        repo: repo as unknown as IdentityExternalAuthRepository,
      };
    }

    const mockLoginStore: IdentityLoginStore = {
      getCredential: () => Promise.resolve(undefined),
      getUser: () => Promise.resolve(undefined),
      insertSession: (_s: LoginSession) => Promise.resolve(true),
      getSession: () => Promise.resolve(undefined),
      revokeSession: () => Promise.resolve(true),
    };

    const dummySigner = (input: { subject: string; roles: readonly string[] }) =>
      Promise.resolve(`jwt.${input.subject}.${input.roles.join(",")}`);

    it("provisions a new student user upon first Google login", async () => {
      const mock = createMockRepo();
      const service = new IdentityExternalAuthService({
        repository: mock.repo,
        loginStore: mockLoginStore,
        verificationConfig,
        accessTokenSigner: dummySigner,
        logger: createLogger({ service: "test-auth", environment: "test", level: "info" }),
      });

      const token = await createGoogleToken({ sub: "google-new-1" });
      const result = await service.socialLogin("GOOGLE", token);

      expect(result.isNewUser).toBe(true);
      expect(result.user.role).toBe("STUDENT");
      expect(result.user.status).toBe("ACTIVE");
      expect(result.accessToken).toBe(`jwt.${result.user.userId}.STUDENT`);
      expect(result.refreshToken).toBeDefined();

      // Check external identity was linked
      const link = await mock.repo.findExternalIdentity("GOOGLE", "google-new-1");
      expect(link?.userId).toBe(result.user.userId);
    });

    it("logs in an existing user on subsequent Google logins without re-provisioning", async () => {
      const mock = createMockRepo();
      const service = new IdentityExternalAuthService({
        repository: mock.repo,
        loginStore: mockLoginStore,
        verificationConfig,
        accessTokenSigner: dummySigner,
        logger: createLogger({ service: "test-auth", environment: "test", level: "info" }),
      });

      const token = await createGoogleToken({ sub: "google-existing-1" });
      const first = await service.socialLogin("GOOGLE", token);
      expect(first.isNewUser).toBe(true);

      const second = await service.socialLogin("GOOGLE", token);
      expect(second.isNewUser).toBe(false);
      expect(second.user.userId).toBe(first.user.userId);
    });

    it("enforces safe account linking: rejects automatic merge when email exists on a local account", async () => {
      const mock = createMockRepo();
      // Simulate existing local password account
      mock.credentialsByEmail.set("student.google@example.com", {
        userId: randomUUID(),
        status: "ACTIVE",
      });

      const service = new IdentityExternalAuthService({
        repository: mock.repo,
        loginStore: mockLoginStore,
        verificationConfig,
        accessTokenSigner: dummySigner,
        logger: createLogger({ service: "test-auth", environment: "test", level: "info" }),
      });

      const token = await createGoogleToken({ sub: "google-unlinked-sub" });
      await expect(service.socialLogin("GOOGLE", token)).rejects.toMatchObject({
        code: "ACCOUNT_LINK_REQUIRED",
        status: 409,
      });
    });

    it("allows user to link Google to their account and lists connected login methods", async () => {
      const mock = createMockRepo();
      const userId = randomUUID();
      mock.users.set(userId, {
        userId,
        emailMasked: "m***@example.com",
        displayName: "Existing User",
        role: "STUDENT",
        status: "ACTIVE",
        lecturerVerified: false,
        tokenVersion: 1,
        profileVersion: 1,
        credentialVersion: 1, // Has password
      });

      const service = new IdentityExternalAuthService({
        repository: mock.repo,
        loginStore: mockLoginStore,
        verificationConfig,
        accessTokenSigner: dummySigner,
        logger: createLogger({ service: "test-auth", environment: "test", level: "info" }),
      });

      const token = await createGoogleToken({ sub: "google-link-sub" });
      const linkResult = await service.linkIdentity(userId, "GOOGLE", token);
      expect(linkResult.linked).toBe(true);

      const identities = await service.listIdentities(userId);
      expect(identities.hasPassword).toBe(true);
      expect(identities.linkedProviders).toHaveLength(1);
      expect(identities.linkedProviders[0]?.provider).toBe("GOOGLE");
    });

    it("prevents unlinking the last remaining login method", async () => {
      const mock = createMockRepo();
      const userId = randomUUID();
      // User has NO password, only Apple login
      mock.users.set(userId, {
        userId,
        emailMasked: "a***@privaterelay.appleid.com",
        displayName: "Social Only User",
        role: "STUDENT",
        status: "ACTIVE",
        lecturerVerified: false,
        tokenVersion: 1,
        profileVersion: 1,
        credentialVersion: 0, // No password
      });
      mock.userIdentities.set(userId, [
        {
          provider: "APPLE",
          providerSubject: "apple-sole-sub",
          emailAtLinkTime: "a@privaterelay.appleid.com",
          linkedAt: new Date(),
        },
      ]);
      mock.externalIdentities.set("APPLE:apple-sole-sub", {
        provider: "APPLE",
        providerSubject: "apple-sole-sub",
        userId,
        emailAtLinkTime: "a@privaterelay.appleid.com",
        createdAt: new Date(),
        lastLoginAt: new Date(),
      });

      const service = new IdentityExternalAuthService({
        repository: mock.repo,
        loginStore: mockLoginStore,
        verificationConfig,
        accessTokenSigner: dummySigner,
        logger: createLogger({ service: "test-auth", environment: "test", level: "info" }),
      });

      await expect(service.unlinkIdentity(userId, "APPLE")).rejects.toMatchObject({
        code: "LAST_LOGIN_METHOD_REQUIRED",
        status: 400,
      });
    });

    it("allows unlinking a social provider when another method exists", async () => {
      const mock = createMockRepo();
      const userId = randomUUID();
      // User has password AND Apple login
      mock.users.set(userId, {
        userId,
        emailMasked: "u***@example.com",
        displayName: "Multi Auth User",
        role: "STUDENT",
        status: "ACTIVE",
        lecturerVerified: false,
        tokenVersion: 1,
        profileVersion: 1,
        credentialVersion: 1, // Has password
      });
      mock.userIdentities.set(userId, [
        {
          provider: "APPLE",
          providerSubject: "apple-sub-multi",
          emailAtLinkTime: "u@example.com",
          linkedAt: new Date(),
        },
      ]);
      mock.externalIdentities.set("APPLE:apple-sub-multi", {
        provider: "APPLE",
        providerSubject: "apple-sub-multi",
        userId,
        emailAtLinkTime: "u@example.com",
        createdAt: new Date(),
        lastLoginAt: new Date(),
      });

      const service = new IdentityExternalAuthService({
        repository: mock.repo,
        loginStore: mockLoginStore,
        verificationConfig,
        accessTokenSigner: dummySigner,
        logger: createLogger({ service: "test-auth", environment: "test", level: "info" }),
      });

      const unlinkResult = await service.unlinkIdentity(userId, "APPLE");
      expect(unlinkResult.unlinked).toBe(true);
      expect(unlinkResult.provider).toBe("APPLE");

      const identities = await service.listIdentities(userId);
      expect(identities.hasPassword).toBe(true);
      expect(identities.linkedProviders).toHaveLength(0);
    });
  });
});
