# Phase 40 Revision G — Runtime Integration Progress

Date: 2026-09-22

## Honest status

`PHASE_40_STATUS = RUNTIME_INTEGRATION_INCOMPLETE`

`CONTROLLED_PRODUCT_PILOT_STATUS = REVOKED`

This increment completes the first required implementation slice: production-reachable Mastery V2 and Study Plan routes, durable Cassandra access, and removal of fixture data from the Study Plan UI. It does not claim that the full Revision G scope or any external staging acceptance has passed.

## Implemented in this increment

- Added authenticated Learning Service routes for learner mastery by current learner, course, and learning outcome.
- Added authenticated Study Plan routes for generation, current-plan read, and item accept, skip, reschedule, complete, and alternative actions.
- Added API Gateway forwarding with short-lived signed actor context. Learning Service enforces the `STUDENT` role and always uses the signed actor user ID; callers cannot supply another student ID.
- Added `AdaptiveRuntimeRepository` backed by Cassandra tables from migration 079.
- Added migration 083 for explicit mastery policy/update fields and Study Plan item lifecycle fields (`plan_id`, `course_id`, `completed_at`, `reason_code`, and `source_recommendation`).
- Registered migration 083 in both dev/research inventory and migration precheck policy. It remains `PENDING_DEPLOYMENT`.
- Connected the Web BFF allowlist and replaced all hard-coded Study Plan items, mastery gaps, upcoming assessment data, and the hard-coded recommended action in `StudyPlan.tsx`.
- UI now shows loading and explicit service/data errors; it does not synthesize a successful plan.
- Updated obsolete SAML tests that still expected `SAML_NOT_IMPLEMENTED`; legacy APIs now correctly redirect callers to the federation API/signed ACS route.
- Excluded evidence and generated runtime artifacts from RC content manifests, including nested `docs/evidence` paths.

## Verification

- Root TypeScript typecheck: PASS.
- Web TypeScript typecheck: PASS.
- Focused Phase 39 adaptive, federation-conformance, and RC-freeze tests: 20/20 PASS.
- Web session/BFF tests: 20/20 PASS.
- Migration source precheck: `PASS_SOURCE_POLICY`; target qualification remains `BLOCKED_EXTERNAL` because no target snapshot was supplied.
- Contract validation: PASS (101 public APIs, 15 internal APIs, 22 events).

## Not completed yet

- Mastery event ingestion from assessment submission/final grading/practice/lesson completion/instructor evidence.
- Worker retry, DLQ, trace, and recalculation acceptance.
- AI Tutor tool authorization and complete RAG failure-path acceptance.
- Teacher Copilot durable API/UI flow.
- Question Bank V2 durable API and real item analysis.
- Institution Onboarding durable workflow and real connection-test adapters.
- Local full-stack Student/Teacher/Admin/failure E2E.
- Application of migrations 081, 082, and 083 to an actual target.
- External SAML/LTI and Vault platform acceptance.

## Required status matrix

| Area                     | Current status                     |
| ------------------------ | ---------------------------------- |
| Adaptive Learning        | `PARTIALLY_CONNECTED`              |
| Mastery V2               | `PARTIALLY_CONNECTED`              |
| Study Plan               | `PARTIALLY_CONNECTED`              |
| AI Tutor                 | `PARTIALLY_CONNECTED`              |
| Teacher Copilot          | `PARTIALLY_CONNECTED`              |
| Question Bank V2         | `PARTIALLY_CONNECTED`              |
| Institution Onboarding   | `PARTIALLY_CONNECTED`              |
| Curriculum Intelligence  | `DEFERRED_UNSHIPPED`               |
| Fleet Operations         | `DEFERRED_UNSHIPPED`               |
| Advanced Experimentation | `DEFERRED_UNSHIPPED`               |
| Migration 081            | `NOT_EXECUTED_ON_TARGET`           |
| Migration 082            | `NOT_EXECUTED_ON_TARGET`           |
| Migration 083            | `NOT_EXECUTED_ON_TARGET`           |
| SAML external E2E        | `EXTERNAL_TARGET_REQUIRED`         |
| LTI external E2E         | `EXTERNAL_TARGET_REQUIRED`         |
| Vault target auth        | `CODE_READY_TARGET_NOT_CONFIGURED` |
| Full-stack E2E           | `NOT_EXECUTED`                     |
| Commercial payment       | `BLOCKED`                          |
