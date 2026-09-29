import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { CanonicalLoginUser } from "../login/model.js";
import type { IdentityPasswordRepository } from "../password/repository.js";
import {
  PASSWORD_IDEMPOTENCY_TTL_SECONDS,
  parsePasswordMetadata,
  passwordChangeScope,
  type PasswordChangeMetadata,
  type PasswordCredential,
} from "../password/model.js";
import { hashPassword, verifyPassword } from "../registration/password.js";
import { idempotencyKeyHash } from "../registration/model.js";
import type { IdempotencyRecord } from "../registration/repository.js";
import {
  PASSWORD_RESET_MAX_ATTEMPTS,
  PASSWORD_RESET_RESEND_SECONDS,
  PASSWORD_RESET_TTL_SECONDS,
  type PasswordResetChallenge,
} from "./model.js";
import type { IdentityPasswordResetRepository } from "./repository.js";
import type { PasswordResetMailer } from "./mailer.js";

const COMPLETION_STATES = [
  "IN_PROGRESS",
  "PREPARED",
  "USER_EPOCH_ADVANCED",
  "CREDENTIAL_UPDATED",
  "COMPLETE",
] as const;

export interface PasswordResetLogger {
  info(input: object, message: string): void;
  error(input: object, message: string): void;
}

export class PasswordResetService {
  public constructor(
    private readonly passwords: IdentityPasswordRepository,
    private readonly resets: IdentityPasswordResetRepository,
    private readonly mailer: PasswordResetMailer,
    private readonly hmacKey: string,
    private readonly logger: PasswordResetLogger,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(hmacKey, "utf8") < 32) {
      throw new Error("Password reset HMAC key must contain at least 32 bytes");
    }
  }

  public async requestCode(input: { email: string; requestId: string }): Promise<{ accepted: true }> {
    if (!this.mailer.isConfigured) {
      throw new AppError(
        "PASSWORD_RESET_EMAIL_UNAVAILABLE",
        503,
        "Password reset email is not configured",
        true,
      );
    }

    const credential = await this.passwords.getCredential(input.email);
    if (!credential || credential.status !== "ACTIVE") return { accepted: true };
    const user = await this.passwords.getUser(credential.userId);
    if (
      !user ||
      user.status !== "ACTIVE" ||
      user.normalizedEmail !== input.email ||
      user.credentialVersion !== credential.credentialVersion
    ) {
      return { accepted: true };
    }

    const now = this.now();
    const existing = await this.resets.getChallenge(input.email);
    if (existing && now.getTime() - existing.sentAt.getTime() < PASSWORD_RESET_RESEND_SECONDS * 1_000) {
      return { accepted: true };
    }

    const code = randomInt(100_000, 1_000_000).toString();
    const challenge: PasswordResetChallenge = {
      normalizedEmail: input.email,
      userId: user.userId,
      otpHmac: this.#otpHmac(input.email, code, now),
      verifiedTokenHmac: "",
      tokenVersion: user.tokenVersion,
      credentialVersion: user.credentialVersion,
      attempts: 0,
      issuedAt: now,
      sentAt: now,
      expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_SECONDS * 1_000),
    };

    const stored = existing
      ? await this.resets.replaceChallenge({
          challenge,
          expectedOtpHmac: existing.otpHmac,
          expectedSentAt: existing.sentAt,
        })
      : await this.resets.insertChallenge(challenge);
    if (!stored) return { accepted: true };

    try {
      await this.mailer.sendResetCode(input.email, code, PASSWORD_RESET_TTL_SECONDS / 60);
    } catch (error) {
      await this.resets.deleteChallenge(input.email, challenge.otpHmac).catch(() => {});
      this.logger.error(
        {
          operation: "identity.password_reset.email",
          requestId: input.requestId,
          errorCode: "PASSWORD_RESET_EMAIL_DELIVERY_FAILED",
          err: safeError(error),
        },
        "password reset code email delivery failed",
      );
      // Keep responses indistinguishable for known and unknown accounts.
      return { accepted: true };
    }

    this.logger.info(
      { operation: "identity.password_reset.request", requestId: input.requestId },
      "password reset code requested",
    );
    return { accepted: true };
  }

  public async verifyCode(input: { email: string; code: string }): Promise<{ resetToken: string }> {
    const challenge = await this.resets.getChallenge(input.email);
    const now = this.now();
    if (
      !challenge ||
      challenge.expiresAt.getTime() <= now.getTime() ||
      challenge.attempts >= PASSWORD_RESET_MAX_ATTEMPTS
    ) {
      throw invalidResetCode();
    }

    const expectedOtpHmac = this.#otpHmac(input.email, input.code, challenge.issuedAt);
    if (!safeHexEqual(challenge.otpHmac, expectedOtpHmac)) {
      await this.resets.incrementAttempts({
        email: input.email,
        expectedOtpHmac: challenge.otpHmac,
        expectedAttempts: challenge.attempts,
      });
      throw invalidResetCode();
    }

    const [user, credential] = await Promise.all([
      this.passwords.getUser(challenge.userId),
      this.passwords.getCredential(input.email),
    ]);
    if (!sameChallengeAccount(challenge, user, credential)) throw invalidResetCode();

    const resetToken = randomBytes(32).toString("base64url");
    const resetTokenHmac = this.#tokenHmac(input.email, resetToken);
    const applied = await this.resets.setVerifiedToken({
      email: input.email,
      expectedOtpHmac: challenge.otpHmac,
      expectedAttempts: challenge.attempts,
      expectedIssuedAt: challenge.issuedAt,
      verifiedTokenHmac: resetTokenHmac,
    });
    if (!applied) throw invalidResetCode();
    return { resetToken };
  }

  public async complete(input: {
    email: string;
    resetToken: string;
    newPassword: string;
    requestId: string;
  }): Promise<{ passwordReset: true; replayed: boolean }> {
    const challenge = await this.resets.getChallenge(input.email);
    if (
      !challenge ||
      challenge.expiresAt.getTime() <= this.now().getTime() ||
      !safeHexEqual(challenge.verifiedTokenHmac, this.#tokenHmac(input.email, input.resetToken))
    ) {
      throw invalidResetToken();
    }

    const scope = passwordChangeScope(challenge.userId);
    const tokenHmac = this.#tokenHmac(input.email, input.resetToken);
    const keyHash = idempotencyKeyHash(tokenHmac);
    const requestFingerprint = this.#completionFingerprint(
      challenge.userId,
      input.email,
      tokenHmac,
      input.newPassword,
    );
    let record = await this.passwords.getIdempotency(scope, keyHash, tokenHmac);
    let metadata: PasswordChangeMetadata | undefined;
    let replayed = false;

    if (record) {
      this.#requireMatching(record, challenge.userId, requestFingerprint);
      if (record.status === "FAILED") throw invalidResetToken();
      if (record.status === "COMPLETE") return { passwordReset: true, replayed: true };
      metadata = parsePasswordMetadata(record.requestChecksum);
      replayed = true;
    } else {
      const [user, credential] = await Promise.all([
        this.passwords.getUser(challenge.userId),
        this.passwords.getCredential(input.email),
      ]);
      if (!sameChallengeAccount(challenge, user, credential)) throw invalidResetToken();
      const createdAt = this.now();
      metadata = {
        schemaVersion: 1,
        requestFingerprint,
        expectedTokenVersion: user.tokenVersion,
        nextTokenVersion: user.tokenVersion + 1,
        expectedCredentialVersion: user.credentialVersion,
        nextCredentialVersion: user.credentialVersion + 1,
        updatedAt: createdAt.toISOString(),
      };
      const reservation = await this.passwords.beginIdempotency({
        scope,
        keyHash,
        idempotencyKey: tokenHmac,
        operationId: randomUUID(),
        userId: challenge.userId,
        requestFingerprint,
        createdAt,
        ttlSeconds: PASSWORD_IDEMPOTENCY_TTL_SECONDS,
      });
      record = reservation.record;
      replayed = !reservation.created;
      this.#requireMatching(record, challenge.userId, requestFingerprint);
      if (record.status === "FAILED") throw invalidResetToken();
      if (record.status === "COMPLETE") return { passwordReset: true, replayed: true };
      metadata = parsePasswordMetadata(record.requestChecksum) ?? metadata;
    }

    if (!metadata) {
      const [user, credential] = await Promise.all([
        this.passwords.getUser(challenge.userId),
        this.passwords.getCredential(input.email),
      ]);
      if (!sameChallengeAccount(challenge, user, credential)) throw invalidResetToken();
      metadata = {
        schemaVersion: 1,
        requestFingerprint,
        expectedTokenVersion: user.tokenVersion,
        nextTokenVersion: user.tokenVersion + 1,
        expectedCredentialVersion: user.credentialVersion,
        nextCredentialVersion: user.credentialVersion + 1,
        updatedAt: this.now().toISOString(),
      };
    }
    this.#requireMetadata(metadata, requestFingerprint);

    if (record.status === "IN_PROGRESS") {
      record = await this.#transition(record, "IN_PROGRESS", "PREPARED", metadata, scope, keyHash, tokenHmac);
    }
    record = await this.#advanceEpoch(record, metadata, challenge, input.email, scope, keyHash, tokenHmac);
    record = await this.#updateCredential(
      record,
      metadata,
      challenge,
      input.email,
      input.newPassword,
      scope,
      keyHash,
      tokenHmac,
    );
    record = await this.#transition(
      record,
      "CREDENTIAL_UPDATED",
      "COMPLETE",
      metadata,
      scope,
      keyHash,
      tokenHmac,
      200,
    );
    if (record.status !== "COMPLETE") throw resetUnavailable();
    this.logger.info(
      {
        operation: "identity.password_reset.complete",
        requestId: input.requestId,
        userId: challenge.userId,
        operationId: record.operationId,
        outcome: replayed ? "recovered" : "success",
      },
      "password reset completed",
    );
    return { passwordReset: true, replayed };
  }

  async #advanceEpoch(
    record: IdempotencyRecord,
    metadata: PasswordChangeMetadata,
    challenge: PasswordResetChallenge,
    email: string,
    scope: string,
    keyHash: number,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "USER_EPOCH_ADVANCED")) return record;
    if (record.status !== "PREPARED") throw resetUnavailable();
    let user = await this.passwords.getUser(challenge.userId);
    if (user && intendedEpoch(user, metadata, record.operationId)) {
      return this.#transition(
        record,
        "PREPARED",
        "USER_EPOCH_ADVANCED",
        metadata,
        scope,
        keyHash,
        idempotencyKey,
      );
    }
    const credential = await this.passwords.getCredential(email);
    if (!user || !credential || !sameChallengeAccount(challenge, user, credential)) {
      await this.#failConflict(record, metadata, scope, keyHash, idempotencyKey);
      throw invalidResetToken();
    }
    let applied = false;
    try {
      applied = await this.passwords.advanceUserSecurityEpoch({
        expected: user,
        operationId: record.operationId,
        updatedAt: new Date(metadata.updatedAt),
      });
    } catch {
      // Resolve an uncertain write by reading the canonical user row below.
    }
    user = await this.passwords.getUser(challenge.userId);
    if (!user || (!applied && !intendedEpoch(user, metadata, record.operationId))) {
      await this.#failConflict(record, metadata, scope, keyHash, idempotencyKey);
      throw invalidResetToken();
    }
    if (!intendedEpoch(user, metadata, record.operationId)) throw resetUnavailable();
    return this.#transition(
      record,
      "PREPARED",
      "USER_EPOCH_ADVANCED",
      metadata,
      scope,
      keyHash,
      idempotencyKey,
    );
  }

  async #updateCredential(
    record: IdempotencyRecord,
    metadata: PasswordChangeMetadata,
    challenge: PasswordResetChallenge,
    email: string,
    newPassword: string,
    scope: string,
    keyHash: number,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "CREDENTIAL_UPDATED")) return record;
    if (record.status !== "USER_EPOCH_ADVANCED") throw resetUnavailable();
    const user = await this.passwords.getUser(challenge.userId);
    let credential = await this.passwords.getCredential(email);
    if (!user || !intendedEpoch(user, metadata, record.operationId) || !credential) {
      throw resetUnavailable();
    }
    if (
      credential.credentialVersion === metadata.nextCredentialVersion &&
      credential.securityOperationId === record.operationId
    ) {
      if (!(await verifyPassword(credential.passwordHash, newPassword))) throw invalidResetToken();
      return this.#transition(
        record,
        "USER_EPOCH_ADVANCED",
        "CREDENTIAL_UPDATED",
        metadata,
        scope,
        keyHash,
        idempotencyKey,
      );
    }
    if (
      credential.userId !== challenge.userId ||
      credential.status !== "ACTIVE" ||
      credential.credentialVersion !== metadata.expectedCredentialVersion
    ) {
      await this.#failConflict(record, metadata, scope, keyHash, idempotencyKey);
      throw invalidResetToken();
    }

    const passwordHash = await hashPassword(newPassword);
    try {
      await this.passwords.updateCredential({
        normalizedEmail: email,
        expected: credential,
        passwordHash,
        operationId: record.operationId,
        updatedAt: new Date(metadata.updatedAt),
      });
    } catch {
      // Resolve an uncertain write by reading the credential row below.
    }
    credential = await this.passwords.getCredential(email);
    if (
      !credential ||
      credential.credentialVersion !== metadata.nextCredentialVersion ||
      credential.securityOperationId !== record.operationId ||
      !(await verifyPassword(credential.passwordHash, newPassword))
    ) {
      throw resetUnavailable();
    }
    return this.#transition(
      record,
      "USER_EPOCH_ADVANCED",
      "CREDENTIAL_UPDATED",
      metadata,
      scope,
      keyHash,
      idempotencyKey,
    );
  }

  async #transition(
    record: IdempotencyRecord,
    expectedStatus: string,
    nextStatus: string,
    metadata: PasswordChangeMetadata,
    scope: string,
    keyHash: number,
    idempotencyKey: string,
    resultCode = 0,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, nextStatus)) return record;
    await this.passwords.transitionIdempotency({
      scope,
      keyHash,
      idempotencyKey,
      operationId: record.operationId,
      expectedStatus,
      nextStatus,
      metadata,
      resultCode,
    });
    const current = await this.passwords.getIdempotency(scope, keyHash, idempotencyKey);
    if (
      !current ||
      current.operationId !== record.operationId ||
      !stateAtLeast(current.status, nextStatus) ||
      idempotencyFingerprint(current) !== metadata.requestFingerprint
    ) {
      throw resetUnavailable();
    }
    return current;
  }

  async #failConflict(
    record: IdempotencyRecord,
    metadata: PasswordChangeMetadata,
    scope: string,
    keyHash: number,
    idempotencyKey: string,
  ): Promise<void> {
    await this.passwords.transitionIdempotency({
      scope,
      keyHash,
      idempotencyKey,
      operationId: record.operationId,
      expectedStatus: record.status,
      nextStatus: "FAILED",
      metadata,
      resultCode: 409,
    });
  }

  #requireMatching(record: IdempotencyRecord, userId: string, fingerprint: string): void {
    if (record.resourceId !== userId || idempotencyFingerprint(record) !== fingerprint) {
      throw invalidResetToken();
    }
  }

  #requireMetadata(metadata: PasswordChangeMetadata, fingerprint: string): void {
    if (metadata.requestFingerprint !== fingerprint) throw invalidResetToken();
  }

  #completionFingerprint(userId: string, email: string, tokenHmac: string, password: string): string {
    return createHmac("sha256", this.hmacKey)
      .update("password-reset-completion\0", "utf8")
      .update(userId, "utf8")
      .update("\0", "utf8")
      .update(email, "utf8")
      .update("\0", "utf8")
      .update(tokenHmac, "utf8")
      .update("\0", "utf8")
      .update(password, "utf8")
      .digest("hex");
  }

  #otpHmac(email: string, code: string, issuedAt: Date): string {
    return createHmac("sha256", this.hmacKey)
      .update("password-reset-otp\0", "utf8")
      .update(email, "utf8")
      .update("\0", "utf8")
      .update(code, "utf8")
      .update("\0", "utf8")
      .update(issuedAt.toISOString(), "utf8")
      .digest("hex");
  }

  #tokenHmac(email: string, token: string): string {
    return createHmac("sha256", this.hmacKey)
      .update("password-reset-token\0", "utf8")
      .update(email, "utf8")
      .update("\0", "utf8")
      .update(token, "utf8")
      .digest("hex");
  }
}

