import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { ObjectStorage } from "../../../../packages/storage/src/index.js";
import { keyHash } from "../authoring/model.js";
import { IdentityPublicProfileClientError, type IdentityPublicProfileClient } from "../identity-client.js";
import {
  applyPatch,
  lessonDetailDto,
  lessonDto,
  lessonFingerprint,
  type LessonContentRef,
  type LessonCreateRequest,
  type LessonPatchRequest,
  type LessonReceipt,
  type LessonSummary,
} from "./model.js";
import type { LearningLessonRepository } from "./repository.js";

const MAX_LESSONS = 1_999;

export class LearningLessonService {
  public constructor(
    private readonly repository: LearningLessonRepository,
    private readonly identity: Pick<IdentityPublicProfileClient, "get">,
    private readonly storage:
      (Pick<ObjectStorage, "verify" | "createReadUrl"> & Partial<Pick<ObjectStorage, "stat">>) | undefined,
    private readonly secret: string,
    private readonly media?: {
      lessonMedia(lessonId: string): Promise<{ mediaAssetId: string; mediaStatus: string } | undefined>;
    },
  ) {}

  public async list(input: { courseId: string; actor?: ActorContext; requestId: string }) {
    const course = await this.repository.course(input.courseId);
    if (!course) throw notFound("COURSE_NOT_FOUND", "Course not found");
    if (course.state !== "PUBLISHED") {
      const enrolled =
        course.state === "HIDDEN" && input.actor
          ? await this.repository.hasAccess(input.actor.userId, course.courseId)
          : false;
      if (!input.actor || (!enrolled && input.actor.userId !== course.ownerLecturerId))
        throw notFound("COURSE_NOT_FOUND", "Course not found");
      if (!enrolled) await this.requireLecturer(input.actor, input.requestId);
    }
    const lessons = await this.repository.list(course.courseId, course.contentVersion);
    return {
      courseId: course.courseId,
      contentVersion: course.contentVersion,
      lessons: await Promise.all(
        lessons.map(async (lesson) => ({
          ...lessonDto(lesson, course.courseId, course.contentVersion),
          ...(await this.media?.lessonMedia(lesson.lessonId)),
        })),
      ),
    };
  }

  public async get(input: { lessonId: string; actor: ActorContext }) {
    const pointer = await this.repository.pointer(input.lessonId);
    if (!pointer) throw notFound("LESSON_NOT_FOUND", "Lesson not found");
    const lesson = await this.repository.detail(input.lessonId, pointer.lessonVersion);
    if (!lesson || lesson.courseId !== pointer.courseId)
      throw notFound("LESSON_NOT_FOUND", "Lesson not found");
    const course = await this.repository.course(pointer.courseId);
    if (!course) throw notFound("LESSON_NOT_FOUND", "Lesson not found");
    const owner = input.actor.userId === course.ownerLecturerId && input.actor.roles.includes("LECTURER");
    const entitled =
      ["PUBLISHED", "HIDDEN"].includes(course.state) &&
      (await this.repository.hasAccess(input.actor.userId, course.courseId));
    const preview = course.state === "PUBLISHED" && lesson.preview;
    if (!owner && !entitled && !preview)
      throw new AppError("LESSON_ACCESS_REQUIRED", 403, "Active Course access is required");
    const media = await this.media?.lessonMedia(lesson.lessonId);
    if (media) return { ...lessonDetailDto(lesson), ...media, contentType: "application/vnd.apple.mpegurl" };
    const contentUrl = lesson.objectKey ? await this.readUrl(lesson.objectKey) : undefined;
    const contentType =
      lesson.objectKey && this.storage?.stat
        ? (await this.storage.stat(lesson.objectKey)).contentType
        : undefined;
    return { ...lessonDetailDto(lesson, contentUrl), ...(contentType ? { contentType } : {}) };
  }

