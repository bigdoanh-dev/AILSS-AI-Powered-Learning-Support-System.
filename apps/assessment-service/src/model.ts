import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { objectiveQuizSchema, type ObjectiveQuiz } from "../../../packages/contracts/src/objective-v1.js";

const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (value) =>
        !Array.from(value).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
      "Control characters are not allowed",
    );
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const points = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u)
  .transform(decimal)
  .refine((value) => Number(value) > 0 && Number(value) <= 100, "Points must be > 0 and <= 100");
const option = safeText(1, 500);
const common = { prompt: safeText(1, 2_000), points };
const choiceBase = {
  ...common,
  options: z
    .array(option)
    .min(2)
    .max(10)
    .refine((value) => new Set(value).size === value.length, "Options must be unique"),
};
const singleChoice = z
  .object({ ...choiceBase, questionType: z.literal("SINGLE_CHOICE"), correctAnswer: option })
  .strict()
  .refine((value) => value.options.includes(value.correctAnswer), "Correct answer must be an option");
const multipleChoice = z
  .object({
    ...choiceBase,
    questionType: z.literal("MULTIPLE_CHOICE"),
    correctAnswer: z.array(option).min(1).max(10),
  })
  .strict()
  .refine((value) => new Set(value.correctAnswer).size === value.correctAnswer.length, {
    message: "Correct answers must be unique",
  })
  .refine((value) => value.correctAnswer.every((answer) => value.options.includes(answer)), {
    message: "Every correct answer must be an option",
  })
  .transform((value) => ({
    ...value,
    correctAnswer: value.options.filter((candidate) => value.correctAnswer.includes(candidate)),
  }));
const trueFalse = z
  .object({ ...common, questionType: z.literal("TRUE_FALSE"), correctAnswer: z.boolean() })
  .strict();
const shortAnswer = z
  .object({ ...common, questionType: z.literal("SHORT_ANSWER"), correctAnswer: safeText(1, 500) })
  .strict();
const question = z.union([singleChoice, multipleChoice, trueFalse, shortAnswer]);
const scheduleFields = {
  opensAt: dateTime.optional(),
  closesAt: dateTime.optional(),
  durationSeconds: z.number().int().min(60).max(14_400).optional(),
  attemptLimit: z.number().int().min(1).max(100).optional(),
};
const createSchema = z
  .object({
    title: safeText(3, 160),
    targetType: z.enum(["COURSE", "CLASS"]),
    targetId: z.string().uuid(),
    ...scheduleFields,
    questions: z.array(question).max(200),
  })
  .strict()
  .superRefine(scheduleWindow);
