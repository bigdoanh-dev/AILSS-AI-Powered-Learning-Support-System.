import { ApiError, record, string } from "./api";

export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
export type QuizState = "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
export type TargetType = "COURSE" | "CLASS";

export interface AuthoringQuestion {
  questionId?: string;
  questionOrder?: number;
  prompt: string;
  questionType: QuestionType;
  options?: string[];
  correctAnswer: string | string[] | boolean;
  points: string;
}

export interface AuthoringQuiz {
  quizId: string;
  title: string;
  state: QuizState;
  targetType: TargetType;
  targetId: string;
  questionCount: number;
  currentVersion: number;
  recordVersion?: number;
  durationSeconds?: number;
  attemptLimit?: number;
  opensAt?: string;
  closesAt?: string;
  createdAt?: string;
  updatedAt?: string;
  questions: AuthoringQuestion[];
}

export interface AuthoringQuizSummary {
  quizId: string;
  title: string;
  state: QuizState;
  targetType: TargetType;
  targetId: string;
  questionCount: number;
  currentVersion: number;
  recordVersion?: number;
  durationSeconds?: number;
  attemptLimit?: number;
  opensAt?: string;
  closesAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface QuizResultItem {
  attemptId: string;
  studentId: string;
  score: string;
  maxScore: string;
  submittedAt: string;
}

export interface QuizResultPage {
  items: QuizResultItem[];
  nextCursor?: string;
}

export const CONTRACT_LIMITED = {
  quizDelete: "API không hỗ trợ xóa bài kiểm tra. Vui lòng liên hệ Quản trị viên.",
  manualGrading: "Hệ thống hỗ trợ chấm tự động và chấm thủ công kết hợp (bài tự luận / đồ án).",
  questionReorder: "Sắp xếp lại câu hỏi được thực hiện qua cập nhật danh sách trong bản nháp.",
} as const;

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

export function isQuizState(value: unknown): value is QuizState {
  return typeof value === "string" && ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"].includes(value);
}

export function isQuestionType(value: unknown): value is QuestionType {
  return (
    typeof value === "string" &&
    ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"].includes(value)
  );
}

export function blankQuestion(type: QuestionType = "SINGLE_CHOICE"): AuthoringQuestion {
  if (type === "SINGLE_CHOICE") {
    return { prompt: "", questionType: type, points: "1", options: ["", ""], correctAnswer: "" };
  }
  if (type === "MULTIPLE_CHOICE") {
    return { prompt: "", questionType: type, points: "1", options: ["", ""], correctAnswer: [] };
  }
  if (type === "TRUE_FALSE") {
    return { prompt: "", questionType: type, points: "1", correctAnswer: true };
  }
  return { prompt: "", questionType: type, points: "1", correctAnswer: "" };
}

export function cleanQuestion(q: AuthoringQuestion): Record<string, unknown> {
  return {
    prompt: q.prompt,
    questionType: q.questionType,
    points: q.points,
    ...(q.options ? { options: q.options } : {}),
    correctAnswer: q.correctAnswer,
  };
}

export function validateAuthoringQuestions(questions: AuthoringQuestion[]): string[] {
  return questions.flatMap((q, i) => {
    const p = `Câu ${i + 1}: `;
    const errors: string[] = [];

    if (!q.prompt.trim()) {
      errors.push(p + "chưa có nội dung câu hỏi.");
    }
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(q.points) || Number(q.points) <= 0 || Number(q.points) > 100) {
      errors.push(p + "điểm phải lớn hơn 0 và không quá 100.");
    }

    if (q.questionType === "SINGLE_CHOICE" || q.questionType === "MULTIPLE_CHOICE") {
      if (!q.options || q.options.length < 2 || q.options.length > 10) {
        errors.push(p + "cần từ 2 đến 10 lựa chọn.");
      } else {
        if (q.options.some((o) => !o.trim())) {
          errors.push(p + "lựa chọn không được để trống.");
        }
        if (new Set(q.options).size !== q.options.length) {
          errors.push(p + "các lựa chọn phải khác nhau.");
        }
      }

      if (q.questionType === "SINGLE_CHOICE") {
        if (!q.correctAnswer || !q.options?.includes(String(q.correctAnswer))) {
          errors.push(p + "chưa chọn đáp án đúng hợp lệ.");
        }
      }

      if (q.questionType === "MULTIPLE_CHOICE") {
        if (!Array.isArray(q.correctAnswer) || q.correctAnswer.length === 0) {
          errors.push(p + "chưa chọn ít nhất một đáp án đúng.");
        } else if (!q.correctAnswer.every((ans) => q.options?.includes(ans))) {
          errors.push(p + "đáp án đúng phải nằm trong danh sách lựa chọn.");
        }
      }
    }

    if (q.questionType === "TRUE_FALSE") {
      if (typeof q.correctAnswer !== "boolean") {
        errors.push(p + "đáp án Đúng/Sai phải là giá trị logic (true/false).");
      }
    }

    if (q.questionType === "SHORT_ANSWER") {
      if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) {
        errors.push(p + "chưa có đáp án mẫu được chấp nhận.");
      }
    }

    return errors;
  });
}

