import type { Citation } from "./model.js";
import type { CourseMaterialSnippet } from "./tool-runner.js";

export function citationIdentity(value: {
  courseId?: string;
  courseVersion?: number;
  lessonId?: string;
  lessonVersion?: number;
  sourceObjectId?: string;
}): string | undefined {
  if (
    !value.courseId ||
    !value.courseVersion ||
    !value.lessonId ||
    !value.lessonVersion ||
    !value.sourceObjectId
  )
    return undefined;
  return [
    value.courseId,
    value.courseVersion,
    value.lessonId,
    value.lessonVersion,
    value.sourceObjectId,
  ].join(":");
}

export function enforceCitationAllowlist(
  citations: readonly Citation[],
  retrieved: readonly CourseMaterialSnippet[],
): Citation[] {
  const allowed = new Set(retrieved.map(citationIdentity).filter((value): value is string => Boolean(value)));
  return citations.filter((citation) => {
    const identity = citationIdentity(citation);
    return identity !== undefined && allowed.has(identity);
  });
}
