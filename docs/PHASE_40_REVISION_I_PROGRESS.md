# Phase 40 — Revision I progress report

Generated: 2026-09-22 (Asia/Ho_Chi_Minh)

## Executive status

Revision I is **not closed**. The migration bootstrap and the Assessment → RabbitMQ → Mastery → Study Plan durable path are locally verified, including real retry/DLQ/replay and duplicate delivery. The full browser golden path, practice producer, complete Study Plan adapters, and AI Tutor failure/browser acceptance remain open. External SAML/LTI/Vault/load acceptance remains pending and was not fabricated.

## Implemented in this pass

- Replaced the hand-maintained Cassandra bootstrap list with the canonical migration registry.
- Added a CI parity gate that checks declared total, inventory total, dev/research filenames, order, and SHA-256 hashes.
- Corrected registry metadata to 50 migrations and canonical keyspace names.
- Added canonical `mastery-evidence-event.schema.json`.
- Connected lesson completion evidence only after the real server-side completion write succeeds.
- Connected Assessment submitted/graded events to the Mastery consumer.
- Added durable event reservation, evidence storage, current projection/history update, Study Plan regeneration, retry state, and correlation ID propagation.
- Added Prometheus counters/histogram required by RI10.
- Provisioned three Mastery work queues, three retry stages per queue, and one DLQ per queue.
- Fixed missing RabbitMQ queue read permission and topic-level retry publish permission for `mq_learning`.
- Fixed a runtime LWT reservation defect (`Unmatched column names/values`) found by failure injection.
- Removed the deferred Fleet Operations route from active web routing.
- Classified core features as `SHIP_CORE` and deferred features as `DEFERRED_UNSHIPPED`.

## Runtime evidence

### Cassandra/bootstrap

- Registry/inventory/dev/research parity: 50/50/50/50, PASS.
- Existing local upgrade bootstrap: PASS with 50 migrations.
- Migration 084 tables: applied and writable locally.
- Bootstrap result: `cassandra-bootstrap PASS`, with existing data/backfills remaining readable.
- A disposable zero-data clean-volume bootstrap was not executed in this pass; RI27 is therefore only partially satisfied.

### RabbitMQ retry, DLQ, and recovery

Failure event: `79576542-f2d4-4d82-a2fc-69e5dc1cf474`
Correlation ID: `63cbe879-76a4-4e59-9d1b-6d14a4ac3847`

- The message traversed retry queues 1, 2, and 3.
- DLQ header recorded `x-ailss-retry-count=3`.
- DLQ reason recorded `MASTERY_RECALCULATION_FAILED`.
- DLQ routing key was `assessment.quiz.graded.mastery.dlq`.
- After deploying the SQL correction, the same DLQ message was replayed and processed.
- Ingestion state became `PROCESSED`; `last_error` was cleared.
- Exactly one authoritative evidence row exists for the event.
- Current mastery became score 75, state `PROFICIENT`, evidence count 1.
- Study Plan `79576542-f2d4-4d82-a2fc-69e5dc1cf474` was generated once.
- Re-delivering the identical event did not add evidence or regenerate the plan.

### Metrics

The rebuilt Learning Service exposes all requested metric families. Runtime samples include received=2, duplicate=1, success=1, and one processing-latency observation. Retry/DLQ metric families exist; the retry/DLQ proof itself is taken from RabbitMQ queue/header evidence because the service restart resets in-process Prometheus counters.

## Verification executed

- `pnpm typecheck`: PASS.
- `pnpm typecheck:web`: PASS.
- `pnpm validate:contracts`: PASS (101 public APIs, 22 events).
- `pnpm validate:migration-bootstrap`: PASS.
- Focused Mastery/Study Plan/Progress tests: 19/19 PASS.
- Lint on changed Revision-I files: PASS.
- Full repository lint: FAIL with 214 pre-existing issues across legacy/evaluation/deferred code; not hidden or relabeled.
- Rebuilt images: Learning, Assessment, AI, API Gateway: PASS.
- Recreated services and verified startup: PASS.
- `pnpm audit:dead-code`: command PASS, but still reports deferred/evaluation candidates and production mock/demo markers; remediation remains open.
- `pnpm audit:phase40-runtime`: command PASS, reported `RUNTIME_INTEGRATION_INCOMPLETE`.

