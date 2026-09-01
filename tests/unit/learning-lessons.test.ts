import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { AuthoringCourse } from "../../apps/learning-service/src/authoring/model.js";
import {
  parseCreateLesson,
  parsePatchLesson,
  type LessonDetail,
  type LessonReceipt,
  type LessonSummary,
} from "../../apps/learning-service/src/lessons/model.js";
import type { LearningLessonRepository } from "../../apps/learning-service/src/lessons/repository.js";
import { LearningLessonService } from "../../apps/learning-service/src/lessons/service.js";

describe("P7.13 lesson authoring", () => {
  it("locks a strict normalized DTO with server-owned state and versions", () => {
    expect(
      parseCreateLesson({
        title: "  Lesson One  ",
        sectionTitle: " Section ",
        position: { sectionOrder: 1, lessonOrder: 2 },
      }),
    ).toMatchObject({ title: "Lesson One", sectionTitle: "Section", preview: false });
    expect(() =>
      parseCreateLesson({
        title: "Lesson",
        sectionTitle: "Section",
        position: { sectionOrder: 1, lessonOrder: 1 },
        state: "READY",
      }),
    ).toThrow();
    expect(() => parsePatchLesson({})).toThrow();
    expect(() => parsePatchLesson({ lessonVersion: 8 })).toThrow();
  });

  it("creates V1, advances contentVersion once, replays, then patches to immutable V2", async () => {
    const owner = randomUUID();
    const courseId = randomUUID();
    const store = new MemoryLessons(course(courseId, owner));
    const service = new LearningLessonService(
      store as unknown as LearningLessonRepository,
      { get: async () => ({}) as never },
      undefined,
      "lesson-test-secret",
    );
    const actor = lecturer(owner);
    const request = {
      title: "Lesson One",
      sectionTitle: "Section One",
      position: { sectionOrder: 1, lessonOrder: 1 },
      preview: false,
    } as const;
    const created = await service.create({
      courseId,
      actor,
      request,
      idempotencyKey: "create-one",
      requestId: randomUUID(),
    });
    expect(created.lesson).toMatchObject({ lessonVersion: 1, contentVersion: 2, state: "READY" });
    expect(store.value.contentVersion).toBe(2);
    const replay = await service.create({
      courseId,
      actor,
      request,
      idempotencyKey: "create-one",
      requestId: randomUUID(),
    });
    expect(replay).toMatchObject({
      replayed: true,
      lesson: { lessonId: created.lesson.lessonId, contentVersion: 2 },
    });
    expect(store.value.contentVersion).toBe(2);

    store.failActivationOnce = true;
    const patched = await service.patch({
      lessonId: created.lesson.lessonId,
      actor,
      request: { title: "Lesson One Revised" },
      idempotencyKey: "patch-one",
      requestId: randomUUID(),
    });
    expect(patched.lesson).toMatchObject({
      lessonVersion: 2,
      contentVersion: 3,
      title: "Lesson One Revised",
    });
    expect(store.details.has(`${created.lesson.lessonId}:1`)).toBe(true);
    expect(store.details.has(`${created.lesson.lessonId}:2`)).toBe(true);
    expect(store.value.recordVersion).toBe(1);
  });

  it("rejects position collisions and non-owner/DRAFT mutations", async () => {
    const owner = randomUUID();
    const courseId = randomUUID();
    const store = new MemoryLessons(course(courseId, owner));
    const service = new LearningLessonService(
      store as unknown as LearningLessonRepository,
      { get: async () => ({}) as never },
      undefined,
      "lesson-test-secret",
    );
    const first = await service.create({
      courseId,
      actor: lecturer(owner),
      request: {
        title: "First Lesson",
        sectionTitle: "Section",
        position: { sectionOrder: 1, lessonOrder: 1 },
        preview: false,
      },
      idempotencyKey: "first",
      requestId: randomUUID(),
    });
    await expect(
      service.create({
        courseId,
        actor: lecturer(owner),
        request: {
          title: "Second Lesson",
          sectionTitle: "Section",
          position: { sectionOrder: 1, lessonOrder: 1 },
          preview: false,
        },
        idempotencyKey: "collision",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LESSON_POSITION_CONFLICT", status: 409 });
    await expect(
      service.patch({
        lessonId: first.lesson.lessonId,
        actor: lecturer(randomUUID()),
        request: { title: "Forbidden Edit" },
        idempotencyKey: "not-owner",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "COURSE_OWNER_REQUIRED", status: 403 });
  });

  it("returns only a short-lived content URL and never the internal object key", async () => {
    const owner = randomUUID();
    const courseId = randomUUID();
    const lessonId = randomUUID();
    const store = new MemoryLessons(course(courseId, owner));
    store.pointers.set(lessonId, { lessonVersion: 1, courseId, updatedAt: new Date() });
    store.details.set(`${lessonId}:1`, {
      lessonId,
      lessonVersion: 1,
      courseId,
      contentVersion: 1,
      state: "READY",
      preview: false,
      title: "Private Object Lesson",
      objectKey: `learning/lessons/${lessonId}`,
      checksum: "a".repeat(64),
      updatedAt: new Date(),
    });
    const service = new LearningLessonService(
      store as unknown as LearningLessonRepository,
      { get: async () => ({}) as never },
      {
        verify: async () => true,
        createReadUrl: async () => "http://minio.test/signed?expires=300",
      },
      "lesson-test-secret",
    );
    const detail = await service.get({ lessonId, actor: lecturer(owner) });
    expect(detail).toMatchObject({ contentUrl: "http://minio.test/signed?expires=300" });
    expect(detail).not.toHaveProperty("objectKey");
  });
});

class MemoryLessons {
  public readonly commands = new Map<
    string,
    { operationId: string; resourceId: string; status: string; receipt: LessonReceipt }
  >();
  public readonly snapshots = new Map<number, LessonSummary[]>();
  public readonly details = new Map<string, LessonDetail>();
  public readonly pointers = new Map<string, { lessonVersion: number; courseId: string; updatedAt: Date }>();
  public value: AuthoringCourse;
  public failActivationOnce = false;
  public constructor(value: AuthoringCourse) {
    this.value = value;
    this.snapshots.set(value.contentVersion, []);
  }
  async hasAccess() {
    return false;
  }
  async reserve(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resourceId: string,
    receipt: LessonReceipt,
  ) {
    const id = `${scope}:${String(hash)}:${key}`;
    if (this.commands.has(id)) return false;
    this.commands.set(id, { operationId, resourceId, status: "IN_PROGRESS", receipt });
    return true;
  }
  async command(scope: string, hash: number, key: string) {
    return this.commands.get(`${scope}:${String(hash)}:${key}`);
  }
  async checkpoint(scope: string, hash: number, key: string, _operationId: string, receipt: LessonReceipt) {
    const command = this.commands.get(`${scope}:${String(hash)}:${key}`);
    if (command) command.receipt = receipt;
  }
  async complete(scope: string, hash: number, key: string, _operationId: string, receipt: LessonReceipt) {
    const command = this.commands.get(`${scope}:${String(hash)}:${key}`);
    if (command) {
      command.status = "COMPLETE";
      command.receipt = receipt;
    }
  }
  async course() {
    return this.value;
  }
  async list(_courseId: string, version: number) {
    return [...(this.snapshots.get(version) ?? [])];
  }
  async clearSnapshot(_courseId: string, version: number) {
    this.snapshots.set(version, []);
  }
  async writeSnapshot(_courseId: string, version: number, lessons: readonly LessonSummary[]) {
    this.snapshots.set(version, [...lessons]);
  }
  async writeDetail(
    lesson: LessonSummary,
    courseId: string,
    contentVersion: number,
    contentRef: { sha256: string } | undefined,
    now: Date,
  ) {
    const id = `${lesson.lessonId}:${String(lesson.lessonVersion)}`;
    if (!this.details.has(id))
      this.details.set(id, {
        lessonId: lesson.lessonId,
        lessonVersion: lesson.lessonVersion,
        courseId,
        contentVersion,
        state: lesson.state,
        preview: lesson.preview,
        title: lesson.title,
        ...(lesson.objectKey ? { objectKey: lesson.objectKey } : {}),
        ...(contentRef ? { checksum: contentRef.sha256 } : {}),
        updatedAt: now,
      });
    return true;
  }
  async pointer(lessonId: string) {
    return this.pointers.get(lessonId);
  }
  async detail(lessonId: string, version: number) {
    return this.details.get(`${lessonId}:${String(version)}`);
  }
  async acquireBuilder() {
    return true;
  }
  async releaseBuilder() {}
  async activate(current: AuthoringCourse, target: number) {
    if (this.failActivationOnce) {
      this.failActivationOnce = false;
      throw new Error("AMBIGUOUS_ACTIVATION");
    }
    if (this.value.contentVersion !== current.contentVersion || this.value.state !== "DRAFT") return false;
    this.value = { ...this.value, contentVersion: target };
    return true;
  }
  async setPointer(lessonId: string, lessonVersion: number, courseId: string, now: Date) {
    this.pointers.set(lessonId, { lessonVersion, courseId, updatedAt: now });
  }
  async hasLegacyAccess() {
    return false;
  }
}

function course(courseId: string, ownerLecturerId: string): AuthoringCourse {
  const now = new Date();
  return {
    courseId,
    ownerLecturerId,
    title: "Course",
    slug: "course",
    categoryId: randomUUID(),
    state: "DRAFT",
    contentVersion: 1,
    recordVersion: 1,
    priceType: "FREE",
    price: "0",
    currency: "VND",
    createdAt: now,
    updatedAt: now,
  };
}
function lecturer(userId: string): ActorContext {
  const now = Math.floor(Date.now() / 1000);
  return {
    userId,
    roles: ["LECTURER"],
    sessionId: randomUUID(),
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: now,
    expiresAt: now + 30,
  };
}
