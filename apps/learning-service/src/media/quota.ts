import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import type { MediaAsset } from "./model.js";

export interface QuotaLimits {
  tenantOriginalBytes: number;
  tenantDerivedBytes: number;
  courseOriginalBytes: number;
  courseDerivedBytes: number;
  tenantAssets: number;
  courseAssets: number;
}
export interface MediaReservation {
  reservationId: string;
  tenantId: string;
  courseId: string;
  mediaAssetId: string;
  reservedBytes: number;
  reservedDerivedBytes: number;
  originalBytes: number;
  derivedBytes: number;
  expiresAt: string;
  state: "RESERVED" | "STORED" | "RELEASED";
}
export interface QuotaLedger {
  revision: number;
  reconciled: boolean;
  reservations: Record<string, MediaReservation>;
}
export interface QuotaStore {
  read(tenantId: string): Promise<QuotaLedger>;
  cas(tenantId: string, old: QuotaLedger, next: QuotaLedger): Promise<boolean>;
}
export class CassandraQuotaStore implements QuotaStore {
  constructor(private readonly db: CassandraClient) {}
  async read(tenantId: string): Promise<QuotaLedger> {
    const row = (
      await this.db.execute(
        "SELECT revision,payload FROM media_quota_by_tenant WHERE tenant_id=?",
        [types.Uuid.fromString(tenantId)],
        "LOCAL_QUORUM",
      )
    )[0];
    if (!row) return { revision: 0, reconciled: false, reservations: {} };
    const payload = JSON.parse(String(row.payload)) as Partial<QuotaLedger> & { formatVersion?: number };
    if (payload.formatVersion !== 1 || typeof payload.reconciled !== "boolean" || !payload.reservations)
      throw Error("MEDIA_QUOTA_LEDGER_FORMAT_INVALID");
    return {
      revision: Number(row.revision),
      reconciled: payload.reconciled,
      reservations: payload.reservations,
    };
  }
  async cas(tenantId: string, old: QuotaLedger, next: QuotaLedger) {
    const id = types.Uuid.fromString(tenantId);
    const revision = types.Long.fromNumber(next.revision);
    const payload = JSON.stringify({
      formatVersion: 1,
      reconciled: next.reconciled,
      reservations: next.reservations,
    });
    const rows =
      old.revision === 0
        ? await this.db.execute(
            "INSERT INTO media_quota_by_tenant (tenant_id,revision,payload) VALUES (?,?,?) IF NOT EXISTS",
            [id, revision, payload],
            "LOCAL_QUORUM",
            "LOCAL_SERIAL",
          )
        : await this.db.execute(
            "UPDATE media_quota_by_tenant SET revision=?,payload=? WHERE tenant_id=? IF revision=?",
            [revision, payload, id, types.Long.fromNumber(old.revision)],
            "LOCAL_QUORUM",
            "LOCAL_SERIAL",
          );
    return rows[0]?.["[applied]"] === true;
  }
}
export function quotaUsage(ledger: QuotaLedger, courseId?: string) {
  return Object.values(ledger.reservations).reduce(
    (sum, r) => {
      if (r.state === "RELEASED" || (courseId && r.courseId !== courseId)) return sum;
      return {
        originalBytes: sum.originalBytes + r.originalBytes,
        derivedBytes: sum.derivedBytes + r.derivedBytes,
        reservedOriginalBytes: sum.reservedOriginalBytes + r.reservedBytes,
        reservedDerivedBytes: sum.reservedDerivedBytes + r.reservedDerivedBytes,
        assetCount: sum.assetCount + 1,
      };
    },
    { originalBytes: 0, derivedBytes: 0, reservedOriginalBytes: 0, reservedDerivedBytes: 0, assetCount: 0 },
  );
}
export class MediaQuota {
  constructor(
    private readonly store: QuotaStore,
    private readonly limits: QuotaLimits,
  ) {}
  async snapshot(tenantId: string) {
    const ledger = await this.store.read(tenantId);
    if (!ledger.reconciled) throw Error("MEDIA_QUOTA_BACKFILL_REQUIRED");
    return quotaUsage(ledger);
  }
  private async change(tenantId: string, mutate: (ledger: QuotaLedger) => boolean, initializing = false) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const old = await this.store.read(tenantId);
      if (!initializing && !old.reconciled)
        throw new AppError("MEDIA_QUOTA_BACKFILL_REQUIRED", 503, "Media quota backfill is required", true);
      const next = structuredClone(old);
      if (!mutate(next)) return;
      next.revision++;
      if (await this.store.cas(tenantId, old, next)) return;
    }
    throw new AppError("MEDIA_QUOTA_BUSY", 503, "Media quota is busy; retry the same command", true);
  }
  // Operational bootstrap only: the caller must hold a maintenance window and
  // build a complete, bounded snapshot from metadata plus storage HEAD checks.
  // Once enabled this operation refuses to overwrite a live authoritative ledger.
  async initialize(tenantId: string, reservations: MediaReservation[]) {
    if (reservations.length > 2048) throw Error("MEDIA_QUOTA_LEDGER_CAPACITY");
    await this.change(
      tenantId,
      (ledger) => {
        if (ledger.reconciled) throw Error("MEDIA_QUOTA_ALREADY_RECONCILED");
        if (ledger.revision !== 0) throw Error("MEDIA_QUOTA_BOOTSTRAP_CONFLICT");
        for (const r of reservations) {
          if (
            r.tenantId !== tenantId ||
            r.reservationId !== r.mediaAssetId ||
            ledger.reservations[r.mediaAssetId] ||
            ![r.reservedBytes, r.reservedDerivedBytes, r.originalBytes, r.derivedBytes].every(
              (bytes) => Number.isSafeInteger(bytes) && bytes >= 0,
            )
          )
            throw Error("MEDIA_QUOTA_BACKFILL_INVALID");
          ledger.reservations[r.mediaAssetId] = structuredClone(r);
        }
        for (const courseId of new Set(reservations.map((r) => r.courseId))) this.enforce(ledger, courseId);
        ledger.reconciled = true;
        return true;
      },
      true,
    );
  }
  async reserve(asset: MediaAsset, derivedBudget: number) {
    await this.change(asset.tenantId, (ledger) => {
      const existing = ledger.reservations[asset.mediaAssetId];
      if (existing) {
        if (existing.courseId !== asset.courseId || existing.state === "RELEASED")
          throw new AppError(
            "MEDIA_RESERVATION_CLOSED",
            409,
            "Reservation is closed; create a new upload session",
          );
        return false;
      }
      // One bounded authoritative tenant row avoids partial cross-partition
      // reservations. Capacity exhaustion is fail-closed, never silent eviction.
      if (Object.keys(ledger.reservations).length >= 2048)
        throw new AppError(
          "MEDIA_QUOTA_LEDGER_CAPACITY",
          409,
          "Media ledger retention capacity requires reconciliation",
        );
      ledger.reservations[asset.mediaAssetId] = {
        reservationId: asset.mediaAssetId,
        tenantId: asset.tenantId,
        courseId: asset.courseId,
        mediaAssetId: asset.mediaAssetId,
        reservedBytes: asset.sizeBytes,
        reservedDerivedBytes: derivedBudget,
        originalBytes: 0,
        derivedBytes: 0,
        expiresAt: asset.uploadExpiresAt,
        state: "RESERVED",
      };
      this.enforce(ledger, asset.courseId);
      return true;
    });
  }
  private enforce(ledger: QuotaLedger, courseId: string) {
    const tenant = quotaUsage(ledger),
      course = quotaUsage(ledger, courseId),
      l = this.limits;
    if (
      tenant.originalBytes + tenant.reservedOriginalBytes > l.tenantOriginalBytes ||
      tenant.derivedBytes + tenant.reservedDerivedBytes > l.tenantDerivedBytes ||
      course.originalBytes + course.reservedOriginalBytes > l.courseOriginalBytes ||
      course.derivedBytes + course.reservedDerivedBytes > l.courseDerivedBytes ||
      tenant.assetCount > l.tenantAssets ||
      course.assetCount > l.courseAssets
    )
      throw new AppError("MEDIA_QUOTA_EXCEEDED", 413, "Media tenant or course quota exceeded");
  }
  async originalStored(asset: MediaAsset) {
    await this.change(asset.tenantId, (ledger) => {
      const r = ledger.reservations[asset.mediaAssetId];
      if (!r || r.state === "RELEASED") throw Error("MEDIA_RESERVATION_REQUIRED");
      if (r.originalBytes === asset.sizeBytes) return false;
      r.originalBytes = asset.sizeBytes;
      r.reservedBytes = 0;
      r.state = "STORED";
      this.enforce(ledger, asset.courseId);
      return true;
    });
  }
  async derivedStored(asset: MediaAsset, bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw Error("MEDIA_DERIVED_SIZE_INVALID");
    await this.change(asset.tenantId, (ledger) => {
      const r = ledger.reservations[asset.mediaAssetId];
      if (!r || r.state === "RELEASED" || r.originalBytes !== asset.sizeBytes)
        throw Error("MEDIA_RESERVATION_REQUIRED");
      if (r.derivedBytes === bytes && r.reservedDerivedBytes === 0) return false;
      r.derivedBytes = bytes;
      r.reservedDerivedBytes = 0;
      this.enforce(ledger, asset.courseId);
      return true;
    });
  }
  async release(asset: Pick<MediaAsset, "tenantId" | "mediaAssetId">) {
    await this.change(asset.tenantId, (ledger) => {
      const r = ledger.reservations[asset.mediaAssetId];
      if (!r || r.state === "RELEASED") return false;
      // Retained original bytes still count after validation rejection.
      r.reservedBytes = 0;
      r.reservedDerivedBytes = 0;
      r.state = r.originalBytes > 0 ? "STORED" : "RELEASED";
      return true;
    });
  }
  async expiredReservations(tenantId: string, now = Date.now()) {
    const ledger = await this.store.read(tenantId);
    if (!ledger.reconciled) return [];
    return Object.values(ledger.reservations)
      .filter(
        (r) =>
          r.state !== "RELEASED" &&
          (r.state === "RESERVED" || r.reservedBytes > 0 || r.reservedDerivedBytes > 0) &&
          Date.parse(r.expiresAt) <= now,
      )
      .slice(0, 16);
  }
}
