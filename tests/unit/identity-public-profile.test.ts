import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importPKCS8 } from "jose";
import {
  IdentityPublicProfileClient,
  IdentityPublicProfileClientError,
} from "../../apps/learning-service/src/identity-client.js";
import type {
  CanonicalPublicSubject,
  PublicLecturerProjection,
} from "../../apps/identity-service/src/public-profile/model.js";
import {
  PublicProfileService,
  type PublicProfileStore,
} from "../../apps/identity-service/src/public-profile/service.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";

const userId = randomUUID();
const canonical: CanonicalPublicSubject = {
  userId,
  displayName: "Lecturer Safe",
  role: "LECTURER",
  status: "ACTIVE",
  lecturerVerified: true,
  profileVersion: 4,
};
const projection: PublicLecturerProjection = {
  lecturerId: userId,
  displayName: "Lecturer Safe",
  bio: "Public biography",
  avatarObjectKey: "private/storage/key.png",
  verified: true,
  profileVersion: 4,
  updatedAt: new Date("2026-08-29T00:00:00.000Z"),
};

describe("P7.7 public lecturer visibility and DTO privacy", () => {
  it("returns exact public and internal DTOs only for a matching eligible projection", async () => {
    const service = fixture().service;
    await expect(service.readPublic(userId, randomUUID())).resolves.toEqual({
      lecturerId: userId,
      displayName: "Lecturer Safe",
      bio: "Public biography",
      avatarRef: null,
      verified: true,
      profileVersion: 4,
    });
    await expect(service.readInternal(userId, randomUUID())).resolves.toEqual({
      userId,
      displayName: "Lecturer Safe",
      avatarRef: null,
      resourceVersion: 4,
    });
  });

  it("exposes the uploaded photo only after the lecturer opts in", async () => {
    const store = Object.assign(new MemoryPublicProfileStore(), {
      getAvatar: async () => ({ contentType: "image/png", objectKey: "private/avatar" }),
    });
    const service = new PublicProfileService(
      store,
      createMetrics(`public-photo-${randomUUID().replaceAll("-", "")}`),
      createLogger({ service: "identity-service", environment: "test", level: "silent" }),
      { read: async () => Buffer.from("real uploaded bytes") },
    );
    store.projection = { ...projection, avatarPublic: false };
    expect((await service.readPublic(userId, randomUUID())).avatarRef).toBeNull();
    store.projection = { ...projection, avatarPublic: true };
    expect((await service.readPublic(userId, randomUUID())).avatarRef).toBe(
      `data:image/png;base64,${Buffer.from("real uploaded bytes").toString("base64")}`,
    );
  });

  it.each([
    ["student", { role: "STUDENT" }],
    ["unverified", { lecturerVerified: false }],
    ["inactive", { status: "SUSPENDED" }],
  ])("conceals %s canonical state as the same safe 404", async (_name, change) => {
    const test = fixture();
    test.store.canonical = { ...canonical, ...change };
    await expect(test.service.readPublic(userId, randomUUID())).rejects.toMatchObject({
      code: "PUBLIC_PROFILE_NOT_AVAILABLE",
      status: 404,
    });
  });

  it("conceals a missing canonical row and ignores a stale projection as authority", async () => {
    const test = fixture();
    test.store.canonical = undefined;
    await expect(test.service.readPublic(userId, randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ["missing", undefined],
    ["unverified", { ...projection, verified: false }],
    ["lower", { ...projection, profileVersion: 3 }],
    ["ahead", { ...projection, profileVersion: 5 }],
    ["inconsistent", { ...projection, displayName: "Different" }],
  ])("fails closed with 503 for a %s eligible projection", async (_name, value) => {
    const test = fixture();
    test.store.projection = value;
    await expect(test.service.readPublic(userId, randomUUID())).rejects.toMatchObject({
      code: "PUBLIC_PROFILE_TEMPORARILY_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
  });

  it("maps canonical/projection dependency failures to safe 503", async () => {
    const canonicalFailure = fixture();
    canonicalFailure.store.failCanonical = true;
    await expect(canonicalFailure.service.readPublic(userId, randomUUID())).rejects.toMatchObject({
      status: 503,
    });
    const projectionFailure = fixture();
    projectionFailure.store.failProjection = true;
    await expect(projectionFailure.service.readPublic(userId, randomUUID())).rejects.toMatchObject({
      status: 503,
    });
  });
});

describe("P7.7 Learning INT-IDN-01 client", () => {
  it("sends exact Service auth/correlation and accepts only the minimal response", async () => {
    const privateKey = await testPrivateKey();
    const correlationId = randomUUID();
    let authorization = "";
    let propagated = "";
    const client = new IdentityPublicProfileClient({
      ...clientOptions(privateKey),
      fetcher: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        propagated = new Headers(init?.headers).get("x-correlation-id") ?? "";
        return Response.json({
          data: { userId, displayName: "Lecturer Safe", avatarRef: null, resourceVersion: 4 },
          meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
        });
      },
    });
    await expect(client.get(userId, correlationId)).resolves.toEqual({
      userId,
      displayName: "Lecturer Safe",
      avatarRef: null,
      resourceVersion: 4,
    });
    expect(authorization).toMatch(/^Service [^.]+\.[^.]+\.[^.]+$/u);
    expect(propagated).toBe(correlationId);
  });

  it("fails closed on owner rejection and malformed/private response fields", async () => {
    const privateKey = await testPrivateKey();
    for (const fetcher of [
      async () => new Response("denied", { status: 403 }),
      async () =>
        Response.json({
          data: {
            userId,
            displayName: "Lecturer Safe",
            avatarRef: null,
            resourceVersion: 4,
            emailMasked: "forbidden@example.test",
          },
          meta: { requestId: randomUUID(), timestamp: new Date().toISOString() },
        }),
    ]) {
      const client = new IdentityPublicProfileClient({ ...clientOptions(privateKey), fetcher });
      await expect(client.get(userId, randomUUID())).rejects.toBeInstanceOf(IdentityPublicProfileClientError);
    }
  });

  it("aborts a delayed owner call inside the 500 ms total deadline without retry", async () => {
    const privateKey = await testPrivateKey();
    let attempts = 0;
    const client = new IdentityPublicProfileClient({
      ...clientOptions(privateKey),
      deadlineMs: 120,
      fetcher: async (_input, init) => {
        attempts += 1;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 2_000);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          });
        });
        return new Response();
      },
    });
    const startedAt = performance.now();
    await expect(client.get(userId, randomUUID())).rejects.toMatchObject({
      code: "IDENTITY_PROFILE_UNAVAILABLE",
    });
    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(attempts).toBe(1);
  });
});

