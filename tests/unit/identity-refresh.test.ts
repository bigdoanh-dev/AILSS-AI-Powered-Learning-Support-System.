import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CanonicalLoginUser, LoginSession } from "../../apps/identity-service/src/login/model.js";
import {
  fingerprintRefreshToken,
  newRefreshCredential,
  refreshTokenMatchesFingerprint,
} from "../../apps/identity-service/src/login/tokens.js";
import { parseRefreshRequest, type RefreshCommand } from "../../apps/identity-service/src/refresh/model.js";
import {
  RefreshService,
  type IdentityRefreshStore,
  type RefreshAccessTokenInput,
} from "../../apps/identity-service/src/refresh/service.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";

const now = new Date("2026-08-29T00:00:00.123Z");

describe("P7.3 IDN-03 request and fingerprint proof", () => {
  it("accepts only sessionId and one 256-bit base64url token", () => {
    const fixture = refreshFixture();
    expect(
      parseRefreshRequest({ sessionId: fixture.session.sessionId, refreshToken: fixture.rawToken }),
    ).toEqual({
      sessionId: fixture.session.sessionId,
      refreshToken: fixture.rawToken,
    });
    expect(() =>
      parseRefreshRequest({
        sessionId: fixture.session.sessionId,
        refreshToken: fixture.rawToken,
        userId: randomUUID(),
      }),
    ).toThrow();
    expect(() => parseRefreshRequest({ sessionId: "not-a-uuid", refreshToken: fixture.rawToken })).toThrow();
    expect(() =>
      parseRefreshRequest({ sessionId: fixture.session.sessionId, refreshToken: "short" }),
    ).toThrow();
  });

  it("derives SHA-256 hex and compares fixed fingerprints with timing-safe primitive", () => {
    const fixture = refreshFixture();
    expect(fixture.session.refreshFingerprint).toBe(fingerprintRefreshToken(fixture.rawToken));
    expect(refreshTokenMatchesFingerprint(fixture.rawToken, fixture.session.refreshFingerprint)).toBe(true);
    expect(
      refreshTokenMatchesFingerprint(newRefreshCredential().rawToken, fixture.session.refreshFingerprint),
    ).toBe(false);
    expect(refreshTokenMatchesFingerprint(fixture.rawToken, "malformed")).toBe(false);
  });
});

