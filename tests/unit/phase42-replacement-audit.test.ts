import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import { CassandraMediaRepository } from "../../apps/learning-service/src/media/repository.js";
import type { MediaAsset, MediaReplacementEvent } from "../../apps/learning-service/src/media/model.js";

function fixture() {
  const active = randomUUID();
  let history: string | null = null;
  let conflict = false;
  let updates = 0;
  const db = {
    execute: async (cql: string, params: readonly unknown[]) => {
      if (cql.startsWith("SELECT")) return [{ media_asset_id: active, replacement_history: history }];
      expect(cql).toContain("IF media_asset_id=? AND replacement_history=?");
      expect(String(params.at(-2))).toBe(active);
      expect(params.at(-1)).toBe(history);
      updates++;
      if (conflict) {
        conflict = false;
        history = JSON.stringify([{ status: "APPLIED", replacementMediaAssetId: randomUUID() }]);
        return [{ "[applied]": false }];
      }
      history = String(params[0]);
      return [{ "[applied]": true }];
    },
  } as unknown as CassandraClient;
  const asset: MediaAsset = {
    tenantId: randomUUID(),
    mediaAssetId: randomUUID(),
    lessonId: randomUUID(),
    ownerUserId: randomUUID(),
    replacementOfMediaAssetId: active,
    failureCode: "MEDIA_PROCESSING_FAILED",
    audit: [
      {
        from: "PROCESSING",
        to: "FAILED",
        at: new Date().toISOString(),
        actor: "media-worker",
        failureCode: "MEDIA_PROCESSING_FAILED",
        processingLease: randomUUID(),
      },
    ],
  } as MediaAsset;
  return {
    asset,
    active,
    repository: new CassandraMediaRepository(db),
    history: () => JSON.parse(history ?? "[]") as MediaReplacementEvent[],
    updates: () => updates,
    conflict: () => {
      conflict = true;
    },
  };
}
describe("replacement failure audit", () => {
  it("records failure without moving V1 binding", async () => {
    const f = fixture();
    await f.repository.recordReplacementFailure(f.asset);
    expect(f.history()).toEqual([
      expect.objectContaining({
        previousMediaAssetId: f.active,
        replacementMediaAssetId: f.asset.mediaAssetId,
        changedBy: f.asset.ownerUserId,
        changedAt: f.asset.audit[0]?.at,
        status: "FAILED",
        recordedBy: "media-worker",
        failureCode: "MEDIA_PROCESSING_FAILED",
      }),
    ]);
  });
  it("repairs interrupted audit idempotently on retry", async () => {
    const f = fixture();
    await f.repository.recordReplacementFailure(f.asset);
    await f.repository.recordReplacementFailure(f.asset);
    expect(f.history()).toHaveLength(1);
    expect(f.updates()).toBe(1);
  });
  it("does not overwrite a concurrent history update", async () => {
    const f = fixture();
    f.conflict();
    await f.repository.recordReplacementFailure(f.asset);
    expect(f.history()).toHaveLength(2);
    expect(f.history()[0]?.status).toBe("APPLIED");
    expect(f.updates()).toBe(2);
  });
  it("does not call a failed first upload a replacement", async () => {
    const f = fixture();
    f.asset.mediaAssetId = f.active;
    await f.repository.recordReplacementFailure(f.asset);
    expect(f.updates()).toBe(0);
  });
  it("does not invent historical V1 for a legacy payload", async () => {
    const f = fixture();
    delete f.asset.replacementOfMediaAssetId;
    await f.repository.recordReplacementFailure(f.asset);
    expect(f.updates()).toBe(0);
  });
});
