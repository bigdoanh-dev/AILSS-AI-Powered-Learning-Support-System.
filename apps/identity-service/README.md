# Identity service

- Owner domain: Identity.
- Owned Cassandra: `identity_keyspace`; runtime role `svc_identity`.
- Public API IDs: `IDN-01..22`.
- Owned internal API IDs: `INT-IDN-01`; outbound internal calls: none.
- Produced events: `identity.user.registered.v1`, `identity.user.status_changed.v1`, `system.audit.requested.v1`.
- Consumed queues: none.
- Dependencies: Cassandra, JWT/service-identity primitives and injected signing/public-key files.
- Prohibited access: every foreign keyspace, Cassandra DDL/admin operations and RabbitMQ topology configuration. Other domains obtain identity data only through `INT-IDN-01` or public contracts.

Implemented Phase 7 handlers:

- `IDN-01 POST /api/v1/auth/register`: `Q-IDN-001`, `Q-IDN-002`, `Q-IDN-007`.
- `IDN-02 POST /api/v1/auth/login`: `Q-IDN-001`, `Q-IDN-002`, `Q-IDN-003`.
- `IDN-03 POST /api/v1/auth/refresh`: `Q-IDN-001`, `Q-IDN-003`.
- `IDN-20..22 POST /api/v1/auth/password-reset/{request,verify,complete}`: email OTP recovery with short-lived, hashed challenges.

Login signs Ed25519 access JWTs from injected key files, persists only an opaque refresh-token fingerprint, and revalidates canonical account authorization after session creation. Refresh proves the current 256-bit opaque credential, signs before mutation, rotates the fingerprint/generation/version with a one-row Cassandra LWT, preserves the absolute family expiry, and conservatively revokes the canonical family on a known-session mismatch or losing replay. Both paths revalidate canonical account authorization before returning credentials.

`sessions_by_user_bucket` is not written because `Q-IDN-004` is read-only and does not bind `IDN-02` or `IDN-03`. Refresh emits no business event or durable audit intent because the registries bind neither to `IDN-03`. `IDN-04..12` and `INT-IDN-01` remain unimplemented. JWKS and foundation health/metrics endpoints remain available.
