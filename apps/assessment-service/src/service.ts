import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../../packages/http/src/index.js";
import type { ActorContext } from "../../../packages/security/src/index.js";
import { AssessmentDependencyError, type AssessmentClients } from "./clients.js";
import {
  copyQuestions,
  deterministicUuid,
  fingerprint,
  keyHash,
  listDto,
  materializeQuestions,
  questionContentChecksum,
  questionDto,
  questionFromDto,
  attemptDto,
  gradeObjectiveV1,
  decodeResultCursor,
  encodeResultCursor,
  resultFiltersHash,
  quizDetailDto,
  quizDto,
  quizFromDto,
  snapshotChecksum,
  validateSchedule,
  objectiveToAssessment,
  type AiDraftImportRequest,
  type AiDraftImportResult,
  type CommandReceipt,
  type QuestionInput,
  type Quiz,
  type QuizCreateRequest,
  type QuizDetailDto,
  type QuizPatchRequest,
  type QuizQuestion,
  type Attempt,
  type AttemptSubmitRequest,
  type ResultCursorPosition,
} from "./model.js";
import type { AssessmentRepository, CommandRecord, ResultProjectionRow } from "./repository.js";

export type AssessmentStore = Pick<
  AssessmentRepository,
  | "reserveAiImport"
  | "aiImport"
  | "completeAiImport"
  | "reserveCommand"
  | "command"
  | "checkpoint"
  | "completeCommand"
  | "quiz"
  | "createQuiz"
  | "finalizeCreate"
  | "reserveVersion"
  | "finalizeVersion"
  | "publish"
  | "writeQuestions"
  | "questions"
  | "deleteProjection"
  | "insertProjection"
  | "projectionMatches"
  | "listProjection"
  | "attempt"
  | "guard"
  | "initializeGuard"
  | "reserveAttempt"
  | "createAttempt"
  | "startAttempt"
  | "expireAttempt"
  | "writeAttemptProjection"
  | "clearGuard"
  | "reserveSubmit"
  | "writeResultItems"
  | "createResult"
  | "result"
  | "submitAttempt"
  | "writeResultProjection"
  | "prepareSubmittedEvent"
  | "readySubmittedEvent"
  | "resultProjectionShard"
>;

export interface QuizResult {
  quiz: QuizDetailDto;
  replayed: boolean;
  noOp: boolean;
}

export class AssessmentService {
  public constructor(
    private readonly repository: AssessmentStore,
    private readonly clients: Pick<AssessmentClients, "eligibleLecturer" | "target" | "studentTarget">,
    private readonly secret: string,
  ) {}

  async importAiDraft(input: {
    actor: ActorContext;
    draftId: string;
    request: AiDraftImportRequest;
    requestId: string;
  }): Promise<{ result: AiDraftImportResult; replayed: boolean }> {
    await this.requireLecturer(input.actor, input.requestId);
    if (input.actor.userId !== input.request.ownerLecturerId)
      throw new AppError("AI_IMPORT_ACTOR_MISMATCH", 403, "Approving Lecturer does not match owner");
    const target = await this.requireTargetOwner(
      input.request.targetType,
      input.request.targetId,
      input.request.ownerLecturerId,
      input.requestId,
    );
    if (target.version !== input.request.targetVersion)
      throw conflict("AI_IMPORT_TARGET_VERSION_CONFLICT", "Target version changed before import");
    const requestFingerprint = fingerprint(this.secret, {
        route: "/internal/v1/ai-drafts/{id}/import",
        draftId: input.draftId,
        body: input.request,
      }),
      quizId = deterministicUuid(this.secret, "ai-import-quiz", input.request.importOperationId),
      now = new Date(),
      reserved = await this.repository.reserveAiImport({
        importOperationId: input.request.importOperationId,
        draftId: input.draftId,
        fingerprint: requestFingerprint,
        quizId,
        now,
      }),
      command = await this.repository.aiImport(input.request.importOperationId);
    if (!command || command.draftId !== input.draftId || command.fingerprint !== requestFingerprint)
      throw conflict("IDEMPOTENCY_CONFLICT", "Import operation conflicts with another request");
    if (command.state === "COMPLETE" && command.result) return { result: command.result, replayed: true };

    const questionInput = objectiveToAssessment(input.request.quiz),
      questions = materializeQuestions(
        this.secret,
        input.request.importOperationId,
        command.quizId,
        1,
        questionInput,
      ),
      checksum = snapshotChecksum(questions),
      request: QuizCreateRequest = {
        title: input.request.quiz.title,
        targetType: input.request.targetType,
        targetId: input.request.targetId,
        questions: questionInput,
      },
      intended: Quiz = {
        quizId: command.quizId,
        targetType: request.targetType,
        targetId: request.targetId,
        ownerId: input.request.ownerLecturerId,
        title: request.title,
        state: "DRAFT",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: questions.length,
        snapshotChecksum: checksum,
        snapshotReady: true,
        createdAt: now,
        updatedAt: now,
      };
    let canonical = await this.repository.quiz(command.quizId);
    if (!canonical) {
      await this.repository.createQuiz({
        quizId: command.quizId,
        operationId: input.request.importOperationId,
        ownerId: input.request.ownerLecturerId,
        request,
        questionCount: questions.length,
        snapshotChecksum: checksum,
        now,
      });
      canonical = await this.repository.quiz(command.quizId);
    }
    if (!canonical || !sameQuizIntent(canonical, intended, false))
      throw conflict("AI_IMPORT_QUIZ_CONFLICT", "Imported Quiz could not be recovered safely");
    await this.writeQuestionsRecoverably(questions);
    await this.verifySnapshot(command.quizId, 1, questions.length, checksum);
    if (!canonical.snapshotReady) {
      await this.repository.finalizeCreate(command.quizId, input.request.importOperationId);
      canonical = await this.repository.quiz(command.quizId);
    }
    if (!canonical?.snapshotReady || !sameQuizIntent(canonical, intended, true)) throw unavailable();
    await this.convergeProjection(undefined, canonical);
    const result: AiDraftImportResult = {
      draftId: input.draftId,
      approvedDraftVersion: 2,
      quizId: command.quizId,
      quizVersion: 1,
      status: "DRAFT",
    };
    if (!(await this.repository.completeAiImport(input.request.importOperationId, result, new Date())))
      throw unavailable();
    return { result, replayed: !reserved };
  }

