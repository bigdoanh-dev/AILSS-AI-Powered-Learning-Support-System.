# Assessment service

- Owner domain: Assessment.
- Owned Cassandra: `assessment_keyspace`; runtime role `svc_assessment`.
- Public API IDs: `ASM-01..10`.
- Owned internal API ID: `INT-ASMT-01`; allowed outbound internal calls: `INT-LRN-01`, `INT-CLS-01`.
- Produced events: `assessment.quiz.submitted.v1`, `assessment.quiz.graded.v1`, `system.audit.requested.v1`.
- Consumed queues: none.
- Dependencies: Cassandra, RabbitMQ publisher and signed Learning/Classroom eligibility APIs.
- Prohibited access: `learning_keyspace`, `classroom_keyspace` and every other foreign keyspace; Cassandra DDL/admin and RabbitMQ topology configuration.

Phase 7 handlers must use `Q-ASMT-001..008`. Eligibility failures are fail-closed and never trigger a fallback foreign-keyspace read.
