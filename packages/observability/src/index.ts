import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export function createMetrics(service: string) {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  return {
    registry,
    httpRequests: new Counter({
      name: "ailss_http_requests_total",
      help: "HTTP requests",
      labelNames: ["route", "method", "status"],
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: "ailss_http_duration_seconds",
      help: "HTTP duration",
      labelNames: ["route", "method"],
      registers: [registry],
    }),
    dependencyErrors: new Counter({
      name: "ailss_dependency_errors_total",
      help: "Dependency errors",
      labelNames: ["dependency", "code"],
      registers: [registry],
    }),
    publishConfirms: new Counter({
      name: "ailss_rabbit_publish_confirms_total",
      help: "Publisher confirms",
      labelNames: ["result"],
      registers: [registry],
    }),
    outboxReadyAge: new Gauge({
      name: "ailss_outbox_ready_age_seconds",
      help: "Oldest READY outbox age",
      registers: [registry],
    }),
    masteryEventsReceived: new Counter({
      name: "mastery_events_received_total",
      help: "Authoritative mastery evidence events received",
      labelNames: ["source"],
      registers: [registry],
    }),
    masteryEventsDuplicate: new Counter({
      name: "mastery_events_duplicate_total",
      help: "Duplicate mastery evidence deliveries",
      labelNames: ["source"],
      registers: [registry],
    }),
    masteryRecalculationSuccess: new Counter({
      name: "mastery_recalculation_success_total",
      help: "Successful mastery recalculations",
      labelNames: ["source"],
      registers: [registry],
    }),
    masteryRecalculationFailure: new Counter({
      name: "mastery_recalculation_failure_total",
      help: "Failed mastery recalculations",
      labelNames: ["source"],
      registers: [registry],
    }),
    masteryRetries: new Counter({
      name: "mastery_retry_total",
      help: "Mastery event retries requested",
      labelNames: ["source"],
      registers: [registry],
    }),
    masteryDlq: new Counter({
      name: "mastery_dlq_total",
      help: "Mastery events rejected for dead-letter routing",
      labelNames: ["reason"],
      registers: [registry],
    }),
    masteryProcessingLatency: new Histogram({
      name: "mastery_processing_latency_seconds",
      help: "Mastery evidence processing latency",
      labelNames: ["source"],
      registers: [registry],
    }),
    aiGenerations: new Counter({
      name: "ailss_ai_generation_total",
      help: "AI generation terminal outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    aiProviderCalls: new Counter({
      name: "ailss_ai_provider_calls_total",
      help: "AI provider call outcomes",
      labelNames: ["outcome", "code"],
      registers: [registry],
    }),
    aiGenerationRetries: new Counter({
      name: "ailss_ai_generation_retry_total",
      help: "Bounded AI provider retries",
      labelNames: ["reason"],
      registers: [registry],
    }),
    aiCircuitRejections: new Counter({
      name: "ailss_ai_circuit_rejections_total",
      help: "AI provider calls rejected by an open circuit",
      registers: [registry],
    }),
    aiGenerationDuration: new Histogram({
      name: "ailss_ai_generation_duration_seconds",
      help: "AI provider generation duration including bounded retries",
      registers: [registry],
    }),
    reconcileDrift: new Counter({
      name: "ailss_reconcile_drift_total",
      help: "Detected projection drift",
      labelNames: ["kind"],
      registers: [registry],
    }),
    identityRegistrations: new Counter({
      name: "ailss_identity_registrations_total",
      help: "Identity registration outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityRegistrationDuration: new Histogram({
      name: "ailss_identity_registration_duration_seconds",
      help: "Identity registration duration",
      registers: [registry],
    }),
    identityIdempotencyReplays: new Counter({
      name: "ailss_identity_idempotency_replays_total",
      help: "Identity registration idempotency replays",
      registers: [registry],
    }),
    identityLogins: new Counter({
      name: "ailss_identity_logins_total",
      help: "Identity login outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityLoginDuration: new Histogram({
      name: "ailss_identity_login_duration_seconds",
      help: "Identity login duration",
      registers: [registry],
    }),
    identityPasswordVerificationDuration: new Histogram({
      name: "ailss_identity_password_verification_duration_seconds",
      help: "Identity password verification duration",
      registers: [registry],
    }),
    identityLoginCompensations: new Counter({
      name: "ailss_identity_login_compensations_total",
      help: "New login sessions revoked before response",
      labelNames: ["reason"],
      registers: [registry],
    }),
    identityRefreshes: new Counter({
      name: "ailss_identity_refreshes_total",
      help: "Identity refresh rotation outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityRefreshDuration: new Histogram({
      name: "ailss_identity_refresh_duration_seconds",
      help: "Identity refresh rotation duration",
      registers: [registry],
    }),
    identityRefreshCompensations: new Counter({
      name: "ailss_identity_refresh_compensations_total",
      help: "Refresh session-family revocations",
      labelNames: ["reason"],
      registers: [registry],
    }),
    identityLogouts: new Counter({
      name: "ailss_identity_logouts_total",
      help: "Current-session logout outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityLogoutDuration: new Histogram({
      name: "ailss_identity_logout_duration_seconds",
      help: "Current-session logout duration",
      registers: [registry],
    }),
    identityProtectedRequests: new Counter({
      name: "ailss_identity_protected_requests_total",
      help: "Identity owner protected-request validation outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityProfileReads: new Counter({
      name: "ailss_identity_profile_reads_total",
      help: "Current-user profile read outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityProfileUpdates: new Counter({
      name: "ailss_identity_profile_updates_total",
      help: "Current-user profile update outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityProfileDuration: new Histogram({
      name: "ailss_identity_profile_duration_seconds",
      help: "Current-user profile operation duration",
      labelNames: ["operation"],
      registers: [registry],
    }),
    identityPasswordChanges: new Counter({
      name: "ailss_identity_password_changes_total",
      help: "Password-change and recovery outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityPasswordChangeDuration: new Histogram({
      name: "ailss_identity_password_change_duration_seconds",
      help: "Password-change operation duration",
      registers: [registry],
    }),
    identityPublicProfiles: new Counter({
      name: "ailss_identity_public_profiles_total",
      help: "Public-safe lecturer profile read outcomes",
      labelNames: ["channel", "outcome"],
      registers: [registry],
    }),
    identityPublicProfileDuration: new Histogram({
      name: "ailss_identity_public_profile_duration_seconds",
      help: "Public-safe lecturer profile read duration",
      labelNames: ["channel"],
      registers: [registry],
    }),
    identityProjectionSync: new Counter({
      name: "ailss_identity_lecturer_projection_sync_total",
      help: "Verified lecturer projection synchronization outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityProjectionDrift: new Counter({
      name: "ailss_identity_lecturer_projection_drift_total",
      help: "Public lecturer projection version/integrity drift",
      labelNames: ["kind"],
      registers: [registry],
    }),
    internalPublicProfiles: new Counter({
      name: "ailss_internal_public_profiles_total",
      help: "INT-IDN-01 service-auth and lookup outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityAdminAuthorization: new Counter({
      name: "ailss_identity_admin_authorization_total",
      help: "Admin trust-boundary outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityAdminReads: new Counter({
      name: "ailss_identity_admin_reads_total",
      help: "Admin search and detail outcomes",
      labelNames: ["operation", "outcome"],
      registers: [registry],
    }),
    identityAdminStatusChanges: new Counter({
      name: "ailss_identity_admin_status_changes_total",
      help: "Admin account status transition outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityLecturerVerifications: new Counter({
      name: "ailss_identity_lecturer_verifications_total",
      help: "Admin lecturer verification outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    identityAdminProjectionMoves: new Counter({
      name: "ailss_identity_admin_projection_moves_total",
      help: "Q-IDN-005 status projection move outcomes",
      labelNames: ["stage", "outcome"],
      registers: [registry],
    }),
    identityAdminDuration: new Histogram({
      name: "ailss_identity_admin_duration_seconds",
      help: "Identity Admin operation duration",
      labelNames: ["operation"],
      registers: [registry],
    }),
    learningCatalogRequests: new Counter({
      name: "learning_catalog_requests_total",
      help: "LRN-01 public course catalog outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    learningSearchRequests: new Counter({
      name: "learning_search_requests_total",
      help: "LRN-02 limited prefix search outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    learningCourseDetail: new Counter({
      name: "learning_course_detail_total",
      help: "LRN-03 course detail outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    learningSlugLookup: new Counter({
      name: "learning_course_slug_lookup_total",
      help: "LRN-04 slug lookup outcomes",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    learningProjectionStale: new Counter({
      name: "learning_projection_stale_total",
      help: "Stale-lower Learning projection candidates skipped",
      labelNames: ["projection"],
      registers: [registry],
    }),
    learningProjectionAhead: new Counter({
      name: "learning_projection_ahead_total",
      help: "Ahead-of-canonical Learning projection candidates flagged",
      labelNames: ["projection"],
      registers: [registry],
    }),
    learningCandidateFiltered: new Counter({
      name: "learning_catalog_candidate_filtered_total",
      help: "Published candidates filtered by canonical visibility/predicate",
      labelNames: ["operation", "reason"],
      registers: [registry],
    }),
    learningCatalogLatency: new Histogram({
      name: "learning_catalog_latency_seconds",
      help: "Learning public read duration",
      labelNames: ["operation"],
      registers: [registry],
    }),
    learningCourseAuthoring: new Counter({
      name: "learning_course_authoring_total",
      help: "LRN-05/LRN-06 authoring outcomes",
      labelNames: ["operation", "outcome"],
      registers: [registry],
    }),
    learningCourseAuthoringLatency: new Histogram({
      name: "learning_course_authoring_latency_seconds",
      help: "Learning course authoring command duration",
      labelNames: ["operation"],
      registers: [registry],
    }),
    assessmentQuizOperations: new Counter({
      name: "ailss_assessment_quiz_operations_total",
      help: "ASM-01..05 quiz operation outcomes",
      labelNames: ["operation", "outcome"],
      registers: [registry],
    }),
    assessmentQuizLatency: new Histogram({
      name: "ailss_assessment_quiz_latency_seconds",
      help: "ASM-01..05 quiz operation duration",
      labelNames: ["operation"],
      registers: [registry],
    }),
  } as const;
}

export * from "./finops.js";
export * from "./slo-engine.js";
