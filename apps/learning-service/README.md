# Learning service

- Owner domain: Learning.
- Owned Cassandra: `learning_keyspace`; runtime role `svc_learning`.
- Public API IDs: `LRN-01..21`.
- Owned internal API IDs: `INT-LRN-01..04`; allowed outbound internal call: `INT-IDN-01`.
- Produced events: `learning.course.created.v1`, `learning.course.published.v1`, `learning.course.enrolled.v1`, `learning.progress.updated.v1`, `learning.order.paid.v1`, `system.audit.requested.v1`.
- Consumed queue: `learning.entitlement.fulfill.q`.
- Registered-event delivery queue: `learning.course.enrolled.q` (durable routing/publisher-confirm sink; no P7.17 business consumer).
- Dependencies: Cassandra, RabbitMQ and the Identity owner API.
- Prohibited access: `identity_keyspace`, `classroom_keyspace`, `assessment_keyspace`, `interaction_keyspace`, `ai_keyspace`, notification/audit keyspaces, runtime DDL and broker configuration.

Phase 7 handlers must use `Q-LRN-001..016`; foreign identity data is fetched through `INT-IDN-01`, never direct CQL.
