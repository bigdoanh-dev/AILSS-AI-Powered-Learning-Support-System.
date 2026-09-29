import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext, StepUpAction } from "../../packages/security/src/index.js";
import type {
  AuthoringCourse,
  CommandIds,
  CommandReceipt,
} from "../../apps/learning-service/src/authoring/model.js";
import type { IdempotencyRecord } from "../../apps/learning-service/src/authoring/repository.js";
import { LearningLifecycleRepository } from "../../apps/learning-service/src/lifecycle/repository.js";
import { LearningLifecycleService } from "../../apps/learning-service/src/lifecycle/service.js";

const lecturerId = randomUUID(),
  adminId = randomUUID(),
  courseId = randomUUID(),
  requestId = randomUUID();
const lecturer: ActorContext = actor(lecturerId, "LECTURER");
const admin: ActorContext = actor(adminId, "ADMIN");

describe("P7.12B Q-LRN-006 traversal", () => {
  it("reads past 25 rows and rejects a late-page non-READY lesson", async () => {
    let calls = 0;
    const db = {
      execute: async () => {
        calls += 1;
        if (calls === 1) return Array.from({ length: 25 }, (_, index) => row(index, "READY"));
        return [row(25, "INCOMPLETE")];
      },
    };
    const repository = new LearningLifecycleRepository(db as never);
    expect(await repository.allLessonsReady(courseId, 1)).toBe(false);
    expect(calls).toBe(2);
  });

  it("requires at least one lesson", async () => {
    const repository = new LearningLifecycleRepository({ execute: async () => [] } as never);
    expect(await repository.allLessonsReady(courseId, 1)).toBe(false);
  });
});

