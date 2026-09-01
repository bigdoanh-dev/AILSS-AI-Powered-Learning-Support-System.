import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { commandFingerprint, keyHash } from "../authoring/model.js";
import {
  ClassroomOfferingContextClientError,
  type ClassroomOfferingContextClient,
} from "../classroom-client.js";
import { IdentityPublicProfileClientError, type IdentityPublicProfileClient } from "../identity-client.js";
import {
  decodeOfferingCursor,
  encodeOfferingCursor,
  mergePatch,
  month,
  offeringDto,
  type Offering,
  type OfferingPatchRequest,
  type OfferingType,
  type OfferingWriteRequest,
} from "./model.js";
import type { LearningOfferingRepository } from "./repository.js";

export class LearningOfferingService {
  public constructor(
    private readonly repo: LearningOfferingRepository,
    private readonly identity: Pick<IdentityPublicProfileClient, "get">,
    private readonly secret: string,
    private readonly classroom: Pick<ClassroomOfferingContextClient, "get">,
  ) {}
  public async create(input: {
    courseId: string;
    actor: ActorContext;
    request: OfferingWriteRequest;
    idempotencyKey: string;
    requestId: string;
  }) {
    await this.requireLecturer(input.actor, input.requestId);
    const course = await this.ownedPublishedCourse(input.courseId, input.actor.userId);
    const fingerprint = commandFingerprint(this.secret, {
      method: "POST",
      route: "/api/v1/courses/{courseId}/offerings",
      actorId: input.actor.userId,
      courseId: input.courseId,
      body: input.request,
    });
    const scope = `LRN-24:${input.actor.userId}:course:${input.courseId}`,
      hash = keyHash(this.secret, input.idempotencyKey),
      operationId = randomUUID(),
      proposed = randomUUID(),
      now = new Date();
    const applied = await this.repo.reserve(
      scope,
      hash,
      input.idempotencyKey,
      operationId,
      proposed,
      { fingerprint, occurredAt: now.toISOString() },
      now,
    );
    const command = await this.repo.command(scope, hash, input.idempotencyKey);
    if (!command) throw unavailable();
    if (command.receipt.fingerprint !== fingerprint)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with another request");
    if (command.status === "COMPLETE" && command.receipt.offering)
      return { offering: command.receipt.offering, replayed: true, noOp: false };
    const commandTime = new Date(command.receipt.occurredAt ?? now.toISOString());
    let value = await this.repo.get(command.resourceId);
    if (!value) {
      value = {
        offeringId: command.resourceId,
        courseId: course.courseId,
        ownerLecturerId: input.actor.userId,
        offeringType: input.request.offeringType,
        ...(input.request.classId ? { classId: input.request.classId } : {}),
        title: input.request.title,
        state: "DRAFT",
        price: input.request.price,
        currency: input.request.currency,
        ...(input.request.salesStartAt ? { salesStartAt: new Date(input.request.salesStartAt) } : {}),
        ...(input.request.salesEndAt ? { salesEndAt: new Date(input.request.salesEndAt) } : {}),
        recordVersion: 1,
        createdAt: commandTime,
        updatedAt: commandTime,
      };
      try {
        await this.repo.create(value);
      } catch {
        // Resolve an ambiguous create LWT through the canonical read below.
      }
      value = await this.repo.get(command.resourceId);
    }
    if (!value || value.courseId !== course.courseId || value.ownerLecturerId !== input.actor.userId)
      throw conflict("OFFERING_CREATE_CONFLICT", "Offering create could not be recovered");
    await this.repo.syncPrivate(value);
    const dto = offeringDto(value);
    await this.repo.complete(
      scope,
      hash,
      input.idempotencyKey,
      command.operationId,
      { ...command.receipt, offering: dto },
      201,
    );
    return { offering: dto, replayed: !applied, noOp: false };
  }
  public async patch(input: {
    offeringId: string;
    actor: ActorContext;
    request: OfferingPatchRequest;
    idempotencyKey: string;
    requestId: string;
  }) {
    await this.requireLecturer(input.actor, input.requestId);
    return this.change("LRN-25", input, async (old, now) => {
      const next = {
        ...mergePatch(old, input.request),
        recordVersion: old.recordVersion + 1,
        updatedAt: now,
      };
      if (sameEditable(old, next)) return old;
      try {
        if (!(await this.repo.update(old, next)))
          throw conflict("OFFERING_VERSION_CONFLICT", "Offering was changed concurrently");
      } catch (error) {
        if (error instanceof AppError) throw error;
        const recovered = await this.repo.get(old.offeringId);
        if (recovered?.recordVersion === next.recordVersion && sameEditable(recovered, next))
          return recovered;
        throw unavailable();
      }
      return (await this.repo.get(old.offeringId)) ?? next;
    });
  }
  public async publish(input: {
    offeringId: string;
    actor: ActorContext;
    idempotencyKey: string;
    requestId: string;
  }) {
    await this.requireLecturer(input.actor, input.requestId);
    return this.change("LRN-26", input, async (old, now) => {
      if (old.offeringType === "LIVE_COHORT") {
        if (!old.classId)
          throw conflict("LIVE_COHORT_CLASS_REQUIRED", "LIVE_COHORT Offering requires a linked Class");
        const context = await this.classroomContext(old.classId, input.requestId);
        if (
          context.classKind !== "LIVE_COHORT" ||
          context.classState !== "ACTIVE" ||
          context.linkedCourseId !== old.courseId ||
          context.ownerLecturerId !== old.ownerLecturerId ||
          context.scheduleState !== "PUBLISHED" ||
          context.sessionCount <= 0
        )
          throw conflict("LIVE_COHORT_CLASS_NOT_ELIGIBLE", "Linked Class is not eligible for publication");
        const claimed = await this.repo.claimClass(
          old.classId,
          old.offeringId,
          old.courseId,
          old.recordVersion,
          now,
        );
        if (!claimed) {
          const claim = await this.repo.classClaim(old.classId);
          if (!claim || claim.offeringId !== old.offeringId)
            throw conflict("CLASS_ALREADY_OFFERED", "Class is already linked to another Offering");
        }
        const publishedAt = old.publishedAt ?? now;
        const next = {
          ...old,
          state: "PUBLISHED" as const,
          recordVersion: old.recordVersion + 1,
          updatedAt: now,
          publishedAt,
        };
        await this.repo.writePublic(next);
        let won = false;
        try {
          won = await this.repo.publish(old, next);
        } catch {
          // Resolve an ambiguous publish LWT through the canonical read-back below.
        }
        if (!won) {
          const recovered = await this.repo.get(old.offeringId);
          if (recovered?.state !== "PUBLISHED") {
            const claim = await this.repo.classClaim(old.classId);
            if (claim && claim.offeringId === old.offeringId && claim.state === "CLAIMED")
              await this.repo.releaseClassClaim(old.classId, old.offeringId);
            throw conflict("OFFERING_VERSION_CONFLICT", "Offering was changed concurrently");
          }
          await this.repo.finalizeClassClaim(old.classId, old.offeringId, recovered.recordVersion);
          return recovered;
        }
        await this.repo.finalizeClassClaim(old.classId, old.offeringId, next.recordVersion);
        return (await this.repo.get(old.offeringId)) ?? next;
      }
      const publishedAt = old.publishedAt ?? now;
      const next = {
        ...old,
        state: "PUBLISHED" as const,
        recordVersion: old.recordVersion + 1,
        updatedAt: now,
        publishedAt,
      };
      await this.repo.writePublic(next);
      let won = false;
      try {
        won = await this.repo.publish(old, next);
      } catch {
        // Resolve an ambiguous publish LWT through Q-LRN-017.
      }
      if (!won) {
        const recovered = await this.repo.get(old.offeringId);
        if (recovered?.state !== "PUBLISHED")
          throw conflict("OFFERING_VERSION_CONFLICT", "Offering was changed concurrently");
        return recovered;
      }
      return (await this.repo.get(old.offeringId)) ?? next;
    });
  }
  private async change(
    operation: "LRN-25" | "LRN-26",
    input: {
      offeringId: string;
      actor: ActorContext;
      request?: OfferingPatchRequest;
      idempotencyKey: string;
    },
    apply: (old: Offering, now: Date) => Promise<Offering>,
  ) {
    const fingerprint = commandFingerprint(this.secret, {
      method: operation === "LRN-25" ? "PATCH" : "POST",
      route:
        operation === "LRN-25" ? "/api/v1/offerings/{offeringId}" : "/api/v1/offerings/{offeringId}/publish",
      actorId: input.actor.userId,
      offeringId: input.offeringId,
      ...(input.request ? { body: input.request } : {}),
    });
    const scope = `${operation}:${input.actor.userId}:offering:${input.offeringId}`,
      hash = keyHash(this.secret, input.idempotencyKey),
      operationId = randomUUID(),
      now = new Date();
    const applied = await this.repo.reserve(
      scope,
      hash,
      input.idempotencyKey,
      operationId,
      input.offeringId,
      { fingerprint, occurredAt: now.toISOString() },
      now,
    );
    const command = await this.repo.command(scope, hash, input.idempotencyKey);
    if (!command) throw unavailable();
    if (command.receipt.fingerprint !== fingerprint)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with another request");
    if (command.status === "COMPLETE" && command.receipt.offering)
      return { offering: command.receipt.offering, replayed: true, noOp: false };
    const old = await this.repo.get(input.offeringId);
    if (!old) throw notFound();
    if (old.ownerLecturerId !== input.actor.userId)
      throw new AppError("OFFERING_OWNER_REQUIRED", 403, "Offering owner authorization is required");
    await this.ownedPublishedCourse(old.courseId, input.actor.userId);
    const receipt = command.receipt;
    if (receipt.oldUpdatedAt && receipt.expectedVersion !== undefined) {
      const recoveredPatch =
        operation === "LRN-25" &&
        old.recordVersion === receipt.expectedVersion + 1 &&
        sameEditable(old, mergePatch(old, input.request ?? {}));
      const recoveredPublish =
        operation === "LRN-26" &&
        old.recordVersion === receipt.expectedVersion + 1 &&
        old.state === "PUBLISHED" &&
        old.publishedAt?.toISOString() === receipt.publishedAt;
      if (recoveredPatch || recoveredPublish) {
        if (recoveredPublish && old.classId)
          await this.repo.finalizeClassClaim(old.classId, old.offeringId, old.recordVersion);
        await this.repo.syncPrivate(old, new Date(receipt.oldUpdatedAt));
        const dto = offeringDto(old);
        await this.repo.complete(
          scope,
          hash,
          input.idempotencyKey,
          command.operationId,
          { ...receipt, offering: dto },
          200,
        );
        return { offering: dto, replayed: true, noOp: false };
      }
    }
    if (old.state !== "DRAFT") throw conflict("OFFERING_NOT_EDITABLE", "Only DRAFT Offering may be changed");
    const occurredAt = new Date(receipt.occurredAt ?? now.toISOString());
    const prepared = {
      ...receipt,
      occurredAt: occurredAt.toISOString(),
      oldUpdatedAt: old.updatedAt.toISOString(),
      expectedVersion: old.recordVersion,
      ...(operation === "LRN-26" ? { publishedAt: occurredAt.toISOString() } : {}),
    };
    await this.repo.checkpoint(scope, hash, input.idempotencyKey, command.operationId, prepared);
    const next = await apply(old, occurredAt),
      noOp = next.recordVersion === old.recordVersion;
    await this.repo.syncPrivate(next, noOp ? undefined : old.updatedAt);
    const dto = offeringDto(next);
    await this.repo.complete(
      scope,
      hash,
      input.idempotencyKey,
      command.operationId,
      {
        ...prepared,
        offering: dto,
        ...(next.publishedAt ? { publishedAt: next.publishedAt.toISOString() } : {}),
      },
      200,
    );
    return { offering: dto, replayed: !applied, noOp };
  }
  public async detail(id: string) {
    const v = await this.repo.get(id);
    if (!v || !(await this.publiclyVisible(v))) throw notFound();
    return offeringDto(v);
  }
  public async byCourse(input: { courseId: string; actor?: ActorContext; requestId: string }) {
    const course = await this.repo.course(input.courseId);
    if (!course) throw new AppError("COURSE_NOT_FOUND", 404, "Course not found");
    const owner = input.actor?.userId === course.ownerLecturerId;
    if (owner && input.actor) {
      await this.requireLecturer(input.actor, input.requestId);
      return (await this.repo.listCourse(input.courseId)).map(offeringDto);
    }
    if (course.state !== "PUBLISHED") throw new AppError("COURSE_NOT_FOUND", 404, "Course not found");
    const values = await this.repo.listCourse(input.courseId);
    return values.filter((v) => v.state === "PUBLISHED").map(offeringDto);
  }
  public async owned(input: { actor: ActorContext; requestId: string }) {
    await this.requireLecturer(input.actor, input.requestId);
    return (await this.repo.listLecturer(input.actor.userId)).map(offeringDto);
  }
  public async catalog(input: { type: OfferingType; cursor?: string; limit: number }) {
    const filtersHash = commandFingerprint(this.secret, { type: input.type });
    let windowEnd: string,
      positions: Record<string, [string, string]> = {};
    if (input.cursor) {
      let c;
      try {
        c = decodeOfferingCursor(this.secret, input.cursor);
      } catch {
        throw new AppError("INVALID_CURSOR", 400, "Invalid offering catalog cursor");
      }
      if (c.type !== input.type || c.filtersHash !== filtersHash)
        throw new AppError("INVALID_CURSOR", 400, "Cursor does not match filters");
      windowEnd = c.windowEnd;
      positions = c.positions;
    } else {
      const bounds = await this.repo.bounds(input.type);
      if (!bounds) return { items: [], nextCursor: undefined };
      windowEnd = bounds.newest;
    }
    const months = [windowEnd, previousMonth(windowEnd)],
      candidates: Offering[] = [];
    for (const m of months)
      for (let s = 0; s < 8; s++)
        candidates.push(
          ...(await this.repo.listPublic(input.type, m, s, input.limit + 1, positions[`${m}:${String(s)}`])),
        );
    const visible: Offering[] = [];
    for (const v of candidates.sort(compare)) {
      if ((await this.publiclyVisible(v)) && !visible.some((x) => x.offeringId === v.offeringId))
        visible.push(v);
    }
    const page = visible.slice(0, input.limit);
    for (const v of page) {
      if (!v.publishedAt) continue;
      positions[`${month(v.publishedAt)}:${String(offeringShard(v.offeringId))}`] = [
        v.publishedAt.toISOString(),
        v.offeringId,
      ];
    }
    let nextCursor: string | undefined;
    if (visible.length > input.limit)
      nextCursor = encodeOfferingCursor(this.secret, {
        v: 1,
        type: input.type,
        windowEnd,
        positions,
        filtersHash,
        exp: Math.floor(Date.now() / 1000) + 900,
      });
    else {
      const bounds = await this.repo.bounds(input.type);
      const older = previousMonth(previousMonth(windowEnd));
      if (bounds && older >= bounds.oldest)
        nextCursor = encodeOfferingCursor(this.secret, {
          v: 1,
          type: input.type,
          windowEnd: older,
          positions: {},
          filtersHash,
          exp: Math.floor(Date.now() / 1000) + 900,
        });
    }
    return { items: page.map(offeringDto), ...(nextCursor ? { nextCursor } : {}) };
  }
  private async publiclyVisible(v: Offering) {
    if (v.state !== "PUBLISHED") return false;
    const c = await this.repo.course(v.courseId);
    return c?.state === "PUBLISHED";
  }
  private async ownedPublishedCourse(id: string, owner: string) {
    const c = await this.repo.course(id);
    if (!c) throw new AppError("COURSE_NOT_FOUND", 404, "Course not found");
    if (c.ownerLecturerId !== owner)
      throw new AppError("COURSE_OWNER_REQUIRED", 403, "Course owner authorization is required");
    if (c.state !== "PUBLISHED") throw conflict("COURSE_NOT_PUBLISHED", "Course must be PUBLISHED");
    return c;
  }
  private async requireLecturer(actor: ActorContext, requestId: string) {
    if (!actor.roles.includes("LECTURER"))
      throw new AppError("LECTURER_REQUIRED", 403, "Eligible Lecturer authorization is required");
    try {
      await this.identity.get(actor.userId, requestId);
    } catch (e) {
      if (e instanceof IdentityPublicProfileClientError && e.code === "IDENTITY_PROFILE_REJECTED")
        throw new AppError("LECTURER_NOT_ELIGIBLE", 403, "Eligible Lecturer authorization is required");
      throw new AppError(
        "IDENTITY_SERVICE_UNAVAILABLE",
        503,
        "Identity service is temporarily unavailable",
        true,
      );
    }
  }
  private async classroomContext(classId: string, requestId: string) {
    try {
      return await this.classroom.get(classId, requestId);
    } catch (e) {
      if (e instanceof ClassroomOfferingContextClientError && e.code === "CLASSROOM_CONTEXT_REJECTED")
        throw conflict("LIVE_COHORT_CLASS_NOT_AVAILABLE", "Linked Class is not available");
      throw new AppError(
        "CLASSROOM_SERVICE_UNAVAILABLE",
        503,
        "Classroom service is temporarily unavailable",
        true,
      );
    }
  }
}
function sameEditable(a: Offering, b: Offering) {
  return (
    a.title === b.title &&
    a.price === b.price &&
    a.currency === b.currency &&
    a.salesStartAt?.getTime() === b.salesStartAt?.getTime() &&
    a.salesEndAt?.getTime() === b.salesEndAt?.getTime()
  );
}
function compare(a: Offering, b: Offering) {
  return (
    (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) ||
    a.offeringId.localeCompare(b.offeringId)
  );
}
function previousMonth(v: string) {
  const d = new Date(`${v}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7) + "-01";
}
function offeringShard(id: string) {
  return (createHash("sha256").update(id).digest()[0] ?? 0) % 8;
}
function conflict(code: string, message: string) {
  return new AppError(code, 409, message);
}
function notFound() {
  return new AppError("OFFERING_NOT_FOUND", 404, "Offering not found");
}
function unavailable() {
  return new AppError(
    "LEARNING_WRITE_UNAVAILABLE",
    503,
    "Learning Offering service is temporarily unavailable",
    true,
  );
}
