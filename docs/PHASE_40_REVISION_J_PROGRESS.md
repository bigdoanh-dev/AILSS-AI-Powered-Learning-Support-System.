# Phase 40 — Revision J closure report

Generated: 2026-09-23 (Asia/Ho_Chi_Minh)

## Decision

`PHASE_40_STATUS = RUNTIME_INTEGRATION_INCOMPLETE`

Revision J materially closes clean bootstrap, practice scope, lint governance, and the real AI Tutor Mastery/Study Plan boundary. It does not yet satisfy the full browser feedback loop, authoritative Study Plan schedule adapters, or RAG failure/citation acceptance. Phase 41 remains unopened.

## Completed

### Practice evidence scope

- Selected `REMOVE_PRACTICE_FROM_ACTIVE_PHASE40_RUNTIME`.
- Removed `PRACTICE` and `PRACTICE_ATTEMPT` from the accepted runtime evidence schema/consumer.
- Replaced generated `PRACTICE_QUESTIONS` plan actions with authoritative course-material review actions.
- Recorded practice, instructor observation, and AI conversation evidence as `DEFERRED_EVIDENCE_SOURCE` values.
- Disabled active `TEACHER_PRIORITY` generation; no Phase 40 generator emits that reason.

### Study Plan provenance

Generated items now carry runtime provenance where applicable: `reasonCode`, `sourceType`, `sourceId`, `courseId`, `learningOutcomeId`, `masteryPolicyVersion`, and `generatedAt`. Assessment items retain the assessment ID and due date supplied to the generator. The runtime still lacks a production adapter that supplies the Assessment schedule and real course requirement graph, so RJ3–RJ5 remain open.

### AI Tutor boundary and authorization

- Added explicit metadata for the four core tools: role, tenant scope, course scope, input/output schema, and timeout behavior.
- Added service-token-protected Learning endpoints for persisted Mastery and Study Plan.
- AI Service now calls those HTTP endpoints; it does not import Mastery calculation code.
- Removed synthetic empty Mastery/Study Plan fallbacks. Missing adapter now fails closed.
- The student ID comes only from the authenticated actor, never tool arguments.
- Learning checks active course entitlement before returning Mastery or Study Plan.
- Runtime probe: entitled course returned an authoritative Mastery array; unauthorized course returned `ADAPTIVE_TOOL_FORBIDDEN`.
- Added intent dispatch for “mastery” and “study plan” prompts.
- Disabled `LECTURER_COPILOT` in the role matrix because Teacher Copilot is deferred.

RAG material retrieval is not closed: the configured `/internal/v1/courses/:courseId/materials/search` producer is not implemented in Learning, and the client currently converts that failure to an empty result. Citation mismatch injection/browser acceptance therefore remains open.

### Clean Cassandra bootstrap

- Added an isolated disposable-container harness.
- Created a new empty Docker volume with no application schema.
- Applied registry migrations 001 through 084 in canonical order with SHA-256 validation.
- Verified all 50 migrations, eight canonical keyspaces, schema agreement, and required Mastery/Study Plan tables.
- Deleted the exact disposable container and volume afterward.
- Result: `MIGRATION_CLEAN_BOOTSTRAP_STATUS = VERIFIED_EMPTY_VOLUME_50_MIGRATIONS`.

### Lint governance

- Added machine-readable `lint-baseline.json` scoped to production source (`apps`, `packages`).
- Baseline records commit, file, rule, severity, line, and column.
- Frozen baseline: 82 production-source issues.
- Added `lint:no-regression`; current result: 82 baseline / 82 current / 0 new, PASS.
- CI now runs the no-regression gate instead of an always-failing all-repository lint command.
- Revision J changed files lint clean individually.

### Dead-code/mock governance

Core classification:

- `PRODUCTION_CONNECTED`: Mastery consumer/repository, Study Plan runtime/repository, AI Tutor orchestrator/tool runner/domain client.
- `DEFERRED`: Teacher Copilot, Question Bank V2, Institution Onboarding V2, Curriculum Intelligence, Fleet Operations, experimentation services.
- `EVALUATION_ONLY`: AI Tutor evaluation V1/V2/V3 and mastery calibration datasets.
- `FRAMEWORK_DISCOVERED`: Expo Router pages and executable verification scripts reported as entrypoints.
- `REMOVE/REMEDIATE`: production-reachable mock/demo/fallback findings outside the selected core remain debt; notably several admin/mobile/lecturer screens. They are not reclassified as clean.