  async create(input: {
    actor: ActorContext;
    request: QuizCreateRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<QuizResult> {
    await this.requireLecturer(input.actor, input.requestId);
    const target = await this.requireTargetOwner(
      input.request.targetType,
      input.request.targetId,
      input.actor.userId,
      input.requestId,
    );
    void target;
    const scope = `ASM-01:${input.actor.userId}`,
      hash = keyHash(this.secret, input.idempotencyKey),
      requestFingerprint = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/quizzes",
        actorId: input.actor.userId,
        body: input.request,
      }),
      operationId = randomUUID(),
      quizId = randomUUID(),
      now = new Date(),
      initial: CommandReceipt = {
        fingerprint: requestFingerprint,
        action: "CREATE",
        occurredAt: now.toISOString(),
      };
    const reserved = await this.repository.reserveCommand(
      scope,
      hash,
      input.idempotencyKey,
      operationId,
      quizId,
      initial,
      now,
    );
    const command = await this.requiredCommand(scope, hash, input.idempotencyKey, requestFingerprint);
    if (command.status === "COMPLETE" && command.receipt.result)
      return { quiz: command.receipt.result, replayed: true, noOp: command.receipt.noOp === true };
    const occurredAt = new Date(command.receipt.occurredAt ?? now.toISOString()),
      questions = command.receipt.questions
        ? command.receipt.questions.map((question) => questionFromDto(question, command.resourceId, 1))
        : materializeQuestions(
            this.secret,
            command.operationId,
            command.resourceId,
            1,
            input.request.questions,
          ),
      checksum = snapshotChecksum(questions),
      intended: Quiz = {
        quizId: command.resourceId,
        targetType: input.request.targetType,
        targetId: input.request.targetId,
        ownerId: input.actor.userId,
        title: input.request.title,
        state: "DRAFT",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: questions.length,
        snapshotChecksum: checksum,
        snapshotReady: true,
        ...(input.request.opensAt ? { opensAt: new Date(input.request.opensAt) } : {}),
        ...(input.request.closesAt ? { closesAt: new Date(input.request.closesAt) } : {}),
        ...(input.request.durationSeconds !== undefined
          ? { durationSeconds: input.request.durationSeconds }
          : {}),
        ...(input.request.attemptLimit !== undefined ? { attemptLimit: input.request.attemptLimit } : {}),
        createdAt: occurredAt,
        updatedAt: occurredAt,
      };
    if (!command.receipt.intendedQuiz) {
      command.receipt.intendedQuiz = quizDto(intended);
      command.receipt.questions = questions.map((question) => questionDto(question, true));
      await this.checkpoint(scope, hash, input.idempotencyKey, command);
    }
    let canonical = await this.repository.quiz(command.resourceId);
    if (!canonical) {
      const mutation = {
        quizId: command.resourceId,
        operationId: command.operationId,
        ownerId: input.actor.userId,
        request: input.request,
        questionCount: questions.length,
        snapshotChecksum: checksum,
        now: occurredAt,
      };
      try {
        await this.repository.createQuiz(mutation);
      } catch {
        canonical = await this.repository.quiz(command.resourceId);
        if (!canonical) await this.repository.createQuiz(mutation);
      }
    }
    canonical = await this.repository.quiz(command.resourceId);
    if (!canonical || !sameQuizIntent(canonical, intended, false))
      throw conflict("QUIZ_CREATE_CONFLICT", "Quiz create could not be recovered safely");
    await this.writeQuestionsRecoverably(questions);
    await this.verifySnapshot(command.resourceId, 1, questions.length, checksum);
    if (!canonical.snapshotReady) {
      try {
        await this.repository.finalizeCreate(command.resourceId, command.operationId);
      } catch {
        const readBack = await this.repository.quiz(command.resourceId);
        if (!readBack?.snapshotReady)
          await this.repository.finalizeCreate(command.resourceId, command.operationId);
      }
      canonical = await this.repository.quiz(command.resourceId);
    }
    if (!canonical?.snapshotReady || !sameQuizIntent(canonical, intended, true)) throw unavailable();
    await this.convergeProjection(undefined, canonical);
    const detail = quizDetailDto(canonical, questions, true);
    command.receipt.result = detail;
    await this.repository.completeCommand(
      scope,
      hash,
      input.idempotencyKey,
      command.operationId,
      201,
      command.receipt,
    );
    return { quiz: detail, replayed: !reserved, noOp: false };
  }

