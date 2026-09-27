import { describe, expect, it } from "vitest";
import { Registry } from "prom-client";
import { createMediaMetrics } from "../../packages/observability/src/media.js";

describe("Phase 42 media operational metrics", () => {
  it("reads stored and reserved bytes from a quota snapshot at scrape time", async () => {
    const registry = new Registry();
    const usage = { originalBytes: 91, derivedBytes: 37, reservedOriginalBytes: 14, reservedDerivedBytes: 2 };
    createMediaMetrics(registry, async () => usage);
    const text = await registry.metrics();
    expect(text).toContain("ailss_media_original_bytes_current 91");
    expect(text).toContain("ailss_media_derived_bytes_current 37");
    expect(text).toContain("ailss_media_quota_reserved_bytes 16");
  });

  it("reads queue depth and cleanup pending from suppliers", async () => {
    const registry = new Registry();
    createMediaMetrics(registry, {
      queueDepth: async () => 4,
      cleanupPending: async () => 7,
    });
    const text = await registry.metrics();
    expect(text).toContain("ailss_media_processing_queue_depth 4");
    expect(text).toContain("ailss_media_cleanup_pending 7");
  });

  it("keeps operational byte/failure counters label-free and tracks all 11 required metrics", async () => {
    const registry = new Registry();
    const metrics = createMediaMetrics(registry);
    metrics.uploadBytes.inc(120);
    metrics.deliveryBytes.inc(72);
    metrics.deliveryFailure.inc();
    metrics.event("quota_rejected");
    metrics.event("worker_recovered");
    metrics.event("derived_cleanup_failed");
    metrics.queueDepth.set(3);
    metrics.cleanupPending.set(1);

    const text = await registry.metrics();
    expect(text).toContain("ailss_media_upload_bytes_total 120");
    expect(text).toContain("ailss_media_delivery_bytes_total 72");
    expect(text).toContain("ailss_media_delivery_failure_total 1");
    expect(text).toContain("ailss_media_quota_rejected_total 1");
    expect(text).toContain("ailss_media_worker_recovered_total 1");
    expect(text).toContain("ailss_media_cleanup_failed_total 1");
    expect(text).toContain("ailss_media_processing_queue_depth 3");
    expect(text).toContain("ailss_media_cleanup_pending 1");

    // Cardinality safety assertions (BF23)
    expect(text).not.toContain("userId=");
    expect(text).not.toContain("filename=");
    expect(text).not.toContain("token=");
    expect(text).not.toContain("mediaAssetId=");
    expect(text).not.toContain("jobId=");
  });
});
