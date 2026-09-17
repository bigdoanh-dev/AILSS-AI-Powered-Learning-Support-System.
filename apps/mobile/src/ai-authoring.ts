import { ApiError, record, string } from "./api";

export type AiJobState =
  "QUEUED" | "PROCESSING" | "VALIDATING" | "AI_DRAFT" | "FAILED" | "APPROVED" | "CANCELLED";

export const VALID_AI_JOB_STATES = new Set<AiJobState>([
  "QUEUED",
  "PROCESSING",
  "VALIDATING",
  "AI_DRAFT",
  "FAILED",
  "APPROVED",
  "CANCELLED",
]);

export const TERMINAL_AI_JOB_STATES = new Set<AiJobState>(["AI_DRAFT", "APPROVED", "FAILED", "CANCELLED"]);

export function isAiJobState(value: unknown): value is AiJobState {
  if (value === "COMPLETED") {
    // Explicit contract rule: COMPLETED is NOT valid for QUIZ_GENERATION
    return false;
  }
  return typeof value === "string" && VALID_AI_JOB_STATES.has(value as AiJobState);
}

export type CognitiveLevel = "RECOGNITION" | "UNDERSTANDING" | "APPLICATION" | "ADVANCED_APPLICATION";

export const COGNITIVE_LABELS: Record<CognitiveLevel, string> = {
  RECOGNITION: "Nhận biết",
  UNDERSTANDING: "Thông hiểu",
  APPLICATION: "Vận dụng",
  ADVANCED_APPLICATION: "Vận dụng cao",
};

export const COGNITIVE_HINTS: Record<CognitiveLevel, string> = {
  RECOGNITION: "Nhớ khái niệm, định nghĩa và dữ kiện cơ bản.",
  UNDERSTANDING: "Giải thích, so sánh và diễn giải kiến thức.",
  APPLICATION: "Áp dụng kiến thức vào tình huống cụ thể.",
  ADVANCED_APPLICATION: "Phân tích, giải quyết vấn đề nhiều bước.",
};

export interface ObjectiveOption {
  id: string;
  text: string;
}

export type ObjectiveCorrectAnswer =
  { optionId: string } | { optionIds: string[] } | { value: boolean } | { acceptedAnswer: string };

export interface ObjectiveQuestion {
  id: string;
  order: number;
  text: string;
  points: string;
  cognitiveLevel?: CognitiveLevel;
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
  options?: ObjectiveOption[];
  correctAnswer: ObjectiveCorrectAnswer;
}

export interface ObjectiveQuiz {
  schemaVersion: "objective-v1";
  title: string;
  questions: ObjectiveQuestion[];
}

export interface AiDraft {
  draftId: string;
  draftVersion: number;
  validationStatus: string;
  questionCount: number;
  state: string;
  checksum: string;
  content: ObjectiveQuiz;
  createdAt?: string;
}

