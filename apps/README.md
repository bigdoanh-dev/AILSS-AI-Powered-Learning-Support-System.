# Application ownership map

The six business owners are `identity-service`, `learning-service`, `classroom-service`, `assessment-service`, `interaction-service` and `ai-service`. Support processes do not gain cross-keyspace database access.

| Process                 | Role                        | Keyspace/role                                | Queue                    | Contract responsibility                                    |
| ----------------------- | --------------------------- | -------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `api-gateway`           | Edge skeleton               | None                                         | None                     | Reserves all public routes; strips forged identity headers |
| `ai-worker`             | AI consumer                 | `ai_keyspace` / `svc_ai`                     | `ai.quiz.generate.q`     | Calls `INT-LRN-04`, `INT-CLS-03`, `INT-ASMT-01`            |
| `document-worker`       | Document consumer           | `ai_keyspace` / `svc_ai`                     | `ai.document.extract.q`  | AI document events                                         |
| `notification-worker`   | Notification owner/consumer | `notification_keyspace` / `svc_notification` | `notification.q`         | `NOT-01..02`, `Q-NOT-001..002`                             |
| `audit-worker`          | Application-audit consumer  | `audit_support_keyspace` / `svc_audit`       | `audit.q`                | Append-only support audit records                          |
| `reconciliation-worker` | Owner-orchestrated repair   | No database credentials                      | `projection.reconcile.q` | Uses owner internal APIs only                              |

Every process exposes `/health/live`, `/health/ready`, `/metrics` and `/__foundation/manifest` where applicable. Phase 7 must implement handlers against `docs/implementation-manifest.md` without introducing foreign Cassandra credentials.