const patchSchema = z
  .object({
    title: safeText(3, 160).optional(),
    opensAt: dateTime.nullable().optional(),
    closesAt: dateTime.nullable().optional(),
    durationSeconds: z.number().int().min(60).max(14_400).nullable().optional(),
    attemptLimit: z.number().int().min(1).max(100).nullable().optional(),
    questions: z.array(question).max(200).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "PATCH body must not be empty");

export type QuizCreateRequest = z.infer<typeof createSchema>;
export type QuizPatchRequest = z.infer<typeof patchSchema>;
export type QuestionInput = QuizCreateRequest["questions"][number];
export type QuizState = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";

export const aiDraftImportSchema = z
  .object({
    importOperationId: z.string().uuid(),
    approvedDraftVersion: z.literal(2),
    approvedDraftChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
    jobId: z.string().uuid(),
    targetType: z.enum(["COURSE", "CLASS"]),
    targetId: z.string().uuid(),
    targetVersion: z.number().int().positive(),
    ownerLecturerId: z.string().uuid(),
    quiz: objectiveQuizSchema,
  })
  .strict();
export type AiDraftImportRequest = z.infer<typeof aiDraftImportSchema>;
export interface AiDraftImportResult {
  draftId: string;
  approvedDraftVersion: 2;
  quizId: string;
  quizVersion: 1;
  status: "DRAFT";
}

export function objectiveToAssessment(quiz: ObjectiveQuiz): QuizCreateRequest["questions"] {
  return [...quiz.questions]
    .sort((left, right) => left.order - right.order)
    .map((question): QuestionInput => {
      if (question.type === "SINGLE_CHOICE") {
        const byId = new Map(question.options.map((option) => [option.id, option.text]));
        const correctAnswer = byId.get(question.correctAnswer.optionId);
        if (!correctAnswer) throw new Error("OBJECTIVE_ANSWER_REFERENCE_INVALID");
        return {
          prompt: question.text,
          points: question.points,
          questionType: question.type,
          options: question.options.map((option) => option.text),
          correctAnswer,
        };
      }
      if (question.type === "MULTIPLE_CHOICE") {
        const answers = new Set(question.correctAnswer.optionIds);
        return {
          prompt: question.text,
          points: question.points,
          questionType: question.type,
          options: question.options.map((option) => option.text),
          correctAnswer: question.options
            .filter((option) => answers.has(option.id))
            .map((option) => option.text),
        };
      }
      if (question.type === "TRUE_FALSE")
        return {
          prompt: question.text,
          points: question.points,
          questionType: question.type,
          correctAnswer: question.correctAnswer.value,
        };
      return {
        prompt: question.text,
        points: question.points,
        questionType: question.type,
        correctAnswer: question.correctAnswer.acceptedAnswer,
      };
    });
}

export interface Quiz {
  quizId: string;
  targetType: "COURSE" | "CLASS";
  targetId: string;
  ownerId: string;
  title: string;
  state: QuizState;
  currentVersion: number;
  opensAt?: Date;
  closesAt?: Date;
  durationSeconds?: number;
  attemptLimit?: number;
  recordVersion: number;
  questionCount: number;
  snapshotChecksum: string;
  snapshotReady: boolean;
  pendingOperationId?: string;
  pendingVersion?: number;
  pendingQuestionCount?: number;
  pendingSnapshotChecksum?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuizQuestion {
  quizId: string;
  quizVersion: number;
  questionOrder: number;
  questionId: string;
  prompt: string;
  questionType: QuestionInput["questionType"];
  options?: string[];
  correctAnswer: QuestionInput["correctAnswer"];
  points: string;
  checksum: string;
}

export interface QuizProjection {
  targetType: "COURSE" | "CLASS";
  targetId: string;
  state: "DRAFT" | "PUBLISHED";
  sortAt: Date;
  quizId: string;
  title: string;
  opensAt?: Date;
  closesAt?: Date;
  quizVersion: number;
  recordVersion: number;
}

export interface CommandReceipt {
  fingerprint: string;
  action: "CREATE" | "UPDATE" | "PUBLISH" | "START_ATTEMPT" | "SUBMIT_ATTEMPT";
  occurredAt?: string;
  expectedCurrentVersion?: number;
  expectedRecordVersion?: number;
  oldSnapshotChecksum?: string;
  intendedSnapshotChecksum?: string;
  oldQuiz?: QuizDto;
  intendedQuiz?: QuizDto;
  questions?: QuizQuestionDto[];
  result?: QuizDetailDto;
  noOp?: boolean;
  attempt?: AttemptDto;
  submitResult?: { attemptId: string; score: string; maxScore: string; resultVersion: number };
  submittedEventId?: string;
}

export type AttemptState = "CREATED" | "IN_PROGRESS" | "SUBMITTED" | "EXPIRED";
export interface Attempt {
  attemptId: string;
  studentId: string;
  quizId: string;
  quizVersion: number;
  attemptNo: number;
  state: AttemptState;
  startedAt?: Date;
  deadlineAt?: Date;
  submittedAt?: Date;
  submitOperationId?: string;
  version: number;
  pendingSubmitOperationId?: string;
  pendingSubmitReceivedAt?: Date;
  pinnedQuestionCount?: number;
  pinnedSnapshotChecksum?: string;
}

const answerBase = { questionId: z.string().uuid() };
const submittedAnswer = z.union([
  z.object({ ...answerBase, selectedOptionId: safeText(1, 500) }).strict(),
  z
    .object({ ...answerBase, selectedOptionIds: z.array(safeText(1, 500)).max(10) })
    .strict()
    .refine(
      (v) => new Set(v.selectedOptionIds).size === v.selectedOptionIds.length,
      "Option IDs must be unique",
    ),
  z.object({ ...answerBase, value: z.boolean() }).strict(),
  z.object({ ...answerBase, text: z.string().max(500) }).strict(),
]);
const submitSchema = z
  .object({ answers: z.array(submittedAnswer).max(200), clientSubmittedAt: dateTime })
  .strict()
  .refine(
    (v) => new Set(v.answers.map((a) => a.questionId)).size === v.answers.length,
    "Question IDs must be unique",
  );
export type AttemptSubmitRequest = z.infer<typeof submitSchema>;
export const parseAttemptSubmit = (value: unknown) => submitSchema.parse(value);

export interface ResultCursorPosition {
  submittedAt: string;
  attemptId: string;
}
export interface ResultCursor {
  v: 1;
  quizId: string;
  month: string;
  limit: number;
  filtersHash: string;
  issuedAt: number;
  expiry: number;
  positions: Record<string, ResultCursorPosition>;
}

export function parseResultListQuery(value: unknown): { month: string; limit: number; cursor?: string } {
  const parsed = z
    .object({
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().min(16).max(16_384).optional(),
    })
    .strict()
    .parse(value);
  return parsed.cursor
    ? { month: parsed.month, limit: parsed.limit, cursor: parsed.cursor }
    : { month: parsed.month, limit: parsed.limit };
}

export function resultFiltersHash(quizId: string, month: string, limit: number): string {
  return createHash("sha256").update(JSON.stringify({ quizId, month, limit })).digest("hex");
}

export function encodeResultCursor(secret: string, payload: ResultCursor): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function decodeResultCursor(
  secret: string,
  cursor: string,
  expected: { quizId: string; month: string; limit: number },
  now = Math.floor(Date.now() / 1000),
): ResultCursor {
  const [body, signature, extra] = cursor.split(".");
  if (!body || !signature || extra) throw new Error("INVALID_CURSOR");
  const expectedSignature = createHmac("sha256", secret).update(body).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature))
    throw new Error("INVALID_CURSOR");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  const position = z.object({ submittedAt: z.string().datetime(), attemptId: z.string().uuid() }).strict();
  const value = z
    .object({
      v: z.literal(1),
      quizId: z.string().uuid(),
      month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
      limit: z.number().int().min(1).max(100),
      filtersHash: z.string().regex(/^[a-f0-9]{64}$/u),
      issuedAt: z.number().int().nonnegative(),
      expiry: z.number().int().positive(),
      positions: z.record(z.string(), position),
    })
    .strict()
    .parse(decoded);
  if (
    value.quizId !== expected.quizId ||
    value.month !== expected.month ||
    value.limit !== expected.limit ||
    value.filtersHash !== resultFiltersHash(expected.quizId, expected.month, expected.limit) ||
    value.issuedAt > now ||
    value.expiry < now
  )
    throw new Error("INVALID_CURSOR");
  return value;
}

