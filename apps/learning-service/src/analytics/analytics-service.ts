import {
  type ProductAnalyticsEvent,
  productAnalyticsEventSchema,
  sanitizeAnalyticsPayload,
} from "../../../../packages/contracts/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";

export interface CatalogFunnelMetrics {
  readonly searched: number;
  readonly viewed: number;
  readonly checkoutStarted: number;
  readonly purchased: number;
  readonly searchToViewRate: number;
  readonly viewToCheckoutRate: number;
  readonly checkoutToPurchaseRate: number;
  readonly overallConversionRate: number;
}

export interface LearningFunnelMetrics {
  readonly enrolled: number;
  readonly courseStarted: number;
  readonly lessonCompleted: number;
  readonly assessmentCompleted: number;
  readonly completionRate: number;
}

export interface AssistantFunnelMetrics {
  readonly sessionsStarted: number;
  readonly toolsInvoked: number;
  readonly safetyBlocked: number;
  readonly citationsOpened: number;
  readonly toolAdoptionRate: number;
}

export interface ProductIntelligenceSummary {
  readonly catalogFunnel: CatalogFunnelMetrics;
  readonly learningFunnel: LearningFunnelMetrics;
  readonly assistantFunnel: AssistantFunnelMetrics;
  readonly activeUsersCount: number;
  readonly period: string;
}

export class ProductAnalyticsService {
  readonly #eventsStore: ProductAnalyticsEvent[] = [];

  /**
   * Ingests a validated analytics event with automated PII & secret stripping.
   */
  public ingestEvent(raw: unknown): Promise<{ success: boolean; eventId: string }> {
    const parseResult = productAnalyticsEventSchema.safeParse(raw);
    if (!parseResult.success) {
      return Promise.reject(
        new AppError(
          "INVALID_ANALYTICS_EVENT",
          422,
          `Analytics event schema validation failed: ${parseResult.error.message}`,
        ),
      );
    }

    const event = parseResult.data;
    const sanitized: ProductAnalyticsEvent = {
      ...event,
      payload: sanitizeAnalyticsPayload(event.payload),
    };

    this.#eventsStore.push(sanitized);
    return Promise.resolve({ success: true, eventId: event.eventId });
  }