class MemoryPublicProfileStore implements PublicProfileStore {
  public canonical: CanonicalPublicSubject | undefined = canonical;
  public projection: PublicLecturerProjection | undefined = projection;
  public failCanonical = false;
  public failProjection = false;
  public async getCanonicalSubject(): Promise<CanonicalPublicSubject | undefined> {
    if (this.failCanonical) throw new Error("canonical unavailable");
    return this.canonical;
  }
  public async getProjection(): Promise<PublicLecturerProjection | undefined> {
    if (this.failProjection) throw new Error("projection unavailable");
    return this.projection;
  }
}

function fixture() {
  const store = new MemoryPublicProfileStore();
  return {
    store,
    service: new PublicProfileService(
      store,
      createMetrics(`public-profile-${randomUUID().replaceAll("-", "")}`),
      createLogger({ service: "identity-service", environment: "test", level: "silent" }),
    ),
  };
}

async function testPrivateKey() {
  const pair = generateKeyPairSync("ed25519");
  return importPKCS8(pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "EdDSA");
}

function clientOptions(privateKey: Awaited<ReturnType<typeof testPrivateKey>>) {
  return {
    baseUrl: "http://identity.test:8101",
    privateKey,
    issuer: "ailss-internal",
    audience: "identity-service",
    purpose: "identity.public-profile.read",
    kid: "learning-test",
    tokenTtlSeconds: 60,
    deadlineMs: 500,
  };
}