describe("P7.3 IDN-03 refresh orchestration", () => {
  it("rotates one generation/version, preserves the absolute family expiry, and signs bound claims", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    let signed: RefreshAccessTokenInput | undefined;
    const service = makeService(store, {
      signer: async (input) => {
        signed = input;
        return `signed.${input.sessionId}`;
      },
    });
    const result = await service.refresh(command(fixture));

    expect(result.session).toMatchObject({
      sessionId: fixture.session.sessionId,
      userId: fixture.session.userId,
      tokenFamilyId: fixture.session.tokenFamilyId,
      generation: 1,
      version: 2,
      state: "ACTIVE",
    });
    expect(result.session.expiresAt.getTime()).toBe(fixture.session.expiresAt.getTime());
    expect(result.session.createdAt.getTime()).toBe(fixture.session.createdAt.getTime());
    expect(result.refreshToken).not.toBe(fixture.rawToken);
    expect(result.session.refreshFingerprint).toBe(fingerprintRefreshToken(result.refreshToken));
    expect(JSON.stringify(store.session)).not.toContain(result.refreshToken);
    expect(signed).toEqual({
      subject: fixture.session.userId,
      roles: ["STUDENT"],
      sessionId: fixture.session.sessionId,
      tokenVersion: 1,
      issuedAtSeconds: Math.floor(now.getTime() / 1_000),
    });
    expect(result.accessExpiresAt.getTime()).toBe((Math.floor(now.getTime() / 1_000) + 900) * 1_000);
  });

  it("uses one generic error for missing, invalid, expired, revoked, and denied-account flows", async () => {
    const missingFixture = refreshFixture();
    const missingStore = new MemoryRefreshStore(undefined);
    const missing = await captureError(makeService(missingStore).refresh(command(missingFixture)));

    const invalidFixture = refreshFixture();
    const invalidStore = new MemoryRefreshStore(invalidFixture.session);
    const invalid = await captureError(
      makeService(invalidStore).refresh({
        ...command(invalidFixture),
        refreshToken: newRefreshCredential().rawToken,
      }),
    );

    const expiredFixture = refreshFixture({ expiresAt: new Date(now.getTime() - 1) });
    const expired = await captureError(
      makeService(new MemoryRefreshStore(expiredFixture.session)).refresh(command(expiredFixture)),
    );

    const revokedFixture = refreshFixture({ state: "REVOKED", revokedAt: new Date(now), version: 2 });
    const revoked = await captureError(
      makeService(new MemoryRefreshStore(revokedFixture.session)).refresh(command(revokedFixture)),
    );

    const deniedFixture = refreshFixture();
    const deniedStore = new MemoryRefreshStore(deniedFixture.session);
    deniedStore.user = { ...deniedStore.user, status: "SUSPENDED" };
    const denied = await captureError(makeService(deniedStore).refresh(command(deniedFixture)));

    const publicShape = (value: ErrorShape) => ({
      code: value.code,
      status: value.status,
      message: value.message,
      retryable: value.retryable,
      details: value.details,
    });
    expect([invalid, expired, revoked, denied].map(publicShape)).toEqual([
      publicShape(missing),
      publicShape(missing),
      publicShape(missing),
      publicShape(missing),
    ]);
    expect(publicShape(missing)).toEqual({
      code: "INVALID_REFRESH_CREDENTIALS",
      status: 401,
      message: "Invalid refresh credentials",
      retryable: false,
      details: [],
    });
    expect(invalidStore.session).toMatchObject({ state: "REVOKED", version: 2 });
    expect(deniedStore.session).toMatchObject({ state: "REVOKED", version: 2 });
  });

  it("rejects expiry at the exact current instant and accepts one millisecond before expiry", async () => {
    const boundaryFixture = refreshFixture({ expiresAt: new Date(now) });
    await expect(
      makeService(new MemoryRefreshStore(boundaryFixture.session)).refresh(command(boundaryFixture)),
    ).rejects.toMatchObject({ code: "INVALID_REFRESH_CREDENTIALS", status: 401 });

    const liveFixture = refreshFixture({ expiresAt: new Date(now.getTime() + 1) });
    const result = await makeService(new MemoryRefreshStore(liveFixture.session)).refresh(
      command(liveFixture),
    );
    expect(result.session).toMatchObject({ generation: 1, version: 2, state: "ACTIVE" });
    expect(result.session.expiresAt.getTime()).toBe(now.getTime() + 1);
  });

  it("revokes suspected reuse once and keeps repeated reuse idempotent", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    const service = makeService(store);
    const replay = { ...command(fixture), refreshToken: newRefreshCredential().rawToken };
    await expect(service.refresh(replay)).rejects.toMatchObject({ code: "INVALID_REFRESH_CREDENTIALS" });
    expect(store.session).toMatchObject({ state: "REVOKED", version: 2 });
    await expect(service.refresh(replay)).rejects.toMatchObject({ code: "INVALID_REFRESH_CREDENTIALS" });
    expect(store.session).toMatchObject({ state: "REVOKED", version: 2 });
  });

  it("fails closed and revokes the family when session authVersion is stale or missing", async () => {
    for (const authVersion of [0, null] as const) {
      const fixture = refreshFixture({ authVersion });
      const store = new MemoryRefreshStore(fixture.session);
      await expect(makeService(store).refresh(command(fixture))).rejects.toMatchObject({
        code: "INVALID_REFRESH_CREDENTIALS",
        status: 401,
      });
      expect(store.session).toMatchObject({ state: "REVOKED", version: 2, authVersion });
    }
  });

  it("does not mutate the session when access signing fails", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    const service = makeService(store, {
      signer: async () => {
        throw new Error("signing key unavailable");
      },
    });
    await expect(service.refresh(command(fixture))).rejects.toMatchObject({
      code: "TOKEN_SIGNING_UNAVAILABLE",
      status: 503,
    });
    expect(store.session).toEqual(fixture.session);
    expect(store.rotateCalls).toBe(0);
  });

  it("recovers an acknowledged-lost rotation only when exact next state exists", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    store.rotateMode = "commit_then_throw";
    const result = await makeService(store).refresh(command(fixture));
    expect(result.session).toMatchObject({ generation: 1, version: 2, state: "ACTIVE" });
  });

  it("fails without credentials when an ambiguous rotation cannot be resolved", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    store.rotateMode = "throw_before_commit";
    await expect(makeService(store).refresh(command(fixture))).rejects.toMatchObject({
      code: "ROTATION_PERSISTENCE_UNAVAILABLE",
      status: 503,
    });
    expect(store.session).toEqual(fixture.session);
  });

  it("performs one bounded CAS retry when not-applied still reads the exact expected state", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    store.rotateMode = "not_applied_once";
    const result = await makeService(store).refresh(command(fixture));
    expect(result.session).toMatchObject({ generation: 1, version: 2 });
    expect(store.rotateCalls).toBe(2);
  });

  it("revokes the rotated family when account authorization changes before response", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    store.changeAuthorizationAfterRotate = true;
    await expect(makeService(store).refresh(command(fixture))).rejects.toMatchObject({
      code: "INVALID_REFRESH_CREDENTIALS",
      status: 401,
    });
    expect(store.session).toMatchObject({ generation: 1, state: "REVOKED", version: 3 });
  });

  it("cannot return a usable rotation when a password security epoch advances after the CAS", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    store.changeSecurityEpochAfterRotate = true;
    await expect(makeService(store).refresh(command(fixture))).rejects.toMatchObject({
      code: "INVALID_REFRESH_CREDENTIALS",
      status: 401,
    });
    expect(store.user).toMatchObject({ tokenVersion: 2, credentialVersion: 2 });
    expect(store.session).toMatchObject({ generation: 1, state: "REVOKED", version: 3, authVersion: 1 });
  });

  it("allows one concurrent issuance winner and revokes the family on the losing replay", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    const service = makeService(store);
    const settled = await Promise.allSettled([
      service.refresh(command(fixture)),
      service.refresh(command(fixture)),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(store.session).toMatchObject({ generation: 1, state: "REVOKED", version: 3 });
  });

  it("revokes generation N+1 when response loss retries generation N token", async () => {
    const fixture = refreshFixture();
    const store = new MemoryRefreshStore(fixture.session);
    const service = makeService(store);
    const rotated = await service.refresh(command(fixture));
    await expect(service.refresh(command(fixture))).rejects.toMatchObject({
      code: "INVALID_REFRESH_CREDENTIALS",
      status: 401,
    });
    expect(rotated.session).toMatchObject({ generation: 1, version: 2 });
    expect(store.session).toMatchObject({ generation: 1, state: "REVOKED", version: 3 });
  });
});

