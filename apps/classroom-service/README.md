# Classroom service

- Owner domain: Classroom.
- Owned Cassandra: `classroom_keyspace`; runtime role `svc_classroom`.
- Public API IDs: `CLS-01..10`.
- Owned internal API IDs: `INT-CLS-01..03`; allowed outbound internal call: `INT-LRN-02`.
- Produced events: `classroom.class.created.v1`, `classroom.student.joined.v1`, `classroom.student.removed.v1`, `system.notification.requested.v1`, `system.audit.requested.v1`.
- Consumed queues: none.
- Dependencies: Cassandra, RabbitMQ publisher and Learning class-link eligibility.
- Prohibited access: all foreign keyspaces, especially `learning_keyspace`; Cassandra DDL/admin and RabbitMQ topology configuration.

Phase 7 handlers must use `Q-CLS-001..008`; course eligibility crosses the signed `INT-LRN-02` API only.
