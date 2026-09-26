export type ServiceId =
  | "api-gateway"
  | "identity-service"
  | "learning-service"
  | "classroom-service"
  | "assessment-service"
  | "interaction-service"
  | "ai-service"
  | "ai-worker"
  | "document-worker"
  | "notification-worker"
  | "audit-worker"
  | "reconciliation-worker"
  | "media-worker"
  | "media-delivery";

export type BusinessServiceId = Exclude<
  ServiceId,
  | "api-gateway"
  | "ai-worker"
  | "document-worker"
  | "notification-worker"
  | "audit-worker"
  | "reconciliation-worker"
  | "media-worker"
  | "media-delivery"
>;

export interface DependencyState {
  readonly name: string;
  readonly ready: boolean;
  readonly detail?: string;
}

export interface ReadinessSnapshot {
  readonly service: ServiceId;
  readonly ready: boolean;
  readonly dependencies: readonly DependencyState[];
  readonly checkedAt: string;
}

export const AI_JOB_STATES = [
  "QUEUED",
  "PROCESSING",
  "VALIDATING",
  "AI_DRAFT",
  "FAILED",
  "APPROVED",
  "CANCELLED",
] as const;
export type AiJobState = (typeof AI_JOB_STATES)[number];

export const ORDER_STATES = ["PENDING", "PAYMENT_FAILED", "PAID_PENDING_ENTITLEMENT", "ENTITLED"] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const ATTEMPT_STATES = ["CREATED", "IN_PROGRESS", "SUBMITTED", "EXPIRED"] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export const OUTBOX_STATES = [
  "PREPARED",
  "READY",
  "PUBLISHING",
  "PUBLISHED",
  "TERMINAL_FAILED",
  "CANCELLED",
] as const;
export type OutboxState = (typeof OUTBOX_STATES)[number];

/** ERRATA-P7-012A-01: the only canonical course lifecycle vocabulary. */
export const COURSE_STATES = ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"] as const;
export type CourseState = (typeof COURSE_STATES)[number];

/**
 * ERRATA-P7-012A-02 submit-review predicate. P7.13 may add lesson-type content
 * validation, but must not redefine these stored authoring readiness values.
 */
export const LESSON_AUTHORING_STATES = ["DRAFT", "INCOMPLETE", "READY"] as const;
export type LessonAuthoringState = (typeof LESSON_AUTHORING_STATES)[number];

export function isCourseContentReadyForReview(
  lessons: readonly { readonly state: LessonAuthoringState }[],
): boolean {
  return lessons.length > 0 && lessons.every((lesson) => lesson.state === "READY");
}
