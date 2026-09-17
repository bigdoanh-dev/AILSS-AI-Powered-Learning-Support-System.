import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type {
  SearchDocument,
  SearchQueryInput,
  SearchResponse,
  SearchResultItem,
} from "./model.js";
import type { SearchIndexRepository } from "./repository.js";

export interface SearchAuthorizationContext {
  readonly actor: ActorContext;
  readonly accessibleTenantIds?: readonly string[];
  readonly enrolledCourseIds?: readonly string[];
  readonly taughtCourseIds?: readonly string[];
}

export class MultiTenantSearchService {
  readonly #repo: SearchIndexRepository;

  public constructor(repo: SearchIndexRepository) {
    this.#repo = repo;
  }

  public async index(doc: SearchDocument, actor: ActorContext): Promise<void> {
    const isPlatformAdmin = actor.roles.includes("PLATFORM_ADMIN");
    const isStaff = actor.roles.includes("ADMIN") || actor.roles.includes("LECTURER") || actor.roles.includes("INSTITUTION_ADMIN");

    if (!isPlatformAdmin && !isStaff) {
      throw new AppError("FORBIDDEN", 403, "Only authorized staff or administrators can index documents");
    }

    await this.#repo.index(doc);
  }

  public async delete(id: string, actor: ActorContext): Promise<void> {
    const doc = await this.#repo.findDocument(id);
    if (!doc) return;

    const isPlatformAdmin = actor.roles.includes("PLATFORM_ADMIN");
    const isStaff = actor.roles.includes("ADMIN") || actor.roles.includes("INSTITUTION_ADMIN");

    if (!isPlatformAdmin && !isStaff) {
      throw new AppError("FORBIDDEN", 403, "Only administrators can remove indexed documents");
    }

    await this.#repo.delete(id);
  }

  /**
   * Performs multi-tenant search with strict retrieval boundary filtering:
   * Cross-tenant leaks are mathematically impossible because documents outside
   * the actor's authorized tenancy/enrollment scope are pruned before response.
   */
  public async search(
    query: SearchQueryInput,
    authContext: SearchAuthorizationContext,
  ): Promise<SearchResponse> {
    const { actor, accessibleTenantIds = [], enrolledCourseIds = [], taughtCourseIds = [] } = authContext;
    const isPlatformAdmin = actor.roles.includes("PLATFORM_ADMIN");

    // Guard: Explicit tenant query check
    if (query.organizationId && !isPlatformAdmin) {
      const hasTenantAccess = accessibleTenantIds.includes(query.organizationId);
      if (!hasTenantAccess) {
        throw new AppError(
          "TENANT_ACCESS_DENIED",
          403,
          `Actor does not have authorization to search within tenant ${query.organizationId}`,
        );
      }
    }

    const rawHits = await this.#repo.search(query);

    // Apply strict retrieval boundary authorization filter
    const authorizedItems: SearchResultItem[] = [];

    for (const hit of rawHits) {
      const doc = hit.document;

      if (this.#canAccessDocument(doc, actor, isPlatformAdmin, accessibleTenantIds, enrolledCourseIds, taughtCourseIds)) {
        authorizedItems.push({
          id: doc.id,
          entityType: doc.entityType,
          organizationId: doc.organizationId,
          title: doc.title,
          snippet: hit.snippet,
          score: hit.score,
          visibility: doc.visibility,
          ...(doc.courseId !== undefined ? { courseId: doc.courseId } : {}),
          ...(doc.metadata !== undefined ? { metadata: doc.metadata } : {}),
        });
      }
    }

    // Pagination
    const offset = query.offset ?? 0;
    const limit = Math.min(query.limit ?? 20, 100);
    const paginated = authorizedItems.slice(offset, offset + limit);

    return {
      results: paginated,
      total: authorizedItems.length,
      offset,
      limit,
    };
  }

  #canAccessDocument(
    doc: SearchDocument,
    actor: ActorContext,
    isPlatformAdmin: boolean,
    accessibleTenantIds: readonly string[],
    enrolledCourseIds: readonly string[],
    taughtCourseIds: readonly string[],
  ): boolean {
    // 1. Platform Admin has universal clearance
    if (isPlatformAdmin) return true;

    // 2. Public visibility is visible across tenants
    if (doc.visibility === "PUBLIC") return true;

    // 3. Institutional visibility requires membership in that tenant or descendant
    const hasTenantMembership = accessibleTenantIds.includes(doc.organizationId);
    if (doc.visibility === "INSTITUTIONAL") {
      return hasTenantMembership;
    }

    // 4. Restricted visibility (course-internal content) requires enrollment, teaching, or tenant admin
    if (!hasTenantMembership) return false;

    const isInstitutionAdmin = actor.roles.includes("ADMIN") || actor.roles.includes("INSTITUTION_ADMIN");
    if (isInstitutionAdmin) return true;

    if (doc.courseId) {
      if (enrolledCourseIds.includes(doc.courseId)) return true;
      if (taughtCourseIds.includes(doc.courseId)) return true;
    }
    return false;
  }
}
