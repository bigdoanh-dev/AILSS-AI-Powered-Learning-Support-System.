import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { AuthoringCourse } from "../../apps/learning-service/src/authoring/model.js";
import {
  decodeOfferingCursor,
  encodeOfferingCursor,
  parseOfferingPatch,
  parseOfferingWrite,
  type Offering,
  type OfferingReceipt,
  type OfferingType,
} from "../../apps/learning-service/src/offerings/model.js";
import {
  ClassroomOfferingContextClientError,
  type ClassroomOfferingContext,
} from "../../apps/learning-service/src/classroom-client.js";
import type { LearningOfferingRepository } from "../../apps/learning-service/src/offerings/repository.js";
import { LearningOfferingService } from "../../apps/learning-service/src/offerings/service.js";

describe("P7.14 CourseOffering", () => {
  it("locks strict SELF_PACED/LIVE_COHORT DTO and sales windows", () => {
    expect(
      parseOfferingWrite({
        offeringType: "SELF_PACED",
        title: "  Main Access  ",
        price: "10.25",
        currency: "usd",
      }),
    ).toMatchObject({ title: "Main Access", currency: "USD" });
    expect(() =>
      parseOfferingWrite({
        offeringType: "SELF_PACED",
        classId: randomUUID(),
        title: "Bad Self",
        price: "0",
        currency: "USD",
      }),
    ).toThrow();
    expect(() =>
      parseOfferingWrite({
        offeringType: "LIVE_COHORT",
        title: "Missing Class",
        price: "0",
        currency: "USD",
      }),
    ).toThrow();
    expect(() =>
      parseOfferingWrite({
        offeringType: "LIVE_COHORT",
        classId: randomUUID(),
        title: "Bad Window",
        price: "0",
        currency: "USD",
        salesStartAt: "2026-09-02T00:00:00Z",
        salesEndAt: "2026-09-01T00:00:00Z",
      }),
    ).toThrow();
    expect(() => parseOfferingPatch({ state: "PUBLISHED" })).toThrow();
    expect(() => parseOfferingPatch({})).toThrow();
  });
  it("signs, binds and expires catalog cursors", () => {
    const value = {
      v: 1 as const,
      type: "SELF_PACED" as const,
      windowEnd: "2026-08-01",
      positions: {},
      filtersHash: "x",
      exp: Math.floor(Date.now() / 1000) + 60,
    };
    const token = encodeOfferingCursor("secret", value);
    expect(decodeOfferingCursor("secret", token)).toEqual(value);
    expect(() => decodeOfferingCursor("other", token)).toThrow();
  });
  it("creates DRAFT, exact-replays, updates once and publishes SELF_PACED without an event", async () => {
    const owner = randomUUID(),
      courseId = randomUUID(),
      store = new MemoryOfferings(course(courseId, owner));
    const service = new LearningOfferingService(
      store as unknown as LearningOfferingRepository,
      { get: async () => ({}) as never },
      "secret",
      { get: async () => ({}) as never },
    );
    const actor = lecturer(owner),
      request = {
        offeringType: "SELF_PACED" as const,
        title: "Default Access",
        price: "25.00",
        currency: "USD",
      };
    const first = await service.create({
      courseId,
      actor,
      request,
      idempotencyKey: "create",
      requestId: randomUUID(),
    });
    expect(first.offering).toMatchObject({ state: "DRAFT", recordVersion: 1, courseId });
    const replay = await service.create({
      courseId,
      actor,
      request,
      idempotencyKey: "create",
      requestId: randomUUID(),
    });
    expect(replay.replayed).toBe(true);
    expect(replay.offering.offeringId).toBe(first.offering.offeringId);
    const changed = await service.patch({
      offeringId: first.offering.offeringId,
      actor,
      request: { title: "Revised Access" },
      idempotencyKey: "patch",
      requestId: randomUUID(),
    });
    expect(changed.offering).toMatchObject({ title: "Revised Access", recordVersion: 2 });
    const published = await service.publish({
      offeringId: first.offering.offeringId,
      actor,
      idempotencyKey: "publish",
      requestId: randomUUID(),
    });
    expect(published.offering).toMatchObject({ state: "PUBLISHED", recordVersion: 3 });
    expect(store.publicIds).toContain(first.offering.offeringId);
    expect(await service.detail(first.offering.offeringId)).toMatchObject({ state: "PUBLISHED" });
  });
  it("publishes LIVE_COHORT through INT-CLS-08 and settles the one-per-Class claim", async () => {
    const owner = randomUUID(),
      courseId = randomUUID(),
      classId = randomUUID(),
      store = new MemoryOfferings(course(courseId, owner));
    const service = new LearningOfferingService(
      store as unknown as LearningOfferingRepository,
      { get: async () => ({}) as never },
      "secret",
      { get: async () => cohortContext(classId, courseId, owner) },
    );
    const actor = lecturer(owner);
    const created = await service.create({
      courseId,
      actor,
      request: {
        offeringType: "LIVE_COHORT",
        classId,
        title: "Live Cohort",
        price: "10",
        currency: "USD",
      },
      idempotencyKey: "live",
      requestId: randomUUID(),
    });
    const published = await service.publish({
      offeringId: created.offering.offeringId,
      actor,
      idempotencyKey: "publish-live",
      requestId: randomUUID(),
    });
    expect(published.offering).toMatchObject({ state: "PUBLISHED", recordVersion: 2 });
    expect(store.classClaims.get(classId)).toMatchObject({
      offeringId: created.offering.offeringId,
      state: "PUBLISHED",
      offeringVersion: 2,
    });
    const replay = await service.publish({
      offeringId: created.offering.offeringId,
      actor,
      idempotencyKey: "publish-live",
      requestId: randomUUID(),
    });
    expect(replay.replayed).toBe(true);
    expect(store.classClaims.get(classId)?.offeringVersion).toBe(2);
    const second = await service.create({
      courseId,
      actor,
      request: {
        offeringType: "LIVE_COHORT",
        classId,
        title: "Second Cohort",
        price: "10",
        currency: "USD",
      },
      idempotencyKey: "live-2",
      requestId: randomUUID(),
    });
    await expect(
      service.publish({
        offeringId: second.offering.offeringId,
        actor,
        idempotencyKey: "publish-live-2",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CLASS_ALREADY_OFFERED", status: 409 });
    const live = store.offerings.get(created.offering.offeringId);
    if (!live) throw new Error("missing test offering");
    store.canonical = { ...store.canonical, state: "ARCHIVED" };
    await expect(service.detail(created.offering.offeringId)).rejects.toMatchObject({
      code: "OFFERING_NOT_FOUND",
      status: 404,
    });
  });
  it("fails LIVE_COHORT publish closed when the Class context is ineligible or unavailable", async () => {
    const owner = randomUUID(),
      courseId = randomUUID(),
      classId = randomUUID(),
      store = new MemoryOfferings(course(courseId, owner));
    const build = (get: () => Promise<ClassroomOfferingContext>) =>
      new LearningOfferingService(
        store as unknown as LearningOfferingRepository,
        { get: async () => ({}) as never },
        "secret",
        { get },
      );
    const actor = lecturer(owner);
    const draftSchedule = build(async () => ({
      ...cohortContext(classId, courseId, owner),
      scheduleState: "DRAFT",
    }));
    const created = await draftSchedule.create({
      courseId,
      actor,
      request: {
        offeringType: "LIVE_COHORT",
        classId,
        title: "Blocked Cohort",
        price: "10",
        currency: "USD",
      },
      idempotencyKey: "blocked",
      requestId: randomUUID(),
    });
    await expect(
      draftSchedule.publish({
        offeringId: created.offering.offeringId,
        actor,
        idempotencyKey: "publish-blocked",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LIVE_COHORT_CLASS_NOT_ELIGIBLE", status: 409 });
    expect(store.classClaims.has(classId)).toBe(false);
    const rejected = build(async () => {
      throw new ClassroomOfferingContextClientError("CLASSROOM_CONTEXT_REJECTED", 404);
    });
    await expect(
      rejected.publish({
        offeringId: created.offering.offeringId,
        actor,
        idempotencyKey: "publish-rejected",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LIVE_COHORT_CLASS_NOT_AVAILABLE", status: 409 });
    const unavailable = build(async () => {
      throw new ClassroomOfferingContextClientError("CLASSROOM_CONTEXT_UNAVAILABLE");
    });
    await expect(
      unavailable.publish({
        offeringId: created.offering.offeringId,
        actor,
        idempotencyKey: "publish-unavailable",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "CLASSROOM_SERVICE_UNAVAILABLE", status: 503 });
    expect(store.classClaims.has(classId)).toBe(false);
  });
  it("advances a signed catalog cursor to offerings older than two months", async () => {
    const owner = randomUUID(),
      courseId = randomUUID(),
      store = new MemoryOfferings(course(courseId, owner));
    const service = new LearningOfferingService(
      store as unknown as LearningOfferingRepository,
      { get: async () => ({}) as never },
      "secret",
      { get: async () => ({}) as never },
    );
    for (const publishedAt of [new Date("2026-08-20T00:00:00Z"), new Date("2026-05-20T00:00:00Z")]) {
      const value: Offering = {
        offeringId: randomUUID(),
        courseId,
        ownerLecturerId: owner,
        offeringType: "SELF_PACED",
        title: "Historical Access",
        state: "PUBLISHED",
        price: "0",
        currency: "VND",
        recordVersion: 1,
        createdAt: publishedAt,
        updatedAt: publishedAt,
        publishedAt,
      };
      store.offerings.set(value.offeringId, value);
      store.publicIds.push(value.offeringId);
    }
    const first = await service.catalog({ type: "SELF_PACED", limit: 50 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    if (!first.nextCursor) throw new Error("missing historical cursor");
    const second = await service.catalog({ type: "SELF_PACED", limit: 50, cursor: first.nextCursor });
    expect(second.items[0]?.publishedAt).toContain("2026-05-20");
  });
  it("recovers canonical N+1 after projection failure without a second version increment", async () => {
    const owner = randomUUID(),
      courseId = randomUUID(),
      store = new MemoryOfferings(course(courseId, owner)),
      service = new LearningOfferingService(
        store as unknown as LearningOfferingRepository,
        { get: async () => ({}) as never },
        "secret",
        { get: async () => ({}) as never },
      ),
      actor = lecturer(owner);
    const created = await service.create({
      courseId,
      actor,
      request: { offeringType: "SELF_PACED", title: "Recoverable Access", price: "0", currency: "VND" },
      idempotencyKey: "recovery-create",
      requestId: randomUUID(),
    });
    store.failSyncOnce = true;
    const command = {
      offeringId: created.offering.offeringId,
      actor,
      request: { title: "Recovered Access" },
      idempotencyKey: "recovery-patch",
      requestId: randomUUID(),
    };
    await expect(service.patch(command)).rejects.toThrow("PROJECT_FAIL");
    const replay = await service.patch(command);
    expect(replay).toMatchObject({
      replayed: true,
      offering: { title: "Recovered Access", recordVersion: 2 },
    });
  });
  it("locks deterministic UUIDv5 migration, bounded checkpointing and divergent-row failure", () => {
    const source = readFileSync(
      new URL("../../scripts/dev/bootstrap-cassandra.mjs", import.meta.url),
      "utf8",
    );
    expect(source).toContain("f36a5ca4-5f16-5dae-8c7d-b8bf0f02d814");
    expect(source).toContain("LIMIT 100");
    expect(source).toContain("divergent deterministic offering");
    expect(source).toContain("p7.14-backfill-checkpoint.json");
    expect(source).not.toContain("ALLOW FILTERING");
  });
});

class MemoryOfferings {
  offerings = new Map<string, Offering>();
  commands = new Map<
    string,
    { operationId: string; resourceId: string; status: string; receipt: OfferingReceipt }
  >();
  classClaims = new Map<
    string,
    { offeringId: string; courseId: string; state: string; offeringVersion: number; claimedAt: Date }
  >();
  publicIds: string[] = [];
  failSyncOnce = false;
  constructor(public canonical: AuthoringCourse) {}
  async claimClass(
    classId: string,
    offeringId: string,
    courseId: string,
    offeringVersion: number,
    now: Date,
  ) {
    if (this.classClaims.has(classId)) return false;
    this.classClaims.set(classId, {
      offeringId,
      courseId,
      state: "CLAIMED",
      offeringVersion,
      claimedAt: now,
    });
    return true;
  }
  async classClaim(classId: string) {
    return this.classClaims.get(classId);
  }
  async finalizeClassClaim(classId: string, offeringId: string, offeringVersion: number) {
    const claim = this.classClaims.get(classId);
    if (!claim || claim.offeringId !== offeringId) return false;
    claim.state = "PUBLISHED";
    claim.offeringVersion = offeringVersion;
    return true;
  }
  async releaseClassClaim(classId: string, offeringId: string) {
    const claim = this.classClaims.get(classId);
    if (!claim || claim.offeringId !== offeringId || claim.state !== "CLAIMED") return false;
    this.classClaims.delete(classId);
    return true;
  }
  async course() {
    return this.canonical;
  }
  async get(id: string) {
    return this.offerings.get(id);
  }
  async reserve(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resourceId: string,
    receipt: OfferingReceipt,
  ) {
    const k = `${scope}:${String(hash)}:${key}`;
    if (this.commands.has(k)) return false;
    this.commands.set(k, { operationId, resourceId, status: "IN_PROGRESS", receipt });
    return true;
  }
  async command(scope: string, hash: number, key: string) {
    return this.commands.get(`${scope}:${String(hash)}:${key}`);
  }
  async checkpoint(scope: string, hash: number, key: string, operationId: string, receipt: OfferingReceipt) {
    const current = this.commands.get(`${scope}:${String(hash)}:${key}`);
    if (!current) throw new Error("missing test command");
    this.commands.set(`${scope}:${String(hash)}:${key}`, { ...current, operationId, receipt });
  }
  async complete(scope: string, hash: number, key: string, operationId: string, receipt: OfferingReceipt) {
    const current = this.commands.get(`${scope}:${String(hash)}:${key}`);
    if (!current) throw new Error("missing test command");
    this.commands.set(`${scope}:${String(hash)}:${key}`, {
      operationId,
      resourceId: current.resourceId,
      status: "COMPLETE",
      receipt,
    });
  }
  async create(v: Offering) {
    this.offerings.set(v.offeringId, v);
    return true;
  }
  async syncPrivate() {
    if (this.failSyncOnce) {
      this.failSyncOnce = false;
      throw new Error("PROJECT_FAIL");
    }
  }
  async update(old: Offering, next: Offering) {
    if (this.offerings.get(old.offeringId)?.recordVersion !== old.recordVersion) return false;
    this.offerings.set(old.offeringId, next);
    return true;
  }
  async publish(old: Offering, next: Offering) {
    return this.update(old, next);
  }
  async writePublic(v: Offering) {
    this.publicIds.push(v.offeringId);
  }
  async listCourse(courseId: string) {
    return [...this.offerings.values()].filter((v) => v.courseId === courseId);
  }
  async listLecturer(id: string) {
    return [...this.offerings.values()].filter((v) => v.ownerLecturerId === id);
  }
  async bounds(type: OfferingType) {
    const rows = [...this.offerings.values()].filter((v) => v.offeringType === type && v.publishedAt);
    if (!rows.length) return undefined;
    const months = rows.map((v) => (v.publishedAt?.toISOString() ?? "").slice(0, 7) + "-01").sort();
    return { newest: months.at(-1), oldest: months[0] };
  }
  async listPublic(_type: OfferingType, month: string, shard: number) {
    return this.publicIds.flatMap((id) => {
      const value = this.offerings.get(id);
      return value?.publishedAt &&
        value.publishedAt.toISOString().slice(0, 7) + "-01" === month &&
        (createHash("sha256").update(value.offeringId).digest()[0] ?? 0) % 8 === shard
        ? [value]
        : [];
    });
  }
}
function lecturer(userId: string): ActorContext {
  return {
    userId,
    roles: ["LECTURER"],
    sessionId: randomUUID(),
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: 1,
    expiresAt: 9999999999,
  };
}
function cohortContext(classId: string, courseId: string, ownerLecturerId: string): ClassroomOfferingContext {
  return {
    classId,
    linkedCourseId: courseId,
    ownerLecturerId,
    classKind: "LIVE_COHORT",
    classState: "ACTIVE",
    scheduleState: "PUBLISHED",
    scheduleVersion: 1,
    sessionCount: 3,
  };
}
function course(courseId: string, ownerLecturerId: string): AuthoringCourse {
  return {
    courseId,
    ownerLecturerId,
    title: "Published Course",
    slug: "published-course",
    categoryId: randomUUID(),
    state: "PUBLISHED",
    contentVersion: 1,
    recordVersion: 1,
    priceType: "PAID",
    price: "25",
    currency: "USD",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    publishedAt: new Date("2026-08-01T00:00:00Z"),
  };
}
