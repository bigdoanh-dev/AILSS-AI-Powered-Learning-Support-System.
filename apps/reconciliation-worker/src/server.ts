import { startService, type ServiceManifest } from "../../../packages/runtime/src/index.js";
const manifest: ServiceManifest = {
  serviceId: "reconciliation-worker",
  ownerDomain: "Owner-orchestrated support",
  defaultPort: 8205,
  publicApiIds: [],
  internalApiIds: [
    "INT-LRN-01",
    "INT-LRN-02",
    "INT-LRN-03",
    "INT-LRN-04",
    "INT-CLS-01",
    "INT-CLS-02",
    "INT-CLS-03",
    "INT-IDN-01",
  ],
  producedEvents: ["system.audit.requested.v1"],
  consumedQueues: ["projection.reconcile.q"],
};
await startService(manifest);
