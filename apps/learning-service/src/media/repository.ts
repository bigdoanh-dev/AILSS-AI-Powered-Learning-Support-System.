import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { MediaAsset } from "./model.js";
const uuid = (s: string) => types.Uuid.fromString(s);
const long = (n: number) => types.Long.fromNumber(n);
export interface MediaJob {
  tenantId: string;
  mediaAssetId: string;
  day: string;
  shard: number;
  revision: number;
  lease: string | null;
  leaseUntil: Date | null;
  attempts: number;
}
export interface MediaStore {
  acquireCourseWrite(courseId: string, lease: string): Promise<boolean>;
  releaseCourseWrite(courseId: string, lease: string): Promise<void>;
  get(tenantId: string, id: string): Promise<MediaAsset | undefined>;
  insert(asset: MediaAsset): Promise<boolean>;
  replace(old: MediaAsset, next: MediaAsset): Promise<boolean>;
  bind(asset: MediaAsset, replace: boolean): Promise<void>;
  binding(tenantId: string, lessonId: string): Promise<string | undefined>;
  enqueue(asset: MediaAsset): Promise<void>;
}
export class CassandraMediaRepository implements MediaStore {
  constructor(private readonly db: CassandraClient) {}
  async acquireCourseWrite(courseId: string, lease: string) {
    const row = (
      await this.db.execute(
        "SELECT media_write_token,media_write_until FROM course_by_id WHERE course_id=?",
        [uuid(courseId)],
        "LOCAL_QUORUM",
      )
    )[0];
    // No automatic lock expiry: a delayed old writer must never outlive the
    // publication fence. Replaying the same idempotent command recovers its lock.
    if (!row || (row.media_write_token && String(row.media_write_token) !== lease)) return false;
    const result = await this.db.execute(
      "UPDATE course_by_id SET media_write_token=?,media_write_until=? WHERE course_id=? IF state='DRAFT' AND media_write_token=?",
      [uuid(lease), new Date(Date.now() + 60000), uuid(courseId), row.media_write_token ?? null],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return result[0]?.["[applied]"] === true;
  }
  async releaseCourseWrite(courseId: string, lease: string) {
    await this.db.execute(
      "UPDATE course_by_id SET media_write_token=null,media_write_until=null WHERE course_id=? IF media_write_token=?",
      [uuid(courseId), uuid(lease)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async get(tenantId: string, id: string): Promise<MediaAsset | undefined> {
    const r = (
      await this.db.execute(
        "SELECT payload FROM media_asset_by_tenant_id WHERE tenant_id=? AND media_asset_id=?",
        [uuid(tenantId), uuid(id)],
        "LOCAL_QUORUM",
      )
    )[0];
    return r ? (JSON.parse(String(r.payload)) as MediaAsset) : undefined;
  }
  async insert(a: MediaAsset) {
    return (
      (
        await this.db.execute(
          "INSERT INTO media_asset_by_tenant_id (tenant_id,media_asset_id,revision,payload) VALUES (?,?,?,?) IF NOT EXISTS",
          [uuid(a.tenantId), uuid(a.mediaAssetId), long(a.revision), JSON.stringify(a)],
          "LOCAL_QUORUM",
          "LOCAL_SERIAL",
        )
      )[0]?.["[applied]"] === true
    );
  }
  async replace(old: MediaAsset, next: MediaAsset) {
    if (
      next.revision !== old.revision + 1 ||
      old.tenantId !== next.tenantId ||
      old.mediaAssetId !== next.mediaAssetId
    )
      throw Error("INVALID_MEDIA_CAS");
    return (
      (
        await this.db.execute(
          "UPDATE media_asset_by_tenant_id SET revision=?,payload=? WHERE tenant_id=? AND media_asset_id=? IF revision=?",
          [
            long(next.revision),
            JSON.stringify(next),
            uuid(old.tenantId),
            uuid(old.mediaAssetId),
            long(old.revision),
          ],
          "LOCAL_QUORUM",
          "LOCAL_SERIAL",
        )
      )[0]?.["[applied]"] === true
    );
  }
  async binding(tenantId: string, lessonId: string) {
    const r = (
      await this.db.execute(
        "SELECT media_asset_id FROM media_asset_by_lesson WHERE tenant_id=? AND lesson_id=?",
        [uuid(tenantId), uuid(lessonId)],
        "LOCAL_QUORUM",
      )
    )[0];
    return r ? String(r.media_asset_id) : undefined;
  }
  async bind(a: MediaAsset, replace: boolean): Promise<void> {
    // First upload marks the lesson's required media immediately; publish must wait
    // for READY. Replacement switches only after the new asset is READY.
    if (!replace) {
      await this.db.execute(
        "INSERT INTO media_asset_by_lesson (tenant_id,lesson_id,media_asset_id) VALUES (?,?,?) IF NOT EXISTS",
        [uuid(a.tenantId), uuid(a.lessonId), uuid(a.mediaAssetId)],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
    } else {
      if (a.status !== "READY") throw Error("MEDIA_NOT_READY");
      const current = await this.binding(a.tenantId, a.lessonId);
      if (!current) return this.bind(a, false);
      const r = await this.db.execute(
        "UPDATE media_asset_by_lesson SET media_asset_id=? WHERE tenant_id=? AND lesson_id=? IF media_asset_id=?",
        [uuid(a.mediaAssetId), uuid(a.tenantId), uuid(a.lessonId), uuid(current)],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
      if (r[0]?.["[applied]"] !== true) throw Error("MEDIA_BINDING_CONFLICT");
    }
  }
  async enqueue(a: MediaAsset) {
    const day = a.jobDay ?? a.updatedAt.slice(0, 10),
      shard = Number.parseInt(a.mediaAssetId.slice(0, 2), 16) % 4;
    await this.db.execute(
      "INSERT INTO media_queue_day_by_tenant (tenant_id,job_day) VALUES (?,?)",
      [uuid(a.tenantId), types.LocalDate.fromString(day)],
      "LOCAL_QUORUM",
    );
    await this.db.execute(
      "INSERT INTO media_job_by_day_shard (tenant_id,job_day,shard,media_asset_id,revision,attempts) VALUES (?,?,?,?,1,0) IF NOT EXISTS",
      [uuid(a.tenantId), types.LocalDate.fromString(day), shard, uuid(a.mediaAssetId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async days(tenantId: string, after?: string): Promise<string[]> {
    const rows = await this.db.execute(
      `SELECT job_day FROM media_queue_day_by_tenant WHERE tenant_id=?${after ? " AND job_day>?" : ""} LIMIT 32`,
      [uuid(tenantId), ...(after ? [types.LocalDate.fromString(after)] : [])],
      "LOCAL_QUORUM",
    );
    return rows.map((row) => String(row.job_day));
  }
  async jobs(tenantId: string, day: string, shard: number): Promise<MediaJob[]> {
    const rows = await this.db.execute(
      "SELECT media_asset_id,revision,attempts,lease,lease_until FROM media_job_by_day_shard WHERE tenant_id=? AND job_day=? AND shard=? LIMIT 100",
      [uuid(tenantId), types.LocalDate.fromString(day), shard],
      "LOCAL_QUORUM",
    );
    return rows.map((r) => ({
      tenantId,
      mediaAssetId: String(r.media_asset_id),
      day,
      shard,
      revision: Number(r.revision),
      attempts: Number(r.attempts),
      lease: r.lease ? String(r.lease) : null,
      leaseUntil: r.lease_until ? new Date(String(r.lease_until)) : null,
    }));
  }
  async claim(j: MediaJob, lease: string, leaseUntil: Date) {
    if (j.leaseUntil && j.leaseUntil.getTime() > Date.now()) return false;
    const r = await this.db.execute(
      "UPDATE media_job_by_day_shard SET revision=?,attempts=?,lease=?,lease_until=? WHERE tenant_id=? AND job_day=? AND shard=? AND media_asset_id=? IF revision=?",
      [
        long(j.revision + 1),
        j.attempts + 1,
        uuid(lease),
        leaseUntil,
        uuid(j.tenantId),
        types.LocalDate.fromString(j.day),
        j.shard,
        uuid(j.mediaAssetId),
        long(j.revision),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return r[0]?.["[applied]"] === true;
  }
  async release(j: MediaJob, lease: string, done: boolean) {
    const key = [
      uuid(j.tenantId),
      types.LocalDate.fromString(j.day),
      j.shard,
      uuid(j.mediaAssetId),
      uuid(lease),
    ];
    if (done)
      await this.db.execute(
        "DELETE FROM media_job_by_day_shard WHERE tenant_id=? AND job_day=? AND shard=? AND media_asset_id=? IF lease=?",
        key,
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
    else
      await this.db.execute(
        "UPDATE media_job_by_day_shard SET lease=null,lease_until=null WHERE tenant_id=? AND job_day=? AND shard=? AND media_asset_id=? IF lease=?",
        key,
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
  }
}
