# Phase 40 Runtime Connectivity Recovery — Revision F

Generated: 2026-09-22

## Executive result

Revision F correctly revokes the previous `CONTROLLED_PRODUCT_PILOT_READY` classification. The repository now reports `RUNTIME_INTEGRATION_INCOMPLETE` and does not present zero-inbound Phase 39–40 services as shipped features.

This recovery pass completed the source/runtime audit, generated the required feature graph, classified high-confidence orphan modules, disabled false pilot classifications in generated evidence, and hardened the connected AI assistant path against fabricated fallback data. It does not claim external staging validation because no authorized staging endpoint, IdP, LTI platform, or Vault control plane is available in this workspace.

## Required status output

| Field                                  | Status                             | Evidence / reason                                                                                     |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| PHASE_40_STATUS                        | `RUNTIME_INTEGRATION_INCOMPLETE`   | External and zero-inbound acceptance gates remain open.                                               |
| RUNTIME_AUDIT_STATUS                   | `COMPLETE_FOR_CURRENT_SOURCE`      | Runtime graph generated under `artifacts/runtime-audit`.                                              |
| DEAD_CODE_AUDIT_STATUS                 | `COMPLETE_WITH_OWNER_DECISIONS`    | `pnpm audit:dead-code`; high-confidence Phase 39–40 modules classified CONNECT or DEFER.              |
| ADAPTIVE_LEARNING_RUNTIME_STATUS       | `DEFERRED_UNSHIPPED`               | V2 service has no production controller/repository path.                                              |
| STUDY_PLAN_RUNTIME_STATUS              | `DEFERRED_UNSHIPPED`               | Service is in-memory and has no production API importer.                                              |
| MASTERY_RUNTIME_STATUS                 | `DEFERRED_UNSHIPPED`               | V2 engine is reached only by calibration/evaluation modules.                                          |
| AI_TUTOR_RUNTIME_STATUS                | `PARTIALLY_CONNECTED`              | Gateway, API, orchestrator and durable conversation store exist; staging browser/RAG proof is absent. |
| TEACHER_COPILOT_RUNTIME_STATUS         | `DEFERRED_UNSHIPPED`               | Service is zero-inbound and Web UI contains local fixtures.                                           |
| QUESTION_BANK_V2_RUNTIME_STATUS        | `DEFERRED_UNSHIPPED`               | In-memory service has no production router or durable repository.                                     |
| CURRICULUM_INTELLIGENCE_RUNTIME_STATUS | `DEFERRED_UNSHIPPED`               | In-memory export history; no production API or audited durable export.                                |
| INSTITUTION_ONBOARDING_RUNTIME_STATUS  | `DEFERRED_UNSHIPPED`               | In-memory service and optimistic synthetic connection health.                                         |
| FLEET_OPERATIONS_RUNTIME_STATUS        | `DEFERRED_UNSHIPPED`               | No production router, durable audit store, or target adapter.                                         |
| SAML_EXTERNAL_E2E_STATUS               | `EXTERNAL_TARGET_REQUIRED`         | Local metadata/ACS runtime exists; no authorized real staging IdP supplied.                           |
| LTI_EXTERNAL_E2E_STATUS                | `EXTERNAL_TARGET_REQUIRED`         | Local OIDC/JWKS/launch runtime exists; no staging LMS registration supplied.                          |
| MIGRATION_081_STATUS                   | `LOCAL_APPLIED_READY`              | Local Cassandra backfill is `READY`; DEV/RESEARCH/STAGING/PRODUCTION are not asserted.                |
| MIGRATION_082_STATUS                   | `LOCAL_APPLIED`                    | Federation tables verified locally; other environments are not asserted.                              |
| STAGING_LOAD_STATUS                    | `NOT_RUN_NO_AUTHORIZED_TARGET`     | Local load evidence exists but is not staging capacity evidence.                                      |
| VAULT_TARGET_AUTH_STATUS               | `CODE_READY_TARGET_NOT_CONFIGURED` | Kubernetes/AppRole/renewal/fail-closed code exists; platform role binding is external.                |
| CONTROLLED_PRODUCT_PILOT_STATUS        | `REVOKED`                          | Candidate classification changed to `RUNTIME_INTEGRATION_INCOMPLETE`.                                 |
| COMMERCIAL_PAYMENT_STATUS              | `PILOT_BLOCKED_FAIL_CLOSED`        | No production payment activation was performed.                                                       |

