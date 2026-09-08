# AI service

- Owner domain: AI.
- Owned Cassandra: `ai_keyspace`; runtime role `svc_ai` shared only with the two AI workers.
- Public API IDs: `AI-01..10`.
- Owned internal APIs: none; `ai-worker` may call `INT-LRN-04`, `INT-CLS-03`, `INT-ASMT-01`.
- Produced events: `ai.document.extract.v1`, `ai.quiz.generate.v1`, `system.audit.requested.v1`; AI workers produce `ai.quiz.generated.v1` and `ai.job.failed.v1`.
- Consumed queues: service none; `ai.quiz.generate.q` and `ai.document.extract.q` belong to AI workers.
- Dependencies: Cassandra, RabbitMQ, private MinIO storage and bounded signed internal clients. The `AIProvider` remains an adapter boundary; no real provider secret is required in Phase 6.
- Prohibited access: Learning, Classroom, Assessment and all other foreign keyspaces; Cassandra DDL/admin and RabbitMQ topology configuration.

Phase 7 handlers must use `Q-AI-001..007`; contextual data is obtained through the three listed internal APIs, never direct CQL.