  async update(input: {
    actor: ActorContext;
    quizId: string;
    request: QuizPatchRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<QuizResult> {
    await this.requireLecturer(input.actor, input.requestId);
    const initialQuiz = await this.requiredQuiz(input.quizId);
    this.requireOwnerDraft(initialQuiz, input.actor.userId);
    await this.requireTargetOwner(
      initialQuiz.targetType,
      initialQuiz.targetId,
      input.actor.userId,
      input.requestId,
    );
    const scope = `ASM-03:${input.actor.userId}:${input.quizId}`,
      hash = keyHash(this.secret, input.idempotencyKey),
      requestFingerprint = fingerprint(this.secret, {
        method: "PATCH",
        route: "/api/v1/quizzes/{quizId}",
        actorId: input.actor.userId,
        quizId: input.quizId,
        body: input.request,
      }),
      now = new Date(),
      operationId = randomUUID();
    const reserved = await this.repository.reserveCommand(
      scope,
      hash,
      input.idempotencyKey,
      operationId,
      input.quizId,
      { fingerprint: requestFingerprint, action: "UPDATE", occurredAt: now.toISOString() },
      now,
    );
    const command = await this.requiredCommand(scope, hash, input.idempotencyKey, requestFingerprint);
    if (command.status === "COMPLETE" && command.receipt.result)
      return { quiz: command.receipt.result, replayed: true, noOp: command.receipt.noOp === true };
    let current = await this.requiredQuiz(input.quizId);
    const old = command.receipt.oldQuiz
      ? {
          ...quizFromDto(command.receipt.oldQuiz),
          snapshotChecksum: command.receipt.oldSnapshotChecksum ?? "",
        }
      : current;
    if (!command.receipt.oldQuiz) {
      this.requireOwnerDraft(old, input.actor.userId);
      const existingQuestions = await this.verifiedCurrentSnapshot(old);
      if (semanticNoOp(old, existingQuestions, input.request)) {
        const result = quizDetailDto(old, existingQuestions, true);
        command.receipt.result = result;
        command.receipt.noOp = true;
        await this.repository.completeCommand(
          scope,
          hash,
          input.idempotencyKey,
          command.operationId,
          200,
          command.receipt,
        );
        return { quiz: result, replayed: !reserved, noOp: true };
      }
      const occurredAt = new Date(command.receipt.occurredAt ?? now.toISOString()),
        nextVersion = old.currentVersion + 1,
        questions = input.request.questions
          ? materializeQuestions(
              this.secret,
              command.operationId,
              old.quizId,
              nextVersion,
              input.request.questions,
            )
          : copyQuestions(existingQuestions, nextVersion),
        next = applyPatch(old, input.request, questions, occurredAt);
      command.receipt.oldQuiz = quizDto(old);
      command.receipt.oldSnapshotChecksum = old.snapshotChecksum;
      command.receipt.intendedQuiz = quizDto(next);
      command.receipt.intendedSnapshotChecksum = next.snapshotChecksum;
      command.receipt.questions = questions.map((question) => questionDto(question, true));
      command.receipt.expectedCurrentVersion = old.currentVersion;
      command.receipt.expectedRecordVersion = old.recordVersion;
      await this.checkpoint(scope, hash, input.idempotencyKey, command);
    }
    if (!command.receipt.intendedQuiz || !command.receipt.questions) throw unavailable();
    const intendedDto = command.receipt.intendedQuiz,
      intendedQuestions = command.receipt.questions.map((question) =>
        questionFromDto(question, input.quizId, intendedDto.currentVersion),
      ),
      intendedChecksum = snapshotChecksum(intendedQuestions),
      intended = {
        ...quizFromDto(intendedDto),
        snapshotChecksum: command.receipt.intendedSnapshotChecksum ?? intendedChecksum,
        questionCount: intendedQuestions.length,
      };
    current = await this.requiredQuiz(input.quizId);
    if (!sameQuizIntent(current, intended, true)) {
      if (!sameQuizIntent(current, old, true))
        throw conflict("VERSION_CONFLICT", "Quiz was updated concurrently");
      if (current.pendingOperationId && current.pendingOperationId !== command.operationId)
        throw conflict("VERSION_CONFLICT", "Another quiz version owns the next snapshot");
      if (!current.pendingOperationId) {
        const reservation = {
          quiz: old,
          operationId: command.operationId,
          nextVersion: intended.currentVersion,
          questionCount: intendedQuestions.length,
          snapshotChecksum: intendedChecksum,
        };
        try {
          await this.repository.reserveVersion(reservation);
        } catch {
          const readBack = await this.requiredQuiz(input.quizId);
          if (!readBack.pendingOperationId) await this.repository.reserveVersion(reservation);
        }
      }
      const reservedQuiz = await this.requiredQuiz(input.quizId);
      if (
        reservedQuiz.pendingOperationId !== command.operationId ||
        reservedQuiz.pendingVersion !== intended.currentVersion
      )
        throw conflict("VERSION_CONFLICT", "Quiz version reservation was lost");
      await this.writeQuestionsRecoverably(intendedQuestions);
      await this.verifySnapshot(
        input.quizId,
        intended.currentVersion,
        intendedQuestions.length,
        intendedChecksum,
      );
      const finalization = { old, operationId: command.operationId, next: intended };
      try {
        await this.repository.finalizeVersion(finalization);
      } catch {
        const readBack = await this.requiredQuiz(input.quizId);
        if (!sameQuizIntent(readBack, intended, true)) await this.repository.finalizeVersion(finalization);
      }
      current = await this.requiredQuiz(input.quizId);
    }
    if (!sameQuizIntent(current, intended, true))
      throw conflict("VERSION_CONFLICT", "Quiz update did not converge");
    await this.convergeProjection(old, current);
    const result = quizDetailDto(current, intendedQuestions, true);
    command.receipt.result = result;
    await this.repository.completeCommand(
      scope,
      hash,
      input.idempotencyKey,
      command.operationId,
      200,
      command.receipt,
    );
    return { quiz: result, replayed: !reserved, noOp: false };
  }

  async publish(input: {
    actor: ActorContext;
    quizId: string;
    idempotencyKey: string;
    requestId: string;
  }): Promise<QuizResult> {
    await this.requireLecturer(input.actor, input.requestId);
    const initial = await this.requiredQuiz(input.quizId);
    if (initial.ownerId !== input.actor.userId)
      throw new AppError("QUIZ_OWNER_REQUIRED", 403, "Quiz owner authorization is required");
    await this.requireTargetOwner(initial.targetType, initial.targetId, input.actor.userId, input.requestId);
    const scope = `ASM-04:${input.actor.userId}:${input.quizId}`,
      hash = keyHash(this.secret, input.idempotencyKey),
      requestFingerprint = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/quizzes/{quizId}/publish",
        actorId: input.actor.userId,
        quizId: input.quizId,
      }),
      now = new Date(),
      operationId = randomUUID(),
      reserved = await this.repository.reserveCommand(
        scope,
        hash,
        input.idempotencyKey,
        operationId,
        input.quizId,
        { fingerprint: requestFingerprint, action: "PUBLISH", occurredAt: now.toISOString() },
        now,
      ),
      command = await this.requiredCommand(scope, hash, input.idempotencyKey, requestFingerprint);
    if (command.status === "COMPLETE" && command.receipt.result)
      return { quiz: command.receipt.result, replayed: true, noOp: false };
    const old = command.receipt.oldQuiz
        ? {
            ...quizFromDto(command.receipt.oldQuiz),
            snapshotChecksum: command.receipt.oldSnapshotChecksum ?? "",
          }
        : initial,
      questions = await this.verifiedCurrentSnapshot(old);
    if (!command.receipt.oldQuiz) {
      this.requireOwnerDraft(old, input.actor.userId);
      if (questions.length === 0)
        throw conflict("QUIZ_NOT_PUBLISHABLE", "Quiz requires at least one question");
      if (old.closesAt && old.closesAt.getTime() <= Date.now())
        throw conflict("QUIZ_NOT_PUBLISHABLE", "Quiz close time has already passed");
      const intended: Quiz = {
        ...old,
        state: "PUBLISHED",
        recordVersion: old.recordVersion + 1,
        updatedAt: now,
      };
      command.receipt.oldQuiz = quizDto(old);
      command.receipt.oldSnapshotChecksum = old.snapshotChecksum;
      command.receipt.intendedQuiz = quizDto(intended);
      command.receipt.intendedSnapshotChecksum = old.snapshotChecksum;
      command.receipt.expectedCurrentVersion = old.currentVersion;
      command.receipt.expectedRecordVersion = old.recordVersion;
      await this.checkpoint(scope, hash, input.idempotencyKey, command);
    }
    if (!command.receipt.intendedQuiz) throw unavailable();
    const intended = {
      ...quizFromDto(command.receipt.intendedQuiz),
      snapshotChecksum: command.receipt.intendedSnapshotChecksum ?? old.snapshotChecksum,
    };
    let current = await this.requiredQuiz(input.quizId);
    if (!sameQuizIntent(current, intended, true)) {
      if (!sameQuizIntent(current, old, true))
        throw conflict("VERSION_CONFLICT", "Quiz publication conflicted");
      try {
        await this.repository.publish(old, intended.updatedAt);
      } catch {
        const readBack = await this.requiredQuiz(input.quizId);
        if (!sameQuizIntent(readBack, intended, true)) await this.repository.publish(old, intended.updatedAt);
      }
      current = await this.requiredQuiz(input.quizId);
    }
    if (!sameQuizIntent(current, intended, true))
      throw conflict("VERSION_CONFLICT", "Quiz publication did not converge");
    await this.convergeProjection(old, current);
    const result = quizDetailDto(current, questions, true);
    command.receipt.result = result;
    await this.repository.completeCommand(
      scope,
      hash,
      input.idempotencyKey,
      command.operationId,
      200,
      command.receipt,
    );
    return { quiz: result, replayed: !reserved, noOp: false };
  }