  public async create(input: {
    courseId: string;
    actor: ActorContext;
    request: LessonCreateRequest;
    idempotencyKey: string;
    requestId: string;
  }) {
    await this.requireLecturer(input.actor, input.requestId);
    await this.verifyContent(input.request.contentRef);
    const fingerprint = lessonFingerprint(this.secret, {
      method: "POST",
      route: "/api/v1/courses/{courseId}/lessons",
      actorId: input.actor.userId,
      courseId: input.courseId,
      body: input.request,
    });
    return this.mutate({
      operation: "LRN-11",
      actor: input.actor,
      courseId: input.courseId,
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      create: input.request,
    });
  }

  public async patch(input: {
    lessonId: string;
    actor: ActorContext;
    request: LessonPatchRequest;
    idempotencyKey: string;
    requestId: string;
  }) {
    await this.requireLecturer(input.actor, input.requestId);
    if (input.request.contentRef) await this.verifyContent(input.request.contentRef);
    const pointer = await this.repository.pointer(input.lessonId);
    if (!pointer) throw notFound("LESSON_NOT_FOUND", "Lesson not found");
    const fingerprint = lessonFingerprint(this.secret, {
      method: "PATCH",
      route: "/api/v1/lessons/{lessonId}",
      actorId: input.actor.userId,
      lessonId: input.lessonId,
      body: input.request,
    });
    return this.mutate({
      operation: "LRN-13",
      actor: input.actor,
      courseId: pointer.courseId,
      lessonId: input.lessonId,
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      patch: input.request,
    });
  }

