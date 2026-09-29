import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../packages/contracts/src/index.js";
import {
  projectionSortAt,
  type CommandReceipt,
  type Quiz,
  type QuizCreateRequest,
  type QuizProjection,
  type QuizQuestion,
  type Attempt,
  type AttemptGuard,
  type AssessmentResult,
  type AiDraftImportResult,
  type ResultItem,
} from "./model.js";

export interface AiImportRecord {
  importOperationId: string;
  draftId: string;
  fingerprint: string;
  quizId: string;
  state: string;
  result?: AiDraftImportResult;
}

export interface CommandRecord {
  operationId: string;
  resourceId: string;
  status: string;
  receipt: CommandReceipt;
}
export interface DueAssessmentEvent {
  dueDay: string;
  shard: number;
  nextAttemptAt: Date;
  eventId: string;
  event: EventEnvelope;
  state: string;
  retryCount: number;
  leaseFence: number;
  leaseUntil?: Date;
}
export interface ResultProjectionRow {
  attemptId: string;
  studentId: string;
  score: string;
  maxScore: string;
  resultVersion: number;
  submittedAt: Date;
  shard: number;
}

export class AssessmentRepository {
  public constructor(private readonly db: CassandraClient) {}

  async reserveAiImport(input: {
    importOperationId: string;
    draftId: string;
    fingerprint: string;
    quizId: string;
    now: Date;
  }): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO ai_draft_import_by_id
       (import_operation_id,draft_id,approved_draft_version,request_fingerprint,quiz_id,quiz_version,status,
        command_state,created_at,updated_at)
       VALUES (?,?,2,?,?,1,'DRAFT','IN_PROGRESS',?,?) IF NOT EXISTS`,
      [
        uuid(input.importOperationId),
        uuid(input.draftId),
        input.fingerprint,
        uuid(input.quizId),
        input.now,
        input.now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async aiImport(importOperationId: string): Promise<AiImportRecord | undefined> {
    const row = (
      await this.db.execute(
        `SELECT import_operation_id,draft_id,request_fingerprint,quiz_id,command_state,response_json
         FROM ai_draft_import_by_id WHERE import_operation_id=?`,
        [uuid(importOperationId)],
        "LOCAL_QUORUM",
      )
    )[0];
    if (!row) return;
    return {
      importOperationId: String(row.import_operation_id),
      draftId: String(row.draft_id),
      fingerprint: String(row.request_fingerprint),
      quizId: String(row.quiz_id),
      state: String(row.command_state),
      ...(row.response_json ? { result: JSON.parse(String(row.response_json)) as AiDraftImportResult } : {}),
    };
  }

  async completeAiImport(
    importOperationId: string,
    result: AiDraftImportResult,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE ai_draft_import_by_id SET command_state='COMPLETE',response_json=?,updated_at=?
       WHERE import_operation_id=? IF command_state='IN_PROGRESS'`,
      [JSON.stringify(result), now, uuid(importOperationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (applied(rows)) return true;
    const current = await this.aiImport(importOperationId);
    return current?.state === "COMPLETE" && JSON.stringify(current.result) === JSON.stringify(result);
  }

  async reserveCommand(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resourceId: string,
    receipt: CommandReceipt,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO idempotency_by_scope_key
       (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at)
       VALUES (?,?,?,?,?,0,'IN_PROGRESS',?,?,?) IF NOT EXISTS`,
      [
        scope,
        hash,
        key,
        uuid(operationId),
        uuid(resourceId),
        JSON.stringify(receipt),
        now,
        new Date(now.getTime() + 86_400_000),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async command(scope: string, hash: number, key: string): Promise<CommandRecord | undefined> {
    const rows = await this.db.execute(
      `SELECT operation_id,resource_id,status,result_checksum FROM idempotency_by_scope_key
       WHERE scope=? AND key_hash=? AND idempotency_key=?`,
      [scope, hash, key],
      "LOCAL_QUORUM",
    );
    const row = rows[0];
    return row
      ? {
          operationId: String(row.operation_id),
          resourceId: String(row.resource_id),
          status: String(row.status),
          receipt: JSON.parse(String(row.result_checksum)) as CommandReceipt,
        }
      : undefined;
  }

  async checkpoint(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    receipt: CommandReceipt,
  ): Promise<void> {
    const rows = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET result_checksum=?
       WHERE scope=? AND key_hash=? AND idempotency_key=?
       IF operation_id=? AND status='IN_PROGRESS'`,
      [JSON.stringify(receipt), scope, hash, key, uuid(operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (!applied(rows)) throw new Error("ASSESSMENT_COMMAND_CHECKPOINT_CONFLICT");
  }

  async completeCommand(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    resultCode: number,
    receipt: CommandReceipt,
  ): Promise<void> {
    const rows = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET status='COMPLETE',result_code=?,result_checksum=?
       WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [resultCode, JSON.stringify(receipt), scope, hash, key, uuid(operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (!applied(rows)) throw new Error("ASSESSMENT_COMMAND_COMPLETE_CONFLICT");
  }

  async quiz(quizId: string): Promise<Quiz | undefined> {
    const rows = await this.db.execute(
      `SELECT quiz_id,target_type,target_id,owner_id,title,state,current_version,opens_at,closes_at,
              duration_seconds,attempt_limit,record_version,question_count,snapshot_checksum,snapshot_ready,
              pending_operation_id,pending_version,pending_question_count,pending_snapshot_checksum,
              created_at,updated_at
       FROM quiz_by_id WHERE quiz_id=?`,
      [uuid(quizId)],
      "LOCAL_QUORUM",
    );
    return rows[0] ? rowQuiz(rows[0]) : undefined;
  }

  async createQuiz(input: {
    quizId: string;
    operationId: string;
    ownerId: string;
    request: QuizCreateRequest;
    questionCount: number;
    snapshotChecksum: string;
    now: Date;
  }): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO quiz_by_id
       (quiz_id,target_type,target_id,owner_id,title,state,current_version,opens_at,closes_at,duration_seconds,
        attempt_limit,record_version,question_count,snapshot_checksum,snapshot_ready,pending_operation_id,
        pending_version,pending_question_count,pending_snapshot_checksum,created_at,updated_at)
       VALUES (?,?,?,?,?,'DRAFT',1,?,?,?,?,1,?,?,false,?,1,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(input.quizId),
        input.request.targetType,
        uuid(input.request.targetId),
        uuid(input.ownerId),
        input.request.title,
        input.request.opensAt ? new Date(input.request.opensAt) : null,
        input.request.closesAt ? new Date(input.request.closesAt) : null,
        input.request.durationSeconds ?? null,
        input.request.attemptLimit ?? null,
        input.questionCount,
        input.snapshotChecksum,
        uuid(input.operationId),
        input.questionCount,
        input.snapshotChecksum,
        input.now,
        input.now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async finalizeCreate(quizId: string, operationId: string): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE quiz_by_id SET snapshot_ready=true,pending_operation_id=null,pending_version=null,
              pending_question_count=null,pending_snapshot_checksum=null
       WHERE quiz_id=? IF pending_operation_id=? AND current_version=1 AND snapshot_ready=false`,
      [uuid(quizId), uuid(operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async reserveVersion(input: {
    quiz: Quiz;
    operationId: string;
    nextVersion: number;
    questionCount: number;
    snapshotChecksum: string;
  }): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE quiz_by_id SET pending_operation_id=?,pending_version=?,pending_question_count=?,
              pending_snapshot_checksum=? WHERE quiz_id=?
       IF owner_id=? AND state='DRAFT' AND current_version=? AND record_version=?
          AND snapshot_ready=true AND pending_operation_id=null`,
      [
        uuid(input.operationId),
        long(input.nextVersion),
        input.questionCount,
        input.snapshotChecksum,
        uuid(input.quiz.quizId),
        uuid(input.quiz.ownerId),
        long(input.quiz.currentVersion),
        long(input.quiz.recordVersion),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async finalizeVersion(input: { old: Quiz; operationId: string; next: Quiz }): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE quiz_by_id SET title=?,opens_at=?,closes_at=?,duration_seconds=?,attempt_limit=?,
              current_version=?,record_version=?,question_count=?,snapshot_checksum=?,snapshot_ready=true,
              pending_operation_id=null,pending_version=null,pending_question_count=null,
              pending_snapshot_checksum=null,updated_at=? WHERE quiz_id=?
       IF owner_id=? AND state='DRAFT' AND current_version=? AND record_version=?
          AND pending_operation_id=? AND pending_version=?`,
      [
        input.next.title,
        input.next.opensAt ?? null,
        input.next.closesAt ?? null,
        input.next.durationSeconds ?? null,
        input.next.attemptLimit ?? null,
        long(input.next.currentVersion),
        long(input.next.recordVersion),
        input.next.questionCount,
        input.next.snapshotChecksum,
        input.next.updatedAt,
        uuid(input.old.quizId),
        uuid(input.old.ownerId),
        long(input.old.currentVersion),
        long(input.old.recordVersion),
        uuid(input.operationId),
        long(input.next.currentVersion),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async publish(old: Quiz, updatedAt: Date): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE quiz_by_id SET state='PUBLISHED',record_version=?,updated_at=? WHERE quiz_id=?
       IF owner_id=? AND state='DRAFT' AND current_version=? AND record_version=? AND snapshot_ready=true
          AND pending_operation_id=null`,
      [
        long(old.recordVersion + 1),
        updatedAt,
        uuid(old.quizId),
        uuid(old.ownerId),
        long(old.currentVersion),
        long(old.recordVersion),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async writeQuestions(questions: readonly QuizQuestion[]): Promise<void> {
    for (const question of questions) {
      const rows = await this.db.execute(
        `INSERT INTO questions_by_quiz_version
         (quiz_id,quiz_version,question_order,question_id,prompt,question_type,options_json,
          correct_answer_json,points,checksum) VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
        [
          uuid(question.quizId),
          long(question.quizVersion),
          question.questionOrder,
          uuid(question.questionId),
          question.prompt,
          question.questionType,
          question.options ? JSON.stringify(question.options) : null,
          JSON.stringify(question.correctAnswer),
          types.BigDecimal.fromString(question.points),
          question.checksum,
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
      if (!applied(rows)) {
        const existing = await this.question(
          question.quizId,
          question.quizVersion,
          question.questionOrder,
          question.questionId,
        );
        if (!existing || existing.checksum !== question.checksum)
          throw new Error("IMMUTABLE_QUESTION_CONFLICT");
      }
    }
  }

  async questions(quizId: string, version: number): Promise<QuizQuestion[]> {
    const rows = await this.db.execute(
      `SELECT quiz_id,quiz_version,question_order,question_id,prompt,question_type,options_json,
              correct_answer_json,points,checksum FROM questions_by_quiz_version
       WHERE quiz_id=? AND quiz_version=? LIMIT 201`,
      [uuid(quizId), long(version)],
      "LOCAL_QUORUM",
    );
    return rows.map(rowQuestion);
  }

  private async question(
    quizId: string,
    version: number,
    order: number,
    questionId: string,
  ): Promise<QuizQuestion | undefined> {
    const rows = await this.db.execute(
      `SELECT quiz_id,quiz_version,question_order,question_id,prompt,question_type,options_json,
              correct_answer_json,points,checksum FROM questions_by_quiz_version
       WHERE quiz_id=? AND quiz_version=? AND question_order=? AND question_id=?`,
      [uuid(quizId), long(version), order, uuid(questionId)],
      "LOCAL_QUORUM",
    );
    return rows[0] ? rowQuestion(rows[0]) : undefined;
  }

  async insertProjection(quiz: Quiz): Promise<void> {
    await this.db.execute(
      `INSERT INTO quizzes_by_target_state_v2
       (target_type,target_id,state,sort_at,quiz_id,title,opens_at,closes_at,quiz_version,record_version)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        quiz.targetType,
        uuid(quiz.targetId),
        quiz.state,
        projectionSortAt(quiz),
        uuid(quiz.quizId),
        quiz.title,
        quiz.opensAt ?? null,
        quiz.closesAt ?? null,
        long(quiz.currentVersion),
        long(quiz.recordVersion),
      ],
      "LOCAL_QUORUM",
    );
  }

  async deleteProjection(quiz: Quiz): Promise<void> {
    await this.db.execute(
      `DELETE FROM quizzes_by_target_state_v2
       WHERE target_type=? AND target_id=? AND state=? AND sort_at=? AND quiz_id=?`,
      [quiz.targetType, uuid(quiz.targetId), quiz.state, projectionSortAt(quiz), uuid(quiz.quizId)],
      "LOCAL_QUORUM",
    );
  }

  async projectionMatches(quiz: Quiz): Promise<boolean> {
    const rows = await this.db.execute(
      `SELECT title,opens_at,closes_at,quiz_version,record_version FROM quizzes_by_target_state_v2
       WHERE target_type=? AND target_id=? AND state=? AND sort_at=? AND quiz_id=?`,
      [quiz.targetType, uuid(quiz.targetId), quiz.state, projectionSortAt(quiz), uuid(quiz.quizId)],
      "LOCAL_QUORUM",
    );
    const row = rows[0];
    return Boolean(
      row &&
      String(row.title) === quiz.title &&
      optionalTimestamp(row.opens_at)?.getTime() === quiz.opensAt?.getTime() &&
      optionalTimestamp(row.closes_at)?.getTime() === quiz.closesAt?.getTime() &&
      Number(row.quiz_version) === quiz.currentVersion &&
      Number(row.record_version) === quiz.recordVersion,
    );
  }

  async listProjection(
    targetType: "COURSE" | "CLASS",
    targetId: string,
    state: "DRAFT" | "PUBLISHED",
  ): Promise<QuizProjection[]> {
    const rows = await this.db.execute(
      `SELECT target_type,target_id,state,sort_at,quiz_id,title,opens_at,closes_at,quiz_version,record_version
       FROM quizzes_by_target_state_v2 WHERE target_type=? AND target_id=? AND state=? LIMIT 50`,
      [targetType, uuid(targetId), state],
      "LOCAL_QUORUM",
    );
    return rows.map((row) => ({
      targetType: String(row.target_type) as "COURSE" | "CLASS",
      targetId: String(row.target_id),
      state: String(row.state) as "DRAFT" | "PUBLISHED",
      sortAt: timestamp(row.sort_at),
      quizId: String(row.quiz_id),
      title: String(row.title),
      ...(row.opens_at ? { opensAt: timestamp(row.opens_at) } : {}),
      ...(row.closes_at ? { closesAt: timestamp(row.closes_at) } : {}),
      quizVersion: Number(row.quiz_version),
      recordVersion: Number(row.record_version),
    }));
  }

  async attempt(attemptId: string): Promise<Attempt | undefined> {
    const rows = await this.db.execute(
      `SELECT attempt_id,student_id,quiz_id,quiz_version,attempt_no,state,started_at,deadline_at,
              submitted_at,submit_key,version,pending_submit_operation_id,pending_submit_received_at,
              pinned_question_count,pinned_snapshot_checksum FROM attempt_by_id WHERE attempt_id=?`,
      [uuid(attemptId)],
      "LOCAL_QUORUM",
    );
    return rows[0] ? rowAttempt(rows[0]) : undefined;
  }

  async guard(studentId: string, quizId: string): Promise<AttemptGuard | undefined> {
    const rows = await this.db.execute(
      `SELECT student_id,quiz_id,active_attempt_id,active_attempt_no,attempts_started,
              holder_operation_id,guard_version FROM attempt_guard_by_student_quiz
       WHERE student_id=? AND quiz_id=?`,
      [uuid(studentId), uuid(quizId)],
      "LOCAL_QUORUM",
    );
    return rows[0] ? rowGuard(rows[0]) : undefined;
  }

  async initializeGuard(studentId: string, quizId: string, now: Date): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO attempt_guard_by_student_quiz
       (student_id,quiz_id,attempts_started,guard_version,updated_at)
       VALUES (?,?,0,0,?) IF NOT EXISTS`,
      [uuid(studentId), uuid(quizId), now],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async reserveAttempt(input: {
    guard: AttemptGuard;
    attemptId: string;
    operationId: string;
    attemptNo: number;
    now: Date;
  }): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE attempt_guard_by_student_quiz SET active_attempt_id=?,active_attempt_no=?,
              attempts_started=?,holder_operation_id=?,guard_version=?,updated_at=?
       WHERE student_id=? AND quiz_id=? IF guard_version=? AND active_attempt_id=null`,
      [
        uuid(input.attemptId),
        input.attemptNo,
        input.attemptNo,
        uuid(input.operationId),
        long(input.guard.guardVersion + 1),
        input.now,
        uuid(input.guard.studentId),
        uuid(input.guard.quizId),
        long(input.guard.guardVersion),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async createAttempt(value: Attempt): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO attempt_by_id
       (attempt_id,student_id,quiz_id,quiz_version,attempt_no,state,version,pinned_question_count,pinned_snapshot_checksum)
       VALUES (?,?,?,?,?,'CREATED',1,?,?) IF NOT EXISTS`,
      [
        uuid(value.attemptId),
        uuid(value.studentId),
        uuid(value.quizId),
        long(value.quizVersion),
        value.attemptNo,
        value.pinnedQuestionCount ?? null,
        value.pinnedSnapshotChecksum ?? null,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async startAttempt(attemptId: string, startedAt: Date, deadlineAt: Date | undefined): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE attempt_by_id SET state='IN_PROGRESS',started_at=?,deadline_at=?,version=2
       WHERE attempt_id=? IF state='CREATED' AND version=1`,
      [startedAt, deadlineAt ?? null, uuid(attemptId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async expireAttempt(attempt: Attempt): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE attempt_by_id SET state='EXPIRED',version=? WHERE attempt_id=?
       IF state='IN_PROGRESS' AND version=?`,
      [long(attempt.version + 1), uuid(attempt.attemptId), long(attempt.version)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async writeAttemptProjection(attempt: Attempt): Promise<void> {
    await this.db.execute(
      `INSERT INTO attempts_by_student_quiz
       (student_id,quiz_id,attempt_no,attempt_id,state,started_at,deadline_at,attempt_version)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        uuid(attempt.studentId),
        uuid(attempt.quizId),
        attempt.attemptNo,
        uuid(attempt.attemptId),
        attempt.state,
        attempt.startedAt ?? null,
        attempt.deadlineAt ?? null,
        long(attempt.version),
      ],
      "LOCAL_QUORUM",
    );
  }

  async clearGuard(attempt: Attempt, now: Date): Promise<boolean> {
    const guard = await this.guard(attempt.studentId, attempt.quizId);
    if (!guard || guard.activeAttemptId !== attempt.attemptId) return false;
    const rows = await this.db.execute(
      `UPDATE attempt_guard_by_student_quiz SET active_attempt_id=null,active_attempt_no=null,
              holder_operation_id=null,guard_version=?,updated_at=?
       WHERE student_id=? AND quiz_id=? IF guard_version=? AND active_attempt_id=?`,
      [
        long(guard.guardVersion + 1),
        now,
        uuid(attempt.studentId),
        uuid(attempt.quizId),
        long(guard.guardVersion),
        uuid(attempt.attemptId),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }

  async reserveSubmit(
    attempt: Attempt,
    operationId: string,
    receivedAt: Date,
    answerChecksum: string,
  ): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE attempt_by_id SET pending_submit_operation_id=?,pending_submit_received_at=?,pending_answer_checksum=?
       WHERE attempt_id=? IF state='IN_PROGRESS' AND version=? AND pending_submit_operation_id=null`,
      [uuid(operationId), receivedAt, answerChecksum, uuid(attempt.attemptId), long(attempt.version)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }
  async writeResultItems(attemptId: string, items: readonly ResultItem[]): Promise<void> {
    for (const item of items)
      await this.db.execute(
        `INSERT INTO result_items_by_attempt (attempt_id,question_order,question_id,question_type,
       submitted_answer_json,awarded_points,grading_outcome,result_version) VALUES (?,?,?,?,?,?,?,1) IF NOT EXISTS`,
        [
          uuid(attemptId),
          item.questionOrder,
          uuid(item.questionId),
          item.questionType,
          item.submittedAnswer === undefined ? null : JSON.stringify(item.submittedAnswer),
          types.BigDecimal.fromString(item.awardedPoints),
          item.gradingOutcome,
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
  }
  async createResult(value: AssessmentResult): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO result_by_attempt (attempt_id,student_id,quiz_id,quiz_version,score,max_score,
       grading_checksum,answer_count,result_items_checksum,grading_algorithm_version,result_version,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,? ,1,?) IF NOT EXISTS`,
      [
        uuid(value.attemptId),
        uuid(value.studentId),
        uuid(value.quizId),
        long(value.quizVersion),
        types.BigDecimal.fromString(value.score),
        types.BigDecimal.fromString(value.maxScore),
        value.gradingChecksum,
        value.answerCount,
        value.resultItemsChecksum,
        value.gradingAlgorithmVersion,
        value.createdAt,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }
  async result(attemptId: string): Promise<AssessmentResult | undefined> {
    const r = (
      await this.db.execute(
        `SELECT attempt_id,student_id,quiz_id,quiz_version,score,max_score,
      grading_checksum,answer_count,result_items_checksum,grading_algorithm_version,result_version,created_at,
      manual_score,teacher_feedback,graded_by,graded_at,grading_status
      FROM result_by_attempt WHERE attempt_id=?`,
        [uuid(attemptId)],
        "LOCAL_QUORUM",
      )
    )[0];
    return r
      ? {
          attemptId: String(r.attempt_id),
          studentId: String(r.student_id),
          quizId: String(r.quiz_id),
          quizVersion: Number(r.quiz_version),
          score: String(r.score),
          maxScore: String(r.max_score),
          gradingChecksum: String(r.grading_checksum),
          answerCount: Number(r.answer_count),
          resultItemsChecksum: String(r.result_items_checksum),
          gradingAlgorithmVersion: "objective-v1",
          resultVersion: Number(r.result_version),
          createdAt: timestamp(r.created_at),
          ...(r.manual_score !== null && r.manual_score !== undefined
            ? { manualScore: String(r.manual_score) }
            : {}),
          ...(r.teacher_feedback ? { teacherFeedback: String(r.teacher_feedback) } : {}),
          ...(r.graded_by ? { gradedBy: String(r.graded_by) } : {}),
          ...(r.graded_at ? { gradedAt: timestamp(r.graded_at) } : {}),
          ...(r.grading_status
            ? { gradingStatus: String(r.grading_status) as NonNullable<AssessmentResult["gradingStatus"]> }
            : {}),
        }
      : undefined;
  }

  async recordManualGrade(input: {
    attemptId: string;
    manualScore: string;
    teacherFeedback?: string;
    gradedBy: string;
    gradedAt: Date;
    expectedResultVersion: number;
    nextResultVersion: number;
  }): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE result_by_attempt SET manual_score=?, teacher_feedback=?, graded_by=?, graded_at=?,
              grading_status='MANUALLY_GRADED', result_version=?
       WHERE attempt_id=? IF result_version=?`,
      [
        types.BigDecimal.fromString(input.manualScore),
        input.teacherFeedback ?? null,
        input.gradedBy,
        input.gradedAt,
        long(input.nextResultVersion),
        uuid(input.attemptId),
        long(input.expectedResultVersion),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }
  async resultProjectionShard(
    quizId: string,
    month: string,
    shard: number,
    limit: number,
    position?: { submittedAt: Date; attemptId: string },
  ): Promise<ResultProjectionRow[]> {
    const ym = types.LocalDate.fromString(`${month}-01`),
      common = [uuid(quizId), ym, shard],
      select = `SELECT submitted_at,attempt_id,student_id,score,max_score,result_version
        FROM results_by_quiz_bucket WHERE quiz_id=? AND year_month=? AND shard=?`,
      rows: Record<string, unknown>[] = [];
    if (position) {
      rows.push(
        ...(await this.db.execute(
          `${select} AND submitted_at=? AND attempt_id>? LIMIT ?`,
          [...common, position.submittedAt, uuid(position.attemptId), limit],
          "LOCAL_QUORUM",
        )),
      );
      if (rows.length < limit)
        rows.push(
          ...(await this.db.execute(
            `${select} AND submitted_at<? LIMIT ?`,
            [...common, position.submittedAt, limit - rows.length],
            "LOCAL_QUORUM",
          )),
        );
    } else rows.push(...(await this.db.execute(`${select} LIMIT ?`, [...common, limit], "LOCAL_QUORUM")));
    return rows.map((row) => ({
      attemptId: String(row.attempt_id),
      studentId: String(row.student_id),
      score: String(row.score),
      maxScore: String(row.max_score),
      resultVersion: Number(row.result_version),
      submittedAt: timestamp(row.submitted_at),
      shard,
    }));
  }
  async submitAttempt(
    attempt: Attempt,
    operationId: string,
    submittedAt: Date,
    answerChecksum: string,
  ): Promise<boolean> {
    const rows = await this.db.execute(
      `UPDATE attempt_by_id SET state='SUBMITTED',submitted_at=?,answer_checksum=?,
      submit_key=?,version=?,pending_submit_operation_id=null,pending_submit_received_at=null,
      pending_answer_checksum=null,pending_grading_checksum=null WHERE attempt_id=?
      IF state='IN_PROGRESS' AND version=? AND pending_submit_operation_id=?`,
      [
        submittedAt,
        answerChecksum,
        operationId,
        long(attempt.version + 1),
        uuid(attempt.attemptId),
        long(attempt.version),
        uuid(operationId),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return applied(rows);
  }
  async writeResultProjection(result: AssessmentResult, submittedAt: Date, shard: number): Promise<void> {
    const ym = types.LocalDate.fromString(submittedAt.toISOString().slice(0, 7) + "-01");
    await this.db.execute(
      `INSERT INTO results_by_quiz_bucket (quiz_id,year_month,shard,submitted_at,
      attempt_id,student_id,score,max_score,result_version) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        uuid(result.quizId),
        ym,
        shard,
        submittedAt,
        uuid(result.attemptId),
        uuid(result.studentId),
        types.BigDecimal.fromString(result.score),
        types.BigDecimal.fromString(result.maxScore),
        long(result.resultVersion),
      ],
      "LOCAL_QUORUM",
    );
  }
  async updateResultProjection(
    quizId: string,
    submittedAt: Date,
    shard: number,
    attemptId: string,
    score: string,
    resultVersion: number,
  ): Promise<void> {
    const ym = types.LocalDate.fromString(submittedAt.toISOString().slice(0, 7) + "-01");
    await this.db.execute(
      `UPDATE results_by_quiz_bucket SET score=?, result_version=?
       WHERE quiz_id=? AND year_month=? AND shard=? AND submitted_at=? AND attempt_id=?`,
      [
        types.BigDecimal.fromString(score),
        long(resultVersion),
        uuid(quizId),
        ym,
        shard,
        submittedAt,
        uuid(attemptId),
      ],
      "LOCAL_QUORUM",
    );
  }
  async prepareSubmittedEvent(input: {
    eventId: string;
    result: AssessmentResult;
    occurredAt: Date;
    correlationId: string;
    mastery?: {
      tenantId: string;
      courseId: string;
      learningOutcomeId: string;
      conceptId: string;
      sourceType: "QUIZ";
    };
  }) {
    const event = {
      specVersion: "1.0",
      eventId: input.eventId,
      eventType: "assessment.quiz.submitted.v1",
      occurredAt: input.occurredAt.toISOString(),
      producer: "assessment-service",
      correlationId: input.correlationId,
      aggregate: { type: "ATTEMPT", id: input.result.attemptId, version: input.result.resultVersion },
      data: {
        quizId: input.result.quizId,
        attemptId: input.result.attemptId,
        studentId: input.result.studentId,
        score: input.result.score,
        maxScore: input.result.maxScore,
        resultVersion: input.result.resultVersion,
        ...(input.mastery
          ? {
              ...input.mastery,
              sourceId: input.result.attemptId,
              rawScorePercent: percent(input.result.score, input.result.maxScore),
              schemaVersion: "1.0",
            }
          : {}),
      },
    };
    const day = types.LocalDate.fromString(input.occurredAt.toISOString().slice(0, 10)),
      bucket = eventShard(input.eventId);
    await this.db.execute(
      `INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,
      aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at)
      VALUES (?,?,?,?,?,?,?,?,'PREPARED',0,0,?) IF NOT EXISTS`,
      [
        day,
        bucket,
        input.occurredAt,
        uuid(input.eventId),
        "assessment.quiz.submitted.v1",
        uuid(input.result.attemptId),
        long(input.result.resultVersion),
        JSON.stringify(event),
        input.occurredAt,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      `INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,
      next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?,'PREPARED',?,0,0,?) IF NOT EXISTS`,
      [
        uuid(input.eventId),
        "assessment.quiz.submitted.v1",
        uuid(input.result.attemptId),
        long(input.result.resultVersion),
        input.occurredAt,
        input.occurredAt,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async prepareGradedEvent(input: {
    eventId: string;
    result: AssessmentResult;
    occurredAt: Date;
    correlationId: string;
    actorId: string;
    mastery?: {
      tenantId: string;
      courseId: string;
      learningOutcomeId: string;
      conceptId: string;
      sourceType: "MANUAL_ASSESSMENT";
    };
  }) {
    const event = {
      specVersion: "1.0",
      eventId: input.eventId,
      eventType: "assessment.quiz.graded.v1",
      occurredAt: input.occurredAt.toISOString(),
      producer: "assessment-service",
      correlationId: input.correlationId,
      actor: { type: "USER", id: input.actorId },
      aggregate: { type: "ATTEMPT", id: input.result.attemptId, version: input.result.resultVersion },
      data: {
        quizId: input.result.quizId,
        attemptId: input.result.attemptId,
        studentId: input.result.studentId,
        score: input.result.manualScore ?? input.result.score,
        autoScore: input.result.score,
        manualScore: input.result.manualScore,
        maxScore: input.result.maxScore,
        teacherFeedback: input.result.teacherFeedback,
        gradedBy: input.result.gradedBy,
        resultVersion: input.result.resultVersion,
        gradingStatus: input.result.gradingStatus ?? "MANUALLY_GRADED",
        ...(input.mastery
          ? {
              ...input.mastery,
              sourceId: input.result.attemptId,
              rawScorePercent: percent(input.result.manualScore ?? input.result.score, input.result.maxScore),
              schemaVersion: "1.0",
            }
          : {}),
      },
    };
    const day = types.LocalDate.fromString(input.occurredAt.toISOString().slice(0, 10)),
      bucket = eventShard(input.eventId);
    await this.db.execute(
      `INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,
      aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at)
      VALUES (?,?,?,?,?,?,?,?,'PREPARED',0,0,?) IF NOT EXISTS`,
      [
        day,
        bucket,
        input.occurredAt,
        uuid(input.eventId),
        "assessment.quiz.graded.v1",
        uuid(input.result.attemptId),
        long(input.result.resultVersion),
        JSON.stringify(event),
        input.occurredAt,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      `INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,
      next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?,'PREPARED',?,0,0,?) IF NOT EXISTS`,
      [
        uuid(input.eventId),
        "assessment.quiz.graded.v1",
        uuid(input.result.attemptId),
        long(input.result.resultVersion),
        input.occurredAt,
        input.occurredAt,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async readySubmittedEvent(eventId: string, occurredAt: Date) {
    const day = types.LocalDate.fromString(occurredAt.toISOString().slice(0, 10)),
      bucket = eventShard(eventId);
    await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY' WHERE due_day=? AND shard=? AND
      next_attempt_at=? AND event_id=? IF state='PREPARED'`,
      [day, bucket, occurredAt, uuid(eventId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF state='PREPARED'`,
      [uuid(eventId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async listDue(now: Date): Promise<DueAssessmentEvent[]> {
    const out: DueAssessmentEvent[] = [];
    for (let d = 0; d < 2; d++) {
      const day = new Date(now);
      day.setUTCDate(day.getUTCDate() - d);
      const due = day.toISOString().slice(0, 10);
      for (let s = 0; s < 16; s++) {
        const rows = await this.db.execute(
          `SELECT due_day,shard,next_attempt_at,event_id,payload_json,
        state,retry_count,lease_fence,lease_until FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND
        next_attempt_at<=? LIMIT 25`,
          [types.LocalDate.fromString(due), s, now],
          "LOCAL_QUORUM",
        );
        for (const r of rows)
          out.push({
            dueDay: String(r.due_day),
            shard: Number(r.shard),
            nextAttemptAt: timestamp(r.next_attempt_at),
            eventId: String(r.event_id),
            event: JSON.parse(String(r.payload_json)) as EventEnvelope,
            state: String(r.state),
            retryCount: Number(r.retry_count),
            leaseFence: Number(r.lease_fence ?? 0),
            ...(r.lease_until ? { leaseUntil: timestamp(r.lease_until) } : {}),
          });
      }
    }
    return out.slice(0, 50);
  }
  async claimEvent(item: DueAssessmentEvent, owner: string, now: Date) {
    const fence = item.leaseFence + 1,
      rows = await this.db.execute(
        `UPDATE pending_events_by_due_bucket SET state='PUBLISHING',lease_owner=?,lease_until=?,lease_fence=? WHERE
     due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='READY'`,
        [
          owner,
          new Date(now.getTime() + 15000),
          long(fence),
          types.LocalDate.fromString(item.dueDay),
          item.shard,
          item.nextAttemptAt,
          uuid(item.eventId),
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
    if (!applied(rows)) return false;
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='PUBLISHING',lease_fence=?
      WHERE event_id=?`,
      [long(fence), uuid(item.eventId)],
      "LOCAL_QUORUM",
    );
    return true;
  }
  async retryEvent(item: DueAssessmentEvent, next: Date) {
    const fence = item.leaseFence + 1;
    await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY',retry_count=?,lease_owner=null,lease_until=? WHERE due_day=?
     AND shard=? AND next_attempt_at=? AND event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [
        item.retryCount + 1,
        next,
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        uuid(item.eventId),
        long(fence),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='READY',retry_count=?,next_attempt_at=? WHERE event_id=?
     IF state='PUBLISHING' AND lease_fence=?`,
      [item.retryCount + 1, next, uuid(item.eventId), long(fence)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async publishedEvent(item: DueAssessmentEvent, now: Date) {
    const fence = item.leaseFence + 1,
      rows = await this.db.execute(
        `UPDATE pending_event_by_id SET state='PUBLISHED',published_at=? WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?`,
        [now, uuid(item.eventId), long(fence)],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
    if (!applied(rows)) throw new Error("OUTBOX_FENCE_LOST");
    await this.db.execute(
      `DELETE FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at=?
     AND event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        uuid(item.eventId),
        long(fence),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
}

function rowQuiz(row: Record<string, unknown>): Quiz {
  return {
    quizId: String(row.quiz_id),
    targetType: String(row.target_type) as "COURSE" | "CLASS",
    targetId: String(row.target_id),
    ownerId: String(row.owner_id),
    title: String(row.title),
    state: String(row.state) as Quiz["state"],
    currentVersion: Number(row.current_version),
    ...(row.opens_at ? { opensAt: timestamp(row.opens_at) } : {}),
    ...(row.closes_at ? { closesAt: timestamp(row.closes_at) } : {}),
    ...(row.duration_seconds !== null && row.duration_seconds !== undefined
      ? { durationSeconds: Number(row.duration_seconds) }
      : {}),
    ...(row.attempt_limit !== null && row.attempt_limit !== undefined
      ? { attemptLimit: Number(row.attempt_limit) }
      : {}),
    recordVersion: Number(row.record_version),
    questionCount: Number(row.question_count),
    snapshotChecksum: String(row.snapshot_checksum),
    snapshotReady: row.snapshot_ready === true,
    ...(row.pending_operation_id
      ? { pendingOperationId: (row.pending_operation_id as types.Uuid).toString() }
      : {}),
    ...(row.pending_version ? { pendingVersion: Number(row.pending_version) } : {}),
    ...(row.pending_question_count !== null && row.pending_question_count !== undefined
      ? { pendingQuestionCount: Number(row.pending_question_count) }
      : {}),
    ...(row.pending_snapshot_checksum
      ? { pendingSnapshotChecksum: row.pending_snapshot_checksum as string }
      : {}),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

function rowQuestion(row: Record<string, unknown>): QuizQuestion {
  return {
    quizId: String(row.quiz_id),
    quizVersion: Number(row.quiz_version),
    questionOrder: Number(row.question_order),
    questionId: String(row.question_id),
    prompt: String(row.prompt),
    questionType: String(row.question_type) as QuizQuestion["questionType"],
    ...(row.options_json ? { options: JSON.parse(row.options_json as string) as string[] } : {}),
    correctAnswer: JSON.parse(String(row.correct_answer_json)) as QuizQuestion["correctAnswer"],
    points: String(row.points),
    checksum: String(row.checksum),
  };
}

function rowAttempt(row: Record<string, unknown>): Attempt {
  return {
    attemptId: String(row.attempt_id),
    studentId: String(row.student_id),
    quizId: String(row.quiz_id),
    quizVersion: Number(row.quiz_version),
    attemptNo: Number(row.attempt_no),
    state: String(row.state) as Attempt["state"],
    ...(row.started_at ? { startedAt: timestamp(row.started_at) } : {}),
    ...(row.deadline_at ? { deadlineAt: timestamp(row.deadline_at) } : {}),
    ...(row.submitted_at ? { submittedAt: timestamp(row.submitted_at) } : {}),
    ...(typeof row.submit_key === "string" ? { submitOperationId: row.submit_key } : {}),
    version: Number(row.version),
    ...(row.pending_submit_operation_id
      ? { pendingSubmitOperationId: (row.pending_submit_operation_id as types.Uuid).toString() }
      : {}),
    ...(row.pending_submit_received_at
      ? { pendingSubmitReceivedAt: timestamp(row.pending_submit_received_at) }
      : {}),
    ...(row.pinned_question_count !== null && row.pinned_question_count !== undefined
      ? { pinnedQuestionCount: Number(row.pinned_question_count) }
      : {}),
    ...(typeof row.pinned_snapshot_checksum === "string"
      ? { pinnedSnapshotChecksum: row.pinned_snapshot_checksum }
      : {}),
  };
}
function rowGuard(row: Record<string, unknown>): AttemptGuard {
  return {
    studentId: String(row.student_id),
    quizId: String(row.quiz_id),
    ...(row.active_attempt_id ? { activeAttemptId: (row.active_attempt_id as types.Uuid).toString() } : {}),
    ...(row.active_attempt_no !== null && row.active_attempt_no !== undefined
      ? { activeAttemptNo: Number(row.active_attempt_no) }
      : {}),
    attemptsStarted: Number(row.attempts_started),
    ...(row.holder_operation_id
      ? { holderOperationId: (row.holder_operation_id as types.Uuid).toString() }
      : {}),
    guardVersion: Number(row.guard_version),
  };
}

function applied(rows: readonly Record<string, unknown>[]): boolean {
  return rows[0]?.["[applied]"] === true;
}
const uuid = (value: string) => types.Uuid.fromString(value);
const long = (value: number) => types.Long.fromNumber(value);
const eventShard = (id: string) => (createHash("sha256").update(id).digest().at(0) ?? 0) % 16;
const percent = (score: string, maximum: string) => {
  const denominator = Number(maximum);
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.max(0, Math.min(100, (Number(score) / denominator) * 100));
};
function timestamp(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
function optionalTimestamp(value: unknown): Date | undefined {
  return value ? timestamp(value) : undefined;
}
