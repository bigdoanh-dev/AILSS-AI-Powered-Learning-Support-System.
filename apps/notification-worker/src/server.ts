import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
const manifest: ServiceManifest = {
  serviceId: "notification-worker",
  ownerDomain: "Notification support",
  defaultPort: 8203,
  keyspace: "notification_keyspace",
  cassandraRole: "svc_notification",
  publicApiIds: ["NOT-01", "NOT-02"],
  internalApiIds: [],
  producedEvents: ["system.audit.requested.v1"],
  consumedQueues: ["notification.q"],
};
await startService(manifest);
