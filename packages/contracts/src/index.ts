import { z } from "zod";

export const EVENT_TYPES = [
  "identity.user.registered.v1",
  "identity.user.status_changed.v1",
  "learning.course.created.v1",
  "learning.course.published.v1",
  "learning.course.enrolled.v1",
  "learning.progress.updated.v1",
  "learning.order.paid.v1",
  "classroom.class.created.v1",
  "classroom.student.joined.v1",
  "classroom.student.removed.v1",
  "assessment.quiz.submitted.v1",
  "assessment.quiz.graded.v1",
  "interaction.review.created.v1",
  "interaction.report.created.v1",
  "interaction.content.moderated.v1",
  "ai.document.extract.v1",
  "ai.quiz.generate.v1",
  "ai.quiz.generated.v1",
  "ai.job.failed.v1",
  "system.notification.requested.v1",
  "system.audit.requested.v1",
  "system.projection.reconcile.v1",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const eventEnvelopeSchema = z.object({
  specVersion: z.literal("1.0"),
  eventId: z.string().uuid(),
  eventType: z.enum(EVENT_TYPES),
  occurredAt: z.string().datetime({ offset: true }),
  producer: z.string().min(1),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  actor: z
    .object({ type: z.enum(["USER", "SERVICE", "SYSTEM"]), id: z.string().uuid().or(z.string().min(1)) })
    .optional(),
  aggregate: z.object({
    type: z.string().min(1),
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
  }),
  trace: z.object({ traceparent: z.string().min(1).optional() }).optional(),
  data: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export function encodeEvent(event: EventEnvelope, maxBytes = 128 * 1024): Buffer {
  const validated = eventEnvelopeSchema.parse(event);
  const buffer = Buffer.from(JSON.stringify(validated));
  if (buffer.byteLength > maxBytes) throw new Error("EVENT_TOO_LARGE");
  return buffer;
}

export function decodeEvent(content: Buffer, maxBytes = 128 * 1024): EventEnvelope {
  if (content.byteLength > maxBytes) throw new Error("EVENT_TOO_LARGE");
  return eventEnvelopeSchema.parse(JSON.parse(content.toString("utf8")));
}

export * from "./analytics-events.js";
export * from "./prerequisite-policy.js";
export * from "./interoperability.js";
export * from "./integrations.js";
export * from "./onboarding.js";
export * from "./scim.js";
export * from "./oneroster.js";
export * from "./institutional-pilot.js";




