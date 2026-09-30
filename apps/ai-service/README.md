# AI service

Assistant responses use `ai_service.assistant_response_cache` after migration 095. The cache stores only successful, validated model text for requests that executed no tools. Authorization and learner safety checks run on every request before cache lookup; cache failures fall through to the provider. `AI_ASSISTANT_CACHE_TTL_SECONDS` defaults to 86400 (24 hours), and `AI_ASSISTANT_CACHE_TENANT_ID` scopes keys to one deployment tenant. The actor context currently has no per-request tenant claim, so a deployment serving multiple tenant contexts must provide that scope before enabling shared response caching for them.

- Owner domain: AI.
- Owned Cassandra: `ai_keyspace`; runtime role `svc_ai` shared only with the two AI workers.
- Public API IDs: `AI-01..10`.
- Owned internal APIs: none; `ai-worker` may call `INT-LRN-04`, `INT-CLS-03`, `INT-ASMT-01`.
- Produced events: `ai.document.extract.v1`, `ai.quiz.generate.v1`, `system.audit.requested.v1`; AI workers produce `ai.quiz.generated.v1` and `ai.job.failed.v1`.
- Consumed queues: service none; `ai.quiz.generate.q` and `ai.document.extract.q` belong to AI workers.
- Dependencies: Cassandra, RabbitMQ, private MinIO storage and bounded signed internal clients. The AI worker uses a real HTTP provider by default. Configure `AI_PROVIDER_ENDPOINT`, `AI_PROVIDER_MODEL`, and `AI_PROVIDER_API_KEY` in `.env`, then recreate the worker after changes: `docker compose --env-file .env -f docker-compose.yml -f docker-compose.async.yml --profile dev-async up -d --no-deps --force-recreate ai-worker`. Credentials remain server-side. Provider failures are reported as failed jobs; they never fall back to sample questions. `AI_PROVIDER_MODE=deterministic-test` is an explicit opt-in for automated acceptance fixtures only. Existing demo drafts remain unchanged; create a new job to generate real questions.
- Prohibited access: Learning, Classroom, Assessment and all other foreign keyspaces; Cassandra DDL/admin and RabbitMQ topology configuration.

Phase 7 handlers must use `Q-AI-001..007`; contextual data is obtained through the three listed internal APIs, never direct CQL.

Quiz generation accepts optional `cognitiveDistribution` counts for `RECOGNITION`, `UNDERSTANDING`, `APPLICATION`, and `ADVANCED_APPLICATION`. Counts must sum to `questionCount` (1–50). When supplied, the distribution overrides the legacy overall `difficulty`. Generated questions must include `cognitiveLevel` and match these counts before becoming a draft. The AI Studio provides per-level counts and editable question labels; legacy jobs without a distribution remain supported. Labels are intended cognitive levels for teacher review, not measured item discrimination.

AI quota is partitioned by calendar day in `Asia/Ho_Chi_Minh` and renews at 00:00 Vietnam time. `/ai/usage` returns canonical persisted counters plus `day`, `timeZone`, and `resetsAt`. A fresh day has no consumption and uses the configured daily limit. Reservations retain their original usage day when they complete or are cancelled after midnight; historical rows are not deleted. The web usage card refreshes at midnight, on job changes, every 30 seconds while visible, and on returning to the page.