  async detail(quizId: string, actor: ActorContext, requestId: string): Promise<QuizDetailDto> {
    const quiz = await this.requiredQuiz(quizId),
      target = await this.target(quiz.targetType, quiz.targetId, requestId);
    let owner = actor.userId === quiz.ownerId && target.ownerLecturerId === actor.userId;
    if (quiz.state === "DRAFT") {
      if (!owner) throw notFound();
      await this.requireLecturer(actor, requestId);
    } else if (quiz.state !== "PUBLISHED") throw notFound();
    if (owner) {
      try {
        await this.requireLecturer(actor, requestId);
      } catch {
        owner = false;
      }
    }
    return quizDetailDto(quiz, await this.verifiedCurrentSnapshot(quiz), owner);
  }

  async list(targetType: "COURSE" | "CLASS", targetId: string, actor: ActorContext, requestId: string) {
    const target = await this.target(targetType, targetId, requestId);
    let owner = target.ownerLecturerId === actor.userId && actor.roles.includes("LECTURER");
    if (owner)
      try {
        await this.requireLecturer(actor, requestId);
      } catch {
        owner = false;
      }
    const candidates = [
      ...(owner ? await this.repository.listProjection(targetType, targetId, "DRAFT") : []),
      ...(await this.repository.listProjection(targetType, targetId, "PUBLISHED")),
    ];
    const result = [];
    for (const candidate of candidates.slice(0, 50)) {
      const canonical = await this.repository.quiz(candidate.quizId);
      if (
        canonical?.snapshotReady &&
        canonical.targetType === targetType &&
        canonical.targetId === targetId &&
        canonical.state === candidate.state &&
        canonical.currentVersion === candidate.quizVersion &&
        canonical.recordVersion === candidate.recordVersion &&
        (canonical.state === "PUBLISHED" || (owner && canonical.ownerId === actor.userId))
      )
        result.push(listDto(canonical));
    }
    return result;
  }