interface ServiceOverrides {
  readonly signer?: (input: RefreshAccessTokenInput) => Promise<string>;
}

function makeService(store: MemoryRefreshStore, overrides: ServiceOverrides = {}): RefreshService {
  return new RefreshService({
    store,
    logger: createLogger({ service: "identity-refresh-test", environment: "test", level: "fatal" }),
    metrics: createMetrics(`identity-refresh-test-${randomUUID().replaceAll("-", "")}`),
    accessTokenTtlSeconds: 900,
    accessTokenSigner: overrides.signer ?? (async (input) => `signed.${input.sessionId}`),
    now: () => new Date(now),
  });
}

function command(fixture: RefreshFixture): RefreshCommand {
  return {
    sessionId: fixture.session.sessionId,
    refreshToken: fixture.rawToken,
    requestId: randomUUID(),
    correlationId: randomUUID(),
  };
}

interface RefreshFixture {
  readonly rawToken: string;
  readonly session: LoginSession;
}

function refreshFixture(overrides: Partial<LoginSession> = {}): RefreshFixture {
  const credential = newRefreshCredential();
  const session: LoginSession = {
    sessionId: randomUUID(),
    userId: randomUUID(),
    tokenFamilyId: randomUUID(),
    refreshFingerprint: credential.fingerprint,
    generation: 0,
    state: "ACTIVE",
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    revokedAt: null,
    version: 1,
    authVersion: 1,
    createdAt: new Date(now.getTime() - 60_000),
    ...overrides,
  };
  return { rawToken: credential.rawToken, session };
}

