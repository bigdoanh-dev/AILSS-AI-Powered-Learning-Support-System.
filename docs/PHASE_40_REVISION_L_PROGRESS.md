# Phase 40 — Revision L: runtime and browser closure progress

Date: 2026-09-23 (Asia/Ho_Chi_Minh). This is a working-tree report, **not** an RC5 release attestation.

## What changed

- Wired the Assessment → Learning runtime dependency in Compose, and restored the async Assessment publisher. A real submitted quiz event now reaches RabbitMQ, Mastery, and Study Plan.
- Configured AI provider egress/timeouts across AI Service, Gateway, Web BFF, and browser client. Replaced the selected student AI Tutor view's canned response with the real `/assistant/chat` path.
- Added authoritative course requirement and future assessment schedule inputs to Study Plan items, including source versions and due dates.
- Added private text-object identity and retrieval score to material search. Missing material is an explicit error; empty retrieval and tool failures cause Tutor abstention. A request-scoped citation allowlist checks course, lesson, version, and object identity.
- Added a local runtime acceptance script and a browser journey that signs in as the seeded student, reads Study Plan/Mastery, asks Tutor for a grounded answer, submits a newly created real quiz through the Web UI, and observes Study Plan regeneration. The browser journey also checks Learning-down and AI-down failure states without network mocks.
- Added canonical test discovery across root Vitest, migration, Web Vitest, Web Node, Mobile, and browser execution. The browser assertion count is read from its actual result rather than hardcoded.

## Verified locally

| Gate | Result | Evidence |
| --- | --- | --- |
| Local positive runtime seed | Pass: entitlement, scheduled quiz, Mastery, durable Study Plan, requirement and schedule sources, material tool and citation | `artifacts/release-evidence/revision-l/positive-runtime.json` |
| Browser positive + degraded paths | Pass: login, Study Plan, AI citation, quiz submission, asynchronous plan change, Learning-down, AI-down; 32 BFF requests | `artifacts/release-evidence/revision-l/browser/` |
| Browser feedback loop | Real attempt `74a5a898-0097-4cae-a34a-f600c1f3156f`; plan ID changed and item count 4 → 7 | `artifacts/release-evidence/revision-l/browser/feedback-loop.json` |
| Clean-volume Cassandra bootstrap | Pass: 50 migrations, 8 keyspaces, schema agreement and required Phase 40 tables; disposable container/volume removed | `pnpm verify:clean-cassandra-bootstrap` output on 2026-09-23 |
| Canonical test discovery | 213 unique suites, 1,474 unique tests, 1,474 passed, 0 failed/skipped/duplicates | `artifacts/release-evidence/rc5-test-discovery.json` |
| Typecheck, Web build, no-new-issues lint | Pass in this working tree | command output from this revision |

The earlier **1,028** was described as “full repository” incorrectly: it represented an earlier root-only run. The earlier reconciled **1,451** was a historical all-group snapshot. Current runner discovery is 1,474 after subsequent test additions and four browser assertions. The current root Vitest plus migration groups total 1,033; the release number is the all-group unique count, not a root-only number.

## Release gates still open

1. There is **no** `v6.2.0-rc.5` tag yet. The repository has an extensive pre-existing dirty working tree spanning prior revisions. Do not relabel RC4 or claim this working tree is an immutable candidate. Review and commit the intended complete scope, tag RC5, then run the same discovery from a clean checkout of that exact tag.
2. The final RC5 manifest, artifact hashes, service image digests, SBOM, and provenance must be generated from that clean checkout, not from this report.
3. Runtime data is verified locally. Staging URL/token, external load-test attestation, and production deployment of Vault workload identity remain external acceptance gates.
4. Browser proof shows real request routing and a plan-ID/item-count change. A direct Cassandra before/after ledger export would strengthen the durable provenance trail further.

**Current status: local runtime and browser closure verified; RC5 release closure pending.** No historical RC tag was changed.