  async startAttempt(input: {
    actor: ActorContext;
    actorContext: string;
    quizId: string;
    idempotencyKey: string;
    requestId: string;
  }) {
    if (!input.actor.roles.includes("STUDENT"))
      throw new AppError("STUDENT_REQUIRED", 403, "Eligible Student authorization is required");
    const quiz = await this.requiredQuiz(input.quizId);
    if (quiz.state !== "PUBLISHED" || !quiz.snapshotReady || quiz.pendingOperationId) throw notFound();
    await this.studentTarget(quiz, input.actorContext, input.actor.correlationId);
    const now = new Date();
    if ((quiz.opensAt && now < quiz.opensAt) || (quiz.closesAt && now >= quiz.closesAt))
      throw new AppError("QUIZ_NOT_OPEN", 409, "Quiz is not open for a new attempt");
    const questions = await this.verifiedCurrentSnapshot(quiz),
      scope = `ASM-06:${input.actor.userId}:${input.quizId}`,
      hash = keyHash(this.secret, input.idempotencyKey),
      requestFingerprint = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/quizzes/{quizId}/attempts",
        actorId: input.actor.userId,
        quizId: input.quizId,
        body: {},
      }),
      operationId = randomUUID(),
      candidateId = randomUUID();
    await this.repository.reserveCommand(
      scope,
      hash,
      input.idempotencyKey,
      operationId,
      candidateId,
      { fingerprint: requestFingerprint, action: "START_ATTEMPT", occurredAt: now.toISOString() },
      now,
    );
    const command = await this.requiredCommand(scope, hash, input.idempotencyKey, requestFingerprint);
    if (command.status === "COMPLETE" && command.receipt.attempt)
      return {
        attempt: command.receipt.attempt,
        questions: questions.map((q) => questionDto(q, false)),
        replayed: true,
      };

    let guard = await this.repository.guard(input.actor.userId, quiz.quizId);
    if (!guard) {
      try {
        await this.repository.initializeGuard(input.actor.userId, quiz.quizId, now);
      } catch {
        /* read-back */
      }
      guard = await this.repository.guard(input.actor.userId, quiz.quizId);
    }
    if (!guard) throw unavailable();
    if (guard.activeAttemptId) {
      const active = await this.readAttemptBounded(guard.activeAttemptId);
      if (!active) throw unavailable();
      const touched = await this.materializeExpiry(active, new Date());
      if (touched.state === "IN_PROGRESS")
        return this.completeAttemptCommand(
          scope,
          hash,
          input.idempotencyKey,
          command,
          touched,
          questions,
          true,
        );
      guard = await this.repository.guard(input.actor.userId, quiz.quizId);
      if (!guard) throw unavailable();
    }
    const limit = quiz.attemptLimit ?? 1;
    if (guard.attemptsStarted >= limit)
      throw new AppError("ATTEMPT_LIMIT_REACHED", 409, "Quiz attempt limit has been reached");
    const attemptNo = guard.attemptsStarted + 1;
    try {
      await this.repository.reserveAttempt({
        guard,
        attemptId: command.resourceId,
        operationId: command.operationId,
        attemptNo,
        now,
      });
    } catch {
      /* exact read-back below */
    }
    const reserved = await this.repository.guard(input.actor.userId, quiz.quizId);
    if (!reserved) throw unavailable();
    if (reserved.activeAttemptId !== command.resourceId) {
      if (!reserved.activeAttemptId) throw unavailable();
      const winner = await this.readAttemptBounded(reserved.activeAttemptId);
      if (!winner) throw unavailable();
      return this.completeAttemptCommand(
        scope,
        hash,
        input.idempotencyKey,
        command,
        await this.materializeExpiry(winner, new Date()),
        questions,
        true,
      );
    }
    const proposed: Attempt = {
      attemptId: command.resourceId,
      studentId: input.actor.userId,
      quizId: quiz.quizId,
      quizVersion: quiz.currentVersion,
      attemptNo,
      state: "CREATED",
      version: 1,
      pinnedQuestionCount: quiz.questionCount,
      pinnedSnapshotChecksum: quiz.snapshotChecksum,
    };
    try {
      await this.repository.createAttempt(proposed);
    } catch {
      /* exact read-back */
    }
    let attempt = await this.repository.attempt(command.resourceId);
    if (!attempt || !sameAttemptIntent(attempt, proposed)) throw unavailable();
    if (attempt.state === "CREATED") {
      const startedAt = new Date(command.receipt.occurredAt ?? now.toISOString()),
        deadlineAt = deadline(startedAt, quiz.durationSeconds, quiz.closesAt);
      try {
        await this.repository.startAttempt(attempt.attemptId, startedAt, deadlineAt);
      } catch {
        /* read-back */
      }
      attempt = await this.repository.attempt(attempt.attemptId);
    }
    if (!attempt || attempt.state !== "IN_PROGRESS") throw unavailable();
    return this.completeAttemptCommand(scope, hash, input.idempotencyKey, command, attempt, questions, false);
  }

  async attemptDetail(attemptId: string, actor: ActorContext) {
    if (!actor.roles.includes("STUDENT")) throw new AppError("ATTEMPT_NOT_FOUND", 404, "Attempt not found");
    const attempt = await this.repository.attempt(attemptId);
    if (!attempt || attempt.studentId !== actor.userId)
      throw new AppError("ATTEMPT_NOT_FOUND", 404, "Attempt not found");
    return attemptDto(await this.materializeExpiry(attempt, new Date()));
  }

  async submit(input: {
    actor: ActorContext;
    attemptId: string;
    request: AttemptSubmitRequest;
    idempotencyKey: string;
    serverReceivedAt: Date;
  }) {
    if (!input.actor.roles.includes("STUDENT"))
      throw new AppError("ATTEMPT_NOT_FOUND", 404, "Attempt not found");
    let attempt = await this.repository.attempt(input.attemptId);
    if (!attempt || attempt.studentId !== input.actor.userId)
      throw new AppError("ATTEMPT_NOT_FOUND", 404, "Attempt not found");
    const scope = `ASM-08:${input.actor.userId}:${input.attemptId}`,
      hash = keyHash(this.secret, input.idempotencyKey),
      fp = fingerprint(this.secret, {
        method: "POST",
        route: "/api/v1/attempts/{attemptId}/submit",
        actorId: input.actor.userId,
        attemptId: input.attemptId,
        body: input.request,
      }),
      operationId = randomUUID(),
      now = input.serverReceivedAt;
    await this.repository.reserveCommand(
      scope,
      hash,
      input.idempotencyKey,
      operationId,
      input.attemptId,
      { fingerprint: fp, action: "SUBMIT_ATTEMPT", occurredAt: now.toISOString() },
      now,
    );
    const command = await this.requiredCommand(scope, hash, input.idempotencyKey, fp);
    if (command.status === "COMPLETE" && command.receipt.submitResult)
      return { ...command.receipt.submitResult, replayed: true };
    if (attempt.state === "SUBMITTED" && attempt.submitOperationId === command.operationId) {
      const canonical = await this.repository.result(attempt.attemptId);
      if (!canonical || !attempt.submittedAt) throw unavailable();
      await this.repository.writeAttemptProjection(attempt);
      await this.repository.clearGuard(attempt, now);
      await this.repository.writeResultProjection(canonical, attempt.submittedAt, shard(attempt.attemptId));
      if (command.receipt.submittedEventId)
        await this.repository.readySubmittedEvent(command.receipt.submittedEventId, attempt.submittedAt);
      command.receipt.submitResult = {
        attemptId: attempt.attemptId,
        score: canonical.score,
        maxScore: canonical.maxScore,
        resultVersion: canonical.resultVersion,
      };
      await this.repository.completeCommand(
        scope,
        hash,
        input.idempotencyKey,
        command.operationId,
        202,
        command.receipt,
      );
      return { ...command.receipt.submitResult, replayed: true };
    }
    if (attempt.state === "SUBMITTED")
      throw conflict("ATTEMPT_ALREADY_SUBMITTED", "Attempt is already submitted");
    if (attempt.state !== "IN_PROGRESS" || (attempt.deadlineAt && now >= attempt.deadlineAt))
      throw conflict("ATTEMPT_EXPIRED", "Attempt deadline has passed");
    const answerChecksum = sha(input.request.answers),
      reserved = await this.repository.reserveSubmit(attempt, command.operationId, now, answerChecksum);
    attempt = await this.repository.attempt(input.attemptId);
    if (!attempt) throw unavailable();
    if (!reserved && attempt.pendingSubmitOperationId !== command.operationId)
      throw conflict("SUBMIT_IN_PROGRESS", "Another submit operation owns this attempt");
    const questions = await this.repository.questions(attempt.quizId, attempt.quizVersion);
    if (attempt.pinnedQuestionCount === undefined || !attempt.pinnedSnapshotChecksum) throw unavailable();
    this.verifyRows(questions, attempt.pinnedQuestionCount, attempt.pinnedSnapshotChecksum);
    let graded;
    try {
      graded = gradeObjectiveV1(attempt, questions, input.request);
    } catch (error) {
      throw new AppError((error as Error).message, 422, "Submitted answers are invalid");
    }
    const itemsChecksum = sha(graded.items),
      gradingChecksum = sha({
        attemptId: attempt.attemptId,
        quizId: attempt.quizId,
        quizVersion: attempt.quizVersion,
        answerChecksum,
        gradingAlgorithmVersion: "objective-v1",
        items: graded.items,
        score: graded.score,
        maxScore: graded.maxScore,
      });
    const result = {
      attemptId: attempt.attemptId,
      studentId: attempt.studentId,
      quizId: attempt.quizId,
      quizVersion: attempt.quizVersion,
      score: graded.score,
      maxScore: graded.maxScore,
      gradingChecksum,
      answerCount: input.request.answers.length,
      resultItemsChecksum: itemsChecksum,
      gradingAlgorithmVersion: "objective-v1" as const,
      resultVersion: 1,
      createdAt: now,
    };
    const eventId =
      command.receipt.submittedEventId ??
      deterministicUuid(this.secret, "submitted-event", command.operationId);
    if (!command.receipt.submittedEventId) {
      command.receipt.submittedEventId = eventId;
      await this.checkpoint(scope, hash, input.idempotencyKey, command);
    }
    await this.repository.prepareSubmittedEvent({
      eventId,
      result,
      occurredAt: now,
      correlationId: input.actor.correlationId,
    });
    await this.repository.writeResultItems(attempt.attemptId, graded.items);
    await this.repository.createResult(result);
    const canonical = await this.repository.result(attempt.attemptId);
    if (!canonical || canonical.gradingChecksum !== gradingChecksum) throw unavailable();
    await this.repository.submitAttempt(attempt, command.operationId, now, answerChecksum);
    const submitted = await this.repository.attempt(attempt.attemptId);
    if (!submitted || submitted.state !== "SUBMITTED") throw unavailable();
    await this.repository.writeAttemptProjection(submitted);
    await this.repository.clearGuard(submitted, now);
    await this.repository.writeResultProjection(canonical, now, shard(attempt.attemptId));
    await this.repository.readySubmittedEvent(eventId, now);
    command.receipt.submitResult = {
      attemptId: attempt.attemptId,
      score: canonical.score,
      maxScore: canonical.maxScore,
      resultVersion: 1,
    };
    await this.repository.completeCommand(
      scope,
      hash,
      input.idempotencyKey,
      command.operationId,
      202,
      command.receipt,
    );
    return { ...command.receipt.submitResult, replayed: false };
  }

  async resultSummary(attemptId: string, actor: ActorContext) {
    if (!actor.roles.includes("STUDENT")) throw new AppError("ATTEMPT_NOT_FOUND", 404, "Attempt not found");
    const attempt = await this.repository.attempt(attemptId);
    if (!attempt || attempt.studentId !== actor.userId)
      throw new AppError("ATTEMPT_NOT_FOUND", 404, "Attempt not found");
    if (attempt.state !== "SUBMITTED")
      throw conflict("ATTEMPT_NOT_SUBMITTED", "Attempt has not been submitted");
    const result = await this.repository.result(attemptId);
    if (
      !result ||
      result.studentId !== attempt.studentId ||
      result.quizId !== attempt.quizId ||
      result.quizVersion !== attempt.quizVersion ||
      !attempt.submittedAt
    )
      throw unavailable();
    return {
      attemptId,
      quizId: result.quizId,
      quizVersion: result.quizVersion,
      score: result.score,
      maxScore: result.maxScore,
      submittedAt: attempt.submittedAt.toISOString(),
      resultVersion: result.resultVersion,
      gradingAlgorithmVersion: result.gradingAlgorithmVersion,
    };
  }

  async quizResults(input: {
    quizId: string;
    month: string;
    limit: number;
    cursor?: string;
    actor: ActorContext;
    requestId: string;
  }) {
    if (input.actor.roles.includes("ADMIN"))
      throw new AppError("ADMIN_RESULTS_DEFERRED", 403, "Admin quiz results access is deferred");
    await this.requireLecturer(input.actor, input.requestId);
    const quiz = await this.repository.quiz(input.quizId);
    if (!quiz) throw new AppError("QUIZ_NOT_FOUND", 404, "Quiz not found");
    if (quiz.ownerId !== input.actor.userId)
      throw new AppError("QUIZ_RESULTS_FORBIDDEN", 403, "Quiz results are forbidden");
    const positions: Record<string, ResultCursorPosition> = {};
    if (input.cursor) {
      let decoded;
      try {
        decoded = decodeResultCursor(this.secret, input.cursor, input);
      } catch {
        throw new AppError("INVALID_CURSOR", 400, "The results cursor is invalid or expired");
      }
      Object.assign(positions, decoded.positions);
    }
    const shardRows = await Promise.all(
        Array.from({ length: 16 }, async (_, shardNo) => {
          const position = positions[String(shardNo)];
          return this.repository.resultProjectionShard(
            input.quizId,
            input.month,
            shardNo,
            input.limit + 1,
            position
              ? { submittedAt: new Date(position.submittedAt), attemptId: position.attemptId }
              : undefined,
          );
        }),
      ),
      candidates = shardRows.flat().sort(compareProjection),
      items: Array<{
        attemptId: string;
        studentId: string;
        score: string;
        maxScore: string;
        submittedAt: string;
        resultVersion: number;
      }> = [];
    let consumed = 0;
    for (const row of candidates) {
      if (items.length >= input.limit) break;
      consumed += 1;
      positions[String(row.shard)] = {
        submittedAt: row.submittedAt.toISOString(),
        attemptId: row.attemptId,
      };
      const canonical = await this.repository.result(row.attemptId);
      if (
        !canonical ||
        canonical.quizId !== input.quizId ||
        canonical.studentId !== row.studentId ||
        canonical.score !== row.score ||
        canonical.maxScore !== row.maxScore ||
        canonical.resultVersion !== row.resultVersion
      )
        continue;
      items.push({
        attemptId: row.attemptId,
        studentId: row.studentId,
        score: row.score,
        maxScore: row.maxScore,
        submittedAt: row.submittedAt.toISOString(),
        resultVersion: row.resultVersion,
      });
    }
    const hasMore = consumed < candidates.length || shardRows.some((rows) => rows.length > input.limit),
      now = Math.floor(Date.now() / 1000);
    return {
      items,
      ...(hasMore
        ? {
            nextCursor: encodeResultCursor(this.secret, {
              v: 1,
              quizId: input.quizId,
              month: input.month,
              limit: input.limit,
              filtersHash: resultFiltersHash(input.quizId, input.month, input.limit),
              issuedAt: now,
              expiry: now + 900,
              positions,
            }),
          }
        : {}),
    };
  }

  private async completeAttemptCommand(
    scope: string,
    hash: number,
    key: string,
    command: CommandRecord,
    attempt: Attempt,
    questions: readonly QuizQuestion[],
    replayed: boolean,
  ) {
    if (attempt.state !== "IN_PROGRESS")
      throw new AppError("ATTEMPT_NOT_ACTIVE", 409, "Attempt is not active");
    await this.repository.writeAttemptProjection(attempt);
    command.receipt.attempt = attemptDto(attempt);
    await this.repository.completeCommand(scope, hash, key, command.operationId, 201, command.receipt);
    return {
      attempt: command.receipt.attempt,
      questions: questions.map((q) => questionDto(q, false)),
      replayed,
    };
  }

  private async materializeExpiry(attempt: Attempt, now: Date): Promise<Attempt> {
    if (
      attempt.state !== "IN_PROGRESS" ||
      attempt.pendingSubmitOperationId ||
      !attempt.deadlineAt ||
      attempt.deadlineAt > now
    )
      return attempt;
    try {
      await this.repository.expireAttempt(attempt);
    } catch {
      /* exact read-back */
    }
    const current = await this.repository.attempt(attempt.attemptId);
    if (!current) throw unavailable();
    if (current.state === "EXPIRED") {
      await this.repository.writeAttemptProjection(current);
      await this.repository.clearGuard(current, now);
    }
    return current;
  }

  private async readAttemptBounded(attemptId: string) {
    for (let tryNo = 0; tryNo < 5; tryNo += 1) {
      const value = await this.repository.attempt(attemptId);
      if (value && value.state !== "CREATED") return value;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    return undefined;
  }

  private async studentTarget(quiz: Quiz, actorContext: string, requestId: string) {
    try {
      return await this.clients.studentTarget(quiz.targetType, quiz.targetId, actorContext, requestId);
    } catch (error) {
      if (error instanceof AssessmentDependencyError && error.kind === "REJECTED")
        throw new AppError("STUDENT_NOT_ELIGIBLE", 403, "Student is not eligible for this quiz");
      throw new AppError("QUIZ_TARGET_SERVICE_UNAVAILABLE", 503, "Quiz target service is unavailable", true);
    }
  }

  private async verifiedCurrentSnapshot(quiz: Quiz): Promise<QuizQuestion[]> {
    if (!quiz.snapshotReady) throw unavailable();
    const questions = await this.repository.questions(quiz.quizId, quiz.currentVersion);
    this.verifyRows(questions, quiz.questionCount, quiz.snapshotChecksum);
    return questions;
  }

  private async verifySnapshot(
    quizId: string,
    version: number,
    count: number,
    checksum: string,
  ): Promise<void> {
    this.verifyRows(await this.repository.questions(quizId, version), count, checksum);
  }

  private verifyRows(questions: readonly QuizQuestion[], count: number, checksum: string): void {
    if (
      questions.length !== count ||
      questions.some((question, index) => {
        const value = {
          prompt: question.prompt,
          questionType: question.questionType,
          ...(question.options ? { options: question.options } : {}),
          correctAnswer: question.correctAnswer,
          points: question.points,
        };
        return question.questionOrder !== index + 1 || question.checksum !== questionContentChecksum(value);
      }) ||
      snapshotChecksum(questions) !== checksum
    )
      throw unavailable();
  }

  private async convergeProjection(old: Quiz | undefined, current: Quiz): Promise<void> {
    if (old)
      try {
        await this.repository.deleteProjection(old);
      } catch {
        await this.repository.deleteProjection(old);
      }
    if (!(await this.repository.projectionMatches(current)))
      try {
        await this.repository.insertProjection(current);
      } catch {
        if (!(await this.repository.projectionMatches(current)))
          await this.repository.insertProjection(current);
      }
    if (!(await this.repository.projectionMatches(current))) throw unavailable();
  }

  private async writeQuestionsRecoverably(questions: readonly QuizQuestion[]): Promise<void> {
    try {
      await this.repository.writeQuestions(questions);
    } catch {
      await this.repository.writeQuestions(questions);
    }
  }

  private async requiredCommand(
    scope: string,
    hash: number,
    key: string,
    expectedFingerprint: string,
  ): Promise<CommandRecord> {
    const command = await this.repository.command(scope, hash, key);
    if (!command) throw unavailable();
    if (command.receipt.fingerprint !== expectedFingerprint)
      throw conflict("IDEMPOTENCY_CONFLICT", "Idempotency key was used with a different request");
    return command;
  }

  private async checkpoint(scope: string, hash: number, key: string, command: CommandRecord) {
    await this.repository.checkpoint(scope, hash, key, command.operationId, command.receipt);
  }

  private async requiredQuiz(quizId: string): Promise<Quiz> {
    const quiz = await this.repository.quiz(quizId);
    if (!quiz) throw new AppError("QUIZ_NOT_FOUND", 404, "Quiz not found");
    return quiz;
  }

  private requireOwnerDraft(quiz: Quiz, actorId: string): void {
    if (quiz.ownerId !== actorId)
      throw new AppError("QUIZ_OWNER_REQUIRED", 403, "Quiz owner authorization is required");
    if (quiz.state !== "DRAFT") throw conflict("QUIZ_NOT_EDITABLE", "Only DRAFT quiz can be modified");
    if (!quiz.snapshotReady) throw unavailable();
  }

  private async requireLecturer(actor: ActorContext, requestId: string): Promise<void> {
    if (!actor.roles.includes("LECTURER"))
      throw new AppError("LECTURER_REQUIRED", 403, "Eligible Lecturer authorization is required");
    try {
      await this.clients.eligibleLecturer(actor.userId, requestId);
    } catch (error) {
      if (error instanceof AssessmentDependencyError && error.kind === "REJECTED")
        throw new AppError("LECTURER_NOT_ELIGIBLE", 403, "Eligible Lecturer authorization is required");
      throw new AppError("IDENTITY_SERVICE_UNAVAILABLE", 503, "Identity service is unavailable", true);
    }
  }

  private async requireTargetOwner(
    targetType: "COURSE" | "CLASS",
    targetId: string,
    actorId: string,
    requestId: string,
  ) {
    const target = await this.target(targetType, targetId, requestId);
    if (target.ownerLecturerId !== actorId)
      throw new AppError("TARGET_OWNER_REQUIRED", 403, "Target owner authorization is required");
    return target;
  }

  private async target(targetType: "COURSE" | "CLASS", targetId: string, requestId: string) {
    try {
      return await this.clients.target(targetType, targetId, requestId);
    } catch (error) {
      if (error instanceof AssessmentDependencyError && error.kind === "REJECTED")
        throw new AppError("QUIZ_TARGET_NOT_AVAILABLE", 404, "Quiz target is not available");
      throw new AppError("QUIZ_TARGET_SERVICE_UNAVAILABLE", 503, "Quiz target service is unavailable", true);
    }
  }
}