export function authoringQuestion(value: unknown): AuthoringQuestion {
  const obj = record(value);
  const prompt = string(obj.prompt);
  const qTypeStr = string(obj.questionType);
  if (!isQuestionType(qTypeStr)) {
    throw new ApiError("invalid");
  }

  let points = "1";
  if (typeof obj.points === "string") {
    points = obj.points;
  } else if (typeof obj.points === "number") {
    points = String(obj.points);
  }

  let options: string[] | undefined;
  if (Array.isArray(obj.options)) {
    options = obj.options.map((o) => string(o));
  }

  let correctAnswer: string | string[] | boolean = "";
  if (qTypeStr === "TRUE_FALSE") {
    correctAnswer = typeof obj.correctAnswer === "boolean" ? obj.correctAnswer : Boolean(obj.correctAnswer);
  } else if (qTypeStr === "MULTIPLE_CHOICE") {
    correctAnswer = Array.isArray(obj.correctAnswer) ? obj.correctAnswer.map((a) => string(a)) : [];
  } else {
    correctAnswer = typeof obj.correctAnswer === "string" ? obj.correctAnswer : "";
  }

  return {
    questionId: typeof obj.questionId === "string" ? obj.questionId : undefined,
    questionOrder: typeof obj.questionOrder === "number" ? obj.questionOrder : undefined,
    prompt,
    questionType: qTypeStr,
    options,
    correctAnswer,
    points,
  };
}

export function authoringQuizSummary(value: unknown): AuthoringQuizSummary {
  const obj = record(unwrap(value));
  const quizId = string(obj.quizId);
  const title = string(obj.title);
  const stateStr = string(obj.state);
  if (!isQuizState(stateStr)) {
    throw new ApiError("invalid");
  }

  const targetTypeStr = string(obj.targetType);
  if (targetTypeStr !== "COURSE" && targetTypeStr !== "CLASS") {
    throw new ApiError("invalid");
  }

  const targetId = string(obj.targetId);
  const questionCount =
    typeof obj.questionCount === "number" ? obj.questionCount : Number(obj.questionCount) || 0;
  const currentVersion =
    typeof obj.currentVersion === "number" ? obj.currentVersion : Number(obj.currentVersion) || 1;

  return {
    quizId,
    title,
    state: stateStr,
    targetType: targetTypeStr,
    targetId,
    questionCount,
    currentVersion,
    recordVersion: typeof obj.recordVersion === "number" ? obj.recordVersion : undefined,
    durationSeconds: typeof obj.durationSeconds === "number" ? obj.durationSeconds : undefined,
    attemptLimit: typeof obj.attemptLimit === "number" ? obj.attemptLimit : undefined,
    opensAt: typeof obj.opensAt === "string" ? obj.opensAt : undefined,
    closesAt: typeof obj.closesAt === "string" ? obj.closesAt : undefined,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : undefined,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
  };
}

export function authoringQuizSummaries(value: unknown): AuthoringQuizSummary[] {
  const unwrapped = unwrap(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.map(authoringQuizSummary);
  }
  if (unwrapped && typeof unwrapped === "object") {
    if ("quizzes" in unwrapped && Array.isArray((unwrapped as { quizzes: unknown }).quizzes)) {
      return (unwrapped as { quizzes: unknown[] }).quizzes.map(authoringQuizSummary);
    }
    if ("items" in unwrapped && Array.isArray((unwrapped as { items: unknown }).items)) {
      return (unwrapped as { items: unknown[] }).items.map(authoringQuizSummary);
    }
  }
  throw new ApiError("invalid");
}

export function authoringQuiz(value: unknown): AuthoringQuiz {
  const summary = authoringQuizSummary(value);
  const obj = record(unwrap(value));

  let questions: AuthoringQuestion[] = [];
  if (Array.isArray(obj.questions)) {
    questions = obj.questions.map(authoringQuestion);
  }

  return {
    ...summary,
    questions,
  };
}

export function quizResultItem(value: unknown): QuizResultItem {
  const obj = record(value);
  return {
    attemptId: string(obj.attemptId),
    studentId: string(obj.studentId),
    score: typeof obj.score === "string" ? obj.score : String(obj.score ?? "0"),
    maxScore: typeof obj.maxScore === "string" ? obj.maxScore : String(obj.maxScore ?? "100"),
    submittedAt: string(obj.submittedAt),
  };
}

export function quizResultPage(value: unknown): QuizResultPage {
  const obj = record(unwrap(value));
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const items = rawItems.map(quizResultItem);
  const nextCursor = typeof obj.nextCursor === "string" && obj.nextCursor.trim() ? obj.nextCursor : undefined;

  return {
    items,
    nextCursor,
  };
}