describe("P7.12B lifecycle protocol", () => {
  it("hides a published course, queues public cleanup, and replays safely", async () => {
    const published = { ...course("PUBLISHED", 3), publishedAt: new Date("2026-09-01T00:00:00.000Z") };
    const memory = new MemoryLifecycle(published);
    const service = createService(memory);
    const input = { ...command(lecturer, "lock-published"), mode: "LOCK" as const };
    const first = await service.retire(input);
    expect(first.course).toMatchObject({ state: "HIDDEN", recordVersion: 4 });
    expect(memory.schedules).toHaveLength(1);
    expect(memory.events.map((event) => event.eventType)).toEqual(["system.projection.reconcile.v1"]);
    expect((await service.retire(input)).replayed).toBe(true);
    expect(memory.transitions).toBe(1);
    await expect(
      service.retire({ ...input, actor: actor(randomUUID(), "LECTURER"), idempotencyKey: "other" }),
    ).rejects.toMatchObject({ status: 403, code: "COURSE_OWNER_REQUIRED" });
  });

  it("soft deletes an unpublished draft without scheduling public cleanup", async () => {
    const memory = new MemoryLifecycle(course("DRAFT", 1));
    const result = await createService(memory).retire({
      ...command(lecturer, "delete-draft"),
      mode: "DELETE",
    });
    expect(result.course).toMatchObject({ state: "DELETED", recordVersion: 2 });
    expect(memory.events).toHaveLength(0);
    expect(memory.schedules).toHaveLength(0);
  });

  it("turns a published delete request into safe unlisting", async () => {
    const memory = new MemoryLifecycle({
      ...course("PUBLISHED", 3),
      publishedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const result = await createService(memory).retire({
      ...command(lecturer, "delete-published"),
      mode: "DELETE",
    });
    expect(result.course.state).toBe("HIDDEN");
  });

  it("moves DRAFT to IN_REVIEW to PUBLISHED to ARCHIVED exactly once", async () => {
    const memory = new MemoryLifecycle(course("DRAFT", 1));
    const service = createService(memory);
    const reviewed = await service.submitReview(command(lecturer, "review"));
    expect(reviewed.course).toMatchObject({ state: "IN_REVIEW", recordVersion: 2, contentVersion: 1 });
    const published = await service.publish({ ...command(admin, "publish"), proof: "publish-proof" });
    expect(published.course).toMatchObject({ state: "PUBLISHED", recordVersion: 3, contentVersion: 1 });
    expect(published.course.publishedAt).toBeTypeOf("string");
    const archived = await service.archive({ ...command(admin, "archive"), proof: "archive-proof" });
    expect(archived.course).toMatchObject({ state: "ARCHIVED", recordVersion: 4, contentVersion: 1 });
    expect(archived.course.publishedAt).toBe(published.course.publishedAt);
    expect(memory.events.map((event) => event.eventType)).toEqual([
      "learning.course.published.v1",
      "system.projection.reconcile.v1",
    ]);
    expect(memory.readyEvents).toHaveLength(2);
    expect(memory.schedules).toHaveLength(1);
    expect(memory.slugOwner).toBe(courseId);
  });

  it("same idempotency key replay does not advance to N+2", async () => {
    const memory = new MemoryLifecycle(course("DRAFT", 1));
    const service = createService(memory),
      input = command(lecturer, "same-review");
    await service.submitReview(input);
    const replay = await service.submitReview(input);
    expect(replay.replayed).toBe(true);
    expect(replay.course.recordVersion).toBe(2);
    expect(memory.transitions).toBe(1);
  });

  it("allows only one global slug owner", async () => {
    const memory = new MemoryLifecycle(course("IN_REVIEW", 2));
    memory.slugOwner = randomUUID();
    await expect(
      createService(memory).publish({ ...command(admin, "collision"), proof: "publish-proof" }),
    ).rejects.toMatchObject({ status: 409, code: "SLUG_CONFLICT" });
    expect(memory.course.state).toBe("IN_REVIEW");
  });

  it("binds Admin proof to action and resource", async () => {
    const memory = new MemoryLifecycle(course("IN_REVIEW", 2));
    await expect(
      createService(memory).publish({ ...command(admin, "bad-proof"), proof: "archive-proof" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(memory.transitions).toBe(0);
  });
});

class MemoryLifecycle {
  records = new Map<string, IdempotencyRecord>();
  projection: AuthoringCourse | undefined;
  events: Array<{ eventType: string; ids: CommandIds }> = [];
  readyEvents: string[] = [];
  schedules: unknown[] = [];
  slugOwner?: string;
  transitions = 0;
  public constructor(public course: AuthoringCourse) {
    this.projection = course;
  }
  async reserve(scope: string, hash: number, key: string, ids: CommandIds, receipt: CommandReceipt) {
    const id = `${scope}:${String(hash)}:${key}`;
    if (this.records.has(id)) return false;
    this.records.set(id, {
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
  async checkpoint(scope: string, hash: number, key: string, operationId: string, receipt: CommandReceipt) {
    const id = `${scope}:${String(hash)}:${key}`,
      record = this.records.get(id);
    if (!record) throw new Error("MISSING_RECORD");
    this.records.set(id, { ...record, operationId, receipt });
  }
  async complete(scope: string, hash: number, key: string, operationId: string, receipt: CommandReceipt) {
    const id = `${scope}:${String(hash)}:${key}`,
      record = this.records.get(id);
    if (!record) throw new Error("MISSING_RECORD");
    this.records.set(id, { ...record, operationId, status: "COMPLETE", receipt });
  }
  async get() {
    return this.course;
  }
  async deleteProjection() {
    this.projection = undefined;
  }
  async insertProjection(value: AuthoringCourse) {
    this.projection = value;
  }
  async projectionMatches(value: AuthoringCourse) {
    return this.projection?.recordVersion === value.recordVersion;
  }
  async readyEvent(id: string) {
    this.readyEvents.push(id);
  }
  async allLessonsReady() {
    return true;
  }
  async transition(old: AuthoringCourse, from: string, to: string, now: Date, publishedAt?: Date) {
    if (this.course.state !== from || this.course.recordVersion !== old.recordVersion) return false;
    this.course = {
      ...this.course,
      state: to,
      recordVersion: old.recordVersion + 1,
      updatedAt: now,
      ...(publishedAt ? { publishedAt } : {}),
    };
    this.transitions += 1;
    return true;
  }
  async claimSlug(c: AuthoringCourse) {
    if (this.slugOwner && this.slugOwner !== c.courseId) return "CONFLICT" as const;
    this.slugOwner = c.courseId;
    return "OWNED" as const;
  }
  async writePublicProjections() {}
  async publicProjectionsMatch() {
    return true;
  }
  async prepareEvent(input: { ids: CommandIds; eventType: string }) {
    this.events.push(input);
  }
  async schedule(input: unknown) {
    this.schedules.push(input);
  }
}

function createService(memory: MemoryLifecycle) {
  return new LearningLifecycleService(
    memory,
    memory,
    memory,
    {
      get: async () => ({ userId: lecturerId, displayName: "Lecturer", avatarRef: null, resourceVersion: 1 }),
    },
    async ({ proof, action, resourceId }: { proof: string; action: StepUpAction; resourceId: string }) => {
      const expected = action === "COURSE_PUBLISH" ? "publish-proof" : "archive-proof";
      if (proof !== expected || resourceId !== courseId) throw new Error("PROOF_MISMATCH");
    },
    "secret",
  );
}
function course(state: string, version: number): AuthoringCourse {
  return {
    courseId,
    ownerLecturerId: lecturerId,
    title: "Advanced Database Systems",
    slug: "advanced-database-systems",
    categoryId: randomUUID(),
    state,
    contentVersion: 1,
    recordVersion: version,
    priceType: "FREE",
    price: "0",
    currency: "VND",
    createdAt: new Date("2026-08-30T00:00:00.000Z"),
    updatedAt: new Date("2026-08-30T00:00:00.000Z"),
  };
}
function actor(userId: string, role: string): ActorContext {
  return {
    userId,
    roles: [role],
    sessionId: randomUUID(),
    tokenVersion: 1,
    correlationId: requestId,
    issuedAt: 1,
    expiresAt: 2,
  };
}
function command(value: ActorContext, key: string) {
  return { actor: value, courseId, idempotencyKey: key, requestId };
}
function row(index: number, state: string) {
  return { section_order: 1, lesson_order: index, lesson_id: randomUUID(), state };
}
