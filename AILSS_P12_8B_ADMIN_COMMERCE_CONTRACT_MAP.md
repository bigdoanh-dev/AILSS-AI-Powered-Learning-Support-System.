# AILSS P12.8B — Admin & Commerce Contract Map

## Locked inventory

P12.8B consumes the locked Phase 12 inventory without adding contracts: **98 public operations, 15 internal operations, 74 query contracts, 22 event contracts, 6 services, Redis disabled**.

## Actor matrix

| Capability                                               |                 Guest |         Student |          Lecturer |                                                                          Admin |
| -------------------------------------------------------- | --------------------: | --------------: | ----------------: | -----------------------------------------------------------------------------: |
| Browse published courses and offerings                   |                   Yes |             Yes |               Yes |                                                                            Yes |
| Create/view own order and simulate payment               |                    No | Yes, owner only |                No | API permits owner/Admin simulation; Web keeps the Student journey owner-scoped |
| Learn from an entitled course                            |                    No |             Yes |                No |                                                                             No |
| Apply for Lecturer role                                  | Authenticated account |             Yes |   View own status |                                                                             No |
| Author courses, offerings, classes, assessments, AI jobs |                    No |              No | Verified Lecturer |                                                                             No |
| Search and inspect users                                 |                    No |              No |                No |                                                                            Yes |
| Change account status                                    |                    No |              No |                No |                                         Yes, current-password reauthentication |
| Review Lecturer applications / verify Lecturer           |                    No |              No |                No |                                         Yes, current-password reauthentication |
| Publish/archive a course                                 |                    No |              No |                No |                  Yes, direct Course UUID and current-password reauthentication |
| Moderate reported comments/reviews                       |                    No |              No |                No |                  Yes, optimistic version and current-password reauthentication |

## Admin Web mapping

| Web route                          | Public operation                 | Adapter path                                                  | Exact constraints                                                                         |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/app/admin`                       | Existing capabilities only       | —                                                             | ADMIN guard                                                                               |
| `/app/admin/users`                 | IDN-09 `GET /api/v1/admin/users` | `GET /web-session/admin/users`                                | Required `role`, `status`; bounded `limit`; opaque cursor                                 |
| `/app/admin/users/:userId`         | IDN-10, IDN-11                   | `/web-session/admin/users/:userId[ /status]`                  | UUID; status is ACTIVE/SUSPENDED; mutation has exact body and idempotency key             |
| `/app/admin/lecturer-applications` | IDN-15/16/17 and IDN-12          | Existing session routes                                       | Admin role checked; decisions/verification use exact reauthentication contracts           |
| `/app/admin/courses`               | LRN-08, LRN-09                   | `POST /web-session/admin/courses/:courseId/{publish,archive}` | Direct UUID because no review queue/list operation exists; exact `{currentPassword}` body |
| `/app/admin/moderation`            | INT-10, INT-11                   | `/web-session/admin/interaction-reports`                      | Bounded page; `If-Match`; exact decision body                                             |

The server-side adapter retains access/refresh tokens and current canonical profile. It rechecks `ACTIVE` and `ADMIN` before every Admin operation, rejects unknown paths/query/body fields, forwards only required optimistic headers, and never returns credentials.

## Student Commerce mapping

| Journey step            | Public operation                                 | Canonical state / behavior                                                |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Select an offering      | LRN-27 `GET /courses/{courseId}/offerings`       | Published offerings only for a non-owner Student                          |
| Create an order         | LRN-19 `POST /orders`                            | Exact `{offeringId}` and idempotency key; returns `PENDING`               |
| Choose simulated result | LRN-21 `POST /orders/{orderId}/simulate-payment` | Exact `SUCCESS` or `FAILURE`; UI explicitly says no real money/provider   |
| Observe fulfillment     | LRN-20 `GET /orders/{orderId}`                   | Owner-safe polling while `PAID_PENDING_ENTITLEMENT`                       |
| Enter learning          | Existing entitled learning APIs                  | `ENTITLED` exposes the learning CTA; `PAYMENT_FAILED` remains recoverable |

Canonical visible states are `PENDING`, `PAYMENT_FAILED`, `PAID_PENDING_ENTITLEMENT`, and `ENTITLED`. The Web does not invent order history, refunds, provider checkout, or an Admin course queue.

## Operational debt carried forward

AI and document workers still require broker reconnect hardening after RabbitMQ interruption. This does not alter the HTTP contracts or P12.8B inventory and remains a release-QA item for P12.9.
