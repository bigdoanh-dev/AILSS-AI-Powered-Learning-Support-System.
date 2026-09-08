import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseRegistrationRequest,
  registrationFingerprint,
  type RegisteredAccount,
  type RegistrationCommand,
} from "../../apps/identity-service/src/registration/model.js";
import type {
  CredentialReservation,
  IdempotencyRecord,
  OutboxLocation,
} from "../../apps/identity-service/src/registration/repository.js";
import {
  RegistrationService,
  type IdentityRegistrationStore,
} from "../../apps/identity-service/src/registration/service.js";
import type { EventEnvelope } from "../../packages/contracts/src/index.js";
import type { AppError } from "../../packages/http/src/index.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";

const validBody = {
  email: " Learner@Example.COM ",
  password: "correct horse battery staple",
  displayName: "  Learner One  ",
};

describe("P7.1 IDN-01 request validation", () => {
  it("normalizes a valid email and display name once", () => {
    expect(parseRegistrationRequest(validBody)).toEqual({
      email: "learner@example.com",
      password: validBody.password,
      displayName: "Learner One",
    });
  });

  it("rejects invalid email, short password, short display name, and unknown fields", () => {
    expect(() => parseRegistrationRequest({ ...validBody, email: "bad" })).toThrow();
    expect(() => parseRegistrationRequest({ ...validBody, password: "too-short" })).toThrow();
    expect(() => parseRegistrationRequest({ ...validBody, displayName: "x" })).toThrow();
    expect(() => parseRegistrationRequest({ ...validBody, role: "ADMIN" })).toThrow();
    expect(() => parseRegistrationRequest({ ...validBody, lecturerVerified: true })).toThrow();
  });

  it("accepts the 128-character password boundary and rejects 129", () => {
    expect(parseRegistrationRequest({ ...validBody, password: "x".repeat(128) }).password).toHaveLength(128);
    expect(() => parseRegistrationRequest({ ...validBody, password: "x".repeat(129) })).toThrow();
  });
});

describe("P7.1 IDN-01 idempotency and uniqueness", () => {
  it("registers lecturers directly, unverified, without student conversion", async () => {
    const store = new MemoryRegistrationStore();
    const service = createService(store);
    const command = { ...makeCommand("lecturer-direct"), role: "LECTURER" as const };
    const first = await service.register(command);
    const replay = await service.register(command);
    expect(first.account).toMatchObject({ role: "LECTURER", lecturerVerified: false, status: "ACTIVE" });
    expect(replay.account).toEqual(first.account);
    expect(parseRegistrationRequest({ ...validBody, role: "LECTURER" }).role).toBe("LECTURER");
    await expect(service.register({ ...command, role: "STUDENT" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("replays the original logical result and keeps stable event IDs", async () => {
    const store = new MemoryRegistrationStore();
    const service = createService(store);
    const command = makeCommand("same-key");
    const first = await service.register(command);
    const second = await service.register({ ...command, requestId: randomUUID() });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.account.userId).toBe(first.account.userId);
    expect(second.eventId).toBe(first.eventId);
    expect(store.users.size).toBe(1);
    expect(store.events.size).toBe(2);
    expect([...store.events.values()].every((item) => item.state === "READY")).toBe(true);
  });

  it("returns IDEMPOTENCY_CONFLICT for the same key with a different payload", async () => {
    const store = new MemoryRegistrationStore();
    const service = createService(store);
    const command = makeCommand("conflict-key");
    await service.register(command);
    await expect(service.register({ ...command, displayName: "Someone Else" })).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    });
    expect(store.users.size).toBe(1);
  });

  it("allows only one winner for concurrent normalized-email registrations", async () => {
    const store = new MemoryRegistrationStore();
    const service = createService(store);
    const settled = await Promise.allSettled([
      service.register(makeCommand("race-a")),
      service.register(makeCommand("race-b")),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ code: "EMAIL_ALREADY_REGISTERED", status: 409 }) as AppError,
    });
    expect(store.users.size).toBe(1);
    expect(store.credentials.size).toBe(1);
  });

  it("recovers after credential reservation and never writes password material to events", async () => {
    const store = new MemoryRegistrationStore();
    const service = createService(store);
    const command = makeCommand("crash-window");
    const ids = { operationId: randomUUID(), resourceId: randomUUID() };
    store.seedInProgress(command, ids.operationId, ids.resourceId);
    store.credentials.set(command.email, { userId: ids.resourceId, status: "RESERVED" });

    const result = await service.register(command);
    expect(result.account.userId).toBe(ids.resourceId);
    expect(store.users.size).toBe(1);
    const serializedEvents = JSON.stringify([...store.events.values()]);
    expect(serializedEvents).not.toContain(command.password);
    expect(serializedEvents).not.toContain("passwordHash");
    expect(serializedEvents).toContain("USER_REGISTERED");
  });
});

