import { describe, expect, it } from "vitest";
import { enforceCitationAllowlist } from "../../apps/ai-service/src/assistant/citation-policy.js";

const source = {
  courseId: "00000000-0000-4000-8000-000000000010",
  courseVersion: 3,
  lessonId: "00000000-0000-4000-8000-000000000020",
  lessonVersion: 2,
  sourceObjectId: "a".repeat(64),
  retrievalScore: 4,
  title: "Partition keys",
  sectionTitle: "Data model",
  contentSnippet: "A partition key groups rows.",
  sourceType: "LESSON_OBJECT" as const,
};
const citation = {
  sourceId: source.lessonId,
  title: source.title,
  lessonId: source.lessonId,
  courseId: source.courseId,
  courseVersion: source.courseVersion,
  lessonVersion: source.lessonVersion,
  sourceObjectId: source.sourceObjectId,
};

describe("Phase 40 request-scoped citation allowlist", () => {
  it("accepts the exact retrieved source identity", () =>
    expect(enforceCitationAllowlist([citation], [source])).toEqual([citation]));
  it.each([
    ["unknown source", { ...citation, sourceObjectId: "b".repeat(64) }],
    ["wrong course", { ...citation, courseId: "00000000-0000-4000-8000-000000000099" }],
    ["stale version", { ...citation, courseVersion: 2 }],
    ["source not supplied", citation],
  ])("rejects %s", (_label, injected) =>
    expect(enforceCitationAllowlist([injected], _label === "source not supplied" ? [] : [source])).toEqual(
      [],
    ),
  );
});
