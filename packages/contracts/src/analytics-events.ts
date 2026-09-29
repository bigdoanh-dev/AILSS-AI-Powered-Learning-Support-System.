import { z } from "zod";

export const PRODUCT_EVENT_FAMILIES = [
  "ACQUISITION",
  "CATALOG",
  "CONVERSION",
  "LEARNING",
  "ASSISTANT",
  "RETENTION",
] as const;

export type ProductEventFamily = (typeof PRODUCT_EVENT_FAMILIES)[number];

export const PRODUCT_EVENT_NAMES = [
  // Acquisition
  "signup_started",
  "signup_completed",
  "social_login_completed",
  // Catalog
  "course_viewed",
  "course_searched",
  "course_compared",
  // Conversion
  "checkout_started",
  "checkout_completed",
  "payment_failed",
  // Learning
  "course_started",
  "lesson_started",
  "lesson_completed",
  "assessment_started",
  "assessment_completed",
  // Assistant
  "assistant_session_started",
  "assistant_tool_invoked",
  "assistant_safety_blocked",
  "assistant_citation_opened",
  // Retention
  "learner_returned",
  "course_resumed",
  // Phase 39 Product Expansion
  "STUDY_PLAN_CREATED",
  "STUDY_PLAN_ACTION_COMPLETED",
  "MASTERY_UPDATED",
  "RECOMMENDATION_SHOWN",
  "RECOMMENDATION_ACCEPTED",
  "AI_TUTOR_SESSION",
  "AI_TUTOR_TOOL_CALL",
  "COPILOT_DRAFT_CREATED",
  "COPILOT_DRAFT_APPROVED",
  "INTERVENTION_CREATED",
  "INTERVENTION_RESOLVED",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export const productAnalyticsEventSchema = z.object({
  eventId: z.string().uuid(),
  eventName: z.enum(PRODUCT_EVENT_NAMES),
  eventFamily: z.enum(PRODUCT_EVENT_FAMILIES),
  version: z.number().int().min(1).default(1),
  occurredAt: z.string().datetime(),
  actorId: z.string().uuid(),
  actorRole: z.enum(["STUDENT", "LECTURER", "ADMIN", "PUBLIC"]),
  sessionId: z.string().min(1).max(256).optional(),
  courseId: z.string().uuid().optional(),
  correlationId: z.string().min(1).max(256).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type ProductAnalyticsEvent = z.infer<typeof productAnalyticsEventSchema>;

const SENSITIVE_KEY_PATTERNS = [
  /password/iu,
  /secret/iu,
  /token/iu,
  /authorization/iu,
  /cookie/iu,
  /card/iu,
  /cvv/iu,
  /pan/iu,
];

const SENSITIVE_VALUE_PATTERNS = [
  /password\s*[:=]\s*\S+/iu,
  /bearer\s+[a-zA-Z0-9_.-]+/iu,
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/u, // JWT pattern
  /\b(?:\d[ -]*?){13,19}\b/u, // Card PAN pattern
  /secret\s*[:=]\s*\S+/iu,
];

export const FAMILY_METADATA_ALLOWLIST: Record<ProductEventFamily, ReadonlySet<string>> = {
  ACQUISITION: new Set(["channel", "referrer", "provider", "campaignId", "deviceType"]),
  CATALOG: new Set([
    "query",
    "searchTerm",
    "category",
    "price",
    "currency",
    "tags",
    "courseTitle",
    "comparisonCourseIds",
    "source",
  ]),
  CONVERSION: new Set([
    "orderId",
    "amount",
    "currency",
    "offeringId",
    "paymentMethod",
    "refundReason",
    "discountCode",
  ]),
  LEARNING: new Set([
    "lessonId",
    "lessonTitle",
    "moduleId",
    "score",
    "durationSeconds",
    "progressPercent",
    "attemptId",
    "assessmentType",
    "bloomLevel",
  ]),
  ASSISTANT: new Set([
    "mode",
    "toolName",
    "topic",
    "citationCount",
    "reasonCode",
    "executionDurationMs",
    "safetyBlocked",
    "warning",
  ]),
  RETENTION: new Set(["streakDays", "dormancyDays", "lastActiveDate", "completedCoursesCount"]),
};

function sanitizeStringValue(str: string): string {
  let cleaned = str;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, "[REDACTED_SECRET]");
    }
  }
  return cleaned;
}

/**
 * Strips sensitive keys and fields to ensure privacy and data minimization.
 * Supports optional schema allowlisting by event family and inspects string values
 * for embedded secret patterns (JWT, Bearer, PAN, password=).
 */
export function sanitizeAnalyticsPayload(
  payload: Record<string, unknown>,
  eventFamily?: ProductEventFamily,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const allowlist = eventFamily ? FAMILY_METADATA_ALLOWLIST[eventFamily] : undefined;

  for (const [key, value] of Object.entries(payload)) {
    // 1. If an allowlist exists for this family, skip non-whitelisted keys
    if (allowlist && !allowlist.has(key)) {
      continue;
    }

    // 2. Deny sensitive key names
    const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitiveKey) {
      continue;
    }

    // 3. Sanitize values
    if (typeof value === "string") {
      sanitized[key] = sanitizeStringValue(value);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeAnalyticsPayload(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      sanitized[key] = (value as readonly unknown[]).map((item: unknown): unknown =>
        typeof item === "string" ? sanitizeStringValue(item) : item,
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
