import { Counter, Gauge, Histogram, type Registry } from "prom-client";

export const mediaEvents = [
  "upload_session_created",
  "upload_completed",
  "upload_failed",
  "media_validation_failed",
  "media_processing_queued",
  "media_processing_failed",
  "media_ready",
  "playback_authorized",
  "playback_denied",
  "quota_reserved",
  "quota_rejected",
  "upload_cleanup_completed",
  "upload_cleanup_failed",
  "worker_recovered",
  "derived_cleanup_completed",
  "derived_cleanup_failed",
] as const;

export type MediaEvent = (typeof mediaEvents)[number];

export interface MediaQuotaSnapshot {
  originalBytes: number;
  derivedBytes: number;
  reservedOriginalBytes: number;
  reservedDerivedBytes: number;
}

export interface MediaOperationalSuppliers {
  quotaSnapshot?: () => Promise<MediaQuotaSnapshot>;
  queueDepth?: () => Promise<number>;
  cleanupPending?: () => Promise<number>;
}

export function createMediaMetrics(
  registry: Registry,
  snapshotOrSuppliers?: (() => Promise<MediaQuotaSnapshot>) | MediaOperationalSuppliers,
) {
  const suppliers: MediaOperationalSuppliers =
    typeof snapshotOrSuppliers === "function"
      ? { quotaSnapshot: snapshotOrSuppliers }
      : snapshotOrSuppliers ?? {};

  const counters = Object.fromEntries(
    mediaEvents.map((event) => [
      event,
      new Counter({ name: `ailss_${event}_total`, help: `Media ${event}`, registers: [registry] }),
    ]),
  ) as Record<MediaEvent, Counter>;

  const processingDuration = new Histogram({
    name: "ailss_media_processing_duration_seconds",
    help: "Media worker processing latency",
    registers: [registry],
  });

  const uploadBytes = new Counter({
    name: "ailss_media_upload_bytes_total",
    help: "Successfully completed original upload bytes in this process lifetime",
    registers: [registry],
  });

  const deliveryBytes = new Counter({
    name: "ailss_media_delivery_bytes_total",
    help: "Successfully delivered private media bytes in this process lifetime",
    registers: [registry],
  });

  const deliveryFailure = new Counter({
    name: "ailss_media_delivery_failure_total",
    help: "Private media delivery failures in this process lifetime",
    registers: [registry],
  });

  const quotaRejected = new Counter({
    name: "ailss_media_quota_rejected_total",
    help: "Authoritative media quota rejection count",
    registers: [registry],
  });

  const cleanupFailed = new Counter({
    name: "ailss_media_cleanup_failed_total",
    help: "Failed media cleanup operations",
    registers: [registry],
  });

  const workerRecovered = new Counter({
    name: "ailss_media_worker_recovered_total",
    help: "Media worker processing lease recoveries",
    registers: [registry],
  });

  const queueDepth = new Gauge({
    name: "ailss_media_processing_queue_depth",
    help: "Active queued processing jobs awaiting worker pickup",
    registers: [registry],
    async collect() {
      if (suppliers.queueDepth) {
        try {
          this.set(await suppliers.queueDepth());
        } catch {
          this.set(Number.NaN);
        }
      }
    },
  });

  const cleanupPending = new Gauge({
    name: "ailss_media_cleanup_pending",
    help: "Pending derived cleanup journal entries",
    registers: [registry],
    async collect() {
      if (suppliers.cleanupPending) {
        try {
          this.set(await suppliers.cleanupPending());
        } catch {
          this.set(Number.NaN);
        }
      }
    },
  });

  const quotaSnapshot = suppliers.quotaSnapshot;
  if (quotaSnapshot) {
    let cached: Promise<MediaQuotaSnapshot> | undefined;
    let until = 0;
    const current = () => {
      if (!cached || Date.now() >= until) {
        cached = quotaSnapshot();
        until = Date.now() + 1000;
      }
      return cached;
    };
    for (const [name, read] of [
      ["ailss_media_original_bytes_current", (usage: MediaQuotaSnapshot) => usage.originalBytes],
      ["ailss_media_derived_bytes_current", (usage: MediaQuotaSnapshot) => usage.derivedBytes],
      [
        "ailss_media_quota_reserved_bytes",
        (usage: MediaQuotaSnapshot) => usage.reservedOriginalBytes + usage.reservedDerivedBytes,
      ],
    ] as const) {
      new Gauge({
        name,
        help: "Authoritative Cassandra quota ledger bytes at scrape time",
        registers: [registry],
        async collect() {
          try {
            this.set(read(await current()));
          } catch {
            this.set(Number.NaN);
          }
        },
      });
    }
  }

  return {
    event: (event: MediaEvent) => {
      counters[event].inc();
      if (event === "quota_rejected") quotaRejected.inc();
      if (event === "worker_recovered") workerRecovered.inc();
      if (event === "derived_cleanup_failed" || event === "upload_cleanup_failed") cleanupFailed.inc();
    },
    processingDuration,
    uploadBytes,
    deliveryBytes,
    deliveryFailure,
    quotaRejected,
    cleanupFailed,
    workerRecovered,
    queueDepth,
    cleanupPending,
  };
}
