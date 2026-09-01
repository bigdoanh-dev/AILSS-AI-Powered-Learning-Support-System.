import { z } from "zod";

export type ResourceType = "COURSE" | "CLASS";
export type CommentState = "ACTIVE" | "DELETED_BY_AUTHOR" | "HIDDEN_BY_MODERATOR";
export interface Comment {
  commentId: string;
  resourceType: ResourceType;
  resourceId: string;
  parentId: string | null;
  authorId: string;
  body: string | null;
  state: CommentState;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  pendingOperationId?: string;
  pendingOperationKind?: string;
  pendingExpectedVersion?: number;
  pendingContentChecksum?: string;
}
export const createSchema = z
  .object({ body: z.string(), parentId: z.string().uuid().nullable().optional() })
  .strict();
export const patchSchema = z.object({ body: z.string() }).strict();
export function body(value: string): string {
  const normalized = value.replace(/\r\n?/gu, "\n").normalize("NFC");
  const length = Array.from(normalized).length;
  if (length < 1 || length > 4000 || Array.from(normalized).some(disallowedControl))
    throw new Error("INVALID_COMMENT_BODY");
  return normalized;
}
function disallowedControl(value: string) {
  const code = value.codePointAt(0) ?? 0;
  return code === 127 || (code < 32 && code !== 9 && code !== 10);
}
export function json(c: Comment) {
  return {
    commentId: c.commentId,
    resourceType: c.resourceType,
    resourceId: c.resourceId,
    parentId: c.parentId,
    authorId: c.authorId,
    body: c.body,
    state: c.state,
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
