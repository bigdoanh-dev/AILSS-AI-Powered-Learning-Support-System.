import type { SearchDocument, SearchQueryInput } from "./model.js";

export interface SearchIndexRepository {
  index(document: SearchDocument): Promise<void>;
  delete(id: string): Promise<void>;
  findDocument(id: string): Promise<SearchDocument | null>;
  search(
    query: SearchQueryInput,
  ): Promise<readonly { document: SearchDocument; score: number; snippet: string }[]>;
}

export class InMemorySearchIndexRepository implements SearchIndexRepository {
  readonly #docs = new Map<string, SearchDocument>();

  public index(document: SearchDocument): Promise<void> {
    this.#docs.set(document.id, document);
    return Promise.resolve();
  }

  public delete(id: string): Promise<void> {
    this.#docs.delete(id);
    return Promise.resolve();
  }

  public findDocument(id: string): Promise<SearchDocument | null> {
    return Promise.resolve(this.#docs.get(id) ?? null);
  }

  public search(
    query: SearchQueryInput,
  ): Promise<readonly { document: SearchDocument; score: number; snippet: string }[]> {
    const rawTokens = query.query
      .toLowerCase()
      .split(/\s+/u)
      .filter((t) => t.length > 1);
    const results: { document: SearchDocument; score: number; snippet: string }[] = [];

    for (const doc of this.#docs.values()) {
      // Filter by organization if specified in query
      if (query.organizationId && doc.organizationId !== query.organizationId) {
        continue;
      }
      // Filter by entity type if specified
      if (query.entityTypes && query.entityTypes.length > 0 && !query.entityTypes.includes(doc.entityType)) {
        continue;
      }
      // Filter by course if specified
      if (query.courseId && doc.courseId !== query.courseId) {
        continue;
      }
      // Filter by tags if specified
      if (query.tags && query.tags.length > 0) {
        const matchesTags = query.tags.some((t) => doc.tags.includes(t.toLowerCase()));
        if (!matchesTags) continue;
      }

      // Compute score
      let score = 0;
      const titleLower = doc.title.toLowerCase();
      const contentLower = doc.content.toLowerCase();

      for (const token of rawTokens) {
        if (titleLower.includes(token)) score += 10;
        if (contentLower.includes(token)) score += 2;
        if (doc.tags.some((tag) => tag.toLowerCase().includes(token))) score += 5;
      }

      if (rawTokens.length === 0 || score > 0) {
        // Generate snippet around first matched token
        let snippet = doc.content.slice(0, 160);
        if (rawTokens.length > 0 && rawTokens[0]) {
          const matchIdx = contentLower.indexOf(rawTokens[0]);
          if (matchIdx !== -1) {
            const start = Math.max(0, matchIdx - 40);
            const end = Math.min(doc.content.length, matchIdx + 120);
            snippet =
              (start > 0 ? "..." : "") +
              doc.content.slice(start, end) +
              (end < doc.content.length ? "..." : "");
          }
        }

        results.push({
          document: doc,
          score: Math.max(1, score),
          snippet,
        });
      }
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);
    return Promise.resolve(results);
  }
}
