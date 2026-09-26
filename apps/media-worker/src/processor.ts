import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile, rm, open } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { MediaObjectStorage } from "../../../packages/storage/src/media.js";
import { transition, type MediaAsset, type MediaPolicy } from "../../learning-service/src/media/model.js";
import type { CassandraMediaRepository, MediaJob } from "../../learning-service/src/media/repository.js";
import type { createMediaMetrics } from "../../../packages/observability/src/media.js";
const run = promisify(execFile);
const probeSchema = z.object({
  format: z.object({ format_name: z.string(), duration: z.string() }),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  ),
});
export function probeMetadata(raw: unknown, policy: MediaPolicy) {
  const p = probeSchema.parse(raw),
    v = p.streams.find((s) => s.codec_type === "video"),
    a = p.streams.find((s) => s.codec_type === "audio"),
    duration = Number(p.format.duration);
  if (
    !v ||
    !v.width ||
    !v.height ||
    v.width < 2 ||
    v.height < 2 ||
    v.width > 8192 ||
    v.height > 8192 ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > policy.maxDurationSeconds ||
    !policy.allowedVideoCodecs.includes(v.codec_name) ||
    (a && !policy.allowedAudioCodecs.includes(a.codec_name)) ||
    !p.format.format_name.split(",").some((x) => policy.allowedContainers.includes(x))
  )
    throw Error("MEDIA_POLICY_REJECTED");
  return {
    durationMs: Math.round(duration * 1000),
    width: v.width,
    height: v.height,
    videoCodec: v.codec_name,
    ...(a ? { audioCodec: a.codec_name } : {}),
    container: p.format.format_name,
  };
}
export function renditionSize(width: number, height: number, maximumHeight: number) {
  const targetHeight = Math.max(2, Math.floor(Math.min(height, maximumHeight) / 2) * 2);
  return { height: targetHeight, width: Math.max(2, Math.floor((width * targetHeight) / height / 2) * 2) };
}
export class MediaProcessor {
  constructor(
    private readonly repository: CassandraMediaRepository,
    private readonly storage: MediaObjectStorage,
    private readonly policy: MediaPolicy,
    private readonly metrics: ReturnType<typeof createMediaMetrics>,
  ) {}
  async handle(job: MediaJob) {
    const lease = randomUUID();
    if (
      !(await this.repository.claim(
        job,
        lease,
        new Date(Date.now() + this.policy.processingTimeoutMs * 4 + 60000),
      ))
    )
      return;
    let a = await this.repository.get(job.tenantId, job.mediaAssetId);
    if (!a || ["READY", "DELETED", "QUARANTINED"].includes(a.status)) {
      await this.repository.release(job, lease, true);
      return;
    }
    if (job.attempts >= 3) {
      if (a.status !== "FAILED")
        await this.repository.replace(a, {
          ...transition(a, "FAILED", "media-worker"),
          processingLease: lease,
          failureCode: "MEDIA_RETRY_EXHAUSTED",
        });
      await this.repository.release(job, lease, true);
      return;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "ailss-media-"));
    const finish = this.metrics.processingDuration.startTimer();
    const prefix = `media-hls/${a.tenantId}/${a.mediaAssetId}/${String(a.processingVersion)}/${lease}`;
    const outputs: string[] = [];
    try {
      // Transfer the processing fence before any work. A previous expired worker
      // cannot activate its output after this CAS succeeds.
      const fenced = {
        ...a,
        processingLease: lease,
        revision: a.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      if (!(await this.repository.replace(a, fenced))) throw Error("MEDIA_LEASE_CONFLICT");
      a = fenced;
      if (a.status === "FAILED") a = await this.save(a, transition(a, "VERIFYING", "media-worker"));
      if (a.status === "UPLOADED") a = await this.save(a, transition(a, "VERIFYING", "media-worker"));
      const source = path.join(directory, "source.bin"),
        hash = createHash("sha256");
      let bytes = 0;
      const declaredBytes = a.sizeBytes;
      const limit = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          hash.update(chunk);
          if (bytes > declaredBytes) callback(Error("MEDIA_SOURCE_SIZE_REJECTED"));
          else callback(null, chunk);
        },
      });
      await pipeline(await this.storage.readStream(a.originalObjectKey), limit, createWriteStream(source), {
        signal: AbortSignal.timeout(this.policy.processingTimeoutMs),
      });
      if (bytes !== a.sizeBytes || bytes > this.policy.maxSourceBytes)
        throw Error("MEDIA_SOURCE_SIZE_REJECTED");
      const sourceHash = hash.digest("hex");
      if (a.sourceSha256 && a.sourceSha256 !== sourceHash) throw Error("MEDIA_CHECKSUM_REJECTED");
      const file = await open(source, "r");
      const magic = Buffer.alloc(16);
      try {
        await file.read(magic, 0, 16, 0);
      } finally {
        await file.close();
      }
      if (magic.subarray(4, 8).toString() !== "ftyp" && magic.subarray(0, 4).toString("hex") !== "1a45dfa3")
        throw Error("MEDIA_CONTAINER_SIGNATURE_REJECTED");
      let stdout: string;
      try {
        ({ stdout } = await run(
          "ffprobe",
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            source,
          ],
          { timeout: 20000, maxBuffer: 1024 * 1024 },
        ));
      } catch (e) {
        if (e instanceof Error && "code" in e && e.code === "ENOENT") throw e;
        throw Error("MEDIA_PROBE_REJECTED");
      }
      let info: ReturnType<typeof probeMetadata>;
      try {
        info = probeMetadata(JSON.parse(stdout), this.policy);
      } catch {
        throw Error("MEDIA_POLICY_REJECTED");
      }
      if (a.status === "VERIFYING")
        a = await this.save(a, {
          ...transition(a, "QUEUED", "media-worker"),
          ...info,
          sourceSha256: sourceHash,
        });
      this.metrics.event("media_processing_queued");
      if (a.status === "QUEUED") a = await this.save(a, transition(a, "PROCESSING", "media-worker"));
      if (a.status !== "PROCESSING") throw Error("MEDIA_PROCESSING_STATE_REJECTED");
      const size = renditionSize(info.width, info.height, this.policy.renditionHeight);
      await run(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          source,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-vf",
          `scale=${String(size.width)}:${String(size.height)}`,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-threads",
          "2",
          "-preset",
          "veryfast",
          "-b:v",
          String(this.policy.videoBitrate),
          "-c:a",
          "aac",
          "-b:a",
          "96000",
          "-force_key_frames",
          "expr:gte(t,n_forced*2)",
          "-f",
          "hls",
          "-hls_time",
          "2",
          "-hls_list_size",
          "0",
          "-hls_playlist_type",
          "vod",
          "-hls_flags",
          "independent_segments",
          "-hls_segment_filename",
          path.join(directory, "segment-%05d.ts"),
          path.join(directory, "variant.m3u8"),
        ],
        { timeout: this.policy.processingTimeoutMs, maxBuffer: 1024 * 1024 },
      );
      const variant = await readFile(path.join(directory, "variant.m3u8"), "utf8");
      if (!variant.startsWith("#EXTM3U") || !variant.includes("#EXT-X-ENDLIST"))
        throw Error("MEDIA_HLS_INVALID");
      await writeFile(
        path.join(directory, "master.m3u8"),
        `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=${String(this.policy.videoBitrate + 128000)},RESOLUTION=${String(size.width)}x${String(size.height)}\nvariant.m3u8\n`,
      );
      for (const name of (await readdir(directory)).filter((n) =>
        /^(master|variant)\.m3u8$|^segment-\d{5}\.ts$/.test(n),
      )) {
        const key = `${prefix}/${name}`;
        outputs.push(key);
        await this.storage.writeFile(
          key,
          path.join(directory, name),
          name.endsWith(".ts") ? "video/mp2t" : "application/vnd.apple.mpegurl",
        );
      }
      // Re-read the fence before READY; all objects have been written privately.
      const current = await this.repository.get(a.tenantId, a.mediaAssetId);
      if (!current || current.processingLease !== lease || current.status !== "PROCESSING")
        throw Error("MEDIA_LEASE_CONFLICT");
      a = await this.save(current, {
        ...transition(current, "READY", "media-worker"),
        ...info,
        sourceSha256: sourceHash,
        masterPlaylistObjectKey: `${prefix}/master.m3u8`,
        availableRenditions: [{ ...size, bitrate: this.policy.videoBitrate }],
      });
      this.metrics.event("media_ready");
      await this.repository.release(job, lease, true);
    } catch (error) {
      const code = error instanceof Error ? error.message : "MEDIA_PROCESSING_FAILED";
      const invalid = /^MEDIA_(POLICY|CHECKSUM|CONTAINER_SIGNATURE|SOURCE_SIZE|PROBE)_REJECTED$/.test(code);
      const current = await this.repository.get(job.tenantId, job.mediaAssetId);
      if (current?.status === "READY" && current.processingLease === lease) {
        await this.repository.release(job, lease, true);
        return;
      }
      if (
        current?.processingLease === lease &&
        !["READY", "DELETED", "QUARANTINED"].includes(current.status)
      ) {
        const next = {
          ...transition(current, invalid ? "QUARANTINED" : "FAILED", "media-worker"),
          failureCode: invalid ? code : "MEDIA_PROCESSING_FAILED",
        };
        await this.repository.replace(current, next);
      }
      this.metrics.event(invalid ? "media_validation_failed" : "media_processing_failed");
      for (const key of outputs) await this.storage.remove(key).catch(() => undefined);
      await this.repository.release(job, lease, invalid || job.attempts >= 2);
    } finally {
      finish();
      await rm(directory, { recursive: true, force: true });
    }
  }
  private async save(old: MediaAsset, next: MediaAsset) {
    if (!(await this.repository.replace(old, next))) throw Error("MEDIA_LEASE_CONFLICT");
    return next;
  }
}
