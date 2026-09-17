import { ApiError, record, string } from "./api";

export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
export type AttemptState = "CREATED" | "IN_PROGRESS" | "SUBMITTED" | "EXPIRED";
export type QuizState = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";

export interface QuizSummary {
  quizId: string;
  targetType: "COURSE" | "CLASS";
  targetId: string;
  title: string;
  state: QuizState;
  currentVersion: number;
  recordVersion?: number;
  questionCount: number;
  durationSeconds?: number;
  attemptLimit?: number;
  opensAt?: string;
  closesAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestion {
  questionId: string;
  questionOrder: number;
  prompt: string;
  questionType: QuestionType;
  options?: string[];
  points: string;
}

export interface QuizDetail extends QuizSummary {
  questions: QuizQuestion[];
}

export interface Attempt {
  attemptId: string;
  quizId: string;
  quizVersion: number;
  attemptNo: number;
  state: AttemptState;
  startedAt?: string;
  deadlineAt?: string;
  submittedAt?: string;
  version: number;
}

export interface AttemptWithQuestions {
  attempt: Attempt;
  questions: QuizQuestion[];
  replayed?: boolean;
}

export type SubmittedAnswer =
  | { questionId: string; selectedOptionId: string }
  | { questionId: string; selectedOptionIds: string[] }
  | { questionId: string; value: boolean }
  | { questionId: string; text: string };

export interface AttemptSubmitRequest {
  answers: SubmittedAnswer[];
  clientSubmittedAt: string;
}

export interface SubmitResponse {
  attemptId: string;
  score: string;
  maxScore: string;
  resultVersion: number;
}

export interface AssessmentResult {
  attemptId: string;
  quizId: string;
  quizVersion: number;
  score: string;
  maxScore: string;
  submittedAt: string;
  resultVersion: number;
  gradingAlgorithmVersion: string;
}

const VALID_ATTEMPT_STATES = new Set<AttemptState>(["CREATED", "IN_PROGRESS", "SUBMITTED", "EXPIRED"]);

export function isAttemptState(value: unknown): value is AttemptState {
  return typeof value === "string" && VALID_ATTEMPT_STATES.has(value as AttemptState);
}

function unwrap(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "data" in value &&
    (value as { data: unknown }).data !== undefined
  ) {
    return (value as { data: unknown }).data;
  }
  return value;
}

export function quizQuestion(value: unknown): QuizQuestion {
  const row = record(value);
  const questionType = string(row.questionType) as QuestionType;
  if (!["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"].includes(questionType)) {
    throw new ApiError("invalid");
  }
  const points = typeof row.points === "string" ? row.points : String(row.points ?? "1");
  const questionOrder = typeof row.questionOrder === "number" ? row.questionOrder : Number(row.questionOrder);
  if (Number.isNaN(questionOrder)) throw new ApiError("invalid");

  let options: string[] | undefined;
  if (Array.isArray(row.options)) {
    options = row.options.map((opt) => (typeof opt === "string" ? opt : String(opt)));
  }

  return {
    questionId: string(row.questionId),
    questionOrder,
    prompt: string(row.prompt),
    questionType,
    ...(options ? { options } : {}),
    points,
  };
}

export function quizQuestions(value: unknown): QuizQuestion[] {
  const raw = unwrap(value);
  if (!Array.isArray(raw)) throw new ApiError("invalid");
  return raw.map(quizQuestion);
}

