export type ChunkStatus = "ACTIVE" | "SUPERSEDED" | "QUARANTINED";

export interface KnowledgeChunk {
  readonly chunkId: string;
  readonly courseId: string;
  readonly courseVersion: number;
  readonly documentId: string;
  readonly chunkIndex: number;
  readonly text: string;
  readonly tokens: readonly string[];
  readonly status: ChunkStatus;
  readonly createdAt: string;
}

export interface RagQueryInput {
  readonly courseId: string;
  readonly courseVersion: number; // Strictly pinned course version
  readonly query: string;
  readonly topK?: number;
  readonly minScore?: number;
}

export interface ScoredKnowledgeChunk {
  readonly chunk: KnowledgeChunk;
  readonly score: number;
}

export interface RagRetrievalResponse {
  readonly courseId: string;
  readonly pinnedCourseVersion: number;
  readonly chunks: readonly KnowledgeChunk[];
  readonly totalRetrieved: number;
  readonly staleChunksRejected: number;
  readonly quarantinedChunksRejected: number;
  readonly generatedPromptContext: string;
}
