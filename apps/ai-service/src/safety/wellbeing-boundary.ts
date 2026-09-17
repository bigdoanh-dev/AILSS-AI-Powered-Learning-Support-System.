import type { SafetyContext, SafetyPolicyResult } from "./policy-types.js";

const WORKLOAD_FATIGUE_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:quá\s*tải|áp\s*lực|mệt\s*mỏi|stress|kiệt\s*sức|không\s*kịp\s*tiến\s*độ|ngợp\s*kiến\s*thức)/iu,
  /(?:overwhelmed|burnout|too\s+much\s+homework|exhausted|study\s+fatigue)/iu,
  /(?:lên\s*lịch\s*học|phân\s*bổ\s*thời\s*gian|nghỉ\s*ngơi|pomodoro|study\s*schedule)/iu,
];

export function evaluateLearnerWellbeing(context: SafetyContext, now: Date): SafetyPolicyResult | null {
  const message = context.message;
  const matchesWellbeing = WORKLOAD_FATIGUE_PATTERNS.some((p) => p.test(message));

  if (!matchesWellbeing) {
    return null;
  }

  return {
    allowed: true,
    policyId: "LEARNER_WELLBEING_POLICY",
    decision: "ALLOW_WITH_WARNING",
    reasonCode: "ACADEMIC_WORKLOAD_SUPPORT",
    warning:
      "AILSS Hỗ Trợ Học Tập: Gợi ý phân bổ thời gian học tập và nghỉ ngơi mang tính tham khảo quản lý tiến độ, hoàn toàn không thay thế cho chẩn đoán hay tư vấn y tế/tâm lý chuyên nghiệp.",
    internalAuditMetadata: {
      category: "ACADEMIC_PACING_SIGNAL",
    },
    timestamp: now,
  };
}