function compareProjection(a: ResultProjectionRow, b: ResultProjectionRow): number {
  const time = b.submittedAt.getTime() - a.submittedAt.getTime();
  return time || a.attemptId.localeCompare(b.attemptId);
}

function applyPatch(
  old: Quiz,
  patch: QuizPatchRequest,
  questions: readonly QuizQuestion[],
  updatedAt: Date,
): Quiz {
  const opensAt =
      patch.opensAt === undefined ? old.opensAt : patch.opensAt ? new Date(patch.opensAt) : undefined,
    closesAt =
      patch.closesAt === undefined ? old.closesAt : patch.closesAt ? new Date(patch.closesAt) : undefined;
  try {
    validateSchedule({
      ...(opensAt ? { opensAt: opensAt.toISOString() } : {}),
      ...(closesAt ? { closesAt: closesAt.toISOString() } : {}),
    });
  } catch {
    throw new AppError("QUIZ_WINDOW_INVALID", 422, "closesAt must be after opensAt");
  }
  const base = { ...old };
  delete base.opensAt;
  delete base.closesAt;
  delete base.durationSeconds;
  delete base.attemptLimit;
  return {
    ...base,
    title: patch.title ?? old.title,
    ...(opensAt ? { opensAt } : {}),
    ...(closesAt ? { closesAt } : {}),
    ...(patch.durationSeconds === undefined
      ? old.durationSeconds !== undefined
        ? { durationSeconds: old.durationSeconds }
        : {}
      : patch.durationSeconds === null
        ? {}
        : { durationSeconds: patch.durationSeconds }),
    ...(patch.attemptLimit === undefined
      ? old.attemptLimit !== undefined
        ? { attemptLimit: old.attemptLimit }
        : {}
      : patch.attemptLimit === null
        ? {}
        : { attemptLimit: patch.attemptLimit }),
    currentVersion: old.currentVersion + 1,
    recordVersion: old.recordVersion + 1,
    questionCount: questions.length,
    snapshotChecksum: snapshotChecksum(questions),
    snapshotReady: true,
    updatedAt,
  };
}

