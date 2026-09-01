import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LoginSession } from "../../apps/identity-service/src/login/model.js";
import { LogoutService, type IdentityLogoutStore } from "../../apps/identity-service/src/logout/service.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";

const now = new Date("2026-08-29T12:00:00.000Z");

describe("P7.4 IDN-04 current-session logout", () => {
  it("conditionally revokes ACTIVE once and keeps repeated logout idempotent", async () => {
    const store = new MemoryLogoutStore(session());
    const service = makeService(store);
    await expect(service.logout(command(requireSession(store)))).resolves.toEqual({ outcome: "revoked" });
    expect(store.session).toMatchObject({ state: "REVOKED", version: 5, generation: 2 });
    const revokedAt = store.session?.revokedAt;
    await expect(service.logout(command(requireSession(store)))).resolves.toEqual({ outcome: "idempotent" });
    expect(store.session).toMatchObject({ state: "REVOKED", version: 5, revokedAt });
    expect(store.revokeAttempts).toBe(1);
  });

  it("denies missing and ownership-mismatched canonical sessions without mutation", async () => {
    const missing = new MemoryLogoutStore(undefined);
    await expect(makeService(missing).logout(command(session()))).rejects.toMatchObject({
      code: "INVALID_ACCESS_TOKEN",
      status: 401,
    });
    const owned = session();
    const mismatch = new MemoryLogoutStore(owned);
    await expect(
      makeService(mismatch).logout({ ...command(owned), userId: randomUUID() }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN", status: 401 });
    expect(mismatch.session).toMatchObject({ state: "ACTIVE", version: 4 });
    expect(mismatch.revokeAttempts).toBe(0);
  });

  it("treats an expired session as terminal without creating a revocation mutation", async () => {
    const expired = session({ expiresAt: new Date(now.getTime() - 1) });
    const store = new MemoryLogoutStore(expired);
    await expect(makeService(store).logout(command(expired))).resolves.toEqual({ outcome: "expired" });
    expect(store.session).toMatchObject({ state: "ACTIVE", version: 4, revokedAt: null });
    expect(store.revokeAttempts).toBe(0);
  });

  it("converges two concurrent logout requests to one version increment", async () => {
    const initial = session();
    const store = new MemoryLogoutStore(initial);
    const service = makeService(store);
    const results = await Promise.all([service.logout(command(initial)), service.logout(command(initial))]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["idempotent", "revoked"]);
    expect(store.session).toMatchObject({ state: "REVOKED", version: 5 });
  });

  it("re-reads and performs one bounded retry when refresh wins the first CAS", async () => {
    const initial = session();
    const store = new MemoryLogoutStore(initial);
    store.rotateBeforeFirstRevoke = true;
    await expect(makeService(store).logout(command(initial))).resolves.toEqual({ outcome: "revoked" });
    expect(store.session).toMatchObject({ state: "REVOKED", generation: 3, version: 6 });
    expect(store.revokeAttempts).toBe(2);
  });

  it("recovers committed ambiguous LWT and retries once when the old state is proven", async () => {
    const committedStore = new MemoryLogoutStore(session());
    committedStore.throwAfterCommit = true;
    await expect(
      makeService(committedStore).logout(command(requireSession(committedStore))),
    ).resolves.toEqual({ outcome: "revoked" });
    expect(committedStore.session).toMatchObject({ state: "REVOKED", version: 5 });

    const retryStore = new MemoryLogoutStore(session());
    retryStore.throwBeforeCommit = true;
    await expect(makeService(retryStore).logout(command(requireSession(retryStore)))).resolves.toEqual({
      outcome: "revoked",
    });
    expect(retryStore.session).toMatchObject({ state: "REVOKED", version: 5 });
    expect(retryStore.revokeAttempts).toBe(2);
  });
});

class MemoryLogoutStore implements IdentityLogoutStore {
  public session: LoginSession | undefined;
  public revokeAttempts = 0;
  public rotateBeforeFirstRevoke = false;
  public throwAfterCommit = false;
  public throwBeforeCommit = false;

  public constructor(initial: LoginSession | undefined) {
    this.session = initial ? clone(initial) : undefined;
  }

  public async getSession(): Promise<LoginSession | undefined> {
    return this.session ? clone(this.session) : undefined;
  }

  public async revokeSession(_sessionId: string, expectedVersion: number, revokedAt: Date): Promise<boolean> {
    this.revokeAttempts += 1;
    if (this.rotateBeforeFirstRevoke && this.revokeAttempts === 1 && this.session) {
      this.session = {
        ...this.session,
        generation: this.session.generation + 1,
        version: this.session.version + 1,
      };
      return false;
    }
    if (this.throwBeforeCommit && this.revokeAttempts === 1) throw new Error("timeout-before-commit");
    if (!this.session || this.session.state !== "ACTIVE" || this.session.version !== expectedVersion) {
      return false;
    }
    this.session = {
      ...this.session,
      state: "REVOKED",
      revokedAt,
      version: expectedVersion + 1,
    };
    if (this.throwAfterCommit && this.revokeAttempts === 1) throw new Error("timeout-after-commit");
    return true;
  }
}

function makeService(store: IdentityLogoutStore): LogoutService {
  return new LogoutService({
    store,
    logger: createLogger({ service: "identity-service", environment: "test", level: "silent" }),
    metrics: createMetrics("identity-service-test"),
    now: () => new Date(now),
  });
}

function session(overrides: Partial<LoginSession> = {}): LoginSession {
  return {
    sessionId: randomUUID(),
    userId: randomUUID(),
    tokenFamilyId: randomUUID(),
    refreshFingerprint: "a".repeat(64),
    generation: 2,
    state: "ACTIVE",
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    version: 4,
    authVersion: 1,
    createdAt: new Date(now.getTime() - 60_000),
    ...overrides,
  };
}

function command(value: LoginSession) {
  return {
    userId: value.userId,
    roles: ["STUDENT"],
    sessionId: value.sessionId,
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: Math.floor(now.getTime() / 1_000),
    expiresAt: Math.floor(now.getTime() / 1_000) + 30,
    requestId: randomUUID(),
  };
}

function clone(value: LoginSession): LoginSession {
  return {
    ...value,
    expiresAt: new Date(value.expiresAt),
    revokedAt: value.revokedAt ? new Date(value.revokedAt) : null,
    createdAt: new Date(value.createdAt),
  };
}

function requireSession(store: MemoryLogoutStore): LoginSession {
  if (!store.session) throw new Error("Test session is unavailable");
  return store.session;
}
