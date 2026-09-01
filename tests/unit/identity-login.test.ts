import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseLoginRequest,
  type CanonicalLoginUser,
  type LoginCommand,
  type LoginCredential,
  type LoginSession,
} from "../../apps/identity-service/src/login/model.js";
import {
  LoginService,
  type IdentityLoginStore,
  type LoginAccessTokenInput,
} from "../../apps/identity-service/src/login/service.js";
import { newRefreshCredential } from "../../apps/identity-service/src/login/tokens.js";
import { hashPassword, verifyPassword } from "../../apps/identity-service/src/registration/password.js";
import { parseRegistrationRequest } from "../../apps/identity-service/src/registration/model.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";

const email = "learner@example.com";
const password = "correct horse battery staple";
const now = new Date("2026-08-28T10:00:00.123Z");

describe("P7.2 IDN-02 request and password verification", () => {
  it("reuses the exact registration email normalization and rejects mass assignment", () => {
    const rawEmail = " Learner@Example.COM ";
    const registered = parseRegistrationRequest({ email: rawEmail, password, displayName: "Learner" });
    const login = parseLoginRequest({ email: rawEmail, password });
    expect(login.email).toBe(registered.email);
    expect(login.email).toBe(email);
    expect(() => parseLoginRequest({ email, password, role: "ADMIN" })).toThrow();
    expect(() => parseLoginRequest({ email, password, sessionId: randomUUID() })).toThrow();
    expect(() => parseLoginRequest({ email, password: "x".repeat(129) })).toThrow();
  });

  it("uses library Argon2id verification for current and legacy P7.1 PHC encoding", async () => {
    const current = await hashPassword(password);
    expect(current).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/u);
    await expect(verifyPassword(current, password)).resolves.toBe(true);
    await expect(verifyPassword(current, "wrong password")).resolves.toBe(false);

    const legacy =
      "$argon2id$v=19$m=65536,t=3,p=4$tCnnaXw1I9tM4jBKk_gtnA$49hmfsGe1lX_R567Ql1YiGWc0oYdQvYAwF6ra00MlVY";
    await expect(verifyPassword(legacy, "legacy-compatible-password")).resolves.toBe(true);
    await expect(verifyPassword("not-a-phc", password)).rejects.toThrow();
  });

  it("generates 256-bit opaque refresh tokens and SHA-256 hex fingerprints", () => {
    const first = newRefreshCredential();
    const second = newRefreshCredential();
    expect(first.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(Buffer.from(first.rawToken, "base64url")).toHaveLength(32);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.fingerprint).toBe(createHash("sha256").update(first.rawToken).digest("hex"));
    expect(second.rawToken).not.toBe(first.rawToken);
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
});

describe("P7.2 IDN-02 login orchestration", () => {
  it("persists only the refresh fingerprint and builds the bound token claims", async () => {
    const store = seededStore();
    let signed: LoginAccessTokenInput | undefined;
    const service = makeService(store, {
      signer: async (input) => {
        signed = input;
        return `signed.${input.sessionId}`;
      },
    });
    const result = await service.login(command());

    expect(result.user.userId).toBe(store.user.userId);
    expect(result.session).toMatchObject({
      userId: store.user.userId,
      generation: 0,
      state: "ACTIVE",
      version: 1,
      revokedAt: null,
    });
    expect(signed).toEqual({
      subject: store.user.userId,
      roles: ["STUDENT"],
      sessionId: result.session.sessionId,
      tokenVersion: 1,
      issuedAtSeconds: Math.floor(now.getTime() / 1_000),
    });
    expect(result.accessExpiresAt.getTime()).toBe((Math.floor(now.getTime() / 1_000) + 900) * 1_000);
    expect(result.refreshExpiresAt.getTime()).toBe(now.getTime() + 2_592_000_000);
    const persisted = store.sessions.get(result.session.sessionId);
    expect(persisted?.refreshFingerprint).toBe(
      createHash("sha256").update(result.refreshToken).digest("hex"),
    );
    expect(JSON.stringify(persisted)).not.toContain(result.refreshToken);
    expect(JSON.stringify(persisted)).not.toContain(result.accessToken);
  });

  it("returns identical generic errors for unknown email, wrong password, and malformed PHC", async () => {
    const unknownStore = seededStore();
    unknownStore.credential = undefined;
    const unknownCalls: string[] = [];
    const unknownService = makeService(unknownStore, {
      verifier: async (hash) => {
        unknownCalls.push(hash);
        return false;
      },
    });
    const unknown = await captureError(unknownService.login(command()));

    const wrongCalls: string[] = [];
    const wrongService = makeService(seededStore(), {
      verifier: async (hash) => {
        wrongCalls.push(hash);
        return false;
      },
    });
    const wrong = await captureError(wrongService.login(command()));

    const malformedCalls: string[] = [];
    const malformedStore = seededStore();
    const malformedCredential = malformedStore.credential;
    if (!malformedCredential) throw new Error("Malformed credential fixture is missing");
    malformedStore.credential = { ...malformedCredential, passwordHash: "malformed" };
    const malformedService = makeService(malformedStore, {
      verifier: async (hash) => {
        malformedCalls.push(hash);
        if (hash === "malformed") throw new Error("Decoding failed");
        return false;
      },
    });
    const malformed = await captureError(malformedService.login(command()));

    const publicShape = (value: ErrorShape) => ({
      code: value.code,
      status: value.status,
      message: value.message,
      retryable: value.retryable,
      details: value.details,
    });
    expect(publicShape(unknown)).toEqual(publicShape(wrong));
    expect(publicShape(malformed)).toEqual(publicShape(wrong));
    expect(publicShape(wrong)).toEqual({
      code: "INVALID_CREDENTIALS",
      status: 401,
      message: "Invalid email or password",
      retryable: false,
      details: [],
    });
    expect(unknownCalls).toEqual(["dummy-hash"]);
    expect(wrongCalls).toEqual(["stored-hash"]);
    expect(malformedCalls).toEqual(["malformed", "dummy-hash"]);
  });

  it("denies an inactive canonical account before signing or session persistence", async () => {
    const store = seededStore();
    store.user = { ...store.user, status: "SUSPENDED" };
    let signCalls = 0;
    const service = makeService(store, {
      signer: async () => {
        signCalls += 1;
        return "unexpected";
      },
    });
    await expect(service.login(command())).rejects.toMatchObject({
      code: "LOGIN_NOT_ALLOWED",
      status: 403,
    });
    expect(signCalls).toBe(0);
    expect(store.sessions.size).toBe(0);
  });

  it("fails closed when canonical and credential versions or operation markers diverge", async () => {
    const versionStore = seededStore();
    versionStore.user = { ...versionStore.user, credentialVersion: 2 };
    await expect(makeService(versionStore).login(command())).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    });
    expect(versionStore.sessions.size).toBe(0);

    const markerStore = seededStore();
    markerStore.user = { ...markerStore.user, securityOperationId: randomUUID() };
    await expect(makeService(markerStore).login(command())).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      status: 401,
    });
    expect(markerStore.sessions.size).toBe(0);
  });

  it("does not persist a session when signing fails", async () => {
    const store = seededStore();
    const service = makeService(store, {
      signer: async () => {
        throw new Error("key unavailable");
      },
    });
    await expect(service.login(command())).rejects.toMatchObject({
      code: "TOKEN_SIGNING_UNAVAILABLE",
      status: 503,
    });
    expect(store.sessions.size).toBe(0);
  });

  it("continues only after an ambiguous write is resolved by exact session read-back", async () => {
    const store = seededStore();
    store.insertMode = "commit_then_throw";
    const result = await makeService(store).login(command());
    expect(store.sessions.get(result.session.sessionId)).toMatchObject({ state: "ACTIVE" });
  });

  it("fails without returning success when a session write cannot be resolved", async () => {
    const store = seededStore();
    store.insertMode = "throw_before_commit";
    await expect(makeService(store).login(command())).rejects.toMatchObject({
      code: "SESSION_PERSISTENCE_UNAVAILABLE",
      status: 503,
    });
    expect(store.sessions.size).toBe(0);
  });

  it("revokes the new session and fails closed when account authorization changes", async () => {
    const store = seededStore();
    store.changeAuthorizationAfterInsert = true;
    await expect(makeService(store).login(command())).rejects.toMatchObject({
      code: "LOGIN_NOT_ALLOWED",
      status: 403,
    });
    expect([...store.sessions.values()]).toHaveLength(1);
    expect([...store.sessions.values()][0]).toMatchObject({ state: "REVOKED", version: 2 });
  });

  it("creates independent sessions for concurrent logins and response-loss retry semantics", async () => {
    const store = seededStore();
    const service = makeService(store);
    const [first, second] = await Promise.all([service.login(command()), service.login(command())]);
    expect(first.session.sessionId).not.toBe(second.session.sessionId);
    expect(first.session.tokenFamilyId).not.toBe(second.session.tokenFamilyId);
    expect(first.refreshToken).not.toBe(second.refreshToken);
    expect(first.session.refreshFingerprint).not.toBe(second.session.refreshFingerprint);
    expect(store.sessions.size).toBe(2);
  });
});

