import { z } from "zod";

export const canonicalEmailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());

export const displayNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const point = character.codePointAt(0) ?? 0;
        return point < 32 || point === 127;
      }),
    "Control characters are not allowed",
  );

export function normalizeIdentityEmail(value: string): string {
  return canonicalEmailSchema.parse(value);
}