export function normalizeShortAnswerV1(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\p{White_Space}+/gu, " ")
    .toLowerCase();
}

export interface ResultItem {
  questionId: string;
  questionOrder: number;
  questionType: string;
  submittedAnswer?: unknown;
  awardedPoints: string;
  gradingOutcome: "CORRECT" | "INCORRECT" | "UNANSWERED";
}
export interface AssessmentResult {
  attemptId: string;
  studentId: string;
  quizId: string;
  quizVersion: number;
  score: string;
  maxScore: string;
  gradingChecksum: string;
  answerCount: number;
  resultItemsChecksum: string;
  gradingAlgorithmVersion: "objective-v1";
  resultVersion: number;
  createdAt: Date;
}

export function gradeObjectiveV1(
  attempt: Attempt,
  questions: readonly QuizQuestion[],
  request: AttemptSubmitRequest,
) {
  const byId = new Map(request.answers.map((answer) => [answer.questionId, answer]));
  for (const id of byId.keys())
    if (!questions.some((q) => q.questionId === id)) throw new Error("UNKNOWN_QUESTION");
  let score = 0n,
    max = 0n;
  const items: ResultItem[] = questions.map((q) => {
    const answer = byId.get(q.questionId),
      points = decimalHundredths(q.points);
    max += points;
    let correct = false;
    if (answer) {
      if (q.questionType === "SINGLE_CHOICE" && "selectedOptionId" in answer) {
        if (!q.options?.includes(answer.selectedOptionId)) throw new Error("UNKNOWN_OPTION");
        correct = answer.selectedOptionId === q.correctAnswer;
      } else if (q.questionType === "MULTIPLE_CHOICE" && "selectedOptionIds" in answer) {
        if (answer.selectedOptionIds.some((id) => !q.options?.includes(id)))
          throw new Error("UNKNOWN_OPTION");
        correct =
          JSON.stringify([...answer.selectedOptionIds].sort()) ===
          JSON.stringify([...(q.correctAnswer as string[])].sort());
      } else if (q.questionType === "TRUE_FALSE" && "value" in answer)
        correct = answer.value === q.correctAnswer;
      else if (q.questionType === "SHORT_ANSWER" && "text" in answer)
        correct =
          normalizeShortAnswerV1(answer.text) !== "" &&
          normalizeShortAnswerV1(answer.text) === normalizeShortAnswerV1(q.correctAnswer as string);
      else throw new Error("ANSWER_TYPE_MISMATCH");
    }
    if (correct) score += points;
    return {
      questionId: q.questionId,
      questionOrder: q.questionOrder,
      questionType: q.questionType,
      ...(answer ? { submittedAnswer: answer } : {}),
      awardedPoints: hundredthsDecimal(correct ? points : 0n),
      gradingOutcome: answer ? (correct ? "CORRECT" : "INCORRECT") : "UNANSWERED",
    };
  });
  return { items, score: hundredthsDecimal(score), maxScore: hundredthsDecimal(max) };
}
const decimalHundredths = (v: string) => {
  const [w, f = ""] = v.split(".");
  return BigInt(w ?? "0") * 100n + BigInt((f + "00").slice(0, 2));
};
const hundredthsDecimal = (v: bigint) => {
  const w = v / 100n,
    f = String(v % 100n).padStart(2, "0");
  return f === "00" ? String(w) : `${String(w)}.${f.replace(/0$/u, "")}`;
};
export interface AttemptGuard {
  studentId: string;
  quizId: string;
  activeAttemptId?: string;
  activeAttemptNo?: number;
  attemptsStarted: number;
  holderOperationId?: string;
  guardVersion: number;
}
export type AttemptDto = ReturnType<typeof attemptDto>;

