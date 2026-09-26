import { z } from "zod";
const U = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
  empty = z.object({}).strict(),
  id = z.string().uuid(),
  txt = (a, b) => z.string().trim().min(a).max(b),
  dt = z.string().datetime({ offset: true }),
  key = z.string().regex(/^[!-~]{1,200}$/),
  page = {
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(16384).optional(),
  };
const partialNonempty = (s) => s.partial().refine((v) => Object.keys(v).length > 0);
const course = z
  .object({
    title: txt(3, 160),
    slug: txt(1, 200),
    categoryId: id,
    priceType: z.enum(["FREE", "PAID"]),
    price: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
  })
  .strict();
const pos = z
    .object({
      sectionOrder: z.number().int().min(1).max(9999),
      lessonOrder: z.number().int().min(1).max(9999),
    })
    .strict(),
  content = z
    .object({
      objectKey: txt(1, 512),
      size: z.number().int().min(1).max(26214400),
      contentType: z.enum([
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
      ]),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    })
    .strict();
const lesson = z
    .object({
      title: txt(3, 160),
      sectionTitle: txt(1, 160),
      position: pos,
      preview: z.boolean().optional(),
      contentRef: content.optional(),
    })
    .strict(),
  lessonPatch = z
    .object({
      title: txt(3, 160).optional(),
      sectionTitle: txt(1, 160).optional(),
      position: pos.optional(),
      preview: z.boolean().optional(),
      contentRef: content.nullable().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0);
const offering = z
    .object({
      offeringType: z.enum(["SELF_PACED", "LIVE_COHORT"]),
      classId: id.optional(),
      title: txt(3, 160),
      price: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/),
      currency: z.string().regex(/^[A-Za-z]{3}$/),
      salesStartAt: dt.nullable().optional(),
      salesEndAt: dt.nullable().optional(),
    })
    .strict(),
  offeringPatch = partialNonempty(offering.omit({ offeringType: true, classId: true }));
