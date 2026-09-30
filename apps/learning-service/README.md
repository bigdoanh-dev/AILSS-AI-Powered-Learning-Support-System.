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

## Mock payout execution

Apply migration `096_lecturer_payout_execution.cql` before enabling approvals. Set
`BANK_PAYOUT_MOCK_URL=http://127.0.0.1:PORT/payouts` and
`BANK_PAYOUT_MOCK_TOKEN` in the learning service environment; optionally set
`BANK_PAYOUT_TIMEOUT_MS` (default 5000). The endpoint must be a local HTTP mock.
Production and nonlocal endpoints are rejected. If the URL is absent, approval
is disabled. Secrets must come from the environment and must not be logged.

Run the supplied mock in another terminal:

```sh
BANK_PAYOUT_MOCK_TOKEN=local-test-secret node scripts/dev/mock-bank-payout.mjs
```

Set the learning service's `BANK_PAYOUT_MOCK_URL` to
`http://127.0.0.1:8799/payouts` and use the same token. Set
`BANK_PAYOUT_MOCK_OUTCOME` on the mock to `rejected`, `error`, or `timeout`
to exercise those outcomes. The default is `paid`.

After an admin prepares the previous month and the refund window closes, an
admin can call `POST /api/v1/admin/payouts/:month/:lecturerId/approve` with a
trusted `learning.admin.payouts` actor context and an empty JSON body. The API
Gateway exposes the same path to authenticated admins, and the web BFF allows
`POST /web-session/admin/payouts/:month/:lecturerId/approve` with an empty body.
Approval can also be reached through the existing Gateway route
`POST /api/v1/admin/payouts/prepare` with JSON
`{"lecturerId":"<uuid>","approve":true}`; this approves the previous month.
The default prepare call still only creates instructions. The mock
receives `amountMinor`, `currency: VND`, `destinationAccount`, and a stable
`reference` also sent as the `idempotency-key` header. It must return JSON
`{"status":"paid","providerReference":"..."}` or `{"status":"rejected"}`.
The service records one durable approval claim before dispatch. A rejection
becomes `PAYOUT_FAILED`; timeout, network failure, invalid response, or process
interruption needs manual reconciliation. `SUBMITTING` is deliberately never
retried automatically. Payout audit entries contain state and reason codes,
without destination account data.
