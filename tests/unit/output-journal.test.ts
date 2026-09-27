import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  recoverOutputIntent,
  validateOutputIntent,
  type OutputIntent,
  type OutputJournal,
} from "../../apps/media-worker/src/output-journal.js";
import type { MediaAsset } from "../../apps/learning-service/src/media/model.js";
import type { MediaJob } from "../../apps/learning-service/src/media/repository.js";
import type { MediaObjectStorage } from "../../packages/storage/src/media.js";

function fixture() {
  const tenantId = randomUUID(),
    mediaAssetId = randomUUID(),
    lease = randomUUID();
  const prefix = `media-hls/${tenantId}/${mediaAssetId}/1/${lease}`;
  const intent: OutputIntent = {
    tenantId,
    mediaAssetId,
    lease,
    prefix,
    day: "2026-09-26",
    shard: 1,
    revision: 1,
    keys: [`${prefix}/master.m3u8`, `${prefix}/poster.jpg`],
    state: "PENDING",
    failures: 0,
    updatedAt: new Date().toISOString(),
  };
  const get = vi.fn<() => Promise<MediaAsset | undefined>>().mockResolvedValue(undefined);
  const job = vi.fn<() => Promise<MediaJob | undefined>>().mockResolvedValue(undefined);
  const replace = vi.fn<(old: MediaAsset, next: MediaAsset) => Promise<boolean>>().mockResolvedValue(true);
  const cas = vi.fn<OutputJournal["cas"]>().mockResolvedValue(true);
  const stat = vi.fn<MediaObjectStorage["stat"]>().mockResolvedValue({ size: 1, etag: "object" });
  const remove = vi.fn<MediaObjectStorage["remove"]>().mockResolvedValue(undefined);
  const journal = { cas } as unknown as OutputJournal;
  const storage = { stat, remove } as unknown as MediaObjectStorage;
  const event = vi.fn();
  return {
    intent,
    get,
    job,
    replace,
    cas,
    stat,
    remove,
    event,
    run: () => recoverOutputIntent(intent, journal, { get, job, replace }, storage, event),
  };
}
describe("durable derived output cleanup", () => {
  it("deletes only journaled derived objects and durably resolves", async () => {
    const f = fixture();
    await f.run();
    expect(f.remove.mock.calls.map(([key]) => key)).toEqual(f.intent.keys);
    expect(f.cas).toHaveBeenCalledWith(f.intent, "CLEANED");
    expect(f.event).toHaveBeenCalledWith("derived_cleanup_completed");
  });
  it("keeps pending intent and retry count after deletion failure", async () => {
    const f = fixture();
    f.remove.mockRejectedValue(Error("MinIO down"));
    await f.run();
    expect(f.cas).toHaveBeenCalledWith(f.intent, "PENDING", true);
    expect(f.event).toHaveBeenCalledWith("derived_cleanup_failed");
  });
  it("never treats storage read failure as missing output", async () => {
    const f = fixture();
    f.stat.mockRejectedValue(Error("unavailable"));
    await f.run();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.cas).toHaveBeenCalledWith(f.intent, "PENDING", true);
  });
  it("skips already absent objects idempotently", async () => {
    const f = fixture();
    f.stat.mockRejectedValue({ code: "NoSuchKey" });
    await f.run();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.cas).toHaveBeenCalledWith(f.intent, "CLEANED");
  });
  it("protects active lease owner", async () => {
    const f = fixture();
    f.job.mockResolvedValue({ lease: f.intent.lease, leaseUntil: new Date(Date.now() + 60_000) } as MediaJob);
    await f.run();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.cas).not.toHaveBeenCalled();
  });
  it("fences expired asset before deleting so delayed READY cannot win", async () => {
    const f = fixture();
    const asset = { processingLease: f.intent.lease, revision: 3, status: "PROCESSING" } as MediaAsset;
    f.get.mockResolvedValue(asset);
    await f.run();
    expect(f.replace).toHaveBeenCalledWith(asset, expect.objectContaining({ revision: 4 }));
    expect(f.replace.mock.calls[0]?.[1]).not.toHaveProperty("processingLease");
    expect(f.replace.mock.invocationCallOrder[0]).toBeLessThan(f.remove.mock.invocationCallOrder[0] ?? 0);
  });
  it("does not delete if activation or another writer wins the fence CAS", async () => {
    const f = fixture();
    f.get.mockResolvedValue({ processingLease: f.intent.lease, revision: 3 } as MediaAsset);
    f.replace.mockResolvedValue(false);
    await f.run();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.cas).not.toHaveBeenCalled();
  });
  it("preserves authoritative READY output after ambiguous activation", async () => {
    const f = fixture();
    f.get.mockResolvedValue({ masterPlaylistObjectKey: `${f.intent.prefix}/master.m3u8` } as MediaAsset);
    await f.run();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.cas).toHaveBeenCalledWith(f.intent, "RETAINED");
  });
  it("revisits resolved intent for a late fenced PUT", async () => {
    const f = fixture();
    f.intent.state = "CLEANED";
    await f.run();
    expect(f.remove).toHaveBeenCalledTimes(2);
    expect(f.cas).toHaveBeenCalledWith(f.intent, "CLEANED");
  });
  it("does not rescan retained output", async () => {
    const f = fixture();
    f.intent.state = "RETAINED";
    await f.run();
    expect(f.get).not.toHaveBeenCalled();
    expect(f.stat).not.toHaveBeenCalled();
  });
  it.each(["media-original/source", "../source", "caption.vtt", "variant.m3u8", "segment-../source.ts"])(
    "rejects destructive scope %s",
    (name) => {
      const f = fixture();
      f.intent.keys = [name.startsWith("media-") ? name : `${f.intent.prefix}/${name}`];
      expect(() => validateOutputIntent(f.intent)).toThrow("MEDIA_OUTPUT_JOURNAL_SCOPE_REJECTED");
    },
  );
  it("rejects another asset's journal prefix", () => {
    const f = fixture();
    f.intent.mediaAssetId = randomUUID();
    expect(() => validateOutputIntent(f.intent)).toThrow("MEDIA_OUTPUT_JOURNAL_SCOPE_REJECTED");
  });
});
