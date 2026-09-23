import { z } from "zod";
const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const empty = z.object({}).strict();
const text = z.string().min(1).max(4000);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z
  .object({ from: date, to: date })
  .strict()
  .refine((v) => {
    const n = (Date.parse(v.to) - Date.parse(v.from)) / 86400000;
    return Number.isFinite(n) && n >= 0 && n < 31;
  });
const page = {
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(16384).optional(),
};
const answer = z.union([
  z.object({ questionId: z.string().uuid(), selectedOptionId: z.string().min(1).max(500) }).strict(),
  z
    .object({ questionId: z.string().uuid(), selectedOptionIds: z.array(z.string().min(1).max(500)).max(10) })
    .strict(),
  z.object({ questionId: z.string().uuid(), value: z.boolean() }).strict(),
  z.object({ questionId: z.string().uuid(), text: z.string().max(500) }).strict(),
]);
const rules = [];
function rule(method, path, query = empty, body = empty, headers = "") {
  rules.push({ method, pattern: new RegExp(`^${path.replaceAll(":id", uuid)}$`), query, body, headers });
}
rule(
  "GET",
  "/courses/search",
  z
    .object({
      q: z.string().min(3).max(20),
      ...page,
      limit: z.coerce.number().int().min(1).max(50).optional(),
    })
    .strict(),
);
for (const path of [
  "/me/courses",
  "/courses/:id",
  "/courses/:id/lessons",
  "/lessons/:id",
  "/courses/:id/progress",
  "/me/classes",
  "/classes/:id",
  "/class-sessions/:id",
  "/quizzes/:id",
  "/targets/(COURSE|CLASS)/:id/quizzes",
  "/attempts/:id",
  "/attempts/:id/result",
  "/courses/:id/offerings",
  "/orders/:id",
])
  rule("GET", path);