  private async mutate(input: {
    operation: "LRN-11" | "LRN-13";
    actor: ActorContext;
    courseId: string;
    lessonId?: string;
    idempotencyKey: string;
    fingerprint: string;
    create?: LessonCreateRequest;
    patch?: LessonPatchRequest;
  }) {
    const scope = `${input.operation}:${input.actor.userId}:course:${input.courseId}${input.lessonId ? `:lesson:${input.lessonId}` : ""}`;
    const hashed = keyHash(this.secret, input.idempotencyKey);
    const operationId = randomUUID();
    const proposedLessonId = input.lessonId ?? randomUUID();
    const now = new Date();
    const applied = await this.repository.reserve(
      scope,
      hashed,
      input.idempotencyKey,
      operationId,
      proposedLessonId,
      { fingerprint: input.fingerprint, occurredAt: now.toISOString(), lessonId: proposedLessonId },
      now,
    );
    const record = await this.repository.command(scope, hashed, input.idempotencyKey);
    if (!record) throw unavailable();
    if (record.receipt.fingerprint !== input.fingerprint)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request");
    if (record.status === "COMPLETE" && record.receipt.lesson)
      return { lesson: record.receipt.lesson, replayed: true };

    const lessonId = record.resourceId;
    let course = await this.repository.course(input.courseId);
    if (!course) throw notFound("COURSE_NOT_FOUND", "Course not found");
    if (course.ownerLecturerId !== input.actor.userId)
      throw new AppError("COURSE_OWNER_REQUIRED", 403, "Course owner authorization is required");

    const receipt = record.receipt;
    if (receipt.targetContentVersion !== undefined) {
      if (course.contentVersion === receipt.targetContentVersion) {
        const recovered = await this.recoverActivated(input, receipt, lessonId, now);
        await this.repository.complete(scope, hashed, input.idempotencyKey, record.operationId, {
          ...receipt,
          lesson: recovered,
        });
        await this.repository.releaseBuilder(course.courseId, record.operationId);
        return { lesson: recovered, replayed: true };
      }
      if (course.contentVersion !== receipt.sourceContentVersion)
        throw conflict("CONTENT_VERSION_CONFLICT", "Course content was changed concurrently");
    }
    if (course.state !== "DRAFT")
      throw conflict("COURSE_NOT_EDITABLE", "Lessons can be changed only while the Course is DRAFT");

    if (receipt.sourceContentVersion === undefined) {
      receipt.sourceContentVersion = course.contentVersion;
      receipt.targetContentVersion = course.contentVersion + 1;
      receipt.expectedRecordVersion = course.recordVersion;
      receipt.lessonId = lessonId;
      await this.repository.checkpoint(scope, hashed, input.idempotencyKey, record.operationId, receipt);
    }
    const source = requiredNumber(receipt.sourceContentVersion);
    const target = requiredNumber(receipt.targetContentVersion);
    const expectedRecordVersion = requiredNumber(receipt.expectedRecordVersion);
    if (!(await this.repository.acquireBuilder(course.courseId, record.operationId, source, target, now)))
      throw conflict("CONTENT_MUTATION_IN_PROGRESS", "Another lesson mutation is in progress");
    try {
      course = await this.repository.course(course.courseId);
      if (!course) throw unavailable();
      if (course.contentVersion === target) {
        const recovered = await this.recoverActivated(input, receipt, lessonId, now);
        await this.repository.complete(scope, hashed, input.idempotencyKey, record.operationId, {
          ...receipt,
          lesson: recovered,
        });
        await this.repository.releaseBuilder(course.courseId, record.operationId);
        return { lesson: recovered, replayed: true };
      }
      if (
        course.state !== "DRAFT" ||
        course.contentVersion !== source ||
        course.recordVersion !== expectedRecordVersion
      )
        throw conflict("CONTENT_VERSION_CONFLICT", "Course content was changed concurrently");

      const sourceLessons = await this.repository.list(course.courseId, source);
      const built = this.build(input, sourceLessons, lessonId, receipt);
      await this.repository.clearSnapshot(course.courseId, target);
      await this.repository.writeSnapshot(course.courseId, target, built.lessons);
      const verified = await this.repository.list(course.courseId, target);
      if (!sameSnapshot(built.lessons, verified)) throw unavailable();
      if (!(await this.repository.writeDetail(built.changed, course.courseId, target, built.contentRef, now)))
        throw conflict("LESSON_VERSION_CONFLICT", "Immutable lesson version already differs");

      let won = false;
      let activated;
      try {
        won = await this.repository.activate(course, target);
        activated = await this.repository.course(course.courseId);
      } catch {
        activated = await this.repository.course(course.courseId);
        if (
          activated?.state === "DRAFT" &&
          activated.contentVersion === source &&
          activated.recordVersion === expectedRecordVersion
        ) {
          won = await this.repository.activate(course, target);
          activated = await this.repository.course(course.courseId);
        }
      }
      if (!won && activated?.contentVersion !== target)
        throw conflict("CONTENT_VERSION_CONFLICT", "Course content was changed concurrently");
      if (!activated || activated.state !== "DRAFT" || activated.recordVersion !== course.recordVersion)
        throw conflict("COURSE_STATE_CONFLICT", "Course changed while lesson content was activating");
      await this.repository.setPointer(lessonId, built.changed.lessonVersion, course.courseId, now);
      const dto = lessonDto(built.changed, course.courseId, target);
      await this.repository.complete(scope, hashed, input.idempotencyKey, record.operationId, {
        ...receipt,
        lessonVersion: built.changed.lessonVersion,
        lesson: dto,
      });
      await this.repository.releaseBuilder(course.courseId, record.operationId);
      return { lesson: dto, replayed: !applied };
    } catch (error) {
      await this.repository.releaseBuilder(input.courseId, record.operationId);
      throw error;
    }
  }

  private build(
    input: { create?: LessonCreateRequest; patch?: LessonPatchRequest },
    source: readonly LessonSummary[],
    lessonId: string,
    receipt: LessonReceipt,
  ): { lessons: LessonSummary[]; changed: LessonSummary; contentRef?: LessonContentRef } {
    let changed: LessonSummary;
    let contentRef: LessonContentRef | undefined;
    if (input.create) {
      if (source.length >= MAX_LESSONS)
        throw conflict("SYLLABUS_LIMIT_REACHED", "A Course may contain at most 1999 lessons");
      changed = {
        lessonId,
        lessonVersion: 1,
        sectionOrder: input.create.position.sectionOrder,
        lessonOrder: input.create.position.lessonOrder,
        sectionTitle: input.create.sectionTitle,
        title: input.create.title,
        state: "READY",
        preview: input.create.preview,
        ...(input.create.contentRef ? { objectKey: input.create.contentRef.objectKey } : {}),
      };
      contentRef = input.create.contentRef;
    } else {
      const current = source.find((lesson) => lesson.lessonId === lessonId);
      if (!current) throw notFound("LESSON_NOT_FOUND", "Lesson not found in current Course content");
      const version = receipt.lessonVersion ?? current.lessonVersion + 1;
      receipt.lessonVersion = version;
      changed = { ...applyPatch(current, input.patch ?? {}), lessonVersion: version };
      contentRef = input.patch?.contentRef ?? undefined;
    }
    if (
      source.some(
        (lesson) =>
          lesson.lessonId !== lessonId &&
          lesson.sectionOrder === changed.sectionOrder &&
          lesson.lessonOrder === changed.lessonOrder,
      )
    )
      throw conflict("LESSON_POSITION_CONFLICT", "Another lesson already occupies this position");
    const lessons = [...source.filter((lesson) => lesson.lessonId !== lessonId), changed].sort(compare);
    return { lessons, changed, ...(contentRef ? { contentRef } : {}) };
  }

