# AILSS Phase 6 — Infrastructure Foundation

AILSS (AI-Powered Learning Support System) is a learning-platform foundation for identity, course delivery, classrooms, assessment, interaction and controlled AI workloads. This repository is the executable Phase 6 baseline: an Express/TypeScript Gateway, exactly six business-service skeletons, support workers, Cassandra 5.0.9, RabbitMQ, private MinIO storage, security primitives, contracts, tests, CI and research evidence. Phase 7 business handlers are intentionally absent and return `501 NOT_IMPLEMENTED_PHASE_7`.

## Architecture

Requests enter the Gateway and cross a private service network. Each owner process has one Cassandra role restricted to its own keyspace; cross-domain access must use one of the registered signed internal APIs. Asynchronous work uses the `/ailss` RabbitMQ vhost, five exchanges, six durable work queues, explicit retry queues and six DLQs. The outbox foundation provides recoverable at-least-once publishing with consumer deduplication; it does not claim exactly-once delivery. MinIO stores private document objects with checksum verification. Redis and distributed shared caches are deliberately absent.

Canonical contracts live in `contracts/`: after the P7.12C multi-mode learning revision there are 93 public REST APIs, 15 internal REST APIs, 71 Query IDs and 22 event schemas. P7.12C additions are contract designs and remain runtime-unimplemented until their roadmap phases. `docs/implementation-manifest.md` maps them to owners, tables, queues and ADRs.

## Requirements

- Node.js 24 LTS and Corepack
- pnpm 11.19.0, locked by `packageManager`
- Docker Engine 28+ and Docker Compose v2
- At least 8 GiB available for `dev-core`; a 16 GiB host is recommended for the three-node research profile
- OpenSSL for development certificate generation

## Install and configure

```sh
corepack enable
corepack pnpm install --frozen-lockfile
pnpm keys:dev
node scripts/dev/bootstrap-dev-env.mjs
pnpm preflight
```

`.env` and generated private keys are local, gitignored artifacts. `.env.example` contains placeholders and exact image tags/digests. Never reuse development credentials or the local CA in production.

## Profiles and bootstrap

```sh
pnpm env:dev-core      # Cassandra + Gateway + Identity
pnpm env:dev-async     # Cassandra + Gateway + AI/worker subset + RabbitMQ + MinIO
pnpm env:research      # 3 Cassandra nodes + complete 12-process topology
pnpm env:demo          # single-node complete topology
pnpm env:down
```

The environment command validates Compose, checks host resources, joins research Cassandra nodes sequentially, waits for ring/schema agreement, runs nine idempotent migrations, creates roles/grants, provisions RabbitMQ and MinIO, builds images and waits for Gateway readiness. There is no hidden manual database or broker bootstrap.

Reset is guarded and deletes only named AILSS Compose volumes:

```sh
AILSS_CONFIRM_RESET=YES pnpm env:reset
```

## Tests and acceptance

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:contracts
pnpm validate:compose
pnpm format:check
pnpm build

AILSS_PROFILE=dev-core pnpm smoke
AILSS_PROFILE=dev-async pnpm smoke
AILSS_PROFILE=research pnpm smoke
AILSS_PROFILE=research pnpm evidence
```

Smoke verifies readiness, correlation propagation, forged-identity rejection, Cassandra positive/negative RBAC, RabbitMQ ACL/publisher-confirm/manual-ACK and MinIO checksum round-trip as applicable to the profile.

## Research TLS path

First run and verify `pnpm env:research` so the schema and roles exist. Preserve its volumes with `pnpm env:down`, then recreate Cassandra on the TLS override:

```sh
docker compose --env-file .env \
  -f docker-compose.yml \
  -f docker-compose.research-tls.yml \
  --profile research up -d cassandra-node1 cassandra-node2 cassandra-node3
pnpm research:cassandra:tls
pnpm research:wrong-credential
AILSS_PROFILE=research pnpm evidence
```

The verifier requires a trusted CA connection and requires both an untrusted CA and a wrong hostname to fail. Client certificate verification is never disabled. Certificates expire after 30 days; rotate with `AILSS_ROTATE_TLS_KEYS=true pnpm keys:dev` when required.

## Failure drills and backup foundation

Research-only controls are scoped to named lab containers:

```sh
pnpm research:cassandra:stop-node -- node3
pnpm research:cassandra:start-node -- node3
pnpm research:rabbitmq:stop
pnpm research:rabbitmq:start
pnpm research:publisher:kill
pnpm research:publisher:start
pnpm research:consumer:kill
pnpm research:consumer:start
pnpm research:cassandra:snapshot -- <run-id>
```

Follow `docs/runbooks/` before any drill. Snapshot support is a lab backup foundation, not a production disaster-recovery claim.

## Repository layout

```text
apps/              Gateway, six business owners and support workers
packages/          Config, HTTP, security, Cassandra, RabbitMQ, outbox and shared runtime
contracts/         OpenAPI, API/query/event registries and JSON Schemas
database/          Ordered migrations, roles, grants and synthetic seed
infrastructure/    Cassandra configuration and generated-TLS layout
scripts/           CI, bootstrap, security and research automation
tests/             Contract, security, unit and runtime smoke tests
docs/              ADRs, runbooks, evidence, manifest and Phase reports
```

## Troubleshooting

- Run `docker compose --env-file .env --profile <profile> ps` and `docker logs ailss-<component>` after a readiness failure.
- If a research node is missing from `nodetool status`, stop the profile and use the guarded reset; nodes must bootstrap sequentially from clean volumes.
- If port checks fail, stop the other local process; management ports are loopback-only.
- If TLS reports a PEM error, regenerate keys and confirm the TLS override mounts `server-keystore.pem` and the CA directory.
- If RabbitMQ checks fail, run `pnpm verify:rabbitmq`; runtime principals are intentionally denied topology configuration.
- Never paste `.env`, private keys or connection URLs containing credentials into logs or tickets.

Operational details are in `docs/runbooks`, decisions in `docs/adr` and immutable per-run evidence in `docs/evidence/<runId>/`.
