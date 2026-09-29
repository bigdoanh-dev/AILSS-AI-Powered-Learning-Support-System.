# Phase 40 Revision H — Implementation Progress

Date: 2026-09-22

## Current classification

`PHASE_40_STATUS = RUNTIME_INTEGRATION_INCOMPLETE`

`CONTROLLED_PRODUCT_PILOT_STATUS = REVOKED`

This revision increment implements the Assessment-to-Mastery write path and closes the first durable Study Plan feedback path. It does not claim that all authoritative event sources or full-stack E2E are complete.

## Implemented

- Assessment submission and final manual grade outbox events now carry mastery evidence fields: authoritative event ID, platform tenant, student, course, outcome, source type/source ID, occurrence time, score and schema version.
- Added dedicated RabbitMQ queues for submitted and graded mastery consumers, with three bounded retries and DLQ routing.
- Added durable Cassandra ingestion identity and evidence tables through migration 084.
- Added LWT event reservation. Duplicate delivery returns `DONE` after processing; interrupted processing is recoverable from durable evidence and ingestion state.
- Recalculation now uses `LearnerMasteryServiceV2`, persists current projection and history, and stores policy ID/version.
- Successful recalculation regenerates the learner's Study Plan from the durable current mastery projection. The event ID is the deterministic plan ID, and plan item IDs are deterministic, making retry safe.
- Study Plan runtime states now include `PROPOSED` and `REPLACED`; invalid transitions are rejected by the repository/service boundary.
- Corrected the local Cassandra bootstrap, which previously stopped at migration 076 while reporting PASS. It now includes all 50 registered migrations.
- Corrected migration 077 from nonexistent `audit_keyspace` to canonical `audit_support_keyspace`.
- Made migration 083 idempotent with `ADD IF NOT EXISTS`.

## Local migration evidence

- Cassandra local container: healthy.
- Bootstrap after correction: PASS, 47 migrations at first corrected run; the three previously omitted migrations were then added to the bootstrap list, making all 50 source migrations represented.
- Migration 083 and 084 were each executed twice against the local Cassandra instance without error.
- Schema agreement: one schema version across the local cluster.
- Verified new tables `mastery_evidence_by_student_course` and `mastery_ingestion_by_event`.
- Verified migration 083 columns on mastery and Study Plan status tables.
- Real write/read/delete probe against `mastery_ingestion_by_event`: PASS.

| Migration | LOCAL                      | DEV                    | RESEARCH               | STAGING                | PRODUCTION             |
| --------- | -------------------------- | ---------------------- | ---------------------- | ---------------------- | ---------------------- |
| 081       | APPLIED_BY_LOCAL_BOOTSTRAP | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET |
| 082       | APPLIED_BY_LOCAL_BOOTSTRAP | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET |
| 083       | DEPLOYED_VERIFIED          | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET |
| 084       | DEPLOYED_VERIFIED          | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET | NOT_EXECUTED_ON_TARGET |

## Verification

- Root TypeScript typecheck: PASS.
- Assessment and Adaptive unit suites: 29/29 PASS.
- Migration source policy: PASS for 50 dev and 50 research files.
- Cassandra schema/write/read/idempotent migration checks: PASS locally.

## Remaining Revision H gaps

- Authoritative practice completion, lesson completion and approved instructor evidence producers are not connected yet.
- Full failure injection proving retry then DLQ has not been executed against the rebuilt service images.
- Course requirement, deadline, assessment schedule and teacher-priority adapters for Study Plan generation remain incomplete.
- AI Tutor authorized tool registry and real Mastery/Study Plan tools remain incomplete.
- Teacher Copilot, Question Bank V2 and Institution Onboarding are now explicitly `DEFERRED_UNSHIPPED`; their unconnected pilot routes were removed.
- Full-stack Student/Teacher/Admin/failure E2E has not passed.
- No external SAML, LTI, Vault, staging or load acceptance is claimed.
