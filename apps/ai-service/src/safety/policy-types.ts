import type { AssistantMode, AssistantRole } from "../assistant/model.js";

export type PolicyDecision =
  "ALLOW" | "ALLOW_WITH_WARNING" | "REQUIRE_CLARIFICATION" | "RESTRICT_TOOL_ACCESS" | "REFUSE" | "ESCALATE";

export interface SafetyContext {
  readonly userId: string;
  readonly role: AssistantRole;
  readonly mode: AssistantMode;
  readonly message: string;
  readonly courseId?: string;
  readonly conversationId?: string;
  readonly hasActiveAssessment: boolean;
  readonly activeAssessmentTitle?: string;
  readonly conversationHistory?: readonly string[] | undefined;
}

export interface SafetyPolicyResult {
  readonly allowed: boolean;
  readonly policyId: string;
  readonly decision: PolicyDecision;
  readonly reasonCode: string;
  readonly userSafeExplanation?: string;
  readonly internalAuditMetadata?: Record<string, unknown>;
  readonly affectedTools?: readonly string[];
  readonly warning?: string;
  readonly timestamp: Date;
}

export interface SafetyAuditRecord {
  readonly auditId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly role: AssistantRole;
  readonly mode: AssistantMode;
  readonly policyId: string;
  readonly decision: PolicyDecision;
  readonly reasonCode: string;
  readonly userSafeExplanation?: string;
  readonly affectedTools?: readonly string[];
  readonly metadata?: Record<string, unknown>;
  readonly evaluatedAt: Date;
}