rule("GET", "/mastery/me", z.object({ courseId: z.string().uuid() }).strict());
rule("GET", "/mastery/courses/:id");
rule("GET", "/mastery/outcomes/[^/]+", z.object({ courseId: z.string().uuid() }).strict());
rule("GET", "/study-plan/current", z.object({ courseId: z.string().uuid() }).strict());
rule(
  "POST",
  "/study-plan/generate",
  empty,
  z.object({ courseId: z.string().uuid(), availableHoursPerWeek: z.number().min(1).max(80) }).strict(),
);
rule(
  "POST",
  "/assistant/chat",
  empty,
  z.object({
    conversationId: z.string().uuid().optional(),
    mode: z.enum(["STUDENT_ADVISOR", "STUDY_BUDDY"]),
    courseId: z.string().uuid().optional(),
    message: z.string().trim().min(1).max(4000),
  }).strict(),
);
rule(
  "PATCH",
  "/study-plan/items/:id",
  empty,
  z.object({
    courseId: z.string().uuid(),
    status: z.enum(["ACCEPTED", "SKIPPED", "RESCHEDULED", "COMPLETED", "REPLACED"]),
    scheduledDate: date.optional(),
  }).strict().refine((value) => value.status !== "RESCHEDULED" || !!value.scheduledDate),
);
rule("POST", "/orders", empty, z.object({ offeringId: z.string().uuid() }).strict(), "key");
rule(
  "POST",
  "/orders/:id/simulate-payment",
  empty,
  z.object({ outcome: z.enum(["SUCCESS", "FAILURE"]) }).strict(),
  "key",
);
rule("POST", "/courses/:id/enrollments", empty, empty, "key");
rule("PUT", "/lessons/:id/completion", empty, z.object({ completed: z.boolean() }).strict(), "key");
rule(
  "POST",
  "/classes/join",
  empty,
  z.object({ code: z.string().regex(/^[A-Z2-9]{6,32}$/) }).strict(),
  "key",
);
rule("GET", "/me/schedule", range);
rule("GET", "/classes/:id/sessions", range);
rule("GET", "/me/attendance", z.object({ month }).strict());
rule(
  "GET",
  "/classes/:id/announcements",
  z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) }).strict(),
);
rule("POST", "/quizzes/:id/attempts", empty, empty, "key");
rule(
  "POST",
  "/attempts/:id/submit",
  empty,
  z
    .object({
      answers: z
        .array(answer)
        .max(200)
        .refine((a) => new Set(a.map((v) => v.questionId)).size === a.length),
      clientSubmittedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  "key",
);
for (const path of ["/resources/(COURSE|CLASS)/:id/comments", "/courses/:id/reviews"])
  rule("GET", path, z.object(page).strict());
rule(
  "POST",
  "/resources/(COURSE|CLASS)/:id/comments",
  empty,
  z.object({ body: text, parentId: z.string().uuid().nullable().optional() }).strict(),
  "key",
);
rule("PATCH", "/comments/:id", empty, z.object({ body: text }).strict(), "match");
rule(
  "POST",
  "/courses/:id/reviews",
  empty,
  z.object({ body: text, rating: z.number().int().min(1).max(5) }).strict(),
  "key",
);
rule(
  "PATCH",
  "/reviews/:id",
  empty,
  z
    .object({ body: text.optional(), rating: z.number().int().min(1).max(5).optional() })
    .strict()
    .refine((v) => Object.keys(v).length > 0),
  "match",
);
for (const path of ["/comments/:id", "/reviews/:id"]) rule("DELETE", path, empty, empty, "match");
rule(
  "POST",
  "/reports",
  empty,
  z
    .object({
      targetType: z.enum(["COMMENT", "REVIEW"]),
      targetId: z.string().uuid(),
      reason: z.string().min(1).max(1000),
    })
    .strict(),
  "key",
);
rule(
  "GET",
  "/notifications",
  z
    .object({
      month,
      limit: z.coerce.number().int().min(1).max(50).optional(),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict(),
);
rule("PATCH", "/notifications/:id/read", empty, empty, "locator");
export function studentOperation(url, method, body, headers) {
  if (!url.startsWith("/web-session/student/")) return null;
  const raw = url.slice("/web-session/student".length);
  const [path, query = ""] = raw.split("?");
  if (raw.includes("#") || /[%\\]/.test(path)) throw new Error("INVALID_STUDENT_REQUEST");
  const rule = rules.find((r) => r.method === method && r.pattern.test(path));
  if (!rule) throw new Error("INVALID_STUDENT_REQUEST");
  const params = new URLSearchParams(query),
    values = {};
  for (const [k, v] of params) {
    if (k in values) throw new Error("INVALID_STUDENT_REQUEST");
    values[k] = v;
  }
  rule.query.parse(values);
  rule.body.parse(body ?? {});
  const extra = {};
  if (rule.headers === "key" || rule.headers === "match")
    z.string()
      .regex(/^[!-~]{1,128}$/)
      .parse(headers["idempotency-key"]);
  if (rule.headers === "match")
    extra["If-Match"] = z
      .string()
      .regex(/^"v[1-9][0-9]{0,9}"$/)
      .parse(headers["if-match"]);
  if (rule.headers === "locator")
    extra["x-notification-locator"] = z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,4096}$/)
      .parse(headers["x-notification-locator"]);
  return { path: path + (query ? "?" + params.toString() : ""), headers: extra };
}
// Fail closed if an upstream changes its Student projection. Never serialize privileged fields.
export function studentEnvelope(value) {
  const forbidden =
    /^(?:accessToken|refreshToken|password|correctAnswer|resultItems|gradingChecksum|actorContext|serviceToken)$/i;
  function inspect(v) {
    if (!v || typeof v !== "object") return;
    for (const [k, item] of Object.entries(v)) {
      if (forbidden.test(k)) throw new Error("UNSAFE_STUDENT_RESPONSE");
      inspect(item);
    }
  }
  inspect(value.data);
  return {
    data: value.data ?? null,
    meta: {
      ...(value.meta?.page ? { page: value.meta.page } : {}),
      ...(value.meta?.pagination ? { pagination: value.meta.pagination } : {}),
    },
  };
}
