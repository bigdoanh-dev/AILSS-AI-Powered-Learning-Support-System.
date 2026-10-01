import { createHash, createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { categoryIdForName, normalizeCategoryName } from "../categories.js";
import { normalizeSlug } from "../catalog/model.js";

const titleSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .refine(
    (value) =>
      !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127),
    "Control characters are not allowed",
  );
const slugSchema = z.string().min(1).max(200).transform(normalizeSlug).pipe(z.string().min(1).max(120));
const moneySchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/u);
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z]{3}$/u));
const fields = {
  description: z.string().trim().max(2000).optional(),
  coverDataUrl: z
    .string()
    .max(350000)
    .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u)
    .nullable()
    .optional(),
  title: titleSchema,
  slug: slugSchema,
  categoryId: z.string().uuid().optional(),
  categoryName: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .refine(
      (value) =>
        !Array.from(value).some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
      "Control characters are not allowed",
    )
    .transform(normalizeCategoryName)
    .optional(),
  priceType: z.enum(["FREE", "PAID"]),
  price: moneySchema,
  currency: currencySchema,
};

const createSchema = z
  .object(fields)
  .strict()
  .refine((value) => !!value.categoryName || !!value.categoryId, "Category is required")
  .transform((value) => ({
    ...value,
    categoryId: value.categoryName
      ? categoryIdForName(value.categoryName)
      : z.string().uuid().parse(value.categoryId),
  }));
const patchSchema = z
  .object({
    description: fields.description,
    coverDataUrl: fields.coverDataUrl,
    title: fields.title.optional(),
    slug: fields.slug.optional(),
    categoryId: fields.categoryId,
    categoryName: fields.categoryName,
    priceType: fields.priceType.optional(),
    price: fields.price.optional(),
    currency: fields.currency.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "PATCH body must not be empty")
  .transform((value) =>
    value.categoryName ? { ...value, categoryId: categoryIdForName(value.categoryName) } : value,
  );

export type CourseWriteRequest = z.infer<typeof createSchema>;
export type CoursePatchRequest = z.infer<typeof patchSchema>;

export interface AuthoringCourse {
  readonly courseId: string;
  readonly ownerLecturerId: string;
  readonly description?: string | undefined;
  readonly coverDataUrl?: string | null | undefined;
  readonly title: string;
  readonly slug: string;
  readonly categoryId: string;
  readonly state: string;
  readonly contentVersion: number;
  readonly recordVersion: number;
  readonly priceType: string;
  readonly price: string;
  readonly currency: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt?: Date;
}

export interface CommandIds {
  operationId: string;
  courseId: string;
  eventId: string;
}
export interface CommandReceipt {
  fingerprint: string;
  eventId?: string;
  occurredAt?: string;
  publishedAt?: string;
  course?: ReturnType<typeof courseDto>;
  oldCourse?: ReturnType<typeof courseDto>;
}

export const parseCreateCourse = (value: unknown): CourseWriteRequest => createSchema.parse(value);
export const parsePatchCourse = (value: unknown): CoursePatchRequest => patchSchema.parse(value);

export function validateIdempotencyKey(value: string | undefined): string {
  if (!value || value.length > 200 || !/^[\x21-\x7e]+$/u.test(value))
    throw new Error("INVALID_IDEMPOTENCY_KEY");
  return value;
}

export function commandFingerprint(secret: string, value: object): string {
  return createHmac("sha256", secret).update(JSON.stringify(value), "utf8").digest("hex");
}

export function keyHash(secret: string, value: string): number {
  const digest = createHmac("sha256", secret).update(value, "utf8").digest();
  const byte = digest[0] ?? 0;
  return byte > 127 ? byte - 256 : byte;
}

export function newCommandIds(courseId: string = randomUUID()): CommandIds {
  return { operationId: randomUUID(), courseId, eventId: randomUUID() };
}

export function eventBucket(eventId: string): number {
  return (createHash("sha256").update(eventId).digest()[0] ?? 0) % 16;
}

export function courseDto(course: AuthoringCourse) {
  return {
    courseId: course.courseId,
    ownerLecturerId: course.ownerLecturerId,
    description: course.description ?? "",
    coverDataUrl: course.coverDataUrl ?? null,
    title: course.title,
    slug: course.slug,
    categoryId: course.categoryId,
    state: course.state,
    contentVersion: course.contentVersion,
    recordVersion: course.recordVersion,
    priceType: course.priceType,
    price: course.price,
    currency: course.currency,
    createdAt: course.createdAt.toISOString(),
    updatedAt: course.updatedAt.toISOString(),
    ...(course.publishedAt ? { publishedAt: course.publishedAt.toISOString() } : {}),
  };
}

export function courseFromDto(value: ReturnType<typeof courseDto>): AuthoringCourse {
  const { createdAt, updatedAt, publishedAt, ...course } = value;
  return {
    ...course,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    ...(publishedAt ? { publishedAt: new Date(publishedAt) } : {}),
  };
}