export function quizSummary(value: unknown): QuizSummary {
  const row = record(unwrap(value));
  const targetType = string(row.targetType);
  if (targetType !== "COURSE" && targetType !== "CLASS") {
    throw new ApiError("invalid");
  }

  const currentVersion =
    typeof row.currentVersion === "number" ? row.currentVersion : Number(row.currentVersion);
  if (Number.isNaN(currentVersion)) throw new ApiError("invalid");

  const questionCount = typeof row.questionCount === "number" ? row.questionCount : Number(row.questionCount);
  if (Number.isNaN(questionCount)) throw new ApiError("invalid");

  return {
    quizId: string(row.quizId),
    targetType,
    targetId: string(row.targetId),
    title: string(row.title),
    state: (typeof row.state === "string" ? row.state : "PUBLISHED") as QuizState,
    currentVersion,
    ...(row.recordVersion !== undefined ? { recordVersion: Number(row.recordVersion) } : {}),
    questionCount,
    ...(typeof row.durationSeconds === "number" ? { durationSeconds: row.durationSeconds } : {}),
    ...(typeof row.attemptLimit === "number" ? { attemptLimit: row.attemptLimit } : {}),
    ...(typeof row.opensAt === "string" ? { opensAt: row.opensAt } : {}),
    ...(typeof row.closesAt === "string" ? { closesAt: row.closesAt } : {}),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
  };
}

export function quizSummaries(value: unknown): QuizSummary[] {
  const raw = unwrap(value);
  if (Array.isArray(raw)) {
    return raw.map(quizSummary);
  }
  if (
    raw &&
    typeof raw === "object" &&
    "items" in raw &&
    Array.isArray((raw as { items: unknown[] }).items)
  ) {
    return (raw as { items: unknown[] }).items.map(quizSummary);
  }
  throw new ApiError("invalid");
}

export function quizDetail(value: unknown): QuizDetail {
  const unwrapped = unwrap(value);
  const summary = quizSummary(unwrapped);
  const row = record(unwrapped);
  const questions = Array.isArray(row.questions) ? quizQuestions(row.questions) : [];
  return {
    ...summary,
    questions,
  };
}

export function attempt(value: unknown): Attempt {
  const row = record(unwrap(value));
  const state = string(row.state);
  if (!isAttemptState(state)) {
    throw new ApiError("invalid");
  }

  const quizVersion = typeof row.quizVersion === "number" ? row.quizVersion : Number(row.quizVersion);
  const attemptNo = typeof row.attemptNo === "number" ? row.attemptNo : Number(row.attemptNo);
  const version = typeof row.version === "number" ? row.version : Number(row.version);

  if (Number.isNaN(quizVersion) || Number.isNaN(attemptNo) || Number.isNaN(version)) {
    throw new ApiError("invalid");
  }

  return {
    attemptId: string(row.attemptId),
    quizId: string(row.quizId),
    quizVersion,
    attemptNo,
    state,
    ...(typeof row.startedAt === "string" ? { startedAt: row.startedAt } : {}),
    ...(typeof row.deadlineAt === "string" ? { deadlineAt: row.deadlineAt } : {}),
    ...(typeof row.submittedAt === "string" ? { submittedAt: row.submittedAt } : {}),
    version,
  };
}

export function attemptWithQuestions(value: unknown): AttemptWithQuestions {
  const row = record(unwrap(value));
  const parsedAttempt = attempt(row);
  const questions = Array.isArray(row.questions) ? quizQuestions(row.questions) : [];
  const replayed = typeof row.replayed === "boolean" ? row.replayed : undefined;

  return {
    attempt: parsedAttempt,
    questions,
    ...(replayed !== undefined ? { replayed } : {}),
  };
}

export function submitResponse(value: unknown): SubmitResponse {
  const row = record(unwrap(value));
  const resultVersion = typeof row.resultVersion === "number" ? row.resultVersion : Number(row.resultVersion);
  if (Number.isNaN(resultVersion)) throw new ApiError("invalid");

  return {
    attemptId: string(row.attemptId),
    score: typeof row.score === "string" ? row.score : String(row.score ?? "0"),
    maxScore: typeof row.maxScore === "string" ? row.maxScore : String(row.maxScore ?? "0"),
    resultVersion,
  };
}