export interface QuizQuestionDto {
  questionId: string;
  questionOrder: number;
  prompt: string;
  questionType: QuestionInput["questionType"];
  options?: string[];
  correctAnswer: QuestionInput["correctAnswer"];
  points: string;
}
export type QuizDto = ReturnType<typeof quizDto>;
export type QuizDetailDto = ReturnType<typeof quizDetailDto>;

export const parseQuizCreate = (value: unknown) => createSchema.parse(value);
export const parseQuizPatch = (value: unknown) => patchSchema.parse(value);

export function validateSchedule(value: { opensAt?: string | null; closesAt?: string | null }): void {
  if (value.opensAt && value.closesAt && Date.parse(value.closesAt) <= Date.parse(value.opensAt))
    throw new Error("QUIZ_WINDOW_INVALID");
}

function scheduleWindow(
  value: { opensAt?: string | undefined; closesAt?: string | undefined },
  context: z.RefinementCtx,
) {
  if (value.opensAt && value.closesAt && Date.parse(value.closesAt) <= Date.parse(value.opensAt))
    context.addIssue({ code: "custom", path: ["closesAt"], message: "closesAt must be after opensAt" });
}

export function validateIdempotencyKey(value: string | undefined): string {
  if (!value || value.length > 200 || !/^[\x21-\x7e]+$/u.test(value)) throw new Error("INVALID_KEY");
  return value;
}

export function fingerprint(secret: string, value: object): string {
  return createHmac("sha256", secret).update(JSON.stringify(value), "utf8").digest("hex");
}

export function keyHash(secret: string, value: string): number {
  const byte = createHmac("sha256", secret).update(value).digest()[0] ?? 0;
  return byte > 127 ? byte - 256 : byte;
}

export function deterministicUuid(secret: string, namespace: string, value: string): string {
  const bytes = Buffer.from(
    createHmac("sha256", secret).update(`${namespace}:${value}`).digest().subarray(0, 16),
  );
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function materializeQuestions(
  secret: string,
  operationId: string,
  quizId: string,
  version: number,
  questions: readonly QuestionInput[],
): QuizQuestion[] {
  return questions.map((value, index) => {
    const normalized = {
      prompt: value.prompt,
      questionType: value.questionType,
      ...(value.questionType === "SINGLE_CHOICE" || value.questionType === "MULTIPLE_CHOICE"
        ? { options: value.options }
        : {}),
      correctAnswer: value.correctAnswer,
      points: value.points,
    };
    return {
      quizId,
      quizVersion: version,
      questionOrder: index + 1,
      questionId: deterministicUuid(
        secret,
        "quiz-question",
        `${operationId}:${String(version)}:${String(index + 1)}`,
      ),
      ...normalized,
      checksum: questionContentChecksum(normalized),
    };
  });
}

export function copyQuestions(questions: readonly QuizQuestion[], version: number): QuizQuestion[] {
  return questions.map((question) => ({ ...question, quizVersion: version }));
}

export function snapshotChecksum(questions: readonly QuizQuestion[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        questions.map((question) => ({
          order: question.questionOrder,
          id: question.questionId,
          checksum: question.checksum,
        })),
      ),
    )
    .digest("hex");
}

