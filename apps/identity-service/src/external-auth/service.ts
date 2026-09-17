import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { Logger } from "pino";
import {
  verifyAppleIdToken,
  verifyGoogleIdToken,
  type SocialProvider,
  type SocialVerificationConfig,
  type VerifiedSocialIdentity,
} from "../../../../packages/security/src/index.js";
import type { LoginSession } from "../login/model.js";
import type { IdentityLoginStore } from "../login/service.js";
import { newLoginIdentifiers, SESSION_INITIAL_STATE } from "../login/model.js";
import { newRefreshCredential } from "../login/tokens.js";
import type {
  SocialLoginResult,
  UserIdentitiesSummary,
} from "./model.js";
import type { IdentityExternalAuthRepository, StoredUser } from "./repository.js";

export interface IdentityExternalAuthServiceOptions {
  readonly repository: IdentityExternalAuthRepository;
  readonly loginStore: IdentityLoginStore;
  readonly verificationConfig: SocialVerificationConfig;
  readonly accessTokenSigner: (input: {
    readonly subject: string;
    readonly roles: readonly string[];
    readonly sessionId: string;
    readonly tokenVersion: number;
    readonly issuedAtSeconds: number;
  }) => Promise<string>;
  readonly accessTokenTtlSeconds?: number;
  readonly refreshTokenTtlSeconds?: number;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export class IdentityExternalAuthService {
  readonly #repo: IdentityExternalAuthRepository;
  readonly #loginStore: IdentityLoginStore;
  readonly #verificationConfig: SocialVerificationConfig;
  readonly #accessTokenSigner: IdentityExternalAuthServiceOptions["accessTokenSigner"];
  readonly #accessTokenTtlSeconds: number;
  readonly #refreshTokenTtlSeconds: number;
  readonly #logger: Logger;
  readonly #now: () => Date;

  public constructor(options: IdentityExternalAuthServiceOptions) {
    this.#repo = options.repository;
    this.#loginStore = options.loginStore;
    this.#verificationConfig = options.verificationConfig;
    this.#accessTokenSigner = options.accessTokenSigner;
    this.#accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 900;
    this.#refreshTokenTtlSeconds = options.refreshTokenTtlSeconds ?? 2_592_000;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
  }

  public async verifyToken(
    provider: SocialProvider,
    idToken: string,
    clientProfile?: { readonly firstName?: string; readonly lastName?: string },
  ): Promise<VerifiedSocialIdentity> {
    if (provider === "GOOGLE") {
      return verifyGoogleIdToken(idToken, this.#verificationConfig);
    }
    return verifyAppleIdToken(idToken, this.#verificationConfig, clientProfile);
  }

  public async socialLogin(
    provider: SocialProvider,
    idToken: string,
    clientProfile?: { readonly firstName?: string; readonly lastName?: string },
  ): Promise<SocialLoginResult> {
    const verified = await this.verifyToken(provider, idToken, clientProfile);
    const now = this.#now();

    // 1. Check if (provider, providerSubject) exists in external_identity_by_provider_subject
    const existingLink = await this.#repo.findExternalIdentity(provider, verified.providerSubject);

    let user: StoredUser;
    let isNewUser = false;

    if (existingLink) {
      // Existing social identity: resolve user
      const foundUser = await this.#repo.findUserById(existingLink.userId);
      if (!foundUser) {
        throw new AppError("ACCOUNT_NOT_FOUND", 404, "User associated with this social account not found");
      }
      if (foundUser.status !== "ACTIVE") {
        throw new AppError("ACCOUNT_DENIED", 403, "This account is disabled or suspended");
      }
      user = foundUser;
      await this.#repo.updateLastLogin(provider, verified.providerSubject, now);
    } else {
      // Not linked yet. Check if email matches existing account to prevent blind merge!
      const normalizedEmail = verified.email.toLowerCase().trim();
      const existingCred = await this.#repo.findCredentialByEmail(normalizedEmail);

      if (existingCred) {
        // Safe Account Linking: reject blind merge!
        throw new AppError(
          "ACCOUNT_LINK_REQUIRED",
          409,
          "An account with this email already exists. Please log in with your credentials to connect this provider in Account Settings.",
        );
      }

      // No existing user with this email: provision new student account
      const newUserId = randomUUID();
      const displayName =
        verified.displayName ||
        (verified.givenName && verified.familyName
          ? `${verified.givenName} ${verified.familyName}`
          : verified.givenName || verified.familyName || normalizedEmail.split("@")[0] || "Học viên AILSS");

      user = await this.#repo.createSocialUser({
        userId: newUserId,
        email: normalizedEmail,
        displayName,
        provider,
        providerSubject: verified.providerSubject,
        ...(verified.displayName ? { profileSnapshot: JSON.stringify(verified) } : {}),
        now,
      });
      isNewUser = true;
    }

    // Issue AILSS session and JWT tokens
    const issuedAtSeconds = Math.floor(now.getTime() / 1_000);
    const identifiers = newLoginIdentifiers();
    const refresh = newRefreshCredential();
    const accessExpiresAt = new Date((issuedAtSeconds + this.#accessTokenTtlSeconds) * 1_000);
    const refreshExpiresAt = new Date(now.getTime() + this.#refreshTokenTtlSeconds * 1_000);

    const accessToken = await this.#accessTokenSigner({
      subject: user.userId,
      roles: [user.role],
      sessionId: identifiers.sessionId,
      tokenVersion: user.tokenVersion,
      issuedAtSeconds,
    });

    const session: LoginSession = {
      sessionId: identifiers.sessionId,
      userId: user.userId,
      tokenFamilyId: identifiers.tokenFamilyId,
      refreshFingerprint: refresh.fingerprint,
      generation: 0,
      state: SESSION_INITIAL_STATE,
      expiresAt: refreshExpiresAt,
      revokedAt: null,
      version: 1,
      authVersion: user.tokenVersion,
      createdAt: now,
    };

    await this.#loginStore.insertSession(session);

    return {
      accessToken,
      refreshToken: refresh.rawToken,
      tokenType: "Bearer",
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      user: {
        userId: user.userId,
        emailMasked: user.emailMasked,
        displayName: user.displayName,
        role: user.role,
        status: user.status,
        lecturerVerified: user.lecturerVerified,
      },
      isNewUser,
    };
  }

  public async listIdentities(userId: string): Promise<UserIdentitiesSummary> {
    const user = await this.#repo.findUserById(userId);
    if (!user) {
      throw new AppError("ACCOUNT_NOT_FOUND", 404, "User not found");
    }

    const linkedProviders = await this.#repo.findExternalIdentitiesByUser(userId);
    const hasPassword = Boolean(user.credentialVersion && user.credentialVersion > 0);

    return {
      userId,
      hasPassword,
      linkedProviders,
    };
  }

  public async linkIdentity(
    userId: string,
    provider: SocialProvider,
    idToken: string,
  ): Promise<{ readonly linked: true; readonly provider: SocialProvider; readonly email: string }> {
    const user = await this.#repo.findUserById(userId);
    if (!user || user.status !== "ACTIVE") {
      throw new AppError("ACCOUNT_DENIED", 403, "Account is invalid or disabled");
    }

    const verified = await this.verifyToken(provider, idToken);
    const existing = await this.#repo.findExternalIdentity(provider, verified.providerSubject);

    if (existing) {
      if (existing.userId === userId) {
        // Already linked to this user (idempotent)
        return { linked: true, provider, email: existing.emailAtLinkTime };
      }
      throw new AppError(
        "IDENTITY_ALREADY_LINKED",
        409,
        "This social account is already linked to another AILSS user.",
      );
    }

    const now = this.#now();
    await this.#repo.linkExternalIdentity(
      userId,
      provider,
      verified.providerSubject,
      verified.email,
      verified.displayName ? JSON.stringify(verified) : undefined,
      now,
    );

    this.#logger.info({ userId, provider, email: verified.email }, "External identity linked successfully");
    return { linked: true, provider, email: verified.email };
  }

  public async unlinkIdentity(
    userId: string,
    provider: SocialProvider,
  ): Promise<{ readonly unlinked: true; readonly provider: SocialProvider }> {
    const user = await this.#repo.findUserById(userId);
    if (!user) {
      throw new AppError("ACCOUNT_NOT_FOUND", 404, "User not found");
    }

    const linkedProviders = await this.#repo.findExternalIdentitiesByUser(userId);
    const targetLink = linkedProviders.find((p) => p.provider === provider);

    if (!targetLink) {
      throw new AppError("PROVIDER_NOT_LINKED", 404, `No ${provider} account is connected to this profile.`);
    }

    const hasPassword = Boolean(user.credentialVersion && user.credentialVersion > 0);
    const totalLoginMethods = (hasPassword ? 1 : 0) + linkedProviders.length;

    if (totalLoginMethods <= 1) {
      throw new AppError(
        "LAST_LOGIN_METHOD_REQUIRED",
        400,
        "Cannot disconnect your only login method. Please set a password or connect another login method first.",
      );
    }

    await this.#repo.unlinkExternalIdentity(userId, provider, targetLink.providerSubject);
    this.#logger.info({ userId, provider }, "External identity unlinked successfully");
    return { unlinked: true, provider };
  }
}
