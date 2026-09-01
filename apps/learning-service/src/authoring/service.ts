import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { IdentityPublicProfileClientError, type IdentityPublicProfileClient } from "../identity-client.js";
import {
  commandFingerprint,
  courseFromDto,
  courseDto,
  keyHash,
  newCommandIds,
  type AuthoringCourse,
  type CoursePatchRequest,
  type CourseWriteRequest,
} from "./model.js";
import type { LearningAuthoringRepository } from "./repository.js";

export type LearningAuthoringStore = Pick<
  LearningAuthoringRepository,
  | "reserve"
  | "idempotency"
  | "complete"
  | "checkpoint"
  | "prepareEvent"
  | "readyEvent"
  | "create"
  | "get"
  | "insertProjection"
  | "deleteProjection"
  | "projectionMatches"
  | "update"
>;

export interface AuthoringResult {
  course: ReturnType<typeof courseDto>;
  replayed: boolean;
  noOp: boolean;
}

export class LearningAuthoringService {
  public constructor(
    private readonly repository: LearningAuthoringStore,
    private readonly identity: Pick<IdentityPublicProfileClient, "get">,
    private readonly secret: string,
  ) {}

  public async create(input: {
    actor: ActorContext;
    request: CourseWriteRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AuthoringResult> {
    await this.requireLecturer(input.actor, input.requestId);
    const scope = `lecturer:${input.actor.userId}:LRN-05`;
    const fingerprint = commandFingerprint(this.secret, {
      method: "POST",
      route: "/api/v1/courses",
      actorId: input.actor.userId,
      body: input.request,
    });
    const hashed = keyHash(this.secret, input.idempotencyKey);
    const ids = newCommandIds();
    const now = new Date();
    const initial = { fingerprint, eventId: ids.eventId, occurredAt: now.toISOString() };
    const applied = await this.repository.reserve(scope, hashed, input.idempotencyKey, ids, initial, now);
    const record = await this.repository.idempotency(scope, hashed, input.idempotencyKey);
    if (!record) throw unavailable();
    if (record.receipt.fingerprint !== fingerprint)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request");
    if (!applied && record.status === "COMPLETE" && record.receipt.course)
      return { course: record.receipt.course, replayed: true, noOp: false };
    const operationIds = {
      operationId: record.operationId,
      courseId: record.resourceId,
      eventId: record.receipt.eventId ?? ids.eventId,
    };
    const occurredAt = new Date(record.receipt.occurredAt ?? now.toISOString());
    await this.repository.prepareEvent(operationIds, input.actor.userId, occurredAt, input.requestId);
    const existing = await this.repository.get(operationIds.courseId);
    if (!existing) {
      await this.repository.create(operationIds.courseId, input.actor.userId, input.request, occurredAt);
    }
    const course = await this.repository.get(operationIds.courseId);
    if (!course || !sameCreate(course, input.actor.userId, input.request))
      throw conflict("COURSE_CREATE_CONFLICT", "Course create could not be recovered safely");
    if (!(await this.repository.projectionMatches(course))) await this.repository.insertProjection(course);
    if (!(await this.repository.projectionMatches(course))) throw unavailable();
    await this.repository.readyEvent(operationIds.eventId, occurredAt);
    const dto = courseDto(course);
    await this.repository.complete(scope, hashed, input.idempotencyKey, record.operationId, {
      ...record.receipt,
      course: dto,
    });
    return { course: dto, replayed: !applied, noOp: false };
  }

  public async update(input: {
    actor: ActorContext;
    courseId: string;
    request: CoursePatchRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AuthoringResult> {
    await this.requireLecturer(input.actor, input.requestId);
    const scope = `lecturer:${input.actor.userId}:course:${input.courseId}:LRN-06`;
    const fingerprint = commandFingerprint(this.secret, {
      method: "PATCH",
      route: "/api/v1/courses/{courseId}",
      actorId: input.actor.userId,
      courseId: input.courseId,
      body: input.request,
    });
    const hashed = keyHash(this.secret, input.idempotencyKey);
    const ids = newCommandIds(input.courseId);
    const now = new Date();
    const applied = await this.repository.reserve(
      scope,
      hashed,
      input.idempotencyKey,
      ids,
      { fingerprint },
      now,
    );
    const record = await this.repository.idempotency(scope, hashed, input.idempotencyKey);
    if (!record) throw unavailable();
    if (record.receipt.fingerprint !== fingerprint)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request");
    if (!applied && record.status === "COMPLETE" && record.receipt.course)
      return { course: record.receipt.course, replayed: true, noOp: false };
    const current = await this.repository.get(input.courseId);
    if (!current) throw new AppError("COURSE_NOT_FOUND", 404, "Course not found");
    if (current.ownerLecturerId !== input.actor.userId)
      throw new AppError("COURSE_OWNER_REQUIRED", 403, "Course owner authorization is required");
    if (current.state !== "DRAFT")
      throw conflict("COURSE_NOT_EDITABLE", "Only DRAFT course metadata can be updated");
    if (!record.receipt.oldCourse && isNoOp(current, input.request)) {
      const dto = courseDto(current);
      await this.repository.complete(scope, hashed, input.idempotencyKey, record.operationId, {
        fingerprint,
        course: dto,
      });
      return { course: dto, replayed: !applied, noOp: true };
    }
    const old = record.receipt.oldCourse ? courseFromDto(record.receipt.oldCourse) : current;
    if (!record.receipt.oldCourse) {
      record.receipt.oldCourse = courseDto(old);
      await this.repository.checkpoint(
        scope,
        hashed,
        input.idempotencyKey,
        record.operationId,
        record.receipt,
      );
    }
    const alreadyCommitted =
      current.recordVersion === old.recordVersion + 1 && matchesPatch(current, input.request);
    const won = alreadyCommitted ? false : await this.repository.update(old, input.request, now);
    const updated = alreadyCommitted ? current : await this.repository.get(input.courseId);
    if (
      !won &&
      (!updated || !matchesPatch(updated, input.request) || updated.recordVersion !== old.recordVersion + 1)
    )
      throw conflict("VERSION_CONFLICT", "Course was updated concurrently");
    if (!updated) throw unavailable();
    await this.repository.deleteProjection(old);
    if (!(await this.repository.projectionMatches(updated))) await this.repository.insertProjection(updated);
    if (!(await this.repository.projectionMatches(updated))) throw unavailable();
    const dto = courseDto(updated);
    await this.repository.complete(scope, hashed, input.idempotencyKey, record.operationId, {
      fingerprint,
      course: dto,
    });
    return { course: dto, replayed: !applied, noOp: false };
  }

  private async requireLecturer(actor: ActorContext, requestId: string): Promise<void> {
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
}

function isNoOp(c: AuthoringCourse, p: CoursePatchRequest) {
  return Object.entries(p).every(([k, v]) => c[k as keyof AuthoringCourse] === v);
}
function matchesPatch(c: AuthoringCourse, p: CoursePatchRequest) {
  return Object.entries(p).every(([k, v]) => c[k as keyof AuthoringCourse] === v);
}
function sameCreate(c: AuthoringCourse, owner: string, r: CourseWriteRequest) {
  return (
    c.ownerLecturerId === owner &&
    c.state === "DRAFT" &&
    c.recordVersion === 1 &&
    c.contentVersion === 1 &&
    matchesPatch(c, r)
  );
}
function conflict(code: string, message: string) {
  return new AppError(code, 409, message);
}
function unavailable() {
  return new AppError(
    "LEARNING_WRITE_UNAVAILABLE",
    503,
    "Learning authoring is temporarily unavailable",
    true,
  );
}