## Changes made

### 1. Runtime feature graph and dead-code governance

- Added `scripts/ci/generate-phase40-runtime-feature-graph.mjs`.
- Added `pnpm audit:phase40-runtime`.
- Generated `artifacts/runtime-audit/phase40-runtime-feature-graph.json`.
- Recorded frontend route, component, API, gateway, controller, service, repository, worker, queue, table, migration, feature flag, inbound importers, entrypoint, owner, decision deadline, decision and runtime status.
- Framework-discovered Expo routes and executable scripts are not automatically classified as dead code.
- Evaluation harnesses are separated from production AI runtime.

### 2. False pilot classifications revoked

- `scripts/ci/rc-manifest-builder.mjs` now emits `RUNTIME_INTEGRATION_INCOMPLETE`.
- `scripts/ci/update-pilot-evidence.mjs` no longer labels unconnected Wave 2 services `PILOT_READY`.
- Deferred flags in generated pilot evidence are set to `OFF` with no allowed tenants.
- Generated Phase 40 evidence now distinguishes `PARTIALLY_CONNECTED` AI Tutor from `DEFERRED_UNSHIPPED` services.

### 3. AI Tutor runtime corrections

- Course recommendations now call the real `/api/v1/courses/search` endpoint instead of sending unsupported `q` and `level` fields to `/api/v1/courses`.
- Learning catalog DTOs are converted into the assistant's course model explicitly.
- Actual tool execution results are supplied to the LLM grounding context. Previously only tool names and arguments were included.
- Knowledge-gap and course-material failures now return empty authoritative results instead of plausible fabricated educational records.
- The system prompt explicitly requires an insufficient-evidence response when tools fail or return no data.

## High-confidence module decisions

| Module                         | Decision | Reason                                                                                  |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------- |
| AI Tutor evaluation V1/V2/V3   | DEFER    | Benchmark harness, not production runtime.                                              |
| TeacherCopilotService          | DEFER    | Zero inbound production import; UI is fixture-backed.                                   |
| StudyPlanService               | DEFER    | In-memory state and no router/repository.                                               |
| LearnerMasteryServiceV2        | DEFER    | Used only by calibration modules.                                                       |
| Mastery calibration V1/V2      | DEFER    | Evaluation datasets, not runtime.                                                       |
| QuestionBankV2Service          | DEFER    | In-memory and zero-inbound.                                                             |
| CurriculumIntelligenceService  | DEFER    | In-memory export audit and zero-inbound.                                                |
| InstitutionOnboardingV2Service | DEFER    | In-memory and returns optimistic connection results.                                    |
| FleetOperationsService         | DEFER    | In-memory templates/config and no API/audit persistence.                                |
| AI assistant/RAG orchestrator  | CONNECT  | Production route and durable conversation storage exist; external E2E remains required. |

## Validation performed

- `pnpm audit:dead-code`
- `pnpm audit:phase40-runtime`
- ESLint on changed runtime/audit files
- Root TypeScript typecheck
- Assistant orchestrator and active-assessment safety tests
- Phase 40 pilot-hardening, product-expansion and Wave 2 security suites

## External acceptance gates not fabricated

The following actions were intentionally not marked successful:

- Applying migrations to DEV, RESEARCH, STAGING or PRODUCTION.
- Running finance backfill against staging.
- Running k6 or browser E2E against staging.
- Capturing staging Prometheus/Grafana capacity evidence.
- Registering or authenticating against a real SAML IdP.
- Registering or launching from a real LTI platform.
- Creating Vault auth roles, policies or Kubernetes bindings on a target platform.
- Enabling commercial payment or payout.

These require explicit target URLs, credentials and deployment authority. Local evidence cannot satisfy these gates.

## Closure verdict

Phase 40 remains open. The repository is now honest about its runtime state, but it may close only after deferred features are either connected with durable stores and staging E2E evidence, or formally removed from product navigation and release scope. Phase 41 must not begin while these gates remain open.
