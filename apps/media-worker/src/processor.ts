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
import { planRenditions, type RenditionProfile } from "../../learning-service/src/media/profiles.js";
import type { MediaQuota } from "../../learning-service/src/media/quota.js";
import type { OutputJournal, OutputIntent } from "./output-journal.js";
import { SOURCE_HEADER_BYTES, sourceContainer } from "./source-validation.js";
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
export function probeMetadata(raw: unknown, policy: MediaPolicy, container: "mp4" | "webm") {
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
    p.streams.some(
      (stream) =>
        (stream.codec_type === "video" && !policy.allowedVideoCodecs.includes(stream.codec_name)) ||
        (stream.codec_type === "audio" && !policy.allowedAudioCodecs.includes(stream.codec_name)),
    ) ||
    !p.format.format_name.split(",").some((x) => policy.allowedContainers.includes(x)) ||
    (container === "webm" &&
      p.streams.some(
        (stream) =>
          (stream.codec_type === "video" && !["vp8", "vp9", "av1"].includes(stream.codec_name)) ||
          (stream.codec_type === "audio" && !["vorbis", "opus"].includes(stream.codec_name)),
      )) ||
    !p.format.format_name.split(",").includes(container)
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
    private readonly quota: MediaQuota,
    private readonly outputJournal: OutputJournal,
  ) {}
  async handle(job: MediaJob) {
    const lease = randomUUID();
    const leaseDurationMs = Math.min(this.policy.processingTimeoutMs + 60_000, 90_000);
    if (!(await this.repository.claim(job, lease, new Date(Date.now() + leaseDurationMs)))) return;
    if (job.attempts > 0) this.metrics.event("worker_recovered");
    let a = await this.repository.get(job.tenantId, job.mediaAssetId);
    // Failed-state CAS and binding audit are separate partitions. Retry repairs
    // an interrupted audit before activating or retiring this durable job.
    if (a) await this.repository.recordReplacementFailure(a);
    if (!a || ["READY", "DELETED", "QUARANTINED"].includes(a.status)) {
      await this.repository.release(job, lease, true);
      return;
    }
    if (job.attempts >= 3) {
      if (a.status !== "FAILED") {
        const next = {
          ...transition(a, "FAILED", "media-worker"),
          processingLease: lease,
          failureCode: "MEDIA_RETRY_EXHAUSTED",
        };
        if (await this.repository.replace(a, next)) await this.repository.recordReplacementFailure(next);
      }
      await this.quota.release(a);
      await this.repository.release(job, lease, true);
      return;
    }
    const directory = await mkdtemp(path.join(tmpdir(), "ailss-media-"));
    const finish = this.metrics.processingDuration.startTimer();
    const prefix = `media-hls/${a.tenantId}/${a.mediaAssetId}/${String(a.processingVersion)}/${lease}`;
    let intent: OutputIntent | undefined;
    const leaseAbort = new AbortController();
    let leaseRevision = job.revision + 1;
    let renewal: Promise<void> | undefined;
    const heartbeat = setInterval(
      () => {
        if (renewal) return;
        renewal = this.repository
          .renew(job, lease, leaseRevision, new Date(Date.now() + leaseDurationMs))
          .then((ok) => {
            if (!ok) leaseAbort.abort(Error("MEDIA_LEASE_CONFLICT"));
            else leaseRevision++;
          })
          .catch(() => leaseAbort.abort(Error("MEDIA_LEASE_RENEWAL_FAILED")))
          .finally(() => {
            renewal = undefined;
          });
      },
      Math.floor(leaseDurationMs / 3),
    );
    heartbeat.unref();
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
        signal: AbortSignal.any([AbortSignal.timeout(this.policy.processingTimeoutMs), leaseAbort.signal]),
      });
      if (bytes !== a.sizeBytes || bytes > this.policy.maxSourceBytes)
        throw Error("MEDIA_SOURCE_SIZE_REJECTED");
      const sourceHash = hash.digest("hex");
      if (a.sourceSha256 && a.sourceSha256 !== sourceHash) throw Error("MEDIA_CHECKSUM_REJECTED");
      const file = await open(source, "r");
      const magic = Buffer.alloc(SOURCE_HEADER_BYTES);
      let headerBytes: number;
      try {
        ({ bytesRead: headerBytes } = await file.read(magic, 0, magic.length, 0));
      } finally {
        await file.close();
      }
      const container = sourceContainer(
        magic.subarray(0, headerBytes),
        a.mimeType,
        this.policy.allowedContainers,
      );
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
          { timeout: 20000, maxBuffer: 1024 * 1024, signal: leaseAbort.signal },
        ));
      } catch (e) {
        if (e instanceof Error && "code" in e && e.code === "ENOENT") throw e;
        throw Error("MEDIA_PROBE_REJECTED");
      }
      let info: ReturnType<typeof probeMetadata>;
      try {
        info = probeMetadata(JSON.parse(stdout), this.policy, container);
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
      // All selected renditions are required: one failure keeps the asset out of READY.
      const fallback: RenditionProfile = {
        height: this.policy.renditionHeight,
        videoBitrate: this.policy.videoBitrate,
        maxBitrate: this.policy.videoBitrate,
        bufferSize: this.policy.videoBitrate * 2,
        audioBitrate: 96_000,
        codec: "libx264",
        profile: "main",
        segmentSeconds: 2,
      };
      const ladder = planRenditions(info.width, info.height, this.policy.profiles ?? [fallback]);
      const master = ["#EXTM3U", "#EXT-X-VERSION:3"];
      for (const { profile, width, height } of ladder) {
        const variantName = `variant-${String(height)}.m3u8`;
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
            `scale=${String(width)}:${String(height)}`,
            "-c:v",
            profile.codec,
            "-profile:v",
            profile.profile,
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "2",
            "-preset",
            "veryfast",
            "-b:v",
            String(profile.videoBitrate),
            "-maxrate",
            String(profile.maxBitrate),
            "-bufsize",
            String(profile.bufferSize),
            "-c:a",
            "aac",
            "-b:a",
            String(profile.audioBitrate),
            "-force_key_frames",
            `expr:gte(t,n_forced*${String(profile.segmentSeconds)})`,
            "-f",
            "hls",
            "-hls_time",
            String(profile.segmentSeconds),
            "-hls_list_size",
            "0",
            "-hls_playlist_type",
            "vod",
            "-hls_flags",
            "independent_segments",
            "-hls_segment_filename",
            path.join(directory, `segment-${String(height)}-%05d.ts`),
            path.join(directory, variantName),
          ],
          { timeout: this.policy.processingTimeoutMs, maxBuffer: 1024 * 1024, signal: leaseAbort.signal },
        );
        const variant = await readFile(path.join(directory, variantName), "utf8");
        const segments = variant.split("\n").filter((line) => line && !line.startsWith("#"));
        if (
          !variant.startsWith("#EXTM3U") ||
          !variant.includes("#EXT-X-ENDLIST") ||
          segments.length === 0 ||
          segments.some((line) => !new RegExp(`^segment-${String(height)}-\\d{5}\\.ts$`).test(line))
        )
          throw Error("MEDIA_HLS_INVALID");
        const codec =
          profile.profile === "high"
            ? "avc1.640028"
            : profile.profile === "baseline"
              ? "avc1.42e01e"
              : "avc1.4d401f";
        master.push(
          `#EXT-X-STREAM-INF:BANDWIDTH=${String(profile.maxBitrate + profile.audioBitrate)},AVERAGE-BANDWIDTH=${String(profile.videoBitrate + profile.audioBitrate)},RESOLUTION=${String(width)}x${String(height)},CODECS="${codec},mp4a.40.2"`,
          variantName,
        );
      }
      await writeFile(path.join(directory, "master.m3u8"), `${master.join("\n")}\n`);
      const posterWidth = Math.max(2, Math.floor(Math.min(640, info.width) / 2) * 2);
      const posterHeight = Math.max(2, Math.floor((info.height * posterWidth) / info.width / 2) * 2);
      await run(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-ss",
          String(Math.min(5, info.durationMs / 10000)),
          "-i",
          source,
          "-frames:v",
          "1",
          "-vf",
          `scale=${String(posterWidth)}:${String(posterHeight)}`,
          "-q:v",
          "3",
          path.join(directory, "poster.jpg"),
        ],
        {
          timeout: Math.min(this.policy.processingTimeoutMs, 60_000),
          maxBuffer: 1024 * 1024,
          signal: leaseAbort.signal,
        },
      );
      const names = (await readdir(directory)).filter((n) =>
        /^master\.m3u8$|^variant-\d+\.m3u8$|^segment-\d+-\d{5}\.ts$|^poster\.jpg$/.test(n),
      );
      if (!names.includes("poster.jpg") || !names.includes("master.m3u8")) throw Error("MEDIA_HLS_INVALID");
      leaseAbort.signal.throwIfAborted();
      intent = await this.outputJournal.begin(
        job,
        lease,
        prefix,
        names.map((name) => `${prefix}/${name}`),
      );
      for (const name of names) {
        leaseAbort.signal.throwIfAborted();
        const key = `${prefix}/${name}`;
        await this.storage.writeFile(
          key,
          path.join(directory, name),
          name.endsWith(".ts")
            ? "video/mp2t"
            : name.endsWith(".jpg")
              ? "image/jpeg"
              : "application/vnd.apple.mpegurl",
        );
      }
      let derivedBytes = 0;
      for (const name of names) {
        const size = (await this.storage.stat(`${prefix}/${name}`)).size;
        if (size === 0) throw Error("MEDIA_HLS_INVALID");
        derivedBytes += size;
      }
      // Re-read the fence before READY; all objects have been written privately.
      leaseAbort.signal.throwIfAborted();
      const current = await this.repository.get(a.tenantId, a.mediaAssetId);
      if (!current || current.processingLease !== lease || current.status !== "PROCESSING")
        throw Error("MEDIA_LEASE_CONFLICT");
      await this.quota.derivedStored(current, derivedBytes);
      a = await this.save(current, {
        ...transition(current, "READY", "media-worker"),
        ...info,
        sourceSha256: sourceHash,
        masterPlaylistObjectKey: `${prefix}/master.m3u8`,
        posterObjectKey: `${prefix}/poster.jpg`,
        availableRenditions: ladder.map(({ width, height, profile }) => ({
          width,
          height,
          bitrate: profile.videoBitrate,
        })),
      });
      this.metrics.event("media_ready");
      await this.outputJournal.cas(intent, "RETAINED");
      await this.repository.release(job, lease, true);
    } catch (error) {
      const code = error instanceof Error ? error.message : "MEDIA_PROCESSING_FAILED";
      const invalid = /^MEDIA_(POLICY|MIME|CHECKSUM|CONTAINER_SIGNATURE|SOURCE_SIZE|PROBE)_REJECTED$/.test(
        code,
      );
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
        const failure = next.audit.at(-1);
        if (failure) {
          failure.failureCode = next.failureCode;
          failure.processingLease = lease;
        }
        if (await this.repository.replace(current, next))
          await this.repository.recordReplacementFailure(next);
      }
      this.metrics.event(invalid ? "media_validation_failed" : "media_processing_failed");
      // Never erase the only cleanup record. Poll recovery owns idempotent deletion
      // once the job lease is released or expires, including SIGKILL/PUT ambiguity.
      if (intent) await this.outputJournal.cas(intent, "PENDING");
      if (current?.processingLease === lease && (invalid || job.attempts >= 2))
        await this.quota.release(current);
      await this.repository.release(job, lease, invalid || job.attempts >= 2);
    } finally {
      clearInterval(heartbeat);
      await renewal;
      finish();
      await rm(directory, { recursive: true, force: true });
    }
  }
  private async save(old: MediaAsset, next: MediaAsset) {
    if (!(await this.repository.replace(old, next))) throw Error("MEDIA_LEASE_CONFLICT");
    return next;
  }
}