export interface AiJob {
  jobId: string;
  jobKind: "QUIZ_GENERATION";
  state: AiJobState;
  version: number;
  targetType: "COURSE" | "CLASS";
  targetId: string;
  documentId: string;
  draftId?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiApprovalResult {
  jobId: string;
  draftId: string;
  state: "APPROVED";
  approvedDraftVersion: number;
  assessment: {
    quizId: string;
    quizVersion: number;
    status: "DRAFT";
  };
}

export interface AiUsage {
  limit: number;
  consumed: number;
  reserved: number;
  remaining: number;
  day?: string;
  resetsAt?: string;
}

export interface AiDocumentDto {
  documentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256?: string;
  status: "UPLOAD_PENDING" | "EXTRACTION_QUEUED" | "EXTRACTING" | "EXTRACTED" | "FAILED" | "QUARANTINED";
  version: number;
  failureCode?: string;
  createdAt?: string;
  updatedAt?: string;
}

export const AI_JOB_STATE_COPY: Record<AiJobState, string> = {
  QUEUED: "Đang xếp yêu cầu",
  PROCESSING: "AI đang tạo câu hỏi",
  VALIDATING: "Đang kiểm tra cấu trúc câu hỏi",
  AI_DRAFT: "Bản nháp đã sẵn sàng",
  FAILED: "Không thể tạo bản nháp",
  APPROVED: "Đã được phê duyệt",
  CANCELLED: "Đã hủy yêu cầu",
};

export const AI_JOB_FAILURE_COPY: Record<string, string> = {
  PROVIDER_OUTPUT_REJECTED: "Yêu cầu không hoàn thành. Hệ thống chưa lưu nguyên nhân chi tiết.",
  PROVIDER_UNAVAILABLE: "Dịch vụ AI tạm thời không sẵn sàng. Hệ thống đã thử tối đa 3 lần.",
  RATE_LIMITED: "Dịch vụ AI đang giới hạn số yêu cầu hoặc hạn mức. Vui lòng thử lại sau.",
  AMBIGUOUS_TIMEOUT: "Dịch vụ AI phản hồi quá lâu. Bạn hãy thử lại với số câu hỏi ít hơn.",
  PROVIDER_NOT_FOUND: "Không tìm thấy tài nguyên AI đã cấu hình.",
  PROVIDER_ACCESS_DENIED: "Dịch vụ AI từ chối quyền truy cập.",
  INVALID_RESPONSE: "Dữ liệu AI trả về không đúng định dạng.",
  OBJECTIVE_V1_INVALID: "Nội dung AI chưa đáp ứng cấu trúc bài kiểm tra objective-v1.",
};

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

export function aiJob(value: unknown): AiJob {
  const obj = record(unwrap(value));
  const rawState = string(obj.state);
  if (!isAiJobState(rawState)) {
    throw new ApiError("invalid");
  }

  const rawTargetType = string(obj.targetType);
  if (rawTargetType !== "COURSE" && rawTargetType !== "CLASS") {
    throw new ApiError("invalid");
  }

  return {
    jobId: string(obj.jobId),
    jobKind: "QUIZ_GENERATION",
    state: rawState,
    version: typeof obj.version === "number" ? obj.version : Number(obj.version) || 1,
    targetType: rawTargetType,
    targetId: string(obj.targetId),
    documentId: string(obj.documentId),
    draftId: typeof obj.draftId === "string" ? obj.draftId : undefined,
    failureCode: typeof obj.failureCode === "string" ? obj.failureCode : undefined,
    createdAt: string(obj.createdAt),
    updatedAt: string(obj.updatedAt),
  };
}

export function aiJobs(value: unknown): AiJob[] {
  const unwrapped = unwrap(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.map(aiJob);
  }
  if (unwrapped && typeof unwrapped === "object") {
    if ("items" in unwrapped && Array.isArray((unwrapped as { items: unknown }).items)) {
      return (unwrapped as { items: unknown[] }).items.map(aiJob);
    }
    if ("jobs" in unwrapped && Array.isArray((unwrapped as { jobs: unknown }).jobs)) {
      return (unwrapped as { jobs: unknown[] }).jobs.map(aiJob);
    }
  }
  throw new ApiError("invalid");
}

export function objectiveQuestion(value: unknown): ObjectiveQuestion {
  const obj = record(value);
  const qType = string(obj.type);
  if (!["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"].includes(qType)) {
    throw new ApiError("invalid");
  }

  let options: ObjectiveOption[] | undefined;
  if (Array.isArray(obj.options)) {
    options = obj.options.map((o) => {
      const opt = record(o);
      return {
        id: string(opt.id),
        text: string(opt.text),
      };
    });
  }

  const ans = record(obj.correctAnswer);
  let correctAnswer: ObjectiveCorrectAnswer;
  if ("optionId" in ans && typeof ans.optionId === "string") {
    correctAnswer = { optionId: ans.optionId };
  } else if ("optionIds" in ans && Array.isArray(ans.optionIds)) {
    correctAnswer = { optionIds: ans.optionIds.map((x) => string(x)) };
  } else if ("value" in ans && typeof ans.value === "boolean") {
    correctAnswer = { value: ans.value };
  } else if ("acceptedAnswer" in ans && typeof ans.acceptedAnswer === "string") {
    correctAnswer = { acceptedAnswer: ans.acceptedAnswer };
  } else {
    correctAnswer = { acceptedAnswer: String(ans.text || "") };
  }

  return {
    id: string(obj.id),
    order: typeof obj.order === "number" ? obj.order : Number(obj.order) || 1,
    text: string(obj.text),
    points: typeof obj.points === "string" ? obj.points : String(obj.points ?? "1"),
    cognitiveLevel:
      typeof obj.cognitiveLevel === "string" ? (obj.cognitiveLevel as CognitiveLevel) : undefined,
    type: qType as ObjectiveQuestion["type"],
    options,
    correctAnswer,
  };
}

export function objectiveQuiz(value: unknown): ObjectiveQuiz {
  const obj = record(value);
  const schemaVersion = string(obj.schemaVersion);
  if (schemaVersion !== "objective-v1") {
    throw new ApiError("invalid");
  }
  const title = string(obj.title);
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : [];
  const questions = rawQuestions.map(objectiveQuestion);

  return {
    schemaVersion: "objective-v1",
    title,
    questions,
  };
}

export function aiDraft(value: unknown): AiDraft {
  const obj = record(unwrap(value));
  return {
    draftId: string(obj.draftId),
    draftVersion: typeof obj.draftVersion === "number" ? obj.draftVersion : Number(obj.draftVersion) || 1,
    validationStatus: string(obj.validationStatus),
    questionCount: typeof obj.questionCount === "number" ? obj.questionCount : Number(obj.questionCount) || 0,
    state: string(obj.state),
    checksum: string(obj.checksum),
    content: objectiveQuiz(obj.content),
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : undefined,
  };
}

export function aiDrafts(value: unknown): AiDraft[] {
  const unwrapped = unwrap(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped.map(aiDraft);
  }
  if (
    unwrapped &&
    typeof unwrapped === "object" &&
    "items" in unwrapped &&
    Array.isArray((unwrapped as { items: unknown }).items)
  ) {
    return (unwrapped as { items: unknown[] }).items.map(aiDraft);
  }
  throw new ApiError("invalid");
}

export function aiApprovalResult(value: unknown): AiApprovalResult {
  const obj = record(unwrap(value));
  const rawState = string(obj.state);
  if (rawState !== "APPROVED") {
    throw new ApiError("invalid");
  }
  const asmt = record(obj.assessment);
  return {
    jobId: string(obj.jobId),
    draftId: string(obj.draftId),
    state: "APPROVED",
    approvedDraftVersion: typeof obj.approvedDraftVersion === "number" ? obj.approvedDraftVersion : 2,
    assessment: {
      quizId: string(asmt.quizId),
      quizVersion: typeof asmt.quizVersion === "number" ? asmt.quizVersion : 1,
      status: "DRAFT",
    },
  };
}

export function aiUsage(value: unknown): AiUsage {
  const obj = record(unwrap(value));
  return {
    limit: typeof obj.limit === "number" ? obj.limit : Number(obj.limit) || 0,
    consumed: typeof obj.consumed === "number" ? obj.consumed : Number(obj.consumed) || 0,
    reserved: typeof obj.reserved === "number" ? obj.reserved : Number(obj.reserved) || 0,
    remaining: typeof obj.remaining === "number" ? obj.remaining : Number(obj.remaining) || 0,
    day: typeof obj.day === "string" ? obj.day : undefined,
    resetsAt: typeof obj.resetsAt === "string" ? obj.resetsAt : undefined,
  };
}

export function aiDocumentDto(value: unknown): AiDocumentDto {
  const obj = record(unwrap(value));
  return {
    documentId: string(obj.documentId),
    fileName: string(obj.fileName),
    contentType: string(obj.contentType),
    sizeBytes: typeof obj.sizeBytes === "number" ? obj.sizeBytes : Number(obj.sizeBytes) || 0,
    sha256: typeof obj.sha256 === "string" ? obj.sha256 : undefined,
    status: string(obj.status) as AiDocumentDto["status"],
    version: typeof obj.version === "number" ? obj.version : 1,
    failureCode: typeof obj.failureCode === "string" ? obj.failureCode : undefined,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : undefined,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : undefined,
  };
}
