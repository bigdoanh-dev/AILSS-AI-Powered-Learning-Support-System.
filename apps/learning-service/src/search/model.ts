export type SearchEntityType = "COURSE" | "LESSON" | "RESOURCE" | "DISCUSSION";
export type SearchVisibility = "PUBLIC" | "INSTITUTIONAL" | "RESTRICTED";

export interface SearchDocument {
  readonly id: string;
  readonly entityType: SearchEntityType;
  readonly organizationId: string;
  readonly title: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly visibility: SearchVisibility;
  readonly courseId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SearchQueryInput {
  readonly query: string;
  readonly organizationId?: string;
  readonly entityTypes?: readonly SearchEntityType[];
  readonly tags?: readonly string[];
  readonly courseId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface SearchResultItem {
  readonly id: string;
  readonly entityType: SearchEntityType;
  readonly organizationId: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly visibility: SearchVisibility;
  readonly courseId?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface SearchResponse {
  readonly results: readonly SearchResultItem[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}
