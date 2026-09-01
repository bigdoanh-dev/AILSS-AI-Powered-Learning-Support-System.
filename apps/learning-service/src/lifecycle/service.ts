import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext, StepUpAction } from "../../../../packages/security/src/index.js";
import { learningShard, searchProjectionTokens } from "../catalog/model.js";
import { IdentityPublicProfileClientError, type IdentityPublicProfileClient } from "../identity-client.js";
import {
  commandFingerprint,
  courseDto,
  courseFromDto,
  keyHash,
  newCommandIds,
  type AuthoringCourse,
  type CommandReceipt,
} from "../authoring/model.js";
import type { LearningAuthoringRepository } from "../authoring/repository.js";
import type { LearningReconciliationRepository } from "../reconciliation/repository.js";
import type { LearningLifecycleRepository } from "./repository.js";

type CommandStore = Pick<
  LearningAuthoringRepository,
  | "reserve"
  | "idempotency"
  | "checkpoint"
  | "complete"
  | "get"
  | "deleteProjection"
  | "insertProjection"
  | "projectionMatches"
  | "readyEvent"
>;
type LifecycleStore = Pick<
  LearningLifecycleRepository,
  | "allLessonsReady"
  | "transition"
  | "claimSlug"
  | "writePublicProjections"
  | "publicProjectionsMatch"
  | "prepareEvent"
>;
type ReconcileStore = Pick<LearningReconciliationRepository, "schedule">;

export interface LifecycleResult {
  course: ReturnType<typeof courseDto>;
  replayed: boolean;
}

export class LearningLifecycleService {
  public constructor(
    private readonly commands: CommandStore,
    private readonly lifecycle: LifecycleStore,
    private readonly reconciliation: ReconcileStore,
    private readonly identity: Pick<IdentityPublicProfileClient, "get">,
    private readonly verifyAdminProof: (input: {
      proof: string;
      actor: ActorContext;
      action: StepUpAction;
      resourceId: string;
    }) => Promise<unknown>,
    private readonly secret: string,
  ) {}

