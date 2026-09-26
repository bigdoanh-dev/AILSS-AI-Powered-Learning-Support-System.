import { types } from "cassandra-driver";
import { z } from "zod";
import type { CassandraClient } from "../../../packages/cassandra/src/index.js";
import type { MediaAsset } from "../../learning-service/src/media/model.js";
import type { MediaJob } from "../../learning-service/src/media/repository.js";
import type { MediaObjectStorage } from "../../../packages/storage/src/media.js";
import type { MediaEvent } from "../../../packages/observability/src/media.js";

const schema = z
  .object({
    tenantId: z.string().uuid(),
    mediaAssetId: z.string().uuid(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    shard: z.number().int().min(0).max(3),
    lease: z.string().uuid(),
    revision: z.number().int().positive(),
    prefix: z.string(),
    keys: z.array(z.string()).min(1).max(20_000),
    state: z.enum(["PENDING", "RETAINED", "CLEANED"]),
    failures: z.number().int().nonnegative(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type OutputIntent = z.infer<typeof schema>;
export function validateOutputIntent(raw: unknown): OutputIntent {
  const value = schema.parse(raw);
  const root = `media-hls/${value.tenantId}/${value.mediaAssetId}/`;
  if (
    !value.prefix.startsWith(root) ||
    !new RegExp(`^${root}[1-9][0-9]*/${value.lease}$`).test(value.prefix) ||
    new Set(value.keys).size !== value.keys.length ||
    value.keys.some(
      (key) =>
        !key.startsWith(`${value.prefix}/`) ||
        !/^(master\.m3u8|variant-\d+\.m3u8|segment-\d+-\d{5}\.ts|poster\.jpg)$/.test(
          key.slice(value.prefix.length + 1),
        ),
    )
  )
    throw Error("MEDIA_OUTPUT_JOURNAL_SCOPE_REJECTED");
  return value;
}
export interface OutputJournal {
  begin(job: MediaJob, lease: string, prefix: string, keys: string[]): Promise<OutputIntent>;
  cas(old: OutputIntent, state: OutputIntent["state"], failed?: boolean): Promise<boolean>;
  page(
    tenantId: string,
    day: string,
    shard: number,
    cursor?: string,
  ): Promise<{ intents: OutputIntent[]; cursor?: string }>;
}
const key = (value: Pick<OutputIntent, "tenantId" | "day" | "shard" | "mediaAssetId" | "lease">) => [
  types.Uuid.fromString(value.tenantId),
  types.LocalDate.fromString(value.day),
  value.shard,
  types.Uuid.fromString(value.mediaAssetId),
  types.Uuid.fromString(value.lease),
];
export class CassandraOutputJournal implements OutputJournal {
  constructor(private readonly db: CassandraClient) {}
  async begin(job: MediaJob, lease: string, prefix: string, keys: string[]) {
    const intent = validateOutputIntent({
      tenantId: job.tenantId,
      mediaAssetId: job.mediaAssetId,
      day: job.day,
      shard: job.shard,
      lease,
      prefix,
      keys,
      revision: 1,
      state: "PENDING",
      failures: 0,
      updatedAt: new Date().toISOString(),
    });
    // Index first, intent second, PUT last. A crash cannot hide written objects.
    await this.db.execute(
      "INSERT INTO media_queue_day_by_tenant (tenant_id,job_day) VALUES (?,?)",
      key(intent).slice(0, 2),
      "LOCAL_QUORUM",
    );
    const result = await this.db.execute(
      "INSERT INTO media_output_journal_by_day_shard (tenant_id,job_day,shard,media_asset_id,lease,revision,payload) VALUES (?,?,?,?,?,?,?) IF NOT EXISTS",
      [...key(intent), types.Long.fromNumber(1), JSON.stringify(intent)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (result[0]?.["[applied]"] !== true) throw Error("MEDIA_OUTPUT_JOURNAL_CONFLICT");
    return intent;
  }
  async cas(old: OutputIntent, state: OutputIntent["state"], failed = false) {
    validateOutputIntent(old);
    const next = {
      ...old,
      state,
      revision: old.revision + 1,
      failures: old.failures + Number(failed),
      updatedAt: new Date().toISOString(),
    };
    const result = await this.db.execute(
      "UPDATE media_output_journal_by_day_shard SET revision=?,payload=? WHERE tenant_id=? AND job_day=? AND shard=? AND media_asset_id=? AND lease=? IF revision=?",
      [
        types.Long.fromNumber(next.revision),
        JSON.stringify(next),
        ...key(old),
        types.Long.fromNumber(old.revision),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return result[0]?.["[applied]"] === true;
  }
  async page(tenantId: string, day: string, shard: number, cursor?: string) {
    const page = await this.db.executePage(
      "SELECT payload FROM media_output_journal_by_day_shard WHERE tenant_id=? AND job_day=? AND shard=?",
      [types.Uuid.fromString(tenantId), types.LocalDate.fromString(day), shard],
      "LOCAL_QUORUM",
      16,
      cursor,
    );
    const intents = page.rows.map((row) => validateOutputIntent(JSON.parse(String(row.payload))));
    if (
      intents.some((intent) => intent.tenantId !== tenantId || intent.day !== day || intent.shard !== shard)
    )
      throw Error("MEDIA_OUTPUT_JOURNAL_PARTITION_REJECTED");
    return { intents, ...(page.pageState ? { cursor: page.pageState } : {}) };
  }
}
export interface OutputRecoveryRepository {
  get(tenantId: string, id: string): Promise<MediaAsset | undefined>;
  job(tenantId: string, day: string, shard: number, id: string): Promise<MediaJob | undefined>;
  replace(old: MediaAsset, next: MediaAsset): Promise<boolean>;
}
function missingObject(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["NoSuchKey", "NotFound", "NoSuchObject"].includes(String(error.code))
  );
}
export async function recoverOutputIntent(
  raw: OutputIntent,
  journal: OutputJournal,
  repository: OutputRecoveryRepository,
  storage: MediaObjectStorage,
  event: (event: MediaEvent) => void,
) {
  const intent = validateOutputIntent(raw);
  if (intent.state === "RETAINED") return;
  // Asset first: a successful-but-ambiguous READY CAS is authoritative, not the journal.
  const asset = await repository.get(intent.tenantId, intent.mediaAssetId);
  if (asset?.masterPlaylistObjectKey === `${intent.prefix}/master.m3u8`) {
    await journal.cas(intent, "RETAINED");
    return;
  }
  const job = await repository.job(intent.tenantId, intent.day, intent.shard, intent.mediaAssetId);
  if (job?.lease === intent.lease && job.leaseUntil && job.leaseUntil.getTime() > Date.now()) return;
  // READY and lease metadata live in different partitions. Fence the expired
  // asset revision before deletion, so a delayed owner cannot activate it in
  // the gap between these reads and object removal. A competing READY CAS wins
  // safely: we do not delete and the next sweep observes its authoritative key.
  if (asset?.processingLease === intent.lease) {
    const fenced = { ...asset, revision: asset.revision + 1, updatedAt: new Date().toISOString() };
    delete fenced.processingLease;
    if (!(await repository.replace(asset, fenced))) return;
  }
  try {
    let removed = false;
    for (const objectKey of intent.keys) {
      try {
        await storage.stat(objectKey);
      } catch (error) {
        if (missingObject(error)) continue;
        throw error;
      }
      await storage.remove(objectKey);
      removed = true;
    }
    // Resolved rows keep their exact keys, so late fenced PUTs are revisited.
    if (intent.state !== "CLEANED" || removed) {
      if (await journal.cas(intent, "CLEANED")) event("derived_cleanup_completed");
    }
  } catch {
    await journal.cas(intent, "PENDING", true);
    event("derived_cleanup_failed");
  }
}
