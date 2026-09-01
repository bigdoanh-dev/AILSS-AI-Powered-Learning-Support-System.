import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { progressDto, progressFingerprint, type CompletionRequest, type Progress } from "./model.js";
import type { LearningProgressRepository } from "./repository.js";

export class LearningProgressService {
  constructor(
    private repo: LearningProgressRepository,
    private secret: string,
  ) {}

  async read(courseId: string, actor: ActorContext) {
    student(actor);
    await this.eligible(actor.userId, courseId);
    const current = await this.repo.progress(actor.userId, courseId);
    if (current) return progressDto(current);
    const course = await this.repo.course(courseId);
    if (!course || course.state !== "PUBLISHED") throw notFound();
    const lessons = await this.repo.syllabus(courseId, course.contentVersion),
      now = new Date();
    return progressDto({
      studentId: actor.userId,
      courseId,
      progressVersion: 0,
      courseContentVersion: course.contentVersion,
      completedCount: 0,
      publishedTotal: lessons.length,
      percent: 0,
      updatedAt: now,
    });
  }

  async complete(input: {
    lessonId: string;
    request: CompletionRequest;
    key: string;
    actor: ActorContext;
    correlationId: string;
  }): Promise<{ data: ReturnType<typeof progressDto>; replayed: boolean; noOp: boolean }> {
    student(input.actor);
    const scope = `student:${input.actor.userId}:lesson:${input.lessonId}:LRN-18`,
      hash = (Buffer.from(input.key)[0] ?? 0) % 16;
    const fingerprint = progressFingerprint(this.secret, {
      method: "PUT",
      route: `/api/v1/lessons/${input.lessonId}/completion`,
      actorId: input.actor.userId,
      request: input.request,
    });
    let command = await this.repo.command(scope, hash, input.key);
    if (command) {
      if (command.receipt.fingerprint !== fingerprint)
        throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used for another request");
      if (command.status === "COMPLETE" && command.receipt.response)
        return { data: command.receipt.response, replayed: true, noOp: command.receipt.noOp === true };
    }
    if (!command) {
      const receipt = {
        fingerprint,
        operationId: randomUUID(),
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
      };
      const reserved = await this.repo.reserve(
        scope,
        hash,
        input.key,
        receipt.operationId,
        input.lessonId,
        receipt,
        new Date(),
      );
      if (!reserved) {
        command = await this.repo.command(scope, hash, input.key);
        if (!command) throw conflict("PROGRESS_COMMAND_CONFLICT", "Progress command reservation conflicted");
        if (command.receipt.fingerprint !== fingerprint)
          throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used for another request");
        if (command.status === "COMPLETE" && command.receipt.response)
          return { data: command.receipt.response, replayed: true, noOp: command.receipt.noOp === true };
      } else command = { operationId: receipt.operationId, status: "IN_PROGRESS", receipt };
    }
    const receipt = command.receipt,
      now = new Date(receipt.occurredAt),
      pointer = await this.repo.lesson(input.lessonId);
    if (!pointer) throw notFound();
    await this.eligible(input.actor.userId, pointer.courseId);
    let locked = false;
    for (let attempt = 0; attempt < 8 && !locked; attempt += 1) {
      locked = await this.repo.lock(input.actor.userId, pointer.courseId, receipt.operationId, new Date());
      if (!locked) await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
    if (!locked) throw conflict("PROGRESS_MUTATION_BUSY", "Progress mutation is in progress");
    try {
      const course = await this.repo.course(pointer.courseId);
      if (!course || course.state !== "PUBLISHED") throw notFound();
      const syllabus = await this.repo.syllabus(pointer.courseId, course.contentVersion);
      if (!syllabus.includes(input.lessonId)) throw notFound();
      let old = await this.repo.progress(input.actor.userId, pointer.courseId);
      if (old?.lastOperationId === receipt.operationId) {
        const response = progressDto(old);
        await this.repo.readyEvent(receipt.eventId, now);
        await this.repo.save(scope, hash, input.key, receipt.operationId, { ...receipt, response }, true);
        return { data: response, replayed: true, noOp: false };
      }
      let completions = await this.repo.completions(input.actor.userId, pointer.courseId),
        existing = completions.find((x) => x.lessonId === input.lessonId);
      if (existing?.completed === input.request.completed || (!existing && !input.request.completed)) {
        const current =
          old ??
          zero(input.actor.userId, pointer.courseId, course.contentVersion, syllabus.length, new Date());
        const response = progressDto(current);
        await this.repo.save(
          scope,
          hash,
          input.key,
          receipt.operationId,
          { ...receipt, response, noOp: true },
          true,
        );
        return { data: response, replayed: false, noOp: true };
      }
      if (
        !(await this.repo.setCompletion(
          input.actor.userId,
          pointer.courseId,
          input.lessonId,
          pointer.lessonVersion,
          input.request.completed,
          receipt.operationId,
          new Date(),
          existing ? { version: existing.version } : undefined,
        ))
      ) {
        completions = await this.repo.completions(input.actor.userId, pointer.courseId);
        existing = completions.find((x) => x.lessonId === input.lessonId);
        if (existing?.operationId !== receipt.operationId && existing?.completed !== input.request.completed)
          throw conflict("VERSION_CONFLICT", "Concurrent completion won");
      }
      completions = await this.repo.completions(input.actor.userId, pointer.courseId);
      const set = new Set(syllabus),
        count = completions.filter((x) => x.completed && set.has(x.lessonId)).length,
        total = syllabus.length,
        version = (old?.progressVersion ?? 0) + 1;
      const progress: Progress = {
        studentId: input.actor.userId,
        courseId: pointer.courseId,
        progressVersion: version,
        courseContentVersion: course.contentVersion,
        completedCount: count,
        publishedTotal: total,
        percent: total ? Number(((count * 100) / total).toFixed(6)) : 0,
        ...(total > 0 && count === total ? { completedAt: new Date() } : {}),
        updatedAt: new Date(),
        lastOperationId: receipt.operationId,
        lastEventId: receipt.eventId,
      };
      if (
        !(await this.repo.writeProgress(progress, receipt.operationId, receipt.eventId, old?.progressVersion))
      ) {
        const read = await this.repo.progress(input.actor.userId, pointer.courseId);
        if (read?.lastOperationId !== receipt.operationId)
          throw conflict("VERSION_CONFLICT", "Concurrent progress update won");
        old = read;
      }
      const canonical = await this.repo.progress(input.actor.userId, pointer.courseId);
      if (!canonical) throw new Error("PROGRESS_READBACK_MISSING");
      await this.repo.updateProjection(input.actor.userId, pointer.courseId, canonical.percent);
      await this.repo.prepareEvent(
        receipt.eventId,
        pointer.courseId,
        canonical.progressVersion,
        input.actor.userId,
        canonical.percent,
        now,
        input.correlationId,
      );
      await this.repo.readyEvent(receipt.eventId, now);
      const response = progressDto(canonical);
      await this.repo.save(scope, hash, input.key, receipt.operationId, { ...receipt, response }, true);
      return { data: response, replayed: false, noOp: false };
    } finally {
      await this.repo.unlock(input.actor.userId, pointer.courseId, receipt.operationId);
    }
  }
  private async eligible(studentId: string, courseId: string) {
    if ((await this.repo.entitlement(studentId, courseId)) !== "ACTIVE")
      throw new AppError("COURSE_ACCESS_DENIED", 403, "Active course entitlement is required");
  }
}
const zero = (
  studentId: string,
  courseId: string,
  courseContentVersion: number,
  publishedTotal: number,
  updatedAt: Date,
): Progress => ({
  studentId,
  courseId,
  progressVersion: 0,
  courseContentVersion,
  completedCount: 0,
  publishedTotal,
  percent: 0,
  updatedAt,
});
function student(actor: ActorContext) {
  if (!actor.roles.includes("STUDENT"))
    throw new AppError("STUDENT_REQUIRED", 403, "Student role is required");
}
const notFound = () => new AppError("LEARNING_RESOURCE_NOT_FOUND", 404, "Learning resource not found");
const conflict = (code: string, message: string) => new AppError(code, 409, message);