  private async recoverActivated(
    input: { create?: LessonCreateRequest; patch?: LessonPatchRequest; courseId: string },
    receipt: LessonReceipt,
    lessonId: string,
    now: Date,
  ) {
    const target = receipt.targetContentVersion;
    if (target === undefined) throw unavailable();
    const rows = await this.repository.list(input.courseId, target);
    const lesson = rows.find((candidate) => candidate.lessonId === lessonId);
    if (!lesson) throw unavailable();
    const expectedVersion = input.create ? 1 : receipt.lessonVersion;
    if (expectedVersion !== undefined && lesson.lessonVersion !== expectedVersion) throw unavailable();
    const detail = await this.repository.detail(lessonId, lesson.lessonVersion);
    if (!detail) throw unavailable();
    await this.repository.setPointer(lessonId, lesson.lessonVersion, input.courseId, now);
    return lessonDto(lesson, input.courseId, target);
  }

  private async requireLecturer(actor: ActorContext, requestId: string) {
    if (!actor.roles.includes("LECTURER"))
      throw new AppError("LECTURER_REQUIRED", 403, "Eligible Lecturer authorization is required");
    try {
      await this.identity.get(actor.userId, requestId);
    } catch (error) {
      if (error instanceof IdentityPublicProfileClientError && error.code === "IDENTITY_PROFILE_REJECTED")
        throw new AppError("LECTURER_NOT_ELIGIBLE", 403, "Eligible Lecturer authorization is required");
      throw new AppError(
        "IDENTITY_SERVICE_UNAVAILABLE",
        503,
        "Identity service is temporarily unavailable",
        true,
      );
    }
  }

  private async verifyContent(contentRef: LessonContentRef | undefined) {
    if (!contentRef) return;
    if (!contentRef.objectKey.startsWith("learning/lessons/"))
      throw new AppError("CONTENT_REFERENCE_REJECTED", 422, "contentRef is outside the Learning namespace");
    if (!this.storage) throw unavailable("OBJECT_STORAGE_UNAVAILABLE");
    try {
      if (!(await this.storage.verify(contentRef)))
        throw new AppError("CONTENT_REFERENCE_REJECTED", 422, "contentRef metadata did not verify");
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable("OBJECT_STORAGE_UNAVAILABLE");
    }
  }

  private async readUrl(objectKey: string) {
    if (!this.storage) throw unavailable("OBJECT_STORAGE_UNAVAILABLE");
    try {
      return await this.storage.createReadUrl(objectKey);
    } catch {
      throw unavailable("OBJECT_STORAGE_UNAVAILABLE");
    }
  }
}

function compare(a: LessonSummary, b: LessonSummary) {
  return (
    a.sectionOrder - b.sectionOrder || a.lessonOrder - b.lessonOrder || a.lessonId.localeCompare(b.lessonId)
  );
}
function sameSnapshot(a: readonly LessonSummary[], b: readonly LessonSummary[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function conflict(code: string, message: string) {
  return new AppError(code, 409, message);
}
function notFound(code: string, message: string) {
  return new AppError(code, 404, message);
}
function unavailable(code = "LEARNING_WRITE_UNAVAILABLE") {
  return new AppError(code, 503, "Learning lesson service is temporarily unavailable", true);
}
function requiredNumber(value: number | undefined): number {
  if (value === undefined) throw unavailable();
  return value;
}