  public async submitReview(input: {
    actor: ActorContext;
    courseId: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<LifecycleResult> {
    await this.requireLecturer(input.actor, input.requestId);
    return this.runTransition({
      ...input,
      operation: "LRN-07",
      route: "/api/v1/courses/{courseId}/submit-review",
      from: "DRAFT",
      to: "IN_REVIEW",
      before: async (course) => {
        if (!(await this.lifecycle.allLessonsReady(course.courseId, course.contentVersion)))
          throw conflict(
            "COURSE_CONTENT_NOT_READY",
            "Every lesson in the current content version must be READY",
          );
      },
    });
  }

  public async publish(input: {
    actor: ActorContext;
    proof: string;
    courseId: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<LifecycleResult> {
    await this.requireAdmin(input.actor, input.proof, "COURSE_PUBLISH", input.courseId);
    return this.runTransition({
      ...input,
      operation: "LRN-08",
      route: "/api/v1/admin/courses/{courseId}/publish",
      from: "IN_REVIEW",
      to: "PUBLISHED",
      eventType: "learning.course.published.v1",
      before: async (course, record, ids) => {
        const publishedAt = new Date(record.receipt.publishedAt ?? receiptTime(record.receipt));
        const version = course.recordVersion + 1;
        await this.lifecycle.prepareEvent({
          ids,
          eventType: "learning.course.published.v1",
          version,
          occurredAt: new Date(receiptTime(record.receipt)),
          correlationId: input.requestId,
          data: { courseId: course.courseId, lecturerId: course.ownerLecturerId, version },
        });
        if ((await this.lifecycle.claimSlug(course, version, publishedAt)) === "CONFLICT")
          throw conflict("SLUG_CONFLICT", "The course slug is already reserved");
        const tokens = searchProjectionTokens(course.title);
        await this.lifecycle.writePublicProjections(course, version, publishedAt, tokens);
        if (!(await this.lifecycle.publicProjectionsMatch(course, version, publishedAt, tokens)))
          throw unavailable();
      },
    });
  }

  public async archive(input: {
    actor: ActorContext;
    proof: string;
    courseId: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<LifecycleResult> {
    await this.requireAdmin(input.actor, input.proof, "COURSE_ARCHIVE", input.courseId);
    return this.runTransition({
      ...input,
      operation: "LRN-09",
      route: "/api/v1/admin/courses/{courseId}/archive",
      from: "PUBLISHED",
      to: "ARCHIVED",
      eventType: "system.projection.reconcile.v1",
      before: async (course, record, ids) => {
        const version = course.recordVersion + 1;
        await this.lifecycle.prepareEvent({
          ids,
          eventType: "system.projection.reconcile.v1",
          version,
          occurredAt: new Date(receiptTime(record.receipt)),
          correlationId: input.requestId,
          data: {
            projectionName: "COURSE_PUBLIC_ARCHIVE_CLEANUP",
            canonicalId: course.courseId,
            canonicalVersion: version,
          },
        });
      },
      after: async (course, record) => {
        if (!course.publishedAt) throw unavailable();
        const tokens = searchProjectionTokens(course.title);
        await this.reconciliation.schedule({
          operationId: record.operationId,
          projectionName: "COURSE_PUBLIC_ARCHIVE_CLEANUP",
          canonicalId: course.courseId,
          canonicalVersion: course.recordVersion,
          checksum: JSON.stringify({
            schemaVersion: 1,
            categoryId: course.categoryId,
            publishedAt: course.publishedAt.toISOString(),
            searchTokens: tokens,
          }),
          now: new Date(receiptTime(record.receipt)),
          shard: learningShard(record.operationId) % 16,
        });
      },
    });
  }

  private async runTransition(input: {
    actor: ActorContext;
    courseId: string;
    idempotencyKey: string;
    requestId: string;
    operation: "LRN-07" | "LRN-08" | "LRN-09";
    route: string;
    from: "DRAFT" | "IN_REVIEW" | "PUBLISHED";
    to: "IN_REVIEW" | "PUBLISHED" | "ARCHIVED";
    eventType?: "learning.course.published.v1" | "system.projection.reconcile.v1";
    before(
      course: AuthoringCourse,
      record: NonNullable<Awaited<ReturnType<CommandStore["idempotency"]>>>,
      ids: ReturnType<typeof newCommandIds>,
    ): Promise<void>;
    after?(
      course: AuthoringCourse,
      record: NonNullable<Awaited<ReturnType<CommandStore["idempotency"]>>>,
    ): Promise<void>;
  }): Promise<LifecycleResult> {
    const scope = `${input.operation}:${input.actor.userId}:course:${input.courseId}`;
    const fingerprint = commandFingerprint(this.secret, {
      method: "POST",
      route: input.route,
      actorId: input.actor.userId,
      courseId: input.courseId,
    });
    const hashed = keyHash(this.secret, input.idempotencyKey);
    const ids = newCommandIds(input.courseId);
    const now = new Date();
    const initial: CommandReceipt = {
      fingerprint,
      occurredAt: now.toISOString(),
      ...(input.eventType ? { eventId: ids.eventId } : {}),
      ...(input.to === "PUBLISHED" ? { publishedAt: now.toISOString() } : {}),
    };
    const applied = await this.commands.reserve(scope, hashed, input.idempotencyKey, ids, initial, now);
    const record = await this.commands.idempotency(scope, hashed, input.idempotencyKey);
    if (!record) throw unavailable();
    if (record.receipt.fingerprint !== fingerprint)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request");
    if (!applied && record.status === "COMPLETE" && record.receipt.course)
      return { course: record.receipt.course, replayed: true };

    let current = await this.commands.get(input.courseId);
    if (!current) throw new AppError("COURSE_NOT_FOUND", 404, "Course not found");
    if (input.operation === "LRN-07" && current.ownerLecturerId !== input.actor.userId)
      throw new AppError("COURSE_OWNER_REQUIRED", 403, "Course owner authorization is required");
    let old = record.receipt.oldCourse ? courseFromDto(record.receipt.oldCourse) : undefined;
    if (!old) {
      if (current.state !== input.from)
        throw conflict("COURSE_STATE_CONFLICT", `Course must be ${input.from}`);
      old = current;
      record.receipt.oldCourse = courseDto(old);
      await this.commands.checkpoint(scope, hashed, input.idempotencyKey, record.operationId, record.receipt);
    }
    const operationIds = {
      operationId: record.operationId,
      courseId: input.courseId,
      eventId: record.receipt.eventId ?? ids.eventId,
    };
    if (current.state === input.from && current.recordVersion === old.recordVersion) {
      await input.before(old, record, operationIds);
      const publishedAt = record.receipt.publishedAt ? new Date(record.receipt.publishedAt) : undefined;
      await this.commands.get(input.courseId); // bounded revalidation immediately before LWT
      try {
        await this.lifecycle.transition(
          old,
          input.from,
          input.to,
          new Date(receiptTime(record.receipt)),
          publishedAt,
        );
      } catch {
        const resolved = await this.commands.get(input.courseId);
        if (resolved?.state === input.from && resolved.recordVersion === old.recordVersion)
          await this.lifecycle.transition(
            old,
            input.from,
            input.to,
            new Date(receiptTime(record.receipt)),
            publishedAt,
          );
        else if (resolved?.state !== input.to || resolved.recordVersion !== old.recordVersion + 1)
          throw conflict("VERSION_CONFLICT", "Course lifecycle outcome is incompatible");
      }
      current = await this.commands.get(input.courseId);
    }
    if (!current || current.state !== input.to || current.recordVersion !== old.recordVersion + 1)
      throw conflict("VERSION_CONFLICT", "Course lifecycle was changed concurrently");
    await this.commands.deleteProjection(old);
    if (!(await this.commands.projectionMatches(current))) await this.commands.insertProjection(current);
    if (!(await this.commands.projectionMatches(current))) throw unavailable();
    await input.after?.(current, record);
    if (input.eventType)
      await this.commands.readyEvent(operationIds.eventId, new Date(receiptTime(record.receipt)));
    const dto = courseDto(current);
    await this.commands.complete(scope, hashed, input.idempotencyKey, record.operationId, {
      ...record.receipt,
      course: dto,
    });
    return { course: dto, replayed: !applied };
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

  private async requireAdmin(actor: ActorContext, proof: string, action: StepUpAction, resourceId: string) {
    if (!actor.roles.includes("ADMIN"))
      throw new AppError("ADMIN_REQUIRED", 403, "Admin authorization is required");
    try {
      await this.verifyAdminProof({ proof, actor, action, resourceId });
    } catch {
      throw new AppError(
        "INVALID_ADMIN_STEP_UP_PROOF",
        403,
        "A current Admin authorization proof is required",
      );
    }
  }
}

function conflict(code: string, message: string) {
  return new AppError(code, 409, message);
}
function unavailable() {
  return new AppError(
    "LEARNING_WRITE_UNAVAILABLE",
    503,
    "Learning lifecycle is temporarily unavailable",
    true,
  );
}
function receiptTime(receipt: CommandReceipt): string {
  if (!receipt.occurredAt) throw unavailable();
  return receipt.occurredAt;
}
