import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import {
  parseCreateCourse,
  parsePatchCourse,
  type AuthoringCourse,
  type CommandIds,
  type CommandReceipt,
  type CoursePatchRequest,
  type CourseWriteRequest,
} from "../../apps/learning-service/src/authoring/model.js";
import type { IdempotencyRecord } from "../../apps/learning-service/src/authoring/repository.js";
import {
  LearningAuthoringService,
  type LearningAuthoringStore,
} from "../../apps/learning-service/src/authoring/service.js";

class MemoryStore implements LearningAuthoringStore {
  records = new Map<string, IdempotencyRecord>();
  courses = new Map<string, AuthoringCourse>();
  projections = new Map<string, AuthoringCourse>();
  events = new Map<string, string>();
  updateWins = true;
  throwAfterUpdate = false;
  async reserve(scope: string, hash: number, key: string, ids: CommandIds, receipt: CommandReceipt) {
    const k = `${scope}:${String(hash)}:${key}`;
    if (this.records.has(k)) return false;
    this.records.set(k, {
      operationId: ids.operationId,
      resourceId: ids.courseId,
      status: "IN_PROGRESS",
      receipt,
    });
    return true;
  }
  async idempotency(scope: string, hash: number, key: string) {
    return this.records.get(`${scope}:${String(hash)}:${key}`);
  }
  async complete(scope: string, hash: number, key: string, operationId: string, receipt: CommandReceipt) {
    const k = `${scope}:${String(hash)}:${key}`,
      r = this.records.get(k);
    if (!r) throw new Error("MISSING_COMMAND");
    this.records.set(k, { ...r, operationId, status: "COMPLETE", receipt });
  }
  async checkpoint(scope: string, hash: number, key: string, operationId: string, receipt: CommandReceipt) {
    const k = `${scope}:${String(hash)}:${key}`;
    const r = this.records.get(k);
    if (!r) throw new Error("MISSING_COMMAND");
    this.records.set(k, { ...r, operationId, receipt });
  }
  async prepareEvent(ids: CommandIds) {
    this.events.set(ids.eventId, "PREPARED");
  }
  async readyEvent(id: string) {
    this.events.set(id, "READY");
  }
  async create(id: string, owner: string, r: CourseWriteRequest, now: Date) {
    if (this.courses.has(id)) return false;
    this.courses.set(id, {
      courseId: id,
      ownerLecturerId: owner,
      ...r,
      state: "DRAFT",
      contentVersion: 1,
      recordVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    return true;
  }
  async get(id: string) {
    return this.courses.get(id);
  }
  async insertProjection(c: AuthoringCourse) {
    this.projections.set(`${c.ownerLecturerId}:${c.updatedAt.toISOString()}:${c.courseId}`, c);
  }
  async deleteProjection(c: AuthoringCourse) {
    this.projections.delete(`${c.ownerLecturerId}:${c.updatedAt.toISOString()}:${c.courseId}`);
  }
  async projectionMatches(c: AuthoringCourse) {
    return (
      this.projections.get(`${c.ownerLecturerId}:${c.updatedAt.toISOString()}:${c.courseId}`)
        ?.recordVersion === c.recordVersion
    );
  }
  async update(c: AuthoringCourse, p: CoursePatchRequest, now: Date) {
    if (!this.updateWins) return false;
    this.courses.set(c.courseId, {
      ...c,
      title: p.title ?? c.title,
      slug: p.slug ?? c.slug,
      categoryId: p.categoryId ?? c.categoryId,
      priceType: p.priceType ?? c.priceType,
      price: p.price ?? c.price,
      currency: p.currency ?? c.currency,
      recordVersion: c.recordVersion + 1,
      updatedAt: now,
    });
    if (this.throwAfterUpdate) {
      this.throwAfterUpdate = false;
      throw new Error("SIMULATED_RESPONSE_LOSS_AFTER_CANONICAL");
    }
    return true;
  }
}
const lecturerId = randomUUID(),
  requestId = randomUUID();
const actor: ActorContext = {
  userId: lecturerId,
  roles: ["LECTURER"],
  sessionId: randomUUID(),
  tokenVersion: 1,
  correlationId: requestId,
  issuedAt: 1,
  expiresAt: 2,
};
const request = {
  title: "Advanced Databases",
  slug: "Cơ Sở Dữ Liệu Nâng Cao",
  categoryId: randomUUID(),
  priceType: "PAID" as const,
  price: "125000.50",
  currency: "vnd",
};
const identity = {
  get: async () => ({ userId: lecturerId, displayName: "Lecturer", avatarRef: null, resourceVersion: 1 }),
};

describe("P7.11 Learning authoring", () => {
  it("normalizes strict create DTO without binary floating point", () => {
    const value = parseCreateCourse(request);
    expect(value.slug).toBe("co-so-du-lieu-nang-cao");
    expect(value.price).toBe("125000.50");
    expect(value.currency).toBe("VND");
  });
  it("rejects unknown and server-owned fields", () => {
    expect(() => parseCreateCourse({ ...request, state: "PUBLISHED" })).toThrow();
    expect(() => parsePatchCourse({ ownerLecturerId: lecturerId })).toThrow();
  });
  it("rejects empty PATCH", () => expect(() => parsePatchCourse({})).toThrow());
  it("creates DRAFT version 1, projection and READY event", async () => {
    const store = new MemoryStore(),
      service = new LearningAuthoringService(store, identity, "secret");
    const result = await service.create({
      actor,
      request: parseCreateCourse(request),
      idempotencyKey: "create-1",
      requestId,
    });
    expect(result.course).toMatchObject({
      state: "DRAFT",
      recordVersion: 1,
      contentVersion: 1,
      ownerLecturerId: lecturerId,
    });
    expect(store.projections.size).toBe(1);
    expect([...store.events.values()]).toEqual(["READY"]);
  });
  it("replays create without another course or event", async () => {
    const store = new MemoryStore(),
      service = new LearningAuthoringService(store, identity, "secret");
    const command = { actor, request: parseCreateCourse(request), idempotencyKey: "create-2", requestId };
    const first = await service.create(command),
      second = await service.create(command);
    expect(second.course.courseId).toBe(first.course.courseId);
    expect(second.replayed).toBe(true);
    expect(store.courses.size).toBe(1);
    expect(store.events.size).toBe(1);
  });
  it("rejects same key with different request", async () => {
    const store = new MemoryStore(),
      service = new LearningAuthoringService(store, identity, "secret");
    await service.create({ actor, request: parseCreateCourse(request), idempotencyKey: "same", requestId });
    await expect(
      service.create({
        actor,
        request: parseCreateCourse({ ...request, title: "Different Title" }),
        idempotencyKey: "same",
        requestId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("denies a role-claim student before Identity", async () => {
    const service = new LearningAuthoringService(new MemoryStore(), identity, "secret");
    await expect(
      service.create({
        actor: { ...actor, roles: ["STUDENT"] },
        request: parseCreateCourse(request),
        idempotencyKey: "x",
        requestId,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("fails closed when Identity is unavailable", async () => {
    const service = new LearningAuthoringService(
      new MemoryStore(),
      {
        get: async () => {
          throw new Error("down");
        },
      },
      "secret",
    );
    await expect(
      service.create({ actor, request: parseCreateCourse(request), idempotencyKey: "x", requestId }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("owner PATCH increments recordVersion and preserves contentVersion", async () => {
    const store = new MemoryStore(),
      service = new LearningAuthoringService(store, identity, "secret");
    const created = await service.create({
      actor,
      request: parseCreateCourse(request),
      idempotencyKey: "c",
      requestId,
    });
    const result = await service.update({
      actor,
      courseId: created.course.courseId,
      request: parsePatchCourse({ title: "Updated Course" }),
      idempotencyKey: "u",
      requestId,
    });
    expect(result.course.recordVersion).toBe(2);
    expect(result.course.contentVersion).toBe(1);
    expect(store.projections.size).toBe(1);
    expect(store.events.size).toBe(1);
  });
  it("semantic no-op does not increment version", async () => {
    const store = new MemoryStore(),
      service = new LearningAuthoringService(store, identity, "secret");
    const c = await service.create({
      actor,
      request: parseCreateCourse(request),
      idempotencyKey: "c2",
      requestId,
    });
    const r = await service.update({
      actor,
      courseId: c.course.courseId,
      request: parsePatchCourse({ title: request.title }),
      idempotencyKey: "noop",
      requestId,
    });
    expect(r.noOp).toBe(true);
    expect(r.course.recordVersion).toBe(1);
  });
  it("denies non-owner", async () => {
    const store = new MemoryStore(),
      service = new LearningAuthoringService(store, identity, "secret");
    const c = await service.create({
      actor,
      request: parseCreateCourse(request),
      idempotencyKey: "c3",
      requestId,
    });
    const other = { ...actor, userId: randomUUID() };
    await expect(
      service.update({
        actor: other,
        courseId: c.course.courseId,
        request: parsePatchCourse({ title: "Other title" }),
        idempotencyKey: "u2",
        requestId,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("allows one conditional update winner", async () => {
    const store = new MemoryStore(),
      service = new LearningAuthoringService(store, identity, "secret");
    const c = await service.create({
      actor,
      request: parseCreateCourse(request),
      idempotencyKey: "c4",
      requestId,
    });
    store.updateWins = false;
    await expect(
      service.update({
        actor,
        courseId: c.course.courseId,
        request: parsePatchCourse({ title: "Losing write" }),
        idempotencyKey: "u3",
        requestId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("replay converges projection after canonical PATCH response loss", async () => {
    const store = new MemoryStore(),
      service = new LearningAuthoringService(store, identity, "secret");
    const c = await service.create({
      actor,
      request: parseCreateCourse(request),
      idempotencyKey: "recover-create",
      requestId,
    });
    const command = {
      actor,
      courseId: c.course.courseId,
      request: parsePatchCourse({ title: "Recovered metadata" }),
      idempotencyKey: "recover-update",
      requestId,
    };
    store.throwAfterUpdate = true;
    await expect(service.update(command)).rejects.toThrow("SIMULATED_RESPONSE_LOSS_AFTER_CANONICAL");
    const recovered = await service.update(command);
    expect(recovered.course.recordVersion).toBe(2);
    expect(recovered.replayed).toBe(true);
    expect(store.projections.size).toBe(1);
  });
});
