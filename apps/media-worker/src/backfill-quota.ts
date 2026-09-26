import { loadConfig } from "../../../packages/config/src/index.js";
import { CassandraClient } from "../../../packages/cassandra/src/index.js";
import { mediaRuntime } from "../../learning-service/src/media/config.js";
import {
  CassandraQuotaStore,
  MediaQuota,
  quotaUsage,
  type MediaReservation,
} from "../../learning-service/src/media/quota.js";
import { transition, type MediaAsset } from "../../learning-service/src/media/model.js";
import { CassandraMediaRepository } from "../../learning-service/src/media/repository.js";

// Run only through scripts/dev/backfill-media-quota.mjs, which checks both
// writers are stopped. No production auto-bootstrap and no ALLOW FILTERING.
if (!process.argv.includes("--maintenance-apply")) throw Error("MEDIA_MAINTENANCE_REQUIRED");
const config = loadConfig(),
  settings = mediaRuntime(config, false);
if (!settings || !config.CASSANDRA_USERNAME || !config.CASSANDRA_PASSWORD)
  throw Error("MEDIA_BACKFILL_CONFIGURATION_REQUIRED");
const db = await CassandraClient.create({
  contactPoints: config.CASSANDRA_CONTACT_POINTS.split(","),
  localDataCenter: config.CASSANDRA_LOCAL_DC,
  keyspace: "learning_keyspace",
  username: config.CASSANDRA_USERNAME,
  password: config.CASSANDRA_PASSWORD,
});
try {
  const store = new CassandraQuotaStore(db),
    repository = new CassandraMediaRepository(db);
  const before = await store.read(config.PLATFORM_TENANT_ID);
  if (before.reconciled) throw Error("MEDIA_QUOTA_ALREADY_RECONCILED");
  const reservations: MediaReservation[] = [];
  const profiles = settings.policy.profiles;
  if (!profiles?.length) throw Error("MEDIA_BACKFILL_PROFILES_REQUIRED");
  const derivedBudget = Math.ceil(
    ((profiles.reduce((sum, p) => sum + p.maxBitrate + p.audioBitrate, 0) *
      settings.policy.maxDurationSeconds) /
      8) *
      1.1 +
      1048576,
  );
  let pageState: string | undefined;
  let scanned = 0;
  do {
    // Migration 085 has a compound partition key (tenant, asset). A bounded
    // operational scan is required for legacy discovery; never ALLOW FILTERING
    // and never run this query from a request/worker hot path.
    const page = await db.executePage(
      "SELECT tenant_id,payload FROM media_asset_by_tenant_id",
      [],
      "LOCAL_QUORUM",
      64,
      pageState,
    );
    for (const row of page.rows) {
      if (++scanned > 65536) throw Error("MEDIA_BACKFILL_SCAN_CAPACITY_EXCEEDED");
      if (String(row.tenant_id) !== config.PLATFORM_TENANT_ID) continue;
      let asset = JSON.parse(String(row.payload)) as MediaAsset;
      if (asset.tenantId !== config.PLATFORM_TENANT_ID) throw Error("MEDIA_BACKFILL_SCOPE_INVALID");
      if (["UPLOADED", "VERIFYING", "QUEUED", "PROCESSING"].includes(asset.status))
        throw Error("MEDIA_BACKFILL_PENDING_JOB_REQUIRED");
      if (
        ["CREATED", "UPLOADING"].includes(asset.status) &&
        Date.parse(asset.uploadExpiresAt) <= Date.now()
      ) {
        if (asset.uploadId) {
          try {
            await settings.storage.abort(asset.originalObjectKey, asset.uploadId);
          } catch (error) {
            if (!error || typeof error !== "object" || !("code" in error) || error.code !== "NoSuchUpload")
              throw error;
          }
        }
        const next = transition(asset, "DELETED", "media-quota-backfill");
        if (!(await repository.replace(asset, next))) throw Error("MEDIA_BACKFILL_WRITE_CONFLICT");
        asset = next;
      }
      let originalBytes = 0;
      try {
        originalBytes = (await settings.storage.stat(asset.originalObjectKey)).size;
        if (originalBytes !== asset.sizeBytes) throw Error("MEDIA_BACKFILL_ORIGINAL_SIZE_INVALID");
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          !["NoSuchKey", "NotFound"].includes(String(error.code))
        )
          throw error;
        if (["READY", "QUARANTINED", "FAILED"].includes(asset.status))
          throw Error("MEDIA_BACKFILL_ORIGINAL_MISSING");
      }
      let derivedBytes = 0;
      if (asset.status === "READY") {
        const master = asset.masterPlaylistObjectKey;
        if (!master || !/^media-hls\/[0-9a-f-]+\/[0-9a-f-]+\/\d+\/[0-9a-f-]+\/master\.m3u8$/.test(master))
          throw Error("MEDIA_BACKFILL_MASTER_INVALID");
        const prefix = master.slice(0, -"master.m3u8".length);
        const text = async (key: string) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of await settings.storage.readStream(key)) {
            const value: unknown = chunk;
            if (!Buffer.isBuffer(value)) throw Error("MEDIA_BACKFILL_STREAM_INVALID");
            bytes += value.length;
            if (bytes > 1048576) throw Error("MEDIA_BACKFILL_PLAYLIST_TOO_LARGE");
            chunks.push(value);
          }
          return Buffer.concat(chunks).toString("utf8");
        };
        const variants = (await text(master)).split("\n").filter((line) => line && !line.startsWith("#"));
        if (!variants.length || variants.some((v) => !/^variant(?:-\d+)?\.m3u8$/.test(v)))
          throw Error("MEDIA_BACKFILL_VARIANT_INVALID");
        const keys = new Set([master]);
        for (const variant of variants) {
          keys.add(prefix + variant);
          const segments = (await text(prefix + variant))
            .split("\n")
            .filter((line) => line && !line.startsWith("#"));
          if (!segments.length || segments.some((s) => !/^segment-(?:\d+-)?\d{5}\.ts$/.test(s)))
            throw Error("MEDIA_BACKFILL_SEGMENT_INVALID");
          for (const segment of segments) keys.add(prefix + segment);
        }
        if (asset.posterObjectKey) {
          if (asset.posterObjectKey !== prefix + "poster.jpg")
            throw Error("MEDIA_BACKFILL_POSTER_SCOPE_INVALID");
          keys.add(asset.posterObjectKey);
        }
        for (const key of keys) {
          const size = (await settings.storage.stat(key)).size;
          if (size <= 0) throw Error("MEDIA_BACKFILL_DERIVED_EMPTY");
          derivedBytes += size;
        }
      }
      const pending = ["CREATED", "UPLOADING"].includes(asset.status);
      reservations.push({
        reservationId: asset.mediaAssetId,
        tenantId: asset.tenantId,
        courseId: asset.courseId,
        mediaAssetId: asset.mediaAssetId,
        originalBytes,
        derivedBytes,
        reservedBytes: pending && originalBytes === 0 ? asset.sizeBytes : 0,
        reservedDerivedBytes: pending ? derivedBudget : 0,
        expiresAt: asset.uploadExpiresAt,
        state: pending && originalBytes === 0 ? "RESERVED" : originalBytes > 0 ? "STORED" : "RELEASED",
      });
      if (reservations.length > 2048) throw Error("MEDIA_QUOTA_LEDGER_CAPACITY");
    }
    pageState = page.pageState;
  } while (pageState);
  await new MediaQuota(store, settings.quotaLimits).initialize(config.PLATFORM_TENANT_ID, reservations);
  const ledger = await store.read(config.PLATFORM_TENANT_ID);
  console.log(
    `MEDIA_QUOTA_BACKFILL_PASS assets=${String(reservations.length)} revision=${String(ledger.revision)} usage=${JSON.stringify(quotaUsage(ledger))}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "MEDIA_QUOTA_BACKFILL_FAILED");
  process.exitCode = 1;
} finally {
  await db.close();
}
