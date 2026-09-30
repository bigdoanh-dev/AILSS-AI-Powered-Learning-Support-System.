import type { SafetyContext, SafetyPolicyResult } from "./policy-types.js";

// Direct solution pattern indicates an attempt to extract an answer for an ongoing test/quiz
const DIRECT_SOLUTION_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:đáp\s*án|câu\s*hỏi|trắc\s*nghiệm|bài\s*thi|quiz|test|answer|chọn\s*câu|đúng\s*hay\s*sai)/iu,
  /(?:giải|làm)\s+(?:giúp|hộ)\s+(?:tôi\s+)?(?:bài\s*thi|bài\s*kiểm\s*tra|quiz|exam|câu\s*\d+)/iu,
  /(?:what\s+is\s+the\s+answer\s+to\s+question|solve\s+question\s+\d+|answer\s+for\s+quiz)/iu,
];

// Conceptual patterns allowed even during active assessment
const CONCEPTUAL_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:giải\s*thích\s*(?:khái\s*niệm|nguyên\s*lý|thuật\s*toán|cơ\s*chế)|định\s*nghĩa\s*về|là\s*gì)/iu,
  /(?:what\s+is|explain\s+concept|how\s+does\s+.*work|definition\s+of)/iu,
];

export function evaluateAssessmentIntegrity(context: SafetyContext, now: Date): SafetyPolicyResult | null {
  // Assessment integrity applies to STUDENT role in STUDY_BUDDY
  if (context.role !== "STUDENT" || context.mode !== "STUDY_BUDDY") {
    return null;
  }

  // If student does not have an active assessment in progress, allow
  if (!context.hasActiveAssessment) {
    return null;
  }

  const message = context.message;

  // Check if conceptual learning without seeking specific quiz answers
  const isConceptual = CONCEPTUAL_PATTERNS.some((pattern) => pattern.test(message));
  const isDirectSolution = DIRECT_SOLUTION_PATTERNS.some((pattern) => pattern.test(message));

  if (isDirectSolution && !isConceptual) {
    return {
      allowed: false,
      policyId: "ASSESSMENT_INTEGRITY_POLICY",
      decision: "REFUSE",
      reasonCode: "ACTIVE_ASSESSMENT_DIRECT_SOLUTION_BLOCKED",
      userSafeExplanation:
        "Bạn đang có một bài kiểm tra đang diễn ra. Để đảm bảo tính trung thực học thuật của AILSS, trợ lý AI không thể giải đáp hoặc gợi ý đáp án bài thi trong thời gian này. Vui lòng hoàn thành bài nộp trước khi thảo luận thêm.",
      internalAuditMetadata: {
        assessmentTitle: context.activeAssessmentTitle,
        promptExcerpt: message.slice(0, 100),
      },
      affectedTools: ["search_course_materials", "get_knowledge_gaps"],
      timestamp: now,
    };
  }

  if (isConceptual) {
    return {
      allowed: true,
      policyId: "ASSESSMENT_INTEGRITY_POLICY",
      decision: "ALLOW_WITH_WARNING",
      reasonCode: "CONCEPTUAL_LEARNING_DURING_ASSESSMENT",
      warning:
        "Lưu ý: Bạn đang trong thời gian làm bài kiểm tra. Trợ lý chỉ giải thích khái niệm học tập và không cung cấp lời giải trực tiếp cho đề thi.",
      timestamp: now,
    };
  }

  return {
    allowed: true,
    policyId: "ASSESSMENT_INTEGRITY_POLICY",
    decision: "ALLOW_WITH_WARNING",
    reasonCode: "ACTIVE_ASSESSMENT_MONITORED",
    warning:
      "Hệ thống ghi nhận bạn đang có bài kiểm tra hoạt động. Hãy tập trung hoàn thành bài thi với năng lực bản thân.",
    timestamp: now,
  };
}
