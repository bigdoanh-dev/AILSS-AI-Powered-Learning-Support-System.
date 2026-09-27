import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredUploads } from "../../apps/media-worker/src/cleanup.js";
import { MediaQuota, quotaUsage, type QuotaLedger } from "../../apps/learning-service/src/media/quota.js";
import type { MediaAsset } from "../../apps/learning-service/src/media/model.js";
import type { MediaStore } from "../../apps/learning-service/src/media/repository.js";
import type { MediaObjectStorage } from "../../packages/storage/src/media.js";
import type { MediaEvent } from "../../packages/observability/src/media.js";

async function fixture() {
  let ledger: QuotaLedger = { revision: 0, reconciled: true, reservations: {} };
  const quota = new MediaQuota(
    {
      read: async () => structuredClone(ledger),
      cas: async (_tenant, old, next) => {
        if (old.revision !== ledger.revision) return false;
        ledger = structuredClone(next);
        return true;
      },
    },
    {
      tenantOriginalBytes: 1000,
      courseOriginalBytes: 1000,
      tenantDerivedBytes: 1000,
      courseDerivedBytes: 1000,
      tenantAssets: 20,
      courseAssets: 20,
    },
  );
  const asset: MediaAsset = {
    mediaAssetId: "expired",
    tenantId: "tenant",
    courseId: "course",
    lessonId: "lesson",
    ownerUserId: "lecturer",
    mediaType: "VIDEO",
    originalFilename: "source.mp4",
    mimeType: "video/mp4",
    originalObjectKey: "media-original/source",
    sizeBytes: 60,
    status: "UPLOADING",
    uploadId: "multipart",
    revision: 2,
    processingVersion: 1,
    fingerprint: "fixture",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    uploadExpiresAt: new Date(Date.now() - 1000).toISOString(),
    captionTracks: [],
    audit: [],
  };
  const abort = vi.fn().mockResolvedValue(undefined),
    statObject = vi.fn();
  const replace = vi.fn().mockResolvedValue(true);
  const storage = { abort, stat: statObject } as unknown as MediaObjectStorage;
  const repository = { get: vi.fn().mockResolvedValue(asset), replace } as unknown as MediaStore;
  const events: MediaEvent[] = [];
  await quota.reserve(asset, 40);
  const run = () =>
    cleanupExpiredUploads("tenant", repository, storage, quota, (event) => events.push(event));
  return { asset, abort, statObject, replace, quota, run, events, usage: () => quotaUsage(ledger) };
}
describe("Phase42 bounded expired multipart cleanup", () => {
  it("aborts multipart before deleting metadata and releasing reservation", async () => {
    const f = await fixture();
    await f.run();
    expect(f.abort).toHaveBeenCalledWith(f.asset.originalObjectKey, "multipart");
    expect(f.replace).toHaveBeenCalledWith(f.asset, expect.objectContaining({ status: "DELETED" }));
    expect(f.usage().reservedOriginalBytes).toBe(0);
    expect(f.events).toEqual(["upload_cleanup_completed"]);
  });
  it("keeps quota and metadata when object storage is unavailable", async () => {
    const f = await fixture();
    f.abort.mockRejectedValue(Error("unavailable"));
    await f.run();
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.usage().reservedOriginalBytes).toBe(60);
    expect(f.events).toEqual(["upload_cleanup_failed"]);
  });
  it("retains real original accounting after ambiguous multipart completion", async () => {
    const f = await fixture();
    f.abort.mockRejectedValue({ code: "NoSuchUpload" });
    f.statObject.mockResolvedValue({ size: 60, etag: "stored" });
    await f.run();
    expect(f.usage().originalBytes).toBe(60);
    expect(f.usage().reservedDerivedBytes).toBe(0);
    expect(f.usage().assetCount).toBe(1);
  });
  it("revisits expired reservations whose original was already accounted", async () => {
    const f = await fixture();
    await f.quota.originalStored(f.asset);
    await f.run();
    expect(f.abort).toHaveBeenCalledOnce();
    expect(f.usage().originalBytes).toBe(60);
    expect(f.usage().reservedDerivedBytes).toBe(0);
  });
  it("does not free quota if a concurrent metadata writer wins the CAS", async () => {
    const f = await fixture();
    f.replace.mockResolvedValue(false);
    await f.run();
    expect(f.usage().reservedOriginalBytes).toBe(60);
    expect(f.events).toEqual([]);
  });
});
