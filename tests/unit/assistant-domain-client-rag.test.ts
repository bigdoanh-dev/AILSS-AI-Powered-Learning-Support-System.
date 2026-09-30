import { generateKeyPair } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAssistantDomainClient } from "../../apps/ai-service/src/assistant/domain-client.js";

describe("AI Tutor material retrieval boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts version-pinned material records from the requested course", async () => {
    const courseId = "00000000-0000-4000-8000-000000000010";
    const lessonId = "00000000-0000-4000-8000-000000000011";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                courseId,
                lessonId,
                lessonVersion: 2,
                courseVersion: 4,
                title: "Quorum",
                sectionTitle: "Consistency",
                contentSnippet: "LOCAL_QUORUM",
                sourceObjectId: "a".repeat(64),
                retrievalScore: 2,
                sourceType: "LESSON_OBJECT",
              },
            ],
            meta: { retrievalState: "MATCHES", courseVersion: 4 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const { privateKey } = await generateKeyPair("Ed25519");
    const client = new HttpAssistantDomainClient({
      learningUrl: "http://learning",
      assessmentUrl: "http://assessment",
      classroomUrl: "http://classroom",
      key: privateKey,
      kid: "test",
    });
    await expect(
      client.searchCourseMaterials("00000000-0000-4000-8000-000000000012", courseId, "quorum"),
    ).resolves.toEqual([expect.objectContaining({ lessonId, courseVersion: 4 })]);
  });

  it("rejects cross-course citation material instead of rendering it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [
              {
                courseId: "00000000-0000-4000-8000-000000000099",
                lessonId: "00000000-0000-4000-8000-000000000011",
                lessonVersion: 2,
                courseVersion: 4,
                title: "Wrong course",
                sectionTitle: "Private",
                contentSnippet: "leak",
                sourceObjectId: "b".repeat(64),
                retrievalScore: 1,
                sourceType: "LESSON_OBJECT",
              },
            ],
            meta: { retrievalState: "MATCHES", courseVersion: 4 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const { privateKey } = await generateKeyPair("Ed25519");
    const client = new HttpAssistantDomainClient({
      learningUrl: "http://learning",
      assessmentUrl: "http://assessment",
      classroomUrl: "http://classroom",
      key: privateKey,
      kid: "test",
    });
    await expect(
      client.searchCourseMaterials(
        "00000000-0000-4000-8000-000000000012",
        "00000000-0000-4000-8000-000000000010",
        "private",
      ),
    ).rejects.toThrow("RAG_SOURCE_SCOPE_MISMATCH");
  });

  it("distinguishes backend failure from a genuine empty retrieval", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const { privateKey } = await generateKeyPair("Ed25519");
    const client = new HttpAssistantDomainClient({
      learningUrl: "http://learning",
      assessmentUrl: "http://assessment",
      classroomUrl: "http://classroom",
      key: privateKey,
      kid: "test",
    });
    await expect(
      client.searchCourseMaterials(
        "00000000-0000-4000-8000-000000000012",
        "00000000-0000-4000-8000-000000000010",
        "topic",
      ),
    ).rejects.toThrow("RAG_TOOL_UNAVAILABLE");
  });

  it("accepts an explicit NO_MATCH without inventing a source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [], meta: { retrievalState: "NO_MATCH", courseVersion: 4 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const { privateKey } = await generateKeyPair("Ed25519");
    const client = new HttpAssistantDomainClient({
      learningUrl: "http://learning",
      assessmentUrl: "http://assessment",
      classroomUrl: "http://classroom",
      key: privateKey,
      kid: "test",
    });
    await expect(
      client.searchCourseMaterials(
        "00000000-0000-4000-8000-000000000012",
        "00000000-0000-4000-8000-000000000010",
        "missing topic",
      ),
    ).resolves.toEqual([]);
  });

  it.each([
    [409, "RAG_MATERIAL_UNAVAILABLE"],
    [403, "RAG_TOOL_FORBIDDEN"],
    [500, "RAG_TOOL_UNAVAILABLE"],
  ])("fails closed for material endpoint status %i", async (status, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    const { privateKey } = await generateKeyPair("Ed25519");
    const client = new HttpAssistantDomainClient({
      learningUrl: "http://learning",
      assessmentUrl: "http://assessment",
      classroomUrl: "http://classroom",
      key: privateKey,
      kid: "test",
    });
    await expect(
      client.searchCourseMaterials(
        "00000000-0000-4000-8000-000000000012",
        "00000000-0000-4000-8000-000000000010",
        "topic",
      ),
    ).rejects.toThrow(expected);
  });
});