  /**
   * Computes platform-wide funnel analytics (Admin only).
   */
  public getAdminIntelligence(actor: ActorContext, period = "30d"): Promise<ProductIntelligenceSummary> {
    if (!actor.roles.includes("ADMIN")) {
      return Promise.reject(
        new AppError("ADMIN_REQUIRED", 403, "Admin authorization required for platform intelligence"),
      );
    }

    return Promise.resolve(this.#calculateMetrics(this.#eventsStore, period));
  }

  /**
   * Computes lecturer-scoped course analytics (Lecturer or Admin).
   * Strict data isolation: only events matching lecturer's courseIds are processed.
   */
  public getLecturerIntelligence(
    actor: ActorContext,
    lecturerCourseIds: readonly string[],
    period = "30d",
  ): Promise<ProductIntelligenceSummary> {
    const isLecturer = actor.roles.includes("LECTURER");
    const isAdmin = actor.roles.includes("ADMIN");

    if (!isLecturer && !isAdmin) {
      return Promise.reject(new AppError("FORBIDDEN", 403, "Lecturer or Admin authorization required"));
    }

    const courseIdSet = new Set(lecturerCourseIds);
    const scopedEvents = this.#eventsStore.filter((e) => e.courseId && courseIdSet.has(e.courseId));

    return Promise.resolve(this.#calculateMetrics(scopedEvents, period));
  }

  #calculateMetrics(events: readonly ProductAnalyticsEvent[], period: string): ProductIntelligenceSummary {
    const counts = {
      course_searched: 0,
      course_viewed: 0,
      checkout_started: 0,
      checkout_completed: 0,
      course_started: 0,
      lesson_completed: 0,
      assessment_completed: 0,
      assistant_session_started: 0,
      assistant_tool_invoked: 0,
      assistant_safety_blocked: 0,
      assistant_citation_opened: 0,
    };

    const activeUserSet = new Set<string>();

    for (const e of events) {
      if (e.actorId) {
        activeUserSet.add(e.actorId);
      }
      if (e.eventName in counts) {
        counts[e.eventName as keyof typeof counts] += 1;
      }
    }

    // Catalog funnel
    const searched = counts.course_searched;
    const viewed = counts.course_viewed;
    const checkoutStarted = counts.checkout_started;
    const purchased = counts.checkout_completed;

    const catalogFunnel: CatalogFunnelMetrics = {
      searched,
      viewed,
      checkoutStarted,
      purchased,
      searchToViewRate: searched > 0 ? Number((viewed / searched).toFixed(4)) : 0,
      viewToCheckoutRate: viewed > 0 ? Number((checkoutStarted / viewed).toFixed(4)) : 0,
      checkoutToPurchaseRate: checkoutStarted > 0 ? Number((purchased / checkoutStarted).toFixed(4)) : 0,
      overallConversionRate: searched > 0 ? Number((purchased / searched).toFixed(4)) : 0,
    };

    // Learning funnel
    const enrolled = checkoutStarted; // Or direct enrollments
    const courseStarted = counts.course_started;
    const lessonCompleted = counts.lesson_completed;
    const assessmentCompleted = counts.assessment_completed;

    const learningFunnel: LearningFunnelMetrics = {
      enrolled,
      courseStarted,
      lessonCompleted,
      assessmentCompleted,
      completionRate: courseStarted > 0 ? Number((assessmentCompleted / courseStarted).toFixed(4)) : 0,
    };

    // Assistant funnel
    const sessions = counts.assistant_session_started;
    const tools = counts.assistant_tool_invoked;
    const safetyBlocked = counts.assistant_safety_blocked;
    const citations = counts.assistant_citation_opened;

    const assistantFunnel: AssistantFunnelMetrics = {
      sessionsStarted: sessions,
      toolsInvoked: tools,
      safetyBlocked,
      citationsOpened: citations,
      toolAdoptionRate: sessions > 0 ? Number((tools / sessions).toFixed(4)) : 0,
    };

    return {
      catalogFunnel,
      learningFunnel,
      assistantFunnel,
      activeUsersCount: activeUserSet.size,
      period,
    };
  }

  /**
   * Enterprise Analytics Export Projection for institutional reporting and auditing.
   * Enforces strict institutional boundary checks: institutions can only export their own projections.
   */
  public async exportEnterpriseProjection(input: {
    readonly organizationId: string;
    readonly format: "CSV" | "JSONL" | "JSON";
    readonly actor: ActorContext;
    readonly accessibleTenantIds?: readonly string[];
  }): Promise<{
    readonly organizationId: string;
    readonly format: "CSV" | "JSONL" | "JSON";
    readonly recordCount: number;
    readonly data: string;
    readonly generatedAt: string;
  }> {
    const isPlatformAdmin = input.actor.roles.includes("PLATFORM_ADMIN");
    const isInstAdmin =
      input.actor.roles.includes("ADMIN") || input.actor.roles.includes("INSTITUTION_ADMIN");

    if (!isPlatformAdmin && !isInstAdmin) {
      throw new AppError(
        "FORBIDDEN",
        403,
        "Administrator clearance required for enterprise analytics export",
      );
    }

    if (!isPlatformAdmin) {
      const allowed = input.accessibleTenantIds ?? [];
      if (!allowed.includes(input.organizationId)) {
        throw new AppError(
          "TENANT_ACCESS_DENIED",
          403,
          `Cannot export analytics projection for foreign organization ${input.organizationId}`,
        );
      }
    }

    // Filter events belonging to target organization
    const orgEvents = this.#eventsStore.filter((e) => {
      const eventOrgId = typeof e.payload.organizationId === "string" ? e.payload.organizationId : undefined;
      return eventOrgId === input.organizationId || !eventOrgId; // include unassigned or matched
    });

    // Project per-learner summary
    const learnerMap = new Map<
      string,
      {
        learnerId: string;
        courseId: string;
        organizationId: string;
        completedLessons: number;
        totalTimeSpentSeconds: number;
        lastActiveAt: string;
        status: "ACTIVE" | "COMPLETED" | "AT_RISK";
      }
    >();

    for (const e of orgEvents) {
      if (!e.actorId || !e.courseId) continue;
      const key = `${e.actorId}:${e.courseId}`;
      const existing = learnerMap.get(key) ?? {
        learnerId: e.actorId,
        courseId: e.courseId,
        organizationId: input.organizationId,
        completedLessons: 0,
        totalTimeSpentSeconds: 0,
        lastActiveAt: e.occurredAt,
        status: "ACTIVE",
      };

      if (e.eventName === "lesson_completed") {
        existing.completedLessons += 1;
      }
      if (typeof e.payload.durationSeconds === "number") {
        existing.totalTimeSpentSeconds += e.payload.durationSeconds;
      }
      if (e.occurredAt > existing.lastActiveAt) {
        existing.lastActiveAt = e.occurredAt;
      }

      if (existing.completedLessons >= 10) {
        existing.status = "COMPLETED";
      }

      learnerMap.set(key, existing);
    }

    const records = Array.from(learnerMap.values());
    const generatedAt = new Date().toISOString();

    let outputData = "";
    if (input.format === "CSV") {
      const header =
        "learnerId,courseId,organizationId,completedLessons,totalTimeSpentSeconds,lastActiveAt,status\n";
      const rows = records
        .map(
          (r) =>
            `${r.learnerId},${r.courseId},${r.organizationId},${String(r.completedLessons)},${String(r.totalTimeSpentSeconds)},${r.lastActiveAt},${r.status}`,
        )
        .join("\n");
      outputData = header + rows;
    } else if (input.format === "JSONL") {
      outputData = records.map((r) => JSON.stringify(r)).join("\n");
    } else {
      outputData = JSON.stringify(records, null, 2);
    }

    return Promise.resolve({
      organizationId: input.organizationId,
      format: input.format,
      recordCount: records.length,
      data: outputData,
      generatedAt,
    });
  }
}
