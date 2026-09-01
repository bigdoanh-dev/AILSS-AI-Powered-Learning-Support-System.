import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ResourceType } from "./model.js";

const position = z.object({ createdAt: z.string().datetime(), commentId: z.string().uuid() }).strict();
const payloadSchema = z
  .object({
    v: z.literal(1),
    resourceType: z.enum(["COURSE", "CLASS"]),
    resourceId: z.string().uuid(),
    snapshotUpperBound: z.string().datetime(),
    currentDay: z.string().date(),
    limit: z.number().int().min(1).max(100),
    filtersHash: z.literal("all-comments-v1"),
    direction: z.literal("DESC"),
    positions: z.record(z.string(), position),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .strict();
export type TimelineCursor = z.infer<typeof payloadSchema>;
export interface CursorBinding {
  resourceType: ResourceType;
  resourceId: string;
  limit: number;
}
export function encodeCursor(secret: string, payload: TimelineCursor) {
  const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${raw}.${sign(secret, raw)}`;
}
export function decodeCursor(
  secret: string,
  value: string,
  binding: CursorBinding,
  now = Date.now(),
): TimelineCursor {
  const [raw, signature, extra] = value.split(".");
  if (!raw || !signature || extra) throw new Error("INVALID_CURSOR");
  const expected = sign(secret, raw),
    a = Buffer.from(signature),
    b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("INVALID_CURSOR");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  const p = payloadSchema.parse(parsed);
  if (
    p.expiresAt * 1000 < now ||
    p.resourceType !== binding.resourceType ||
    p.resourceId !== binding.resourceId ||
    p.limit !== binding.limit
  )
    throw new Error("INVALID_CURSOR");
  return p;
}
function sign(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
