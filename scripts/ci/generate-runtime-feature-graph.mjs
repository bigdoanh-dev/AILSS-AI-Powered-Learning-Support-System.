import { mkdir, writeFile } from "node:fs/promises";

const generatedAt = new Date().toISOString();
const common = {
  frontendRoute: null, frontendComponent: null, APIEndpoint: null, gatewayRoute: null,
  controller: null, repository: null, worker: null, queue: null, databaseTable: null,
  migration: null, featureFlag: null, inboundImporters: [], productionEntrypoint: null,
  owner: "AILSS_PLATFORM_TEAM", decisionDeadline: "BEFORE_PHASE_41",
};

const features = [
  {
    ...common, featureName: "AI_RAG_RUNTIME", decision: "CONNECT",
    APIEndpoint: "/api/v1/assistant/chat; /internal/v1/courses/:courseId/materials/search", gatewayRoute: "apps/api-gateway/src/assistant-proxy.ts",
    controller: "apps/ai-service/src/assistant/router.ts", service: "apps/ai-service/src/assistant/orchestrator.ts",
    repository: "apps/ai-service/src/assistant/repository.ts", databaseTable: "assistant_conversation_by_id",
    migration: "064_ai_assistant.cql", inboundImporters: ["apps/ai-service/src/server.ts"],
    productionEntrypoint: "apps/ai-service/src/server.ts; apps/learning-service/src/server.ts", runtimeStatus: "END_TO_END_LOCAL_VERIFIED",
    evidence: "artifacts/release-evidence/revision-l/positive-runtime.json; artifacts/release-evidence/revision-l/browser/network-proof.json",
    reason: "Entitlement-scoped retrieval, provider grounding, citation allowlist, real BFF browser path and degraded AI behavior are locally verified; external staging remains pending.",
  },
  {
    ...common, featureName: "AI_TUTOR_EVALUATION", decision: "DEFER",
    service: "apps/ai-service/src/assistant/ai-tutor-eval-v1.ts; ai-tutor-eval-v2.ts; ai-tutor-eval-v3.ts",
    runtimeStatus: "DEFERRED_UNSHIPPED", reason: "Benchmark/evaluation harnesses are not production runtime services.",
  },
  {
    ...common, featureName: "TEACHER_COPILOT_RUNTIME", decision: "DEFER",
    frontendRoute: "/teaching/copilot", frontendComponent: "apps/web/src/lecturer/TeacherCopilot.tsx",
    service: "apps/ai-service/src/assistant/teacher-copilot-service.ts", featureFlag: "TEACHER_COPILOT",
    databaseTable: "copilot_drafts_by_teacher", migration: "079_adaptive_learning_v2_and_institution.cql",
    runtimeStatus: "DEFERRED_UNSHIPPED", reason: "Web component uses local fixtures and service has no production importer.",
  },
  {
    ...common, featureName: "ADAPTIVE_STUDY_PLAN", decision: "CONNECT",
    frontendRoute: "/app/study-plan", frontendComponent: "apps/web/src/student/StudyPlan.tsx",
    service: "apps/learning-service/src/adaptive/study-plan-service.ts", featureFlag: "STUDY_PLAN_V2",
    APIEndpoint: "/api/v1/study-plan/*; /internal/v1/students/:studentId/study-plan/:courseId",
    gatewayRoute: "apps/api-gateway/src/adaptive-learning-proxy.ts",
    controller: "apps/learning-service/src/adaptive/runtime-router.ts",
    repository: "apps/learning-service/src/adaptive/runtime-repository.ts",
    worker: "apps/learning-service/src/adaptive/mastery-consumer.ts",
    queue: "assessment.quiz.*.mastery.q; learning.lesson.completed.mastery.q",
    databaseTable: "study_plan_by_student_course", migration: "083_adaptive_runtime_completion.cql",
    inboundImporters: ["apps/learning-service/src/server.ts"], productionEntrypoint: "apps/learning-service/src/server.ts",
    runtimeStatus: "END_TO_END_LOCAL_VERIFIED", evidence: "artifacts/release-evidence/revision-l/positive-runtime.json; artifacts/release-evidence/revision-l/browser/study-plan-positive.png",
    reason: "Durable runtime, authoritative syllabus and Assessment schedule inputs, event feedback loop and real browser path are locally verified.",
  },
  {
    ...common, featureName: "MASTERY_V2", decision: "CONNECT",
    service: "apps/learning-service/src/mastery/mastery-service.ts", featureFlag: "ADAPTIVE_V2",
    APIEndpoint: "/api/v1/mastery/*; /internal/v1/students/:studentId/mastery/:courseId",
    gatewayRoute: "apps/api-gateway/src/adaptive-learning-proxy.ts", controller: "apps/learning-service/src/adaptive/runtime-router.ts",
    repository: "apps/learning-service/src/adaptive/mastery-ingestion-repository.ts",
    worker: "apps/learning-service/src/adaptive/mastery-consumer.ts", queue: "assessment.quiz.*.mastery.q; learning.lesson.completed.mastery.q",
    databaseTable: "mastery_evidence_by_student_course_outcome; mastery_projection_by_student_course",
    migration: "084_mastery_evidence_ingestion.cql", inboundImporters: ["apps/learning-service/src/server.ts"],
    productionEntrypoint: "apps/learning-service/src/server.ts", runtimeStatus: "END_TO_END_LOCAL_VERIFIED",
    evidence: "artifacts/release-evidence/revision-l/positive-runtime.json; artifacts/release-evidence/revision-l/browser/network-proof.json",
    reason: "Assessment and Lesson evidence, retry/DLQ/replay, durable idempotency, Study Plan regeneration and browser readback are locally verified.",
  },
  {
    ...common, featureName: "MASTERY_CALIBRATION", decision: "DEFER",
    service: "apps/learning-service/src/mastery/mastery-calibration-v1.ts; mastery-calibration-v2.ts",
    runtimeStatus: "DEFERRED_UNSHIPPED", reason: "Calibration datasets are evaluation assets, not runtime features.",
  },
  {
    ...common, featureName: "QUESTION_BANK_V2", decision: "DEFER",
    frontendRoute: "/teaching/question-bank", frontendComponent: "apps/web/src/lecturer/QuestionBankStudio.tsx",
    service: "apps/assessment-service/src/authoring/question-bank-v2-service.ts",
    migration: "080_wave2_course_authoring_and_experimentation.cql", runtimeStatus: "DEFERRED_UNSHIPPED",
    reason: "In-memory service has no production router/repository; browser component cannot prove persistence.",
  },
  {
    ...common, featureName: "CURRICULUM_INTELLIGENCE", decision: "DEFER",
    frontendRoute: "/teaching/curriculum", frontendComponent: "apps/web/src/lecturer/CurriculumIntelligence.tsx",
    service: "apps/learning-service/src/curriculum/curriculum-intelligence-service.ts",
    migration: "080_wave2_course_authoring_and_experimentation.cql", runtimeStatus: "DEFERRED_UNSHIPPED",
    reason: "Service keeps export history in process memory and has no production API importer.",
  },
  {
    ...common, featureName: "INSTITUTION_ONBOARDING_V2", decision: "DEFER",
    frontendRoute: "/admin/onboarding", frontendComponent: "apps/web/src/admin/InstitutionWizard.tsx",
    service: "apps/identity-service/src/tenant/institution-onboarding-v2-service.ts", featureFlag: "INSTITUTION_ADMIN_V2",
    runtimeStatus: "DEFERRED_UNSHIPPED", reason: "In-memory service is unconnected and connection tests return optimistic fabricated health.",
  },
  {
    ...common, featureName: "FLEET_OPERATIONS", decision: "DEFER",
    frontendRoute: "/admin/fleet-operations", frontendComponent: "apps/web/src/admin/FleetOperationsCenter.tsx",
    service: "apps/identity-service/src/tenant/fleet-operations-service.ts", featureFlag: "INSTITUTION_ADMIN_V2",
    runtimeStatus: "DEFERRED_UNSHIPPED", reason: "In-memory templates/config have no production router, durable audit store, or target adapter.",
  },
];

const output = {
  schemaVersion: 1, generatedAt, phase: "40-RF", sourceOfTruth: "production-call-graph",
  phase40Status: "CODEBASE_RUNTIME_INTEGRATION_COMPLETE_EXTERNAL_ACCEPTANCE_PENDING", allowedStatuses: [
    "UNCONNECTED", "PARTIALLY_CONNECTED", "END_TO_END_LOCAL_VERIFIED", "END_TO_END_STAGING_VERIFIED", "PILOT_READY", "DEFERRED_UNSHIPPED",
  ],
  features,
};

await mkdir("artifacts/runtime-audit", { recursive: true });
await writeFile("artifacts/runtime-audit/runtime-feature-graph.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ generatedAt, featureCount: features.length, phase40Status: output.phase40Status })}\n`);
