import type { MediaStore } from "../../learning-service/src/media/repository.js";
import type { MediaQuota } from "../../learning-service/src/media/quota.js";
import { transition } from "../../learning-service/src/media/model.js";
import type { MediaObjectStorage } from "../../../packages/storage/src/media.js";
import type { MediaEvent } from "../../../packages/observability/src/media.js";

export async function cleanupExpiredUploads(
  tenantId: string,
  repository: MediaStore,
  storage: MediaObjectStorage,
  quota: MediaQuota,
  event: (name: MediaEvent) => void,
) {
  for (const r of await quota.expiredReservations(tenantId)) {
    try {
      const asset = await repository.get(tenantId, r.mediaAssetId);
      // Reservation is persisted before MediaAsset, and S3 initiation occurs
      // only after that insert. Missing metadata cannot have issued upload URLs.
      if (!asset) {
        await quota.release(r);
        event("upload_cleanup_completed");
        continue;
      }
      if (!["CREATED", "UPLOADING", "DELETED"].includes(asset.status)) continue;
      if (asset.status !== "DELETED" && asset.uploadId) {
        try {
          await storage.abort(asset.originalObjectKey, asset.uploadId);
        } catch (error) {
          if (!error || typeof error !== "object" || !("code" in error) || error.code !== "NoSuchUpload")
            throw error;
          // Ambiguous completion may already have stored an original. Keep it
          // and charge it rather than granting quota based on an assumption.
          try {
            const original = await storage.stat(asset.originalObjectKey);
            if (original.size !== asset.sizeBytes) throw Error("MEDIA_CLEANUP_SIZE_MISMATCH");
            await quota.originalStored(asset);
          } catch (statError) {
            if (
              !statError ||
              typeof statError !== "object" ||
              !("code" in statError) ||
              !["NoSuchKey", "NotFound"].includes(String(statError.code))
            )
              throw statError;
          }
        }
      }
      if (asset.status !== "DELETED") {
        const next = transition(asset, "DELETED", "media-cleanup");
        if (!(await repository.replace(asset, next))) continue;
      }
      await quota.release(asset);
      event("upload_cleanup_completed");
    } catch {
      event("upload_cleanup_failed");
    }
  }
}
