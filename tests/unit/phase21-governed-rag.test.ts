import { describe, expect, it } from "vitest";
import { GovernedRagService, InMemoryRagKnowledgeRepository } from "../../apps/ai-service/src/rag/index.js";

describe("Phase 21B: Governed RAG Platform V2 & Course Version Pinning", () => {
  async function createSetup() {
    const repo = new InMemoryRagKnowledgeRepository();
    const service = new GovernedRagService(repo);

    const courseId = "course-distributed-db";

    // Ingest Version 1: Legacy curriculum
    await service.ingestDocument({
      courseId,
      courseVersion: 1,
      documentId: "doc-v1-syllabus",
      chunks: [
        "In Version 1 curriculum: The database storage engine relies primarily on classic B-Tree indexing.",
        "Version 1 lab exercises require MySQL 8.0 installation.",
      ],
    });

    // Ingest Version 2: Modern curriculum update
    await service.ingestDocument({
      courseId,
      courseVersion: 2,
      documentId: "doc-v2-syllabus",
      chunks: [
        "In Version 2 curriculum: The database engine was redesigned around Log-Structured Merge Trees (LSM-Tree).",
        "Version 2 lab exercises require Apache Cassandra 5.0 and ScyllaDB.",
      ],
    });

    return { service, repo, courseId };
  }

  it("strictly pins retrieval to Course Version 1 without mixing Version 2 chunks", async () => {
    const { service, courseId } = await createSetup();

    const response = await service.retrieve({
      courseId,
      courseVersion: 1, // PINNED to Version 1
      query: "storage engine",
    });

    expect(response.pinnedCourseVersion).toBe(1);
    expect(response.chunks.length).toBeGreaterThan(0);
    // Every chunk must be Version 1
    for (const chunk of response.chunks) {
      expect(chunk.courseVersion).toBe(1);
      expect(chunk.text).toContain("B-Tree");
      expect(chunk.text).not.toContain("LSM-Tree");
    }

    // Stale Version 2 chunks were intercepted and filtered out
    expect(response.staleChunksRejected).toBeGreaterThan(0);
  });

  it("strictly pins retrieval to Course Version 2 without mixing stale Version 1 chunks", async () => {
    const { service, courseId } = await createSetup();

    const response = await service.retrieve({
      courseId,
      courseVersion: 2, // PINNED to Version 2
      query: "storage engine",
    });

    expect(response.pinnedCourseVersion).toBe(2);
    expect(response.chunks.length).toBeGreaterThan(0);
    // Every chunk must be Version 2
    for (const chunk of response.chunks) {
      expect(chunk.courseVersion).toBe(2);
      expect(chunk.text).toContain("LSM-Tree");
      expect(chunk.text).not.toContain("B-Tree");
    }

    // Stale Version 1 chunks were intercepted and filtered out
    expect(response.staleChunksRejected).toBeGreaterThan(0);
  });

  it("quarantines unsafe or revoked documents from RAG retrieval context", async () => {
    const { service, courseId } = await createSetup();

    // Quarantine doc-v2-syllabus
    const quarantinedCount = await service.quarantineDocument("doc-v2-syllabus");
    expect(quarantinedCount).toBe(2);

    const response = await service.retrieve({
      courseId,
      courseVersion: 2,
      query: "database engine",
    });

    expect(response.chunks).toHaveLength(0);
    expect(response.quarantinedChunksRejected).toBe(2);
  });

  it("fails fast if courseVersion is omitted to avoid accidental cross-version contamination", async () => {
    const { service, courseId } = await createSetup();

    await expect(
      service.retrieve({
        courseId,
        courseVersion: 0, // Invalid version
        query: "database engine",
      }),
    ).rejects.toMatchObject({
      code: "COURSE_VERSION_REQUIRED",
      status: 400,
    });
  });
});
