import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import {
  copyQuestions,
  materializeQuestions,
  parseQuizCreate,
  parseQuizPatch,
  questionDto,
  quizDetailDto,
  snapshotChecksum,
  validateIdempotencyKey,
  normalizeShortAnswerV1,
  gradeObjectiveV1,
  decodeResultCursor,
  encodeResultCursor,
  resultFiltersHash,
  type CommandReceipt,
  type Quiz,
  type QuizCreateRequest,
  type QuizProjection,
  type QuizQuestion,
  type Attempt,
  type AttemptGuard,
  type AssessmentResult,
  type AiDraftImportResult,
} from "../../apps/assessment-service/src/model.js";
import type { AiImportRecord, CommandRecord } from "../../apps/assessment-service/src/repository.js";
import { AssessmentService, type AssessmentStore } from "../../apps/assessment-service/src/service.js";

const targetId = randomUUID();
const lecturerId = randomUUID();
const requestId = randomUUID();
const actor: ActorContext = {
  userId: lecturerId,
  roles: ["LECTURER"],
  sessionId: randomUUID(),
  tokenVersion: 1,
  correlationId: requestId,
  issuedAt: 1,
  expiresAt: 2,
};
const createBody = {
  title: "  Distributed database quiz  ",
  targetType: "COURSE" as const,
  targetId,
  opensAt: "2099-09-01T01:00:00+07:00",
  closesAt: "2099-09-01T03:00:00+07:00",
  durationSeconds: 1800,
  attemptLimit: 2,
  questions: [
    {
      prompt: "Pick the quorum levels",
      questionType: "MULTIPLE_CHOICE" as const,
      options: ["ONE", "QUORUM", "ALL"],
      correctAnswer: ["ALL", "QUORUM"],
      points: "10.00",
    },
    {
      prompt: "Cassandra is a relational database",
      questionType: "TRUE_FALSE" as const,
      correctAnswer: false,
      points: "5.0",
    },
  ],
};

class MemoryAssessmentStore implements AssessmentStore {
  readonly commands = new Map<string, CommandRecord>();
  readonly aiImports = new Map<string, AiImportRecord>();
  readonly quizzes = new Map<string, Quiz>();
  readonly snapshots = new Map<string, QuizQuestion[]>();
  readonly projections = new Map<string, QuizProjection>();
  readonly attempts = new Map<string, Attempt>();
  readonly guards = new Map<string, AttemptGuard>();
  readonly results = new Map<string, AssessmentResult>();
  readonly resultProjections: Awaited<ReturnType<AssessmentStore["resultProjectionShard"]>> = [];
  ambiguousQuestionWriteOnce = false;
  loseAiImportResponseOnce = false;

  async reserveAiImport(input: {
    importOperationId: string;
    draftId: string;
    fingerprint: string;
    quizId: string;
  }) {
    if (this.aiImports.has(input.importOperationId)) return false;
    this.aiImports.set(input.importOperationId, {
      importOperationId: input.importOperationId,
      draftId: input.draftId,
      fingerprint: input.fingerprint,
      quizId: input.quizId,
      state: "IN_PROGRESS",
    });
    return true;
  }
  async aiImport(importOperationId: string) {
    return this.aiImports.get(importOperationId);
  }
  async completeAiImport(importOperationId: string, result: AiDraftImportResult) {
    const value = this.aiImports.get(importOperationId);
    if (!value) return false;
    this.aiImports.set(importOperationId, { ...value, state: "COMPLETE", result });
    if (this.loseAiImportResponseOnce) {
      this.loseAiImportResponseOnce = false;
      throw new Error("SIMULATED_LOST_RESPONSE");
    }
    return true;
  }