const klass = z
    .object({
      name: txt(3, 160),
      classKind: z.enum(["LIVE_COHORT", "PRIVATE", "INSTITUTIONAL"]),
      linkedCourseId: id.optional(),
      maxMembers: z.number().int().min(1).max(10000).optional(),
    })
    .strict(),
  classPatch = z
    .object({
      name: txt(3, 160).optional(),
      linkedCourseId: id.nullable().optional(),
      maxMembers: z.number().int().min(1).max(10000).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0);
const recurrence = z
    .object({
      frequency: z.literal("WEEKLY"),
      interval: z.number().int().min(1).max(4),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .strict(),
  session = z
    .object({
      title: txt(3, 160),
      startAt: dt,
      endAt: dt,
      timezone: txt(1, 64),
      mode: z.enum(["ONLINE", "OFFLINE"]),
      meetingProvider: txt(1, 50).optional(),
      meetingUrl: z.string().url().max(2048).optional(),
      location: txt(1, 300).optional(),
      recurrence: recurrence.optional(),
    })
    .strict(),
  sessionPatch = z
    .object({
      title: txt(3, 160).optional(),
      startAt: dt.optional(),
      endAt: dt.optional(),
      timezone: txt(1, 64).optional(),
      meetingProvider: txt(1, 50).optional(),
      meetingUrl: z.string().url().max(2048).optional(),
      location: txt(1, 300).optional(),
      status: z.literal("CANCELLED").optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0);
const answer = z.union([txt(1, 500), z.array(txt(1, 500)).min(1).max(10), z.boolean()]),
  question = z
    .object({
      prompt: txt(1, 2000),
      points: z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/),
      questionType: z.enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]),
      options: z.array(txt(1, 500)).min(2).max(10).optional(),
      correctAnswer: answer,
    })
    .strict(),
  quiz = z
    .object({
      title: txt(3, 160),
      targetType: z.enum(["COURSE", "CLASS"]),
      targetId: id,
      opensAt: dt.optional(),
      closesAt: dt.optional(),
      durationSeconds: z.number().int().min(60).max(14400).optional(),
      attemptLimit: z.number().int().min(1).max(100).optional(),
      questions: z.array(question).max(200),
    })
    .strict();
const rules = [];
function rule(method, path, { query = empty, body = empty, command = false, match = false } = {}) {
  rules.push({ method, pattern: new RegExp(`^${path.replaceAll(":id", U)}$`), query, body, command, match });
}
rule("GET", "/courses", {
  query: z.object({ categoryId: id.optional(), state: z.string().optional(), ...page }).strict(),
});
for (const p of [
  "/courses/:id",
  "/courses/:id/lessons",
  "/lessons/:id",
  "/courses/:id/roster",
  "/me/owned-offerings",
  "/offerings/:id",
  "/me/owned-classes",
  "/classes/:id",
  "/classes/:id/members",
  "/class-sessions/:id",
  "/class-sessions/:id/attendance",
  "/ai/usage",
])
  rule("GET", p);
rule("POST", "/courses", { body: course, command: true });
rule("PATCH", "/courses/:id", { body: partialNonempty(course), command: true });
rule("POST", "/courses/:id/submit-review", { command: true });
rule("POST", "/courses/:id/lessons", { body: lesson, command: true });
rule("PATCH", "/lessons/:id", { body: lessonPatch, command: true });
rule("POST", "/courses/:id/media-assets", {
  body: z
    .object({
      lessonId: id,
      originalFilename: txt(1, 255).refine((value) => Array.from(value).every((char) => {
        const code = char.codePointAt(0) ?? 0;
        return code > 31 && code !== 127;
      })),
      mimeType: z.enum(["video/mp4", "video/webm"]),
      sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      sourceSha256: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict(),
  command: true,
});
rule("GET", "/media-assets/:id");
rule("GET", "/media-assets/:id/upload");
rule("POST", "/media-assets/:id/captions", {
  body: z.object({
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/).max(35),
    label: txt(1, 80),
    kind: z.enum(["SUBTITLES", "CAPTIONS"]),
    contentType: z.literal("text/vtt"),
    content: z.string().min(1).max(262144),
  }).strict(),
  command: true,
});
rule("POST", "/media-assets/:id/parts", {
  body: z.object({ partNumber: z.number().int().min(1).max(10000) }).strict(),
});
for (const action of ["complete", "cancel", "attach"])
  rule("POST", `/media-assets/:id/${action}`, { body: empty });
rule("GET", "/courses/:id/offerings", { query: z.object(page).strict() });
rule("GET", "/courses/:id/reviews", { query: z.object(page).strict() });
rule("GET", "/resources/(COURSE|CLASS)/:id/comments", { query: z.object(page).strict() });
rule("POST", "/resources/(COURSE|CLASS)/:id/comments", {
  body: z.object({ body: txt(1, 4000), parentId: id.nullable().optional() }).strict(),
  command: true,
});
rule("PATCH", "/comments/:id", {
  body: z.object({ body: txt(1, 4000) }).strict(),
  command: true,
  match: true,
});
rule("DELETE", "/comments/:id", { command: true, match: true });
rule("POST", "/reports", {
  body: z.object({ targetType: z.enum(["COMMENT", "REVIEW"]), targetId: id, reason: txt(1, 1000) }).strict(),
  command: true,
});
rule("POST", "/courses/:id/offerings", { body: offering, command: true });
rule("PATCH", "/offerings/:id", { body: offeringPatch, command: true });
rule("POST", "/offerings/:id/publish", { command: true });
rule("POST", "/classes", { body: klass, command: true });
rule("PATCH", "/classes/:id", { body: classPatch, command: true });
rule("POST", "/classes/:id/join-code/reset", { command: true });
rule("GET", "/classes/:id/announcements", {
  query: z.object({ month: z.string().regex(/^\d{4}-\d{2}-01$/) }).strict(),
});
rule("POST", "/classes/:id/announcements", {
  body: z.object({ title: txt(3, 160), body: txt(1, 5000) }).strict(),
  command: true,
});
rule("GET", "/classes/:id/sessions", {
  query: z
    .object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
    .strict(),
});
rule("POST", "/classes/:id/sessions", { body: session, command: true });
rule("PATCH", "/classes/:id/sessions/:id", { body: sessionPatch, command: true });
rule("POST", "/classes/:id/schedule/publish", { command: true });
rule("PUT", "/class-sessions/:id/attendance/:id", {
  body: z
    .object({ attendanceStatus: z.enum(["PRESENT", "ABSENT", "EXCUSED"]), note: txt(1, 500).optional() })
    .strict(),
  command: true,
  match: true,
});
rule("POST", "/quizzes", { body: quiz, command: true });
rule("GET", "/quizzes/:id");
rule("PATCH", "/quizzes/:id", {
  body: partialNonempty(quiz.omit({ targetType: true, targetId: true })),
  command: true,
});
rule("POST", "/quizzes/:id/publish", { command: true });
rule("GET", "/targets/(COURSE|CLASS)/:id/quizzes");
rule("GET", "/quizzes/:id/results", {
  query: z
    .object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().min(1).max(4096).optional(),
    })
    .strict(),
});
rule("POST", "/ai/documents/upload-intents", {
  body: z
    .object({
      fileName: txt(1, 180),
      contentType: txt(1, 150),
      sizeBytes: z.number().int().min(1).max(26214400),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  command: true,
});
rule("POST", "/ai/documents/:id/complete", {
  body: z
    .object({
      objectKey: txt(1, 512),
      sizeBytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      contentType: txt(1, 150),
    })
    .strict(),
  command: true,
});
rule("GET", "/ai/documents/:id");
rule("POST", "/ai/quiz-jobs", {
  body: z
    .object({
      documentId: id,
      targetType: z.enum(["COURSE", "CLASS"]),
      targetId: id,
      questionCount: z.number().int().min(1).max(50),
      questionTypes: z
        .array(z.enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]))
        .min(1)
        .max(4),
      difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
      cognitiveDistribution: z
        .object({
          RECOGNITION: z.number().int().min(0).max(50),
          UNDERSTANDING: z.number().int().min(0).max(50),
          APPLICATION: z.number().int().min(0).max(50),
          ADVANCED_APPLICATION: z.number().int().min(0).max(50),
        })
        .strict()
        .optional(),
    })
    .strict()
    .refine(
      (v) =>
        !v.cognitiveDistribution ||
        Object.values(v.cognitiveDistribution).reduce((sum, count) => sum + count, 0) === v.questionCount,
    ),
  command: true,
});
rule("GET", "/ai/jobs", {
  query: z
    .object({
      state: z.enum(["QUEUED", "PROCESSING", "VALIDATING", "AI_DRAFT", "FAILED", "APPROVED", "CANCELLED"]),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      limit: z.coerce.number().int().min(1).max(50).optional(),
      cursor: z.string().max(2048).optional(),
    })
    .strict(),
});
for (const p of ["/ai/jobs/:id", "/ai/jobs/:id/drafts"]) rule("GET", p);
rule("POST", "/ai/jobs/:id/cancel");
rule("POST", "/ai/drafts/:id/approve", {
  body: z.object({ reviewedDraft: z.record(z.string(), z.unknown()) }).strict(),
  command: true,
  match: true,
});
export function lecturerOperation(url, method, body, headers) {
  if (!url.startsWith("/web-session/lecturer/")) return null;
  const raw = url.slice("/web-session/lecturer".length),
    [path, query = ""] = raw.split("?");
  if (raw.includes("#") || /[%\\]/.test(path)) throw Error();
  const r = rules.find((x) => x.method === method && x.pattern.test(path));
  if (!r) throw Error();
  const params = new URLSearchParams(query),
    values = {};
  for (const [k, v] of params) {
    if (k in values) throw Error();
    values[k] = v;
  }
  r.query.parse(values);
  r.body.parse(body ?? {});
  const extra = {};
  if (r.command) key.parse(headers["idempotency-key"]);
  if (r.match)
    extra["If-Match"] = z
      .string()
      .regex(/^"v(?:0|[1-9]\d{0,9})"$/)
      .parse(headers["if-match"]);
  return { path: path + (query ? "?" + params.toString() : ""), headers: extra };
}
export function lecturerEnvelope(value) {
  const forbidden =
      /^(?:accessToken|refreshToken|password|currentPassword|gradingChecksum|actorContext|serviceToken|serviceJws|providerCredential|providerApiKey|rawProviderPayload|rawProviderResponse|secretAccessKey|accessKey)$/i,
    walk = (v) => {
      if (!v || typeof v !== "object") return;
      for (const [k, x] of Object.entries(v)) {
        if (forbidden.test(k)) throw Error("UNSAFE_LECTURER_RESPONSE");
        walk(x);
      }
    };
  walk(value.data);
  return {
    data: value.data ?? null,
    meta: {
      ...(typeof value.meta?.nextCursor === "string" ? { nextCursor: value.meta.nextCursor } : {}),
      ...(value.meta?.page ? { page: value.meta.page } : {}),
      ...(value.meta?.pagination ? { pagination: value.meta.pagination } : {}),
    },
  };
}