## Required final status matrix

| Field | Status |
|---|---|
| PHASE_40_STATUS | `RUNTIME_INTEGRATION_INCOMPLETE` |
| ADAPTIVE_LEARNING_RUNTIME_STATUS | `PARTIALLY_LOCAL_VERIFIED` |
| MASTERY_RUNTIME_STATUS | `ASSESSMENT_EVENT_PATH_LOCAL_VERIFIED` |
| STUDY_PLAN_RUNTIME_STATUS | `REGENERATION_LOCAL_VERIFIED_ADAPTERS_INCOMPLETE` |
| AI_TUTOR_RUNTIME_STATUS | `PARTIALLY_CONNECTED_FULL_E2E_NOT_RUN` |
| TEACHER_COPILOT_RUNTIME_STATUS | `DEFERRED_UNSHIPPED` |
| QUESTION_BANK_V2_RUNTIME_STATUS | `DEFERRED_UNSHIPPED` |
| INSTITUTION_ONBOARDING_RUNTIME_STATUS | `DEFERRED_UNSHIPPED` |
| CURRICULUM_INTELLIGENCE_RUNTIME_STATUS | `DEFERRED_UNSHIPPED` |
| FLEET_OPERATIONS_RUNTIME_STATUS | `DEFERRED_UNSHIPPED_ROUTE_REMOVED` |
| MIGRATION_084_LOCAL_STATUS | `APPLIED_LOCAL_VERIFIED` |
| MIGRATION_BOOTSTRAP_PARITY_STATUS | `PASS_CI_ENFORCED` |
| MASTERY_EVENT_INGESTION_STATUS | `ASSESSMENT_AND_LESSON_CONNECTED_PRACTICE_OPEN` |
| MASTERY_RETRY_DLQ_STATUS | `LOCAL_RUNTIME_VERIFIED_3_RETRIES_DLQ_REPLAY` |
| STUDY_PLAN_FEEDBACK_LOOP_STATUS | `EVENT_TO_REGENERATION_VERIFIED_LEARNER_ACTION_LOOP_OPEN` |
| AI_TUTOR_TOOL_AUTH_STATUS | `CODE_CONNECTED_ACCEPTANCE_INCOMPLETE` |
| FULL_STACK_STUDENT_E2E_STATUS | `NOT_COMPLETED` |
| FAILURE_E2E_STATUS | `MASTERY_RETRY_DLQ_VERIFIED_OTHER_FAILURES_OPEN` |
| RUNTIME_AUDIT_STATUS | `RUNTIME_INTEGRATION_INCOMPLETE` |
| DEAD_CODE_AUDIT_STATUS | `EXECUTED_FINDINGS_REMAIN` |
| SAML_EXTERNAL_E2E_STATUS | `EXTERNAL_TARGET_REQUIRED` |
| LTI_EXTERNAL_E2E_STATUS | `EXTERNAL_TARGET_REQUIRED` |
| VAULT_TARGET_AUTH_STATUS | `CODE_READY_TARGET_NOT_CONFIGURED` |
| STAGING_LOAD_STATUS | `NOT_RUN_NO_AUTHORIZED_TARGET` |
| CONTROLLED_PRODUCT_PILOT_STATUS | `REVOKED` |
| COMMERCIAL_PAYMENT_STATUS | `PILOT_BLOCKED` |

## Remaining blockers before Revision I closure

1. Connect a real practice completion producer or remove practice-derived active recommendations.
2. Finish authoritative course requirement/deadline/assessment-schedule adapters and prove the complete learner feedback loop.
3. Execute AI Tutor authorization, RAG failure, citation binding, and browser acceptance against the rebuilt stack.
4. Run the disposable clean-volume Cassandra bootstrap.
5. Run the full HTTP/browser student golden path and degraded paths.
6. Resolve or formally classify the remaining dead-code/mock/demo findings and repository lint baseline.
