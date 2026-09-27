import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MediaQuota,
  quotaUsage,
  type QuotaLedger,
  type QuotaLimits,
  type QuotaStore,
} from "../../apps/learning-service/src/media/quota.js";
import type { MediaAsset } from "../../apps/learning-service/src/media/model.js";

const tenantId = randomUUID(),
  courseId = randomUUID();
function asset(size = 60): MediaAsset {
  return {
    mediaAssetId: randomUUID(),
    tenantId,
    courseId,
    lessonId: randomUUID(),
    ownerUserId: randomUUID(),
    mediaType: "VIDEO",
    originalFilename: "source.mp4",
    mimeType: "video/mp4",
    originalObjectKey: "private/source",
    sizeBytes: size,
    status: "UPLOADING",
    revision: 1,
    processingVersion: 1,
    fingerprint: "fixture",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    uploadExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    captionTracks: [],
    audit: [],
  };
}
const limits: QuotaLimits = {
  tenantOriginalBytes: 100,
  tenantDerivedBytes: 100,
  courseOriginalBytes: 100,
  courseDerivedBytes: 100,
  tenantAssets: 10,
  courseAssets: 10,
};
function fixture(overrides: Partial<QuotaLimits> = {}) {
  let ledger: QuotaLedger = { revision: 0, reconciled: true, reservations: {} };
  const store: QuotaStore = {
    read: async () => structuredClone(ledger),
    cas: async (_tenant, old, next) => {
      if (old.revision !== ledger.revision) return false;
      ledger = structuredClone(next);
      return true;
    },
  };
  return { quota: new MediaQuota(store, { ...limits, ...overrides }), ledger: () => ledger };
}
describe("Phase42 authoritative media quota", () => {
  it("blocks uploads until an authoritative backfill initializes the ledger", async () => {
    let ledger: QuotaLedger = { revision: 0, reconciled: false, reservations: {} };
    const store: QuotaStore = {
      read: async () => structuredClone(ledger),
      cas: async (_tenant, old, next) => {
        if (old.revision !== ledger.revision) return false;
        ledger = structuredClone(next);
        return true;
      },
    };
    const quota = new MediaQuota(store, limits);
    await expect(quota.reserve(asset(), 10)).rejects.toMatchObject({ code: "MEDIA_QUOTA_BACKFILL_REQUIRED" });
    await quota.initialize(tenantId, []);
    await quota.reserve(asset(), 10);
    await expect(quota.initialize(tenantId, [])).rejects.toThrow("MEDIA_QUOTA_ALREADY_RECONCILED");
    expect(quotaUsage(ledger).reservedOriginalBytes).toBe(60);
  });
  it("allows only one concurrent reservation when combined original bytes exceed quota", async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.quota.reserve(asset(), 10), f.quota.reserve(asset(), 10)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(quotaUsage(f.ledger()).reservedOriginalBytes).toBe(60);
  });
  it("enforces course quota independently of tenant quota", async () => {
    const f = fixture({ tenantOriginalBytes: 1000 });
    await f.quota.reserve(asset(), 10);
    await expect(f.quota.reserve(asset(), 10)).rejects.toMatchObject({ code: "MEDIA_QUOTA_EXCEEDED" });
  });
  it("reserves derived bytes and asset count before upload", async () => {
    const f = fixture({ courseAssets: 1 });
    await f.quota.reserve(asset(1), 60);
    await expect(f.quota.reserve(asset(1), 60)).rejects.toMatchObject({ code: "MEDIA_QUOTA_EXCEEDED" });
    const g = fixture();
    await g.quota.reserve(asset(1), 60);
    await expect(g.quota.reserve(asset(1), 60)).rejects.toMatchObject({ code: "MEDIA_QUOTA_EXCEEDED" });
  });
  it("replays the same reservation without double counting", async () => {
    const f = fixture(),
      a = asset();
    await Promise.all([f.quota.reserve(a, 10), f.quota.reserve(a, 10)]);
    expect(quotaUsage(f.ledger()).assetCount).toBe(1);
    expect(f.ledger().revision).toBe(1);
  });
  it("releases canceled unused reservation and rejects replay of the closed session", async () => {
    const f = fixture(),
      a = asset();
    await f.quota.reserve(a, 10);
    await f.quota.release(a);
    expect(quotaUsage(f.ledger()).assetCount).toBe(0);
    await expect(f.quota.reserve(a, 10)).rejects.toMatchObject({ code: "MEDIA_RESERVATION_CLOSED" });
    await f.quota.reserve(asset(), 10);
  });
  it("converts reservations to actual durable bytes idempotently", async () => {
    const f = fixture(),
      a = asset();
    await f.quota.reserve(a, 50);
    await f.quota.originalStored(a);
    await f.quota.originalStored(a);
    await f.quota.derivedStored(a, 20);
    await f.quota.derivedStored(a, 20);
    expect(quotaUsage(f.ledger())).toEqual({
      originalBytes: 60,
      derivedBytes: 20,
      reservedOriginalBytes: 0,
      reservedDerivedBytes: 0,
      assetCount: 1,
    });
  });
  it("retained quarantined originals still count but unused derived reservation is released", async () => {
    const f = fixture(),
      a = asset();
    await f.quota.reserve(a, 50);
    await f.quota.originalStored(a);
    await f.quota.release(a);
    expect(quotaUsage(f.ledger())).toEqual({
      originalBytes: 60,
      derivedBytes: 0,
      reservedOriginalBytes: 0,
      reservedDerivedBytes: 0,
      assetCount: 1,
    });
  });
});
