# AILSS TLS development foundation

Run `pnpm keys:dev` to create a short-lived development CA, three Cassandra node certificates, and Ed25519 signing keys. Generated private material lives only under `generated/`, is mode `0600`, is ignored by Git, and must never be reused in production.

The research TLS overlay is activated with:

```sh
docker compose --env-file .env -f docker-compose.yml -f docker-compose.research-tls.yml --profile research up -d
```

The Cassandra certificates include verified DNS SANs. Clients must keep CA and hostname verification enabled. Production requires an external CA/secret manager and certificate rotation automation.