function sameChallengeAccount(
  challenge: PasswordResetChallenge,
  user: CanonicalLoginUser | undefined,
  credential: PasswordCredential | undefined,
): user is CanonicalLoginUser {
  return Boolean(
    user &&
    credential &&
    user.userId === challenge.userId &&
    user.normalizedEmail === challenge.normalizedEmail &&
    user.status === "ACTIVE" &&
    credential.userId === user.userId &&
    credential.status === "ACTIVE" &&
    user.tokenVersion === challenge.tokenVersion &&
    user.credentialVersion === challenge.credentialVersion &&
    credential.credentialVersion === challenge.credentialVersion,
  );
}
function intendedEpoch(
  user: CanonicalLoginUser,
  metadata: PasswordChangeMetadata,
  operationId: string,
): boolean {
  return (
    user.tokenVersion === metadata.nextTokenVersion &&
    user.credentialVersion === metadata.nextCredentialVersion &&
    user.securityOperationId === operationId
  );
}
function idempotencyFingerprint(record: IdempotencyRecord): string {
  return parsePasswordMetadata(record.requestChecksum)?.requestFingerprint ?? record.requestChecksum;
}
function rank(status: string): number {
  return COMPLETION_STATES.indexOf(status as (typeof COMPLETION_STATES)[number]);
}
function stateAtLeast(current: string, target: string): boolean {
  const currentRank = rank(current);
  const targetRank = rank(target);
  return currentRank >= 0 && targetRank >= 0 && currentRank >= targetRank;
}
function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
function invalidResetCode(): AppError {
  return new AppError("INVALID_PASSWORD_RESET_CODE", 400, "The reset code is invalid or expired");
}
function invalidResetToken(): AppError {
  return new AppError(
    "INVALID_PASSWORD_RESET_TOKEN",
    400,
    "The password reset session is invalid or expired",
  );
}
function resetUnavailable(): AppError {
  return new AppError("PASSWORD_RESET_UNAVAILABLE", 503, "Password reset could not be completed", true);
}