export function assessmentResult(value: unknown): AssessmentResult {
  const row = record(unwrap(value));
  const quizVersion = typeof row.quizVersion === "number" ? row.quizVersion : Number(row.quizVersion);
  const resultVersion = typeof row.resultVersion === "number" ? row.resultVersion : Number(row.resultVersion);

  if (Number.isNaN(quizVersion) || Number.isNaN(resultVersion)) {
    throw new ApiError("invalid");
  }

  return {
    attemptId: string(row.attemptId),
    quizId: string(row.quizId),
    quizVersion,
    score: typeof row.score === "string" ? row.score : String(row.score ?? "0"),
    maxScore: typeof row.maxScore === "string" ? row.maxScore : String(row.maxScore ?? "0"),
    submittedAt: string(row.submittedAt),
    resultVersion,
    gradingAlgorithmVersion:
      typeof row.gradingAlgorithmVersion === "string" ? row.gradingAlgorithmVersion : "objective-v1",
  };
}

export function calculateRemainingSeconds(deadlineAt?: string | null, now = new Date()): number {
  if (!deadlineAt) return 0;
  const deadlineTime = Date.parse(deadlineAt);
  if (Number.isNaN(deadlineTime)) return 0;
  const diffMs = deadlineTime - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 1000);
}

export function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function isAttemptExpired(deadlineAt?: string | null, now = new Date()): boolean {
  if (!deadlineAt) return false;
  const deadlineTime = Date.parse(deadlineAt);
  if (Number.isNaN(deadlineTime)) return false;
  return now.getTime() >= deadlineTime;
}

export function countAnsweredQuestions(
  questions: QuizQuestion[],
  draftAnswers: Record<string, SubmittedAnswer>,
): { answered: number; total: number; unanswered: number } {
  let answered = 0;
  for (const q of questions) {
    const ans = draftAnswers[q.questionId];
    if (ans && validateAnswerForQuestion(q, ans)) {
      answered++;
    }
  }
  return {
    answered,
    total: questions.length,
    unanswered: Math.max(0, questions.length - answered),
  };
}

export function validateAnswerForQuestion(question: QuizQuestion, answer?: SubmittedAnswer): boolean {
  if (!answer) return false;
  if (answer.questionId !== question.questionId) return false;

  switch (question.questionType) {
    case "SINGLE_CHOICE": {
      if (!("selectedOptionId" in answer)) return false;
      return (
        typeof answer.selectedOptionId === "string" &&
        answer.selectedOptionId.trim().length > 0 &&
        (question.options ? question.options.includes(answer.selectedOptionId) : true)
      );
    }
    case "MULTIPLE_CHOICE": {
      if (!("selectedOptionIds" in answer)) return false;
      return (
        Array.isArray(answer.selectedOptionIds) &&
        answer.selectedOptionIds.length > 0 &&
        (question.options ? answer.selectedOptionIds.every((opt) => question.options!.includes(opt)) : true)
      );
    }
    case "TRUE_FALSE": {
      if (!("value" in answer)) return false;
      return typeof answer.value === "boolean";
    }
    case "SHORT_ANSWER": {
      if (!("text" in answer)) return false;
      return typeof answer.text === "string" && answer.text.trim().length > 0;
    }
    default:
      return false;
  }
}

export function buildSubmitPayload(
  questions: QuizQuestion[],
  draftAnswers: Record<string, SubmittedAnswer>,
  clientSubmittedAt = new Date().toISOString(),
): AttemptSubmitRequest {
  const answers: SubmittedAnswer[] = [];
  for (const q of questions) {
    const draft = draftAnswers[q.questionId];
    if (draft && validateAnswerForQuestion(q, draft)) {
      answers.push(draft);
    }
  }
  return {
    answers,
    clientSubmittedAt,
  };
}

export type SubmitReconciliationOutcome = "SUCCESS" | "ALLOW_RETRY" | "EXPIRED" | "UNKNOWN";

export function reconcileAttemptSubmitOutcome(state: AttemptState): SubmitReconciliationOutcome {
  switch (state) {
    case "SUBMITTED":
      return "SUCCESS";
    case "IN_PROGRESS":
    case "CREATED":
      return "ALLOW_RETRY";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "UNKNOWN";
  }
}