export function questionContentChecksum(value: {
  prompt: string;
  questionType: QuestionInput["questionType"];
  options?: readonly string[];
  correctAnswer: QuestionInput["correctAnswer"];
  points: string;
}): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function quizDto(quiz: Quiz) {
  return {
    quizId: quiz.quizId,
    targetType: quiz.targetType,
    targetId: quiz.targetId,
    ownerId: quiz.ownerId,
    title: quiz.title,
    state: quiz.state,
    currentVersion: quiz.currentVersion,
    recordVersion: quiz.recordVersion,
    questionCount: quiz.questionCount,
    ...(quiz.opensAt ? { opensAt: quiz.opensAt.toISOString() } : {}),
    ...(quiz.closesAt ? { closesAt: quiz.closesAt.toISOString() } : {}),
    ...(quiz.durationSeconds !== undefined ? { durationSeconds: quiz.durationSeconds } : {}),
    ...(quiz.attemptLimit !== undefined ? { attemptLimit: quiz.attemptLimit } : {}),
    createdAt: quiz.createdAt.toISOString(),
    updatedAt: quiz.updatedAt.toISOString(),
  };
}

export function quizFromDto(dto: QuizDto): Quiz {
  const { createdAt, updatedAt, opensAt, closesAt, ...quiz } = dto;
  return {
    ...quiz,
    snapshotChecksum: "",
    snapshotReady: true,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    ...(opensAt ? { opensAt: new Date(opensAt) } : {}),
    ...(closesAt ? { closesAt: new Date(closesAt) } : {}),
  };
}

export function questionDto(question: QuizQuestion, includeAnswer: true): QuizQuestionDto;
export function questionDto(
  question: QuizQuestion,
  includeAnswer: false,
): Omit<QuizQuestionDto, "correctAnswer">;
export function questionDto(
  question: QuizQuestion,
  includeAnswer: boolean,
): QuizQuestionDto | Omit<QuizQuestionDto, "correctAnswer">;
export function questionDto(question: QuizQuestion, includeAnswer: boolean) {
  return {
    questionId: question.questionId,
    questionOrder: question.questionOrder,
    prompt: question.prompt,
    questionType: question.questionType,
    ...(question.options ? { options: question.options } : {}),
    ...(includeAnswer ? { correctAnswer: question.correctAnswer } : {}),
    points: question.points,
  };
}

export function questionFromDto(dto: QuizQuestionDto, quizId: string, quizVersion: number): QuizQuestion {
  const normalized = {
    prompt: dto.prompt,
    questionType: dto.questionType,
    ...(dto.options ? { options: dto.options } : {}),
    correctAnswer: dto.correctAnswer,
    points: dto.points,
  };
  return {
    quizId,
    quizVersion,
    questionOrder: dto.questionOrder,
    questionId: dto.questionId,
    ...normalized,
    checksum: questionContentChecksum(normalized),
  };
}

export function quizDetailDto(quiz: Quiz, questions: readonly QuizQuestion[], includeAnswers: boolean) {
  return { ...quizDto(quiz), questions: questions.map((question) => questionDto(question, includeAnswers)) };
}

export function listDto(quiz: Quiz) {
  const { ownerId, questionCount, ...safe } = quizDto(quiz);
  void ownerId;
  return { ...safe, questionCount };
}

export function attemptDto(attempt: Attempt) {
  return {
    attemptId: attempt.attemptId,
    quizId: attempt.quizId,
    quizVersion: attempt.quizVersion,
    attemptNo: attempt.attemptNo,
    state: attempt.state,
    ...(attempt.startedAt ? { startedAt: attempt.startedAt.toISOString() } : {}),
    ...(attempt.deadlineAt ? { deadlineAt: attempt.deadlineAt.toISOString() } : {}),
    ...(attempt.submittedAt ? { submittedAt: attempt.submittedAt.toISOString() } : {}),
    version: attempt.version,
  };
}

export function projectionSortAt(quiz: Pick<Quiz, "opensAt" | "createdAt">): Date {
  return quiz.opensAt ?? quiz.createdAt;
}

function decimal(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/u, "");
  return trimmed ? `${String(BigInt(whole))}.${trimmed}` : String(BigInt(whole));
}