## Verification

- Empty-volume Cassandra bootstrap: PASS, 50 migrations.
- Migration parity gate: PASS, 50/50/50/50.
- Contract validation: PASS, 101 public APIs, 15 internal APIs, 22 events.
- TypeScript typecheck: PASS.
- Lint no-regression: PASS, zero new production-source findings.
- AI authorization/orchestrator tests: 14/14 PASS.
- Adaptive/AI focused tests from this closure chain: PASS.
- Rebuilt Learning and AI images: PASS; both services restarted successfully.
- Runtime audit command: PASS, result remains `RUNTIME_INTEGRATION_INCOMPLETE`.
- Dead-code audit command: PASS with open findings; it is not interpreted as “no dead code”.

## Required final statuses

| Field | Status |
|---|---|
| PHASE_40_STATUS | `RUNTIME_INTEGRATION_INCOMPLETE` |
| ADAPTIVE_LEARNING_RUNTIME_STATUS | `PARTIALLY_LOCAL_VERIFIED` |
| MASTERY_RUNTIME_STATUS | `ASSESSMENT_AND_LESSON_LOCAL_VERIFIED` |
| STUDY_PLAN_RUNTIME_STATUS | `PERSISTED_REGENERATION_VERIFIED_AUTHORITATIVE_ADAPTERS_INCOMPLETE` |
| AI_TUTOR_RUNTIME_STATUS | `MASTERY_STUDY_PLAN_HTTP_BOUNDARY_VERIFIED_RAG_ACCEPTANCE_OPEN` |
| PRACTICE_EVIDENCE_STATUS | `DEFERRED_EVIDENCE_SOURCE_REMOVED_FROM_ACTIVE_RUNTIME` |
| MASTERY_RETRY_DLQ_STATUS | `VERIFIED_LOCAL_RUNTIME_3_RETRIES_DLQ_REPLAY` |
| STUDY_PLAN_FEEDBACK_LOOP_STATUS | `EVENT_TO_REGENERATION_VERIFIED_BROWSER_LOOP_OPEN` |
| AI_TUTOR_TOOL_AUTH_STATUS | `CORE_BOUNDARY_FAIL_CLOSED_LOCALLY_VERIFIED` |
| AI_TUTOR_RAG_FAILURE_STATUS | `NOT_COMPLETE` |
| MIGRATION_CLEAN_BOOTSTRAP_STATUS | `VERIFIED_EMPTY_VOLUME_50_MIGRATIONS` |
| FULL_STACK_STUDENT_E2E_STATUS | `NOT_COMPLETE` |
| FULL_STACK_FAILURE_E2E_STATUS | `MASTERY_QUEUE_PATH_VERIFIED_UI_DEGRADED_PATHS_OPEN` |
| RUNTIME_AUDIT_STATUS | `RUNTIME_INTEGRATION_INCOMPLETE` |
| DEAD_CODE_AUDIT_STATUS | `EXECUTED_CLASSIFIED_CORE_FINDINGS_REMAIN_OUTSIDE_CORE` |
| LINT_BASELINE_STATUS | `PASS_82_BASELINE_0_NEW` |
| SAML_EXTERNAL_E2E_STATUS | `EXTERNAL_TARGET_REQUIRED` |
| LTI_EXTERNAL_E2E_STATUS | `EXTERNAL_TARGET_REQUIRED` |
| VAULT_TARGET_AUTH_STATUS | `CODE_READY_TARGET_NOT_CONFIGURED` |
| STAGING_LOAD_STATUS | `NOT_RUN_NO_AUTHORIZED_TARGET` |
| CONTROLLED_PRODUCT_PILOT_STATUS | `REVOKED` |
| COMMERCIAL_PAYMENT_STATUS | `PILOT_BLOCKED` |

## Remaining closure gates

1. Connect authoritative course requirements and Assessment schedule/deadline adapters to Study Plan.
2. Implement the real entitled course-material/RAG retrieval boundary and truthful timeout/empty/low-confidence behavior.
3. Add citation binding rejection and mismatch injection acceptance.
4. Run the complete browser golden path and Learning/AI/Rabbit consumer degraded UI paths without direct service shortcuts.
5. Re-run runtime audit only after those paths have executable evidence.
