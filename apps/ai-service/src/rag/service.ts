import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { KnowledgeChunk, RagQueryInput, RagRetrievalResponse, ScoredKnowledgeChunk } from "./model.js";
import type { RagKnowledgeRepository } from "./repository.js";

export class GovernedRagService {
  readonly #repo: RagKnowledgeRepository;

  public constructor(repo: RagKnowledgeRepository) {
    this.#repo = repo;
  }

  public async ingestDocument(input: {
    readonly courseId: string;
    readonly courseVersion: number;
    readonly documentId: string;
    readonly chunks: readonly string[];
  }): Promise<readonly KnowledgeChunk[]> {
    if (input.courseVersion < 1 || !Number.isInteger(input.courseVersion)) {
      throw new AppError("INVALID_COURSE_VERSION", 400, "Course version must be a positive integer");
    }

    const now = new Date().toISOString();
    const createdChunks: KnowledgeChunk[] = input.chunks.map((text, idx) => {
      const tokens = text
        .toLowerCase()
        .split(/\s+/u)
        .filter((t) => t.length > 1);
      return {
        chunkId: randomUUID(),
        courseId: input.courseId,
        courseVersion: input.courseVersion,
        documentId: input.documentId,
        chunkIndex: idx,
        text,
        tokens,
        status: "ACTIVE",
        createdAt: now,
      };
    });

    await this.#repo.saveBatch(createdChunks);
    return createdChunks;
  }

  /**
   * Pinned RAG retrieval: Guarantees zero stale chunk mixing by filtering strictly on
   * (courseId, courseVersion) and discarding quarantined or mismatched chunks.
   */
  public async retrieve(input: RagQueryInput): Promise<RagRetrievalResponse> {
    if (!input.courseVersion || input.courseVersion < 1) {
      throw new AppError(
        "COURSE_VERSION_REQUIRED",
        400,
        "Governed RAG retrieval requires explicit courseVersion pinning to prevent stale chunk mixing",
      );
    }

    const allCourseChunks = await this.#repo.findChunksByCourse(input.courseId);

    let staleChunksRejected = 0;
    let quarantinedChunksRejected = 0;
    const eligibleChunks: KnowledgeChunk[] = [];

    for (const chunk of allCourseChunks) {
      // 1. Version Pinning Guard: Strictly reject chunks from other course versions
      if (chunk.courseVersion !== input.courseVersion) {
        staleChunksRejected++;
        continue;
      }

      // 2. Safety Quarantine Guard: Reject quarantined documents
      if (chunk.status === "QUARANTINED" || chunk.status === "SUPERSEDED") {
        quarantinedChunksRejected++;
        continue;
      }

      eligibleChunks.push(chunk);
    }

    // Score eligible chunks against query
    const queryTokens = input.query
      .toLowerCase()
      .split(/\s+/u)
      .filter((t) => t.length > 1);
    const scored: ScoredKnowledgeChunk[] = [];

    for (const chunk of eligibleChunks) {
      let score = 0;
      const textLower = chunk.text.toLowerCase();

      for (const qt of queryTokens) {
        if (textLower.includes(qt)) {
          score += 10;
        }
      }

      if (queryTokens.length === 0 || score > 0) {
        scored.push({ chunk, score: Math.max(1, score) });
      }
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    const topK = Math.min(input.topK ?? 5, 20);
    const topChunks = scored.slice(0, topK).map((s) => s.chunk);

    // Format prompt context
    const generatedPromptContext = topChunks
      .map((c, i) => `[CONTEXT-${String(i + 1)} | Version ${String(c.courseVersion)}]\n${c.text}`)
      .join("\n\n");

    return {
      courseId: input.courseId,
      pinnedCourseVersion: input.courseVersion,
      chunks: topChunks,
      totalRetrieved: topChunks.length,
      staleChunksRejected,
      quarantinedChunksRejected,
      generatedPromptContext,
    };
  }

  public async quarantineDocument(documentId: string): Promise<number> {
    return this.#repo.quarantineDocumentChunks(documentId);
  }
}
