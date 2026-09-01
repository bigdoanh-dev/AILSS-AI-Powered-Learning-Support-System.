import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
const manifest: ServiceManifest = {
  serviceId: "audit-worker",
  ownerDomain: "Audit support",
  defaultPort: 8204,
  keyspace: "audit_support_keyspace",
  cassandraRole: "svc_audit",
  publicApiIds: [],
  internalApiIds: [],
  producedEvents: [],
  consumedQueues: ["audit.q"],
};
await startService(manifest);