function semanticNoOp(quiz: Quiz, questions: readonly QuizQuestion[], patch: QuizPatchRequest): boolean {
  if (patch.title !== undefined && patch.title !== quiz.title) return false;
  if (
    patch.opensAt !== undefined &&
    (patch.opensAt ? Date.parse(patch.opensAt) : undefined) !== quiz.opensAt?.getTime()
  )
    return false;
  if (
    patch.closesAt !== undefined &&
    (patch.closesAt ? Date.parse(patch.closesAt) : undefined) !== quiz.closesAt?.getTime()
  )
    return false;
  if (patch.durationSeconds !== undefined && (patch.durationSeconds ?? undefined) !== quiz.durationSeconds)
    return false;
  if (patch.attemptLimit !== undefined && (patch.attemptLimit ?? undefined) !== quiz.attemptLimit)
    return false;
  if (patch.questions && JSON.stringify(patch.questions) !== JSON.stringify(questions.map(questionInput)))
    return false;
  return true;
}

function questionInput(question: QuizQuestion): QuestionInput {
  return {
    prompt: question.prompt,
    questionType: question.questionType,
    ...(question.options ? { options: question.options } : {}),
    correctAnswer: question.correctAnswer,
    points: question.points,
  } as QuestionInput;
}

function sameQuizIntent(actual: Quiz, intended: Quiz, requireReady: boolean): boolean {
  return (
    actual.quizId === intended.quizId &&
    actual.targetType === intended.targetType &&
    actual.targetId === intended.targetId &&
    actual.ownerId === intended.ownerId &&
    actual.title === intended.title &&
    actual.state === intended.state &&
    actual.currentVersion === intended.currentVersion &&
    actual.recordVersion === intended.recordVersion &&
    actual.questionCount === intended.questionCount &&
    actual.snapshotChecksum === intended.snapshotChecksum &&
    actual.opensAt?.getTime() === intended.opensAt?.getTime() &&
    actual.closesAt?.getTime() === intended.closesAt?.getTime() &&
    actual.durationSeconds === intended.durationSeconds &&
    actual.attemptLimit === intended.attemptLimit &&
    (!requireReady || actual.snapshotReady)
  );
}

function conflict(code: string, message: string) {
  return new AppError(code, 409, message);
}
function unavailable() {
  return new AppError("ASSESSMENT_WRITE_UNAVAILABLE", 503, "Assessment service is unavailable", true);
}
function notFound() {
  return new AppError("QUIZ_NOT_FOUND", 404, "Quiz not found");
}
function deadline(startedAt: Date, durationSeconds: number | undefined, closesAt: Date | undefined) {
  const duration =
    durationSeconds === undefined ? undefined : new Date(startedAt.getTime() + durationSeconds * 1000);
  if (duration && closesAt) return duration < closesAt ? duration : closesAt;
  return duration ?? closesAt;
}
function sameAttemptIntent(actual: Attempt, intended: Attempt) {
  return (
    actual.attemptId === intended.attemptId &&
    actual.studentId === intended.studentId &&
    actual.quizId === intended.quizId &&
    actual.quizVersion === intended.quizVersion &&
    actual.attemptNo === intended.attemptNo &&
    ["CREATED", "IN_PROGRESS"].includes(actual.state)
  );
}
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const shard = (attemptId: string) =>
  (createHash("sha256").update(attemptId.toLowerCase()).digest().at(0) ?? 0) % 16;
