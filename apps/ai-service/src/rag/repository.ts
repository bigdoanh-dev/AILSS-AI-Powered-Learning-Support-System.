import type { KnowledgeChunk } from "./model.js";

export interface RagKnowledgeRepository {
  saveChunk(chunk: KnowledgeChunk): Promise<void>;
  saveBatch(chunks: readonly KnowledgeChunk[]): Promise<void>;
  findChunksByCourse(courseId: string): Promise<readonly KnowledgeChunk[]>;
  quarantineDocumentChunks(documentId: string): Promise<number>;
}

export class InMemoryRagKnowledgeRepository implements RagKnowledgeRepository {
  readonly #chunks = new Map<string, KnowledgeChunk>();

  public saveChunk(chunk: KnowledgeChunk): Promise<void> {
    this.#chunks.set(chunk.chunkId, chunk);
    return Promise.resolve();
  }

  public saveBatch(chunks: readonly KnowledgeChunk[]): Promise<void> {
    for (const c of chunks) {
      this.#chunks.set(c.chunkId, c);
    }
    return Promise.resolve();
  }

  public findChunksByCourse(courseId: string): Promise<readonly KnowledgeChunk[]> {
    const results: KnowledgeChunk[] = [];
    for (const c of this.#chunks.values()) {
      if (c.courseId === courseId) {
        results.push(c);
      }
    }
    return Promise.resolve(results);
  }

  public quarantineDocumentChunks(documentId: string): Promise<number> {
    let count = 0;
    for (const [id, chunk] of this.#chunks.entries()) {
      if (chunk.documentId === documentId) {
        this.#chunks.set(id, {
          ...chunk,
          status: "QUARANTINED",
        });
        count++;
      }
    }
    return Promise.resolve(count);
  }
}