interface ServiceOverrides {
  readonly verifier?: (passwordHash: string, submittedPassword: string) => Promise<boolean>;
  readonly signer?: (input: LoginAccessTokenInput) => Promise<string>;
}

function makeService(store: MemoryLoginStore, overrides: ServiceOverrides = {}): LoginService {
  return new LoginService({
    store,
    logger: createLogger({ service: "identity-login-test", environment: "test", level: "fatal" }),
    metrics: createMetrics(`identity-login-test-${randomUUID().replaceAll("-", "")}`),
    dummyPasswordHash: "dummy-hash",
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 2_592_000,
    accessTokenSigner: overrides.signer ?? (async (input) => `signed.${input.sessionId}`),
    passwordVerifier:
      overrides.verifier ??
      (async (hash, submittedPassword) => hash === "stored-hash" && submittedPassword === password),
    now: () => new Date(now),
  });
}

function command(): LoginCommand {
  return { email, password, requestId: randomUUID(), correlationId: randomUUID() };
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

function seededStore(): MemoryLoginStore {
  return new MemoryLoginStore();
}

class MemoryLoginStore implements IdentityLoginStore {
  public credential: LoginCredential | undefined;
  public user: CanonicalLoginUser;
  public readonly sessions = new Map<string, LoginSession>();
  public insertMode: "normal" | "commit_then_throw" | "throw_before_commit" = "normal";
  public changeAuthorizationAfterInsert = false;

  public constructor() {
    const userId = randomUUID();
    this.credential = {
      userId,
      passwordHash: "stored-hash",
      credentialVersion: 1,
      securityOperationId: null,
      status: "ACTIVE",
    };
    this.user = {
      userId,
      displayName: "Learner",
      role: "STUDENT",
      status: "ACTIVE",
      lecturerVerified: false,
      tokenVersion: 1,
      credentialVersion: 1,
      normalizedEmail: email,
      securityOperationId: null,
      profileVersion: 1,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
  }

  public async getCredential(normalizedEmail: string): Promise<LoginCredential | undefined> {
    return normalizedEmail === email ? this.credential : undefined;
  }

  public async getUser(userId: string): Promise<CanonicalLoginUser | undefined> {
    return this.user.userId === userId ? { ...this.user } : undefined;
  }

  public async insertSession(session: LoginSession): Promise<boolean> {
    if (this.insertMode === "throw_before_commit") throw new Error("write timed out");
    if (this.sessions.has(session.sessionId)) return false;
    this.sessions.set(session.sessionId, session);
    if (this.changeAuthorizationAfterInsert) {
      this.user = { ...this.user, status: "SUSPENDED", tokenVersion: 2 };
    }
    if (this.insertMode === "commit_then_throw") throw new Error("acknowledgement lost");
    return true;
  }

  public async getSession(sessionId: string): Promise<LoginSession | undefined> {
    return this.sessions.get(sessionId);
  }

  public async revokeSession(sessionId: string, expectedVersion: number, revokedAt: Date): Promise<boolean> {
    const existing = this.sessions.get(sessionId);
    if (!existing || existing.state !== "ACTIVE" || existing.version !== expectedVersion) return false;
    this.sessions.set(sessionId, {
      ...existing,
      state: "REVOKED",
      revokedAt,
      version: expectedVersion + 1,
    });
    return true;
  }
}
