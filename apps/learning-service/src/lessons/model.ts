import { createHmac } from "node:crypto";
import { z } from "zod";

const cleanText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine(
      (value) =>
        !Array.from(value).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
      "Control characters are not allowed",
    );

const position = z
  .object({
    sectionOrder: z.number().int().min(1).max(9_999),
    lessonOrder: z.number().int().min(1).max(9_999),
  })
  .strict();

const contentRef = z
  .object({
    objectKey: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/u)
      .refine((value) => !value.includes("..") && !value.startsWith("/")),
    size: z
      .number()
      .int()
      .min(1)
      .max(25 * 1024 * 1024),
    contentType: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ]),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/iu)
      .transform((value) => value.toLowerCase()),
  })
  .strict();

const createSchema = z
  .object({
    title: cleanText(3, 160),
    sectionTitle: cleanText(1, 160),
    position,
    preview: z.boolean().default(false),
    contentRef: contentRef.optional(),
  })
  .strict();

const patchSchema = z
  .object({
    title: cleanText(3, 160).optional(),
    sectionTitle: cleanText(1, 160).optional(),
    position: position.optional(),
    preview: z.boolean().optional(),
    contentRef: contentRef.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "PATCH body must not be empty");

export type LessonCreateRequest = z.infer<typeof createSchema>;
export type LessonPatchRequest = z.infer<typeof patchSchema>;
export type LessonContentRef = NonNullable<LessonCreateRequest["contentRef"]>;

export interface LessonSummary {
  lessonId: string;
  lessonVersion: number;
  sectionOrder: number;
  lessonOrder: number;
  sectionTitle: string;
  title: string;
  state: "DRAFT" | "INCOMPLETE" | "READY";
  preview: boolean;
  objectKey?: string;
}

export interface LessonDetail {
  lessonId: string;
  lessonVersion: number;
  courseId: string;
  contentVersion: number;
  title: string;
  state: "DRAFT" | "INCOMPLETE" | "READY";
  preview: boolean;
  objectKey?: string;
  checksum?: string;
  updatedAt: Date;
}

export interface LessonReceipt {
  fingerprint: string;
  occurredAt: string;
  sourceContentVersion?: number;
  targetContentVersion?: number;
  expectedRecordVersion?: number;
  lessonId?: string;
  lessonVersion?: number;
  lesson?: ReturnType<typeof lessonDto>;
}

export const parseCreateLesson = (value: unknown): LessonCreateRequest => createSchema.parse(value);
export const parsePatchLesson = (value: unknown): LessonPatchRequest => patchSchema.parse(value);

export function lessonFingerprint(secret: string, value: object): string {
  return createHmac("sha256", secret).update(JSON.stringify(value), "utf8").digest("hex");
}

export function lessonDto(
  lesson: LessonSummary,
  courseId: string,
  contentVersion: number,
  contentUrl?: string,
) {
  return {
    lessonId: lesson.lessonId,
    courseId,
    lessonVersion: lesson.lessonVersion,
    contentVersion,
    title: lesson.title,
    sectionTitle: lesson.sectionTitle,
    position: { sectionOrder: lesson.sectionOrder, lessonOrder: lesson.lessonOrder },
    state: lesson.state,
    preview: lesson.preview,
    ...(contentUrl ? { contentUrl } : {}),
  };
}

export function lessonDetailDto(lesson: LessonDetail, contentUrl?: string) {
  return {
    lessonId: lesson.lessonId,
    courseId: lesson.courseId,
    lessonVersion: lesson.lessonVersion,
    contentVersion: lesson.contentVersion,
    title: lesson.title,
    state: lesson.state,
    preview: lesson.preview,
    updatedAt: lesson.updatedAt.toISOString(),
    ...(lesson.checksum ? { checksum: lesson.checksum } : {}),
    ...(contentUrl ? { contentUrl } : {}),
  };
}

export function applyPatch(current: LessonSummary, patch: LessonPatchRequest): LessonSummary {
  const base: LessonSummary = { ...current };
  if (patch.contentRef === null) delete base.objectKey;
  return {
    ...base,
    title: patch.title ?? current.title,
    sectionTitle: patch.sectionTitle ?? current.sectionTitle,
    sectionOrder: patch.position?.sectionOrder ?? current.sectionOrder,
    lessonOrder: patch.position?.lessonOrder ?? current.lessonOrder,
    preview: patch.preview ?? current.preview,
    state: "READY",
    ...(patch.contentRef ? { objectKey: patch.contentRef.objectKey } : {}),
  };
}
