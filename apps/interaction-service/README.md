# Interaction service

- Owner domain: Interaction.
- Owned Cassandra: `interaction_keyspace`; runtime role `svc_interaction`.
- Public API IDs: `INT-01..11`.
- Owned internal APIs: none; allowed outbound internal calls: `INT-LRN-03`, `INT-CLS-02`.
- Produced events: `interaction.review.created.v1`, `interaction.report.created.v1`, `interaction.content.moderated.v1`, `system.audit.requested.v1`.
- Consumed queues: none.
- Dependencies: Cassandra, RabbitMQ publisher and signed Learning/Classroom context APIs.
- Prohibited access: `learning_keyspace`, `classroom_keyspace` and all other foreign keyspaces; Cassandra DDL/admin and RabbitMQ topology configuration.

Phase 7 handlers must use `Q-INT-001..008`; projections are repaired through bounded owner orchestration.