function makeCommand(idempotencyKey: string): RegistrationCommand {
  return {
    email: "learner@example.com",
    password: validBody.password,
    displayName: "Learner One",
    idempotencyKey,
    requestId: randomUUID(),
    correlationId: randomUUID(),
  };
}

function createService(store: MemoryRegistrationStore): RegistrationService {
  return new RegistrationService({
    store,
    logger: createLogger({ service: "identity-test", environment: "test", level: "fatal" }),
    metrics: createMetrics(`identity-test-${randomUUID().replaceAll("-", "")}`),
    passwordHasher: async () => "$argon2id$test-only-hash",
    now: () => new Date("2026-08-28T00:00:00.000Z"),
  });
}

interface MutableIdempotency extends IdempotencyRecord {
  status: string;
  resultCode: number;
}

class MemoryRegistrationStore implements IdentityRegistrationStore {
  readonly idempotency = new Map<string, MutableIdempotency>();
  readonly credentials = new Map<string, CredentialReservation>();
  readonly users = new Map<string, RegisteredAccount>();
  readonly events = new Map<string, { event: EventEnvelope; state: string; location: OutboxLocation }>();
  readonly adminProjections = new Set<string>();

  public async beginIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    resourceId: string;
    requestChecksum: string;
    createdAt: Date;
    ttlSeconds: number;
  }): Promise<{ created: boolean; record: IdempotencyRecord }> {
    const existing = this.idempotency.get(input.idempotencyKey);
    if (existing) return { created: false, record: existing };
    const record: MutableIdempotency = {
      operationId: input.operationId,
      resourceId: input.resourceId,
      resultCode: 0,
      status: "IN_PROGRESS",
      requestChecksum: input.requestChecksum,
      createdAt: input.createdAt,
    };
    this.idempotency.set(input.idempotencyKey, record);
    return { created: true, record };
  }

  public async completeIdempotency(input: { idempotencyKey: string }): Promise<void> {
    const record = this.idempotency.get(input.idempotencyKey);
    if (record) {
      record.status = "COMPLETE";
      record.resultCode = 201;
    }
  }

  public async failIdempotency(input: { idempotencyKey: string; resultCode: number }): Promise<void> {
    const record = this.idempotency.get(input.idempotencyKey);
    if (record) {
      record.status = "FAILED";
      record.resultCode = input.resultCode;
    }
  }

  public async reserveCredential(input: {
    normalizedEmail: string;
    userId: string;
  }): Promise<{ created: boolean; reservation: CredentialReservation }> {
    const existing = this.credentials.get(input.normalizedEmail);
    if (existing) return { created: false, reservation: existing };
    const reservation = { userId: input.userId, status: "RESERVED" };
    this.credentials.set(input.normalizedEmail, reservation);
    return { created: true, reservation };
  }

  public async getCredential(normalizedEmail: string): Promise<CredentialReservation | undefined> {
    return this.credentials.get(normalizedEmail);
  }

  public async activateCredential(normalizedEmail: string, userId: string): Promise<void> {
    this.credentials.set(normalizedEmail, { userId, status: "ACTIVE" });
  }

  public async createUser(input: {
    account: RegisteredAccount;
    maskedEmail: string;
    normalizedEmail: string;
  }): Promise<void> {
    this.users.set(input.account.userId, input.account);
  }

  public async getUser(userId: string): Promise<RegisteredAccount | undefined> {
    return this.users.get(userId);
  }

  public async getAdminProjection(account: RegisteredAccount): Promise<unknown> {
    return this.adminProjections.has(account.userId) ? { userId: account.userId } : undefined;
  }

  public async insertAdminProjection(account: RegisteredAccount): Promise<boolean> {
    const existing = this.adminProjections.has(account.userId);
    this.adminProjections.add(account.userId);
    return !existing;
  }

  public async prepareOutbox(event: EventEnvelope): Promise<OutboxLocation> {
    const location = {
      dueDay: event.occurredAt.slice(0, 10),
      shard: 0,
      nextAttemptAt: new Date(event.occurredAt),
      eventId: event.eventId,
    };
    if (!this.events.has(event.eventId))
      this.events.set(event.eventId, { event, state: "PREPARED", location });
    return location;
  }

  public async markOutboxReady(location: OutboxLocation): Promise<void> {
    const item = this.events.get(location.eventId);
    if (item && item.state === "PREPARED") item.state = "READY";
  }

  public seedInProgress(command: RegistrationCommand, operationId: string, resourceId: string): void {
    this.idempotency.set(command.idempotencyKey, {
      operationId,
      resourceId,
      resultCode: 0,
      status: "IN_PROGRESS",
      requestChecksum: registrationFingerprint(command),
      createdAt: new Date("2026-08-28T00:00:00.000Z"),
    });
  }
}