  async reserveCommand(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resourceId: string,
    receipt: CommandReceipt,
  ) {
    const id = commandKey(scope, hash, key);
    if (this.commands.has(id)) return false;
    this.commands.set(id, { operationId, resourceId, status: "IN_PROGRESS", receipt });
    return true;
  }
  async command(scope: string, hash: number, key: string) {
    return this.commands.get(commandKey(scope, hash, key));
  }
  async checkpoint(scope: string, hash: number, key: string, operationId: string, receipt: CommandReceipt) {
    const id = commandKey(scope, hash, key),
      value = this.commands.get(id);
    if (!value || value.operationId !== operationId) throw new Error("CHECKPOINT_CONFLICT");
    this.commands.set(id, { ...value, receipt });
  }
  async completeCommand(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    _resultCode: number,
    receipt: CommandReceipt,
  ) {
    const id = commandKey(scope, hash, key),
      value = this.commands.get(id);
    if (!value || value.operationId !== operationId) throw new Error("COMPLETE_CONFLICT");
    this.commands.set(id, { ...value, status: "COMPLETE", receipt });
  }
  async quiz(quizId: string) {
    const value = this.quizzes.get(quizId);
    return value ? cloneQuiz(value) : undefined;
  }
  async createQuiz(input: {
    quizId: string;
    operationId: string;
    ownerId: string;
    request: QuizCreateRequest;
    questionCount: number;
    snapshotChecksum: string;
    now: Date;
  }) {
    if (this.quizzes.has(input.quizId)) return false;
    this.quizzes.set(input.quizId, {
      quizId: input.quizId,
      targetType: input.request.targetType,
      targetId: input.request.targetId,
      ownerId: input.ownerId,
      title: input.request.title,
      state: "DRAFT",
      currentVersion: 1,
      recordVersion: 1,
      questionCount: input.questionCount,
      snapshotChecksum: input.snapshotChecksum,
      snapshotReady: false,
      pendingOperationId: input.operationId,
      pendingVersion: 1,
      pendingQuestionCount: input.questionCount,
      pendingSnapshotChecksum: input.snapshotChecksum,
      ...(input.request.opensAt ? { opensAt: new Date(input.request.opensAt) } : {}),
      ...(input.request.closesAt ? { closesAt: new Date(input.request.closesAt) } : {}),
      ...(input.request.durationSeconds !== undefined
        ? { durationSeconds: input.request.durationSeconds }
        : {}),
      ...(input.request.attemptLimit !== undefined ? { attemptLimit: input.request.attemptLimit } : {}),
      createdAt: input.now,
      updatedAt: input.now,
    });
    return true;
  }
  async finalizeCreate(quizId: string, operationId: string) {
    const quiz = this.quizzes.get(quizId);
    if (!quiz || quiz.pendingOperationId !== operationId) return false;
    this.quizzes.set(quizId, clearPending({ ...quiz, snapshotReady: true }));
    return true;
  }
  async reserveVersion(input: {
    quiz: Quiz;
    operationId: string;
    nextVersion: number;
    questionCount: number;
    snapshotChecksum: string;
  }) {
    const current = this.quizzes.get(input.quiz.quizId);
    if (
      !current ||
      current.state !== "DRAFT" ||
      current.currentVersion !== input.quiz.currentVersion ||
      current.recordVersion !== input.quiz.recordVersion ||
      current.pendingOperationId
    )
      return false;
    this.quizzes.set(current.quizId, {
      ...current,
      pendingOperationId: input.operationId,
      pendingVersion: input.nextVersion,
      pendingQuestionCount: input.questionCount,
      pendingSnapshotChecksum: input.snapshotChecksum,
    });
    return true;
  }
  async finalizeVersion(input: { old: Quiz; operationId: string; next: Quiz }) {
    const current = this.quizzes.get(input.old.quizId);
    if (
      !current ||
      current.pendingOperationId !== input.operationId ||
      current.currentVersion !== input.old.currentVersion ||
      current.recordVersion !== input.old.recordVersion
    )
      return false;
    this.quizzes.set(current.quizId, clearPending(cloneQuiz(input.next)));
    return true;
  }
  async publish(old: Quiz, updatedAt: Date) {
    const current = this.quizzes.get(old.quizId);
    if (
      !current ||
      current.state !== "DRAFT" ||
      current.currentVersion !== old.currentVersion ||
      current.recordVersion !== old.recordVersion ||
      current.pendingOperationId
    )
      return false;
    this.quizzes.set(old.quizId, {
      ...current,
      state: "PUBLISHED",
      recordVersion: old.recordVersion + 1,
      updatedAt,
    });
    return true;
  }
  async writeQuestions(questions: readonly QuizQuestion[]) {
    const grouped = new Map<string, QuizQuestion[]>();
    for (const question of questions) {
      const key = snapshotKey(question.quizId, question.quizVersion),
        rows = grouped.get(key) ?? this.snapshots.get(key)?.map(cloneQuestion) ?? [],
        existing = rows.find((row) => row.questionOrder === question.questionOrder);
      if (existing && existing.checksum !== question.checksum) throw new Error("IMMUTABLE_CONFLICT");
      if (!existing) rows.push(cloneQuestion(question));
      rows.sort((left, right) => left.questionOrder - right.questionOrder);
      grouped.set(key, rows);
    }
    for (const [key, rows] of grouped) this.snapshots.set(key, rows);
    if (this.ambiguousQuestionWriteOnce) {
      this.ambiguousQuestionWriteOnce = false;
      throw new Error("SIMULATED_TIMEOUT_AFTER_COMMIT");
    }
  }
  async questions(quizId: string, version: number) {
    return (this.snapshots.get(snapshotKey(quizId, version)) ?? []).map(cloneQuestion);
  }
  async insertProjection(quiz: Quiz) {
    this.projections.set(projectionKey(quiz), {
      targetType: quiz.targetType,
      targetId: quiz.targetId,
      state: quiz.state as "DRAFT" | "PUBLISHED",
      sortAt: quiz.opensAt ?? quiz.createdAt,
      quizId: quiz.quizId,
      title: quiz.title,
      ...(quiz.opensAt ? { opensAt: quiz.opensAt } : {}),
      ...(quiz.closesAt ? { closesAt: quiz.closesAt } : {}),
      quizVersion: quiz.currentVersion,
      recordVersion: quiz.recordVersion,
    });
  }
  async deleteProjection(quiz: Quiz) {
    this.projections.delete(projectionKey(quiz));
  }
  async projectionMatches(quiz: Quiz) {
    const row = this.projections.get(projectionKey(quiz));
    return row?.quizVersion === quiz.currentVersion && row.recordVersion === quiz.recordVersion;
  }
  async listProjection(targetType: "COURSE" | "CLASS", id: string, state: "DRAFT" | "PUBLISHED") {
    return [...this.projections.values()].filter(
      (row) => row.targetType === targetType && row.targetId === id && row.state === state,
    );
  }
  async attempt(id: string) {
    return this.attempts.get(id);
  }
  async guard(studentId: string, quizId: string) {
    return this.guards.get(`${studentId}:${quizId}`);
  }
  async initializeGuard(studentId: string, quizId: string) {
    const key = `${studentId}:${quizId}`;
    if (this.guards.has(key)) return false;
    this.guards.set(key, { studentId, quizId, attemptsStarted: 0, guardVersion: 0 });
    return true;
  }
  async reserveAttempt(input: {
    guard: AttemptGuard;
    attemptId: string;
    operationId: string;
    attemptNo: number;
  }) {
    const key = `${input.guard.studentId}:${input.guard.quizId}`,
      current = this.guards.get(key);
    if (!current || current.activeAttemptId || current.guardVersion !== input.guard.guardVersion)
      return false;
    this.guards.set(key, {
      ...current,
      activeAttemptId: input.attemptId,
      activeAttemptNo: input.attemptNo,
      attemptsStarted: input.attemptNo,
      holderOperationId: input.operationId,
      guardVersion: current.guardVersion + 1,
    });
    return true;
  }
  async createAttempt(v: Attempt) {
    if (this.attempts.has(v.attemptId)) return false;
    this.attempts.set(v.attemptId, v);
    return true;
  }
  async startAttempt(id: string, startedAt: Date, deadlineAt: Date | undefined) {
    const v = this.attempts.get(id);
    if (!v || v.state !== "CREATED") return false;
    this.attempts.set(id, {
      ...v,
      state: "IN_PROGRESS",
      startedAt,
      ...(deadlineAt ? { deadlineAt } : {}),
      version: 2,
    });
    return true;
  }
  async expireAttempt(v: Attempt) {
    if (v.state !== "IN_PROGRESS") return false;
    this.attempts.set(v.attemptId, { ...v, state: "EXPIRED", version: v.version + 1 });
    return true;
  }
  async writeAttemptProjection() {
    return;
  }
  async clearGuard(v: Attempt) {
    const key = `${v.studentId}:${v.quizId}`,
      g = this.guards.get(key);
    if (g?.activeAttemptId !== v.attemptId) return false;
    this.guards.set(key, {
      studentId: g.studentId,
      quizId: g.quizId,
      attemptsStarted: g.attemptsStarted,
      guardVersion: g.guardVersion + 1,
    });
    return true;
  }
  async reserveSubmit(v: Attempt, operationId: string, receivedAt: Date) {
    const current = this.attempts.get(v.attemptId);
    if (!current || current.state !== "IN_PROGRESS" || current.pendingSubmitOperationId) return false;
    this.attempts.set(v.attemptId, {
      ...current,
      pendingSubmitOperationId: operationId,
      pendingSubmitReceivedAt: receivedAt,
    });
    return true;
  }
  async writeResultItems() {
    return;
  }
  async createResult(v: AssessmentResult) {
    if (this.results.has(v.attemptId)) return false;
    this.results.set(v.attemptId, v);
    return true;
  }
  async result(id: string) {
    return this.results.get(id);
  }
  async resultProjectionShard(
    _quizId: string,
    _month: string,
    shard: number,
    limit: number,
    position?: { submittedAt: Date; attemptId: string },
  ) {
    return this.resultProjections
      .filter((row) => row.shard === shard)
      .filter(
        (row) =>
          !position ||
          row.submittedAt < position.submittedAt ||
          (row.submittedAt.getTime() === position.submittedAt.getTime() &&
            row.attemptId > position.attemptId),
      )
      .sort(
        (a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || a.attemptId.localeCompare(b.attemptId),
      )
      .slice(0, limit);
  }
  async submitAttempt(v: Attempt, operationId: string, submittedAt: Date) {
    const current = this.attempts.get(v.attemptId);
    if (current?.pendingSubmitOperationId !== operationId) return false;
    const rest = { ...current };
    delete rest.pendingSubmitOperationId;
    delete rest.pendingSubmitReceivedAt;
    this.attempts.set(v.attemptId, {
      ...rest,
      state: "SUBMITTED",
      submittedAt,
      submitOperationId: operationId,
      version: current.version + 1,
    });
    return true;
  }
  async writeResultProjection() {
    return;
  }
  async updateResultProjection(
    _quizId: string,
    _submittedAt: Date,
    _shard: number,
    attemptId: string,
    score: string,
    resultVersion: number,
  ) {
    const row = this.resultProjections.find((r) => r.attemptId === attemptId);
    if (row) {
      row.score = score;
      row.resultVersion = resultVersion;
    }
  }
  async recordManualGrade(input: {
    attemptId: string;
    manualScore: string;
    teacherFeedback?: string;
    gradedBy: string;
    gradedAt: Date;
    expectedResultVersion: number;
    nextResultVersion: number;
  }) {
    const r = this.results.get(input.attemptId);
    if (!r || r.resultVersion !== input.expectedResultVersion) return false;
    this.results.set(input.attemptId, {
      ...r,
      manualScore: input.manualScore,
      ...(input.teacherFeedback ? { teacherFeedback: input.teacherFeedback } : {}),
      gradedBy: input.gradedBy,
      gradedAt: input.gradedAt,
      gradingStatus: "MANUALLY_GRADED",
      resultVersion: input.nextResultVersion,
    });
    return true;
  }
  async prepareSubmittedEvent() {
    return;
  }
  async readySubmittedEvent() {
    return;
  }
  async prepareGradedEvent() {
    return;
  }
}

const clients = {
  eligibleLecturer: async () => undefined,
  target: async (targetType: "COURSE" | "CLASS", id: string) => ({
    targetType,
    targetId: id,
    ownerLecturerId: lecturerId,
    version: 1,
  }),
  studentTarget: async (targetType: "COURSE" | "CLASS", id: string) => ({
    targetType,
    targetId: id,
    ownerLecturerId: lecturerId,
    version: 1,
  }),
};

describe("P8.1 Assessment quiz contract", () => {
  it("imports objective-v1 once and recovers the same DRAFT after a lost response", async () => {
    const store = new MemoryAssessmentStore(),
      service = new AssessmentService(store, clients, "secret"),
      importOperationId = randomUUID(),
      draftId = randomUUID(),
      request = {
        importOperationId,
        approvedDraftVersion: 2 as const,
        approvedDraftChecksum: "a".repeat(64),
        jobId: randomUUID(),
        targetType: "COURSE" as const,
        targetId,
        targetVersion: 1,
        ownerLecturerId: lecturerId,
        quiz: {
          schemaVersion: "objective-v1" as const,
          title: "Reviewed objective quiz",
          questions: [
            {
              id: "q1",
              order: 1,
              text: "One",
              points: "1.00",
              type: "SINGLE_CHOICE" as const,
              options: [
                { id: "a", text: "A" },
                { id: "b", text: "B" },
              ],
              correctAnswer: { optionId: "b" },
            },
            {
              id: "q2",
              order: 2,
              text: "Many",
              points: "2.50",
              type: "MULTIPLE_CHOICE" as const,
              options: [
                { id: "a", text: "A" },
                { id: "b", text: "B" },
              ],
              correctAnswer: { optionIds: ["a", "b"] },
            },
            {
              id: "q3",
              order: 3,
              text: "Truth",
              points: "1",
              type: "TRUE_FALSE" as const,
              correctAnswer: { value: true },
            },
            {
              id: "q4",
              order: 4,
              text: "Short",
              points: "3.25",
              type: "SHORT_ANSWER" as const,
              correctAnswer: { acceptedAnswer: "Canonical" },
            },
          ],
        },
      };
    store.loseAiImportResponseOnce = true;
    await expect(service.importAiDraft({ actor, draftId, request, requestId })).rejects.toThrow(
      "SIMULATED_LOST_RESPONSE",
    );
    const recovered = await service.importAiDraft({ actor, draftId, request, requestId });
    expect(recovered).toMatchObject({
      replayed: true,
      result: { draftId, approvedDraftVersion: 2, quizVersion: 1, status: "DRAFT" },
    });
    expect(store.quizzes.size).toBe(1);
    expect(store.aiImports.size).toBe(1);
    const snapshot = [...store.snapshots.values()][0];
    expect(snapshot?.map((question) => question.points)).toEqual(["1.00", "2.50", "1", "3.25"]);
    expect(snapshot?.[0]).toMatchObject({ options: ["A", "B"], correctAnswer: "B" });
    expect(snapshot?.[1]).toMatchObject({ options: ["A", "B"], correctAnswer: ["A", "B"] });
  });
  it("normalizes a strict create DTO and keeps decimal values as strings", () => {
    const parsed = parseQuizCreate(createBody);
    expect(parsed.title).toBe("Distributed database quiz");
    expect(parsed.opensAt).toBe("2099-08-31T18:00:00.000Z");
    expect(parsed.questions[0]).toMatchObject({
      correctAnswer: ["QUORUM", "ALL"],
      points: "10",
    });
  });

  it("rejects unknown/server-owned fields, invalid answers and invalid windows", () => {
    expect(() => parseQuizCreate({ ...createBody, state: "PUBLISHED" })).toThrow();
    expect(() => parseQuizPatch({ currentVersion: 10 })).toThrow();
    expect(() => parseQuizPatch({})).toThrow();
    expect(() =>
      parseQuizCreate({
        ...createBody,
        questions: [
          {
            prompt: "Invalid answer",
            questionType: "SINGLE_CHOICE",
            options: ["A", "B"],
            correctAnswer: "C",
            points: "1",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseQuizCreate({
        ...createBody,
        opensAt: "2026-09-01T03:00:00Z",
        closesAt: "2026-09-01T02:00:00Z",
      }),
    ).toThrow();
  });

  it("materializes stable server-owned IDs and immutable snapshot checksums", () => {
    const parsed = parseQuizCreate(createBody);
    const first = materializeQuestions("secret", "operation", targetId, 1, parsed.questions);
    const replay = materializeQuestions("secret", "operation", targetId, 1, parsed.questions);
    const copied = copyQuestions(first, 2);
    expect(replay).toEqual(first);
    expect(copied.map((question) => question.questionId)).toEqual(
      first.map((question) => question.questionId),
    );
    expect(copied.every((question) => question.quizVersion === 2)).toBe(true);
    expect(snapshotChecksum(copied)).toBe(snapshotChecksum(first));
  });

  it("removes correct answers from non-owner representations", () => {
    const parsed = parseQuizCreate(createBody);
    const questions = materializeQuestions("secret", "operation", targetId, 1, parsed.questions);
    const quiz: Quiz = {
      quizId: randomUUID(),
      targetType: "COURSE",
      targetId,
      ownerId: randomUUID(),
      title: parsed.title,
      state: "PUBLISHED",
      currentVersion: 1,
      recordVersion: 2,
      questionCount: questions.length,
      snapshotChecksum: snapshotChecksum(questions),
      snapshotReady: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const first = questions.at(0);
    expect(first).toBeDefined();
    if (!first) throw new Error("missing fixture question");
    expect(questionDto(first, false)).not.toHaveProperty("correctAnswer");
    expect(quizDetailDto(quiz, questions, false).questions).toSatisfy((rows: object[]) =>
      rows.every((row) => !("correctAnswer" in row)),
    );
    expect(quizDetailDto(quiz, questions, true).questions[0]).toHaveProperty("correctAnswer");
  });

  it("requires a bounded visible-ASCII idempotency key", () => {
    expect(validateIdempotencyKey("quiz-command-1")).toBe("quiz-command-1");
    expect(() => validateIdempotencyKey(undefined)).toThrow();
    expect(() => validateIdempotencyKey("has space")).toThrow();
    expect(() => validateIdempotencyKey("x".repeat(201))).toThrow();
  });

  it("recovers an ambiguous snapshot write and replays one logical create", async () => {
    const store = new MemoryAssessmentStore(),
      service = new AssessmentService(store, clients, "secret");
    store.ambiguousQuestionWriteOnce = true;
    const command = {
      actor,
      request: parseQuizCreate(createBody),
      idempotencyKey: "ambiguous-create",
      requestId,
    };
    const first = await service.create(command),
      replay = await service.create(command);
    expect(first.quiz).toMatchObject({ state: "DRAFT", currentVersion: 1, recordVersion: 1 });
    expect(replay.quiz.quizId).toBe(first.quiz.quizId);
    expect(replay.replayed).toBe(true);
    expect(store.quizzes.size).toBe(1);
    expect(store.snapshots.size).toBe(1);
    expect(store.projections.size).toBe(1);
  });

  it("rejects same-key different request", async () => {
    const store = new MemoryAssessmentStore(),
      service = new AssessmentService(store, clients, "secret");
    await service.create({
      actor,
      request: parseQuizCreate(createBody),
      idempotencyKey: "create-conflict",
      requestId,
    });
    await expect(
      service.create({
        actor,
        request: parseQuizCreate({ ...createBody, title: "Different quiz title" }),
        idempotencyKey: "create-conflict",
        requestId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("creates complete metadata-copy snapshots, preserves no-op versions and publishes record-only", async () => {
    const store = new MemoryAssessmentStore(),
      service = new AssessmentService(store, clients, "secret"),
      created = await service.create({
        actor,
        request: parseQuizCreate(createBody),
        idempotencyKey: "version-create",
        requestId,
      }),
      updated = await service.update({
        actor,
        quizId: created.quiz.quizId,
        request: parseQuizPatch({ title: "Version two quiz" }),
        idempotencyKey: "version-update",
        requestId,
      });
    expect(updated.quiz).toMatchObject({ currentVersion: 2, recordVersion: 2 });
    expect(await store.questions(created.quiz.quizId, 1)).toHaveLength(2);
    expect(await store.questions(created.quiz.quizId, 2)).toHaveLength(2);
    const noOp = await service.update({
      actor,
      quizId: created.quiz.quizId,
      request: parseQuizPatch({ title: "Version two quiz" }),
      idempotencyKey: "version-noop",
      requestId,
    });
    expect(noOp.noOp).toBe(true);
    expect(noOp.quiz).toMatchObject({ currentVersion: 2, recordVersion: 2 });
    const published = await service.publish({
      actor,
      quizId: created.quiz.quizId,
      idempotencyKey: "version-publish",
      requestId,
    });
    expect(published.quiz).toMatchObject({ state: "PUBLISHED", currentVersion: 2, recordVersion: 3 });
    expect(store.projections.size).toBe(1);
  });

  it("allows exactly one concurrent N+1 reservation winner", async () => {
    const store = new MemoryAssessmentStore(),
      service = new AssessmentService(store, clients, "secret"),
      created = await service.create({
        actor,
        request: parseQuizCreate(createBody),
        idempotencyKey: "concurrent-create",
        requestId,
      }),
      settled = await Promise.allSettled([
        service.update({
          actor,
          quizId: created.quiz.quizId,
          request: parseQuizPatch({ title: "Concurrent A" }),
          idempotencyKey: "concurrent-a",
          requestId,
        }),
        service.update({
          actor,
          quizId: created.quiz.quizId,
          request: parseQuizPatch({ title: "Concurrent B" }),
          idempotencyKey: "concurrent-b",
          requestId,
        }),
      ]),
      fulfilled = settled.filter((value) => value.status === "fulfilled"),
      rejected = settled.filter((value) => value.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { status: 409 } });
    expect(await store.quiz(created.quiz.quizId)).toMatchObject({ currentVersion: 2, recordVersion: 2 });
  });
});

function commandKey(scope: string, hash: number, key: string) {
  return `${scope}:${String(hash)}:${key}`;
}
function snapshotKey(quizId: string, version: number) {
  return `${quizId}:${String(version)}`;
}
function projectionKey(quiz: Quiz) {
  return `${quiz.targetType}:${quiz.targetId}:${quiz.state}:${(quiz.opensAt ?? quiz.createdAt).toISOString()}:${quiz.quizId}`;
}
function cloneQuestion(question: QuizQuestion): QuizQuestion {
  return {
    ...question,
    ...(question.options ? { options: [...question.options] } : {}),
    correctAnswer: Array.isArray(question.correctAnswer)
      ? [...question.correctAnswer]
      : question.correctAnswer,
  };
}
function cloneQuiz(quiz: Quiz): Quiz {
  return {
    ...quiz,
    ...(quiz.opensAt ? { opensAt: new Date(quiz.opensAt) } : {}),
    ...(quiz.closesAt ? { closesAt: new Date(quiz.closesAt) } : {}),
    createdAt: new Date(quiz.createdAt),
    updatedAt: new Date(quiz.updatedAt),
  };
}
function clearPending(quiz: Quiz): Quiz {
  const value = { ...quiz };
  delete value.pendingOperationId;
  delete value.pendingVersion;
  delete value.pendingQuestionCount;
  delete value.pendingSnapshotChecksum;
  return value;
}

describe("P8.2 Assessment attempt contract", () => {
  it("pins the snapshot, sanitizes delivery, and replays the same key", async () => {
    const store = new MemoryAssessmentStore(),
      studentId = randomUUID(),
      quizId = randomUUID(),
      questions = materializeQuestions("secret", "seed", quizId, 7, parseQuizCreate(createBody).questions),
      now = new Date();
    store.quizzes.set(quizId, {
      quizId,
      targetType: "COURSE",
      targetId,
      ownerId: lecturerId,
      title: "Published",
      state: "PUBLISHED",
      currentVersion: 7,
      recordVersion: 9,
      questionCount: questions.length,
      snapshotChecksum: snapshotChecksum(questions),
      snapshotReady: true,
      durationSeconds: 600,
      attemptLimit: 2,
      createdAt: now,
      updatedAt: now,
    });
    store.snapshots.set(snapshotKey(quizId, 7), questions);
    const service = new AssessmentService(store, clients, "secret"),
      student: ActorContext = {
        ...actor,
        userId: studentId,
        roles: ["STUDENT"],
        correlationId: requestId,
      };
    const first = await service.startAttempt({
      actor: student,
      actorContext: "signed",
      quizId,
      idempotencyKey: "same",
      requestId,
    });
    const replay = await service.startAttempt({
      actor: student,
      actorContext: "signed",
      quizId,
      idempotencyKey: "same",
      requestId,
    });
    expect(replay.attempt.attemptId).toBe(first.attempt.attemptId);
    expect(first.attempt).toMatchObject({ quizVersion: 7, state: "IN_PROGRESS", attemptNo: 1 });
    expect(first.questions[0]).not.toHaveProperty("correctAnswer");
    expect(first.questions[0]).not.toHaveProperty("checksum");
  });

  it("returns one logical active attempt for concurrent different keys", async () => {
    const store = new MemoryAssessmentStore(),
      studentId = randomUUID(),
      quizId = randomUUID(),
      now = new Date(),
      questions = materializeQuestions("secret", "seed2", quizId, 1, parseQuizCreate(createBody).questions);
    store.quizzes.set(quizId, {
      quizId,
      targetType: "CLASS",
      targetId,
      ownerId: lecturerId,
      title: "Published",
      state: "PUBLISHED",
      currentVersion: 1,
      recordVersion: 2,
      questionCount: questions.length,
      snapshotChecksum: snapshotChecksum(questions),
      snapshotReady: true,
      attemptLimit: 1,
      createdAt: now,
      updatedAt: now,
    });
    store.snapshots.set(snapshotKey(quizId, 1), questions);
    const service = new AssessmentService(store, clients, "secret"),
      student: ActorContext = {
        ...actor,
        userId: studentId,
        roles: ["STUDENT"],
        correlationId: requestId,
      };
    const results = await Promise.all(
      ["a", "b"].map((idempotencyKey) =>
        service.startAttempt({
          actor: student,
          actorContext: "signed",
          quizId,
          idempotencyKey,
          requestId,
        }),
      ),
    );
    expect(new Set(results.map((result) => result.attempt.attemptId)).size).toBe(1);
    expect(store.attempts.size).toBe(1);
  });
});

describe("P8.3 OBJECTIVE_GRADING_V1", () => {
  it("normalizes Vietnamese NFC, case and Unicode whitespace without stripping punctuation/diacritics", () => {
    expect(normalizeShortAnswerV1("  ĐA\u0301P\t A\u0301N  ")).toBe(normalizeShortAnswerV1("đáp án"));
    expect(normalizeShortAnswerV1("đáp án!")).not.toBe(normalizeShortAnswerV1("đáp án"));
    expect(normalizeShortAnswerV1("dap an")).not.toBe(normalizeShortAnswerV1("đáp án"));
  });
  it("grades exact sets with no partial credit and exact decimal sums", () => {
    const attempt: Attempt = {
      attemptId: randomUUID(),
      studentId: randomUUID(),
      quizId: randomUUID(),
      quizVersion: 1,
      attemptNo: 1,
      state: "IN_PROGRESS",
      version: 2,
    };
    const qs = materializeQuestions("s", "o", attempt.quizId, 1, parseQuizCreate(createBody).questions);
    const first = qs.at(0),
      second = qs.at(1);
    if (!first || !second) throw new Error("fixture");
    const full = gradeObjectiveV1(attempt, qs, {
      clientSubmittedAt: new Date().toISOString(),
      answers: [
        { questionId: first.questionId, selectedOptionIds: ["ALL", "QUORUM"] },
        { questionId: second.questionId, value: false },
      ],
    });
    expect(full).toMatchObject({ score: "15", maxScore: "15" });
    const partial = gradeObjectiveV1(attempt, qs, {
      clientSubmittedAt: new Date().toISOString(),
      answers: [{ questionId: first.questionId, selectedOptionIds: ["ALL"] }],
    });
    expect(partial.score).toBe("0");
  });
});

describe("P8.4 result reads", () => {
  it("returns an owner-only score summary without result-item or checksum leakage", async () => {
    const store = new MemoryAssessmentStore(),
      service = new AssessmentService(store, clients, "x".repeat(32)),
      studentId = randomUUID(),
      quizId = randomUUID(),
      attemptId = randomUUID(),
      submittedAt = new Date("2026-09-01T01:02:03.000Z"),
      student = { ...actor, userId: studentId, roles: ["STUDENT"] } satisfies ActorContext;
    store.attempts.set(attemptId, {
      attemptId,
      studentId,
      quizId,
      quizVersion: 3,
      attemptNo: 1,
      state: "SUBMITTED",
      submittedAt,
      version: 3,
    });
    store.results.set(attemptId, {
      attemptId,
      studentId,
      quizId,
      quizVersion: 3,
      score: "10.10",
      maxScore: "12.30",
      gradingChecksum: "secret",
      answerCount: 2,
      resultItemsChecksum: "secret-items",
      gradingAlgorithmVersion: "objective-v1",
      resultVersion: 1,
      createdAt: submittedAt,
    });
    const value = await service.resultSummary(attemptId, student);
    expect(value).toEqual({
      attemptId,
      quizId,
      quizVersion: 3,
      score: "10.10",
      maxScore: "12.30",
      submittedAt: submittedAt.toISOString(),
      resultVersion: 1,
      gradingAlgorithmVersion: "objective-v1",
    });
    await expect(
      service.resultSummary(attemptId, { ...student, userId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("HMAC-binds result cursors to quiz/month/limit and rejects tampering", () => {
    const secret = "x".repeat(32),
      quizId = randomUUID(),
      now = 100,
      payload = {
        v: 1 as const,
        quizId,
        month: "2026-09",
        limit: 20,
        filtersHash: resultFiltersHash(quizId, "2026-09", 20),
        issuedAt: now,
        expiry: now + 900,
        positions: {},
      },
      cursor = encodeResultCursor(secret, payload);
    expect(decodeResultCursor(secret, cursor, payload, now)).toEqual(payload);
    expect(() => decodeResultCursor(secret, `${cursor}x`, payload, now)).toThrow("INVALID_CURSOR");
    expect(() => decodeResultCursor(secret, cursor, { ...payload, month: "2026-08" }, now)).toThrow(
      "INVALID_CURSOR",
    );
  });

  it("merges shards deterministically and canonical-guards divergent projections", async () => {
    const store = new MemoryAssessmentStore(),
      service = new AssessmentService(store, clients, "x".repeat(32)),
      quizId = randomUUID(),
      first = randomUUID(),
      stale = randomUUID(),
      at = new Date("2026-09-01T10:00:00.000Z");
    store.quizzes.set(quizId, {
      quizId,
      targetType: "COURSE",
      targetId,
      ownerId: lecturerId,
      title: "Q",
      state: "PUBLISHED",
      currentVersion: 1,
      recordVersion: 1,
      questionCount: 1,
      snapshotChecksum: "s",
      snapshotReady: true,
      createdAt: at,
      updatedAt: at,
    });
    store.resultProjections.push(
      {
        attemptId: stale,
        studentId: randomUUID(),
        score: "9",
        maxScore: "10",
        resultVersion: 1,
        submittedAt: at,
        shard: 1,
      },
      {
        attemptId: first,
        studentId: randomUUID(),
        score: "10.00",
        maxScore: "10.00",
        resultVersion: 1,
        submittedAt: at,
        shard: 2,
      },
    );
    const valid = store.resultProjections[1];
    if (!valid) throw new Error("fixture");
    store.results.set(first, {
      attemptId: first,
      studentId: valid.studentId,
      quizId,
      quizVersion: 1,
      score: valid.score,
      maxScore: valid.maxScore,
      gradingChecksum: "g",
      answerCount: 1,
      resultItemsChecksum: "i",
      gradingAlgorithmVersion: "objective-v1",
      resultVersion: 1,
      createdAt: at,
    });
    const page = await service.quizResults({
      quizId,
      month: "2026-09",
      limit: 20,
      actor,
      requestId,
    });
    expect(page.items.map((item) => item.attemptId)).toEqual([first]);
  });

  describe("P8.3 Assessment manual grading & gradebook persistence", () => {
    it("persists manual grade, teacher feedback, updates result_version and reflects in listGrades", async () => {
      const store = new MemoryAssessmentStore(),
        service = new AssessmentService(store, clients, "secret"),
        quizId = randomUUID(),
        attemptId = randomUUID(),
        studentId = randomUUID(),
        at = new Date();

      store.quizzes.set(quizId, {
        quizId,
        targetType: "COURSE",
        targetId,
        ownerId: lecturerId,
        title: "Test Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: 1,
        snapshotChecksum: "s",
        snapshotReady: true,
        createdAt: at,
        updatedAt: at,
      });

      store.attempts.set(attemptId, {
        attemptId,
        studentId,
        quizId,
        quizVersion: 1,
        attemptNo: 1,
        state: "SUBMITTED",
        submittedAt: at,
        version: 2,
      });

      store.results.set(attemptId, {
        attemptId,
        studentId,
        quizId,
        quizVersion: 1,
        score: "5.0",
        maxScore: "10.0",
        gradingChecksum: "chk",
        answerCount: 1,
        resultItemsChecksum: "items-chk",
        gradingAlgorithmVersion: "objective-v1",
        resultVersion: 1,
        createdAt: at,
      });

      store.resultProjections.push({
        attemptId,
        studentId,
        score: "5.0",
        maxScore: "10.0",
        resultVersion: 1,
        submittedAt: at,
        shard: 0,
      });

      // Lecturer submits manual grade
      const gradeResult = await service.gradeAttempt({
        actor,
        quizId,
        attemptId,
        request: {
          score: "9.5",
          feedback: "Great analytical answer!",
          expectedResultVersion: 1,
        },
        requestId,
      });

      expect(gradeResult).toMatchObject({
        attemptId,
        quizId,
        studentId,
        score: "9.5",
        autoScore: "5.0",
        manualScore: "9.5",
        maxScore: "10.0",
        teacherFeedback: "Great analytical answer!",
        gradedBy: lecturerId,
        gradingStatus: "MANUALLY_GRADED",
        resultVersion: 2,
      });

      // Gradebook listGrades returns the updated manual score
      const gradesList = await service.listGrades({
        quizId,
        actor,
        requestId,
      });

      expect(gradesList.items).toHaveLength(1);
      expect(gradesList.items[0]).toMatchObject({
        attemptId,
        score: "9.5",
        manualScore: "9.5",
        teacherFeedback: "Great analytical answer!",
        gradingStatus: "MANUALLY_GRADED",
        resultVersion: 2,
      });

      // Student result summary reflects manual grade
      const studentActor: ActorContext = {
        ...actor,
        userId: studentId,
        roles: ["STUDENT"],
      };
      const summary = await service.resultSummary(attemptId, studentActor);
      expect(summary).toMatchObject({
        score: "9.5",
        manualScore: "9.5",
        autoScore: "5.0",
        teacherFeedback: "Great analytical answer!",
        gradingStatus: "MANUALLY_GRADED",
        resultVersion: 2,
      });
    });

    it("rejects concurrent grading when expectedResultVersion conflicts", async () => {
      const store = new MemoryAssessmentStore(),
        service = new AssessmentService(store, clients, "secret"),
        quizId = randomUUID(),
        attemptId = randomUUID(),
        studentId = randomUUID(),
        at = new Date();

      store.quizzes.set(quizId, {
        quizId,
        targetType: "COURSE",
        targetId,
        ownerId: lecturerId,
        title: "Test Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: 1,
        snapshotChecksum: "s",
        snapshotReady: true,
        createdAt: at,
        updatedAt: at,
      });

      store.attempts.set(attemptId, {
        attemptId,
        studentId,
        quizId,
        quizVersion: 1,
        attemptNo: 1,
        state: "SUBMITTED",
        submittedAt: at,
        version: 2,
      });

      store.results.set(attemptId, {
        attemptId,
        studentId,
        quizId,
        quizVersion: 1,
        score: "5.0",
        maxScore: "10.0",
        gradingChecksum: "chk",
        answerCount: 1,
        resultItemsChecksum: "items-chk",
        gradingAlgorithmVersion: "objective-v1",
        resultVersion: 2, // version is already 2
        createdAt: at,
      });

      // Attempting to grade with stale expectedResultVersion 1 should fail with 409
      await expect(
        service.gradeAttempt({
          actor,
          quizId,
          attemptId,
          request: {
            score: "8.0",
            expectedResultVersion: 1,
          },
          requestId,
        }),
      ).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    });

    it("rejects score exceeding maximum score", async () => {
      const store = new MemoryAssessmentStore(),
        service = new AssessmentService(store, clients, "secret"),
        quizId = randomUUID(),
        attemptId = randomUUID(),
        studentId = randomUUID(),
        at = new Date();

      store.quizzes.set(quizId, {
        quizId,
        targetType: "COURSE",
        targetId,
        ownerId: lecturerId,
        title: "Test Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: 1,
        snapshotChecksum: "s",
        snapshotReady: true,
        createdAt: at,
        updatedAt: at,
      });

      store.attempts.set(attemptId, {
        attemptId,
        studentId,
        quizId,
        quizVersion: 1,
        attemptNo: 1,
        state: "SUBMITTED",
        submittedAt: at,
        version: 2,
      });

      store.results.set(attemptId, {
        attemptId,
        studentId,
        quizId,
        quizVersion: 1,
        score: "5.0",
        maxScore: "10.0",
        gradingChecksum: "chk",
        answerCount: 1,
        resultItemsChecksum: "items-chk",
        gradingAlgorithmVersion: "objective-v1",
        resultVersion: 1,
        createdAt: at,
      });

      await expect(
        service.gradeAttempt({
          actor,
          quizId,
          attemptId,
          request: {
            score: "15.0", // Exceeds max 10.0
          },
          requestId,
        }),
      ).rejects.toMatchObject({ status: 422, code: "SCORE_EXCEEDS_MAX" });
    });

    it("rejects unauthorized students from manual grading but allows admin", async () => {
      const store = new MemoryAssessmentStore(),
        service = new AssessmentService(store, clients, "secret"),
        quizId = randomUUID(),
        attemptId = randomUUID(),
        studentId = randomUUID(),
        at = new Date();

      store.quizzes.set(quizId, {
        quizId,
        targetType: "COURSE",
        targetId,
        ownerId: lecturerId,
        title: "Test Quiz",
        state: "PUBLISHED",
        currentVersion: 1,
        recordVersion: 1,
        questionCount: 1,
        snapshotChecksum: "s",
        snapshotReady: true,
        createdAt: at,
        updatedAt: at,
      });

      store.attempts.set(attemptId, {
        attemptId,
        studentId,
        quizId,
        quizVersion: 1,
        attemptNo: 1,
        state: "SUBMITTED",
        submittedAt: at,
        version: 2,
      });

      store.results.set(attemptId, {
        attemptId,
        studentId,
        quizId,
        quizVersion: 1,
        score: "5.0",
        maxScore: "10.0",
        gradingChecksum: "chk",
        answerCount: 1,
        resultItemsChecksum: "items-chk",
        gradingAlgorithmVersion: "objective-v1",
        resultVersion: 1,
        createdAt: at,
      });

      // Student attempt
      await expect(
        service.gradeAttempt({
          actor: { ...actor, userId: studentId, roles: ["STUDENT"] },
          quizId,
          attemptId,
          request: { score: "10.0" },
          requestId,
        }),
      ).rejects.toMatchObject({ status: 403, code: "LECTURER_REQUIRED" });

      // Admin attempt succeeds
      const adminResult = await service.gradeAttempt({
        actor: { ...actor, userId: randomUUID(), roles: ["ADMIN"] },
        quizId,
        attemptId,
        request: { score: "9.0" },
        requestId,
      });
      expect(adminResult.score).toBe("9.0");
    });
  });
});
