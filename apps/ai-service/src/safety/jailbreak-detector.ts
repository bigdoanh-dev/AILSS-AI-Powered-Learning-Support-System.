import type { SafetyContext, SafetyPolicyResult } from "./policy-types.js";

const INJECTION_PATTERNS: ReadonlyArray<{ readonly regex: RegExp; readonly reason: string }> = [
  {
    regex: /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts|directives|rules)/iu,
    reason: "PROMPT_INJECTION_OVERRIDE",
  },
  {
    regex: /(?:reveal|show|print|output|display|repeat)\s+(?:your\s+)?(?:system\s+prompt|developer\s+instructions|hidden\s+prompt|initial\s+prompt)/iu,
    reason: "SYSTEM_PROMPT_EXTRACTION",
  },
  {
    regex: /(?:service[_\s]*token|jwt[_\s]*secret|private[_\s]*key|database[_\s]*password|credentials|api[_-]?key|root[_\s]*secret)/iu,
    reason: "CREDENTIAL_EXFILTRATION_ATTEMPT",
  },
  {
    regex: /(?:act\s+as|pretend\s+(?:to\s+be)?|switch\s+to|enable)\s+(?:administrator|admin|system\s+admin|root|lecturer|super\s*user)/iu,
    reason: "ROLE_ESCALATION_ATTEMPT",
  },
  {
    regex: /(?:dan\s+mode|jailbreak|unfiltered\s+mode|developer\s+mode\s+output)/iu,
    reason: "JAILBREAK_PATTERN_DETECTED",
  },
];

export function evaluatePromptInjection(context: SafetyContext, now: Date): SafetyPolicyResult | null {
  const text = context.message;

  for (const { regex, reason } of INJECTION_PATTERNS) {
    if (regex.test(text)) {
      return {
        allowed: false,
        policyId: "PROMPT_INJECTION_DEFENSE",
        decision: "REFUSE",
        reasonCode: reason,
        userSafeExplanation:
          "Yêu cầu của bạn vi phạm chính sách an toàn của AILSS. Trợ lý AI không thể thực hiện các chỉ thị cố gắng thay đổi quy tắc hệ thống hoặc truy xuất thông tin bảo mật.",
        internalAuditMetadata: {
          matchedRule: reason,
          promptSample: text.slice(0, 100),
        },
        affectedTools: [],
        timestamp: now,
      };
    }
  }

  return null;
}