interface ErrorShape {
  readonly code: string;
  readonly status: number;
  readonly message: string;
  readonly retryable: boolean;
  readonly details: readonly unknown[];
}

async function captureError(operation: Promise<unknown>): Promise<ErrorShape> {
  try {
    await operation;
    throw new Error("Expected operation to fail");
  } catch (error) {
    return error as ErrorShape;
  }
}

class MemoryRefreshStore implements IdentityRefreshStore {
  public session: LoginSession | undefined;
  public user: CanonicalLoginUser;
  public rotateMode: "normal" | "commit_then_throw" | "throw_before_commit" | "not_applied_once" = "normal";
  public rotateCalls = 0;
  public changeAuthorizationAfterRotate = false;
  public changeSecurityEpochAfterRotate = false;

  public constructor(session: LoginSession | undefined) {
    this.session = session;
    this.user = {
      userId: session?.userId ?? randomUUID(),
      displayName: "Learner",
      role: "STUDENT",
      status: "ACTIVE",
      lecturerVerified: false,
      tokenVersion: 1,
      credentialVersion: 1,
      normalizedEmail: "learner@example.test",
      securityOperationId: null,
      profileVersion: 1,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
  }

  public async getSession(sessionId: string): Promise<LoginSession | undefined> {
    return this.session?.sessionId === sessionId ? { ...this.session } : undefined;
  }

  public async getUser(userId: string): Promise<CanonicalLoginUser | undefined> {
    return this.user.userId === userId ? { ...this.user } : undefined;
  }

  public async rotateSession(input: {
    expected: LoginSession;
    nextRefreshFingerprint: string;
  }): Promise<boolean> {
    this.rotateCalls += 1;
    if (this.rotateMode === "throw_before_commit") throw new Error("write timeout");
    if (this.rotateMode === "not_applied_once" && this.rotateCalls === 1) return false;
    const current = this.session;
    if (
      !current ||
      current.state !== "ACTIVE" ||
      current.generation !== input.expected.generation ||
      current.version !== input.expected.version ||
      current.refreshFingerprint !== input.expected.refreshFingerprint
    ) {
      return false;
    }
    this.session = {
      ...current,
      refreshFingerprint: input.nextRefreshFingerprint,
      generation: current.generation + 1,
      version: current.version + 1,
    };
    if (this.changeAuthorizationAfterRotate) {
      this.user = { ...this.user, status: "SUSPENDED", tokenVersion: 2 };
    }
    if (this.changeSecurityEpochAfterRotate) {
      this.user = { ...this.user, tokenVersion: 2, credentialVersion: 2 };
    }
    if (this.rotateMode === "commit_then_throw") throw new Error("acknowledgement lost");
    return true;
  }

  public async revokeSession(sessionId: string, expectedVersion: number, revokedAt: Date): Promise<boolean> {
    const current = this.session;
    if (
      !current ||
      current.sessionId !== sessionId ||
      current.state !== "ACTIVE" ||
      current.version !== expectedVersion
    ) {
      return false;
    }
    this.session = { ...current, state: "REVOKED", revokedAt, version: current.version + 1 };
    return true;
  }
}
