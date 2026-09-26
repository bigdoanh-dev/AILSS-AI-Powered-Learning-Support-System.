import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../../../packages/http/src/index.js";
import type { RenditionProfile } from "./profiles.js";
export const mediaVisibilities = ["PROTECTED_LESSON", "PUBLIC_PREVIEW"] as const;
export type MediaVisibility = (typeof mediaVisibilities)[number];

export const mediaStates = [
  "CREATED",
  "UPLOADING",
  "UPLOADED",
  "VERIFYING",
  "QUEUED",
  "PROCESSING",
  "READY",
  "FAILED",
  "QUARANTINED",
  "DELETED",
] as const;
export type MediaState = (typeof mediaStates)[number];
const transitions: Record<MediaState, readonly MediaState[]> = {
  CREATED: ["UPLOADING", "FAILED", "DELETED"],
  UPLOADING: ["UPLOADED", "FAILED", "DELETED"],
  UPLOADED: ["VERIFYING", "FAILED", "QUARANTINED"],
  VERIFYING: ["QUEUED", "FAILED", "QUARANTINED"],
  QUEUED: ["PROCESSING", "FAILED", "QUARANTINED", "DELETED"],
  PROCESSING: ["READY", "FAILED", "QUARANTINED"],
  READY: ["DELETED"],
  FAILED: ["VERIFYING", "QUEUED", "DELETED"],
  QUARANTINED: ["DELETED"],
  DELETED: [],
};
export interface MediaPolicy {
  maxSourceBytes: number;
  maxDurationSeconds: number;
  allowedContainers: string[];
  allowedVideoCodecs: string[];
  allowedAudioCodecs: string[];
  uploadTtlSeconds: number;
  processingTimeoutMs: number;
  renditionHeight: number;
  videoBitrate: number;
  profiles?: RenditionProfile[];
  playbackTtlSeconds: number;
  deliveryOrigin: string;
}
export interface CaptionTrack {
  captionTrackId: string;
  mediaAssetId: string;
  language: string;
  label: string;
  kind: "SUBTITLES" | "CAPTIONS";
  format: "WEBVTT";
  objectKey: string;
  contentSha256?: string;
  status: "UPLOADING" | "READY" | "FAILED" | "DELETED";
}
export interface MediaReplacementEvent {
  previousMediaAssetId: string;
  replacementMediaAssetId: string;
  lessonId: string;
  changedBy: string;
  changedAt: string;
  status: "APPLIED" | "FAILED";
  processingLease?: string;
  failureCode?: string;
  recordedBy?: "media-worker";
}
export interface MediaAsset {
  mediaAssetId: string;
  tenantId: string;
  ownerUserId: string;
  courseId: string;
  lessonId: string;
  mediaType: "VIDEO";
  originalFilename: string;
  mimeType: string;
  originalObjectKey: string;
  sizeBytes: number;
  status: MediaState;
  revision: number;
  processingVersion: number;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  uploadExpiresAt: string;
  jobDay?: string;
  uploadId?: string;
  sourceSha256?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  container?: string;
  processingLease?: string;
  replacementOfMediaAssetId?: string;
  masterPlaylistObjectKey?: string;
  posterObjectKey?: string;
  availableRenditions?: { height: number; width: number; bitrate: number }[];
  captionTracks: CaptionTrack[];
  visibility?: MediaVisibility;
  failureCode?: string;
  audit: {
    from: MediaState;
    to: MediaState;
    at: string;
    actor: string;
    failureCode?: string;
    processingLease?: string;
  }[];
}
export function captionMetadata(asset: MediaAsset) {
  return asset.captionTracks
    .filter((track) => track.status === "READY" && track.mediaAssetId === asset.mediaAssetId)
    .map(({ captionTrackId, language, label, kind, format }) => ({
      captionTrackId,
      language,
      label,
      kind,
      format,
    }));
}
export const mediaCreateSchema = z
  .object({
    lessonId: z.string().uuid(),
    originalFilename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((x) =>
        Array.from(x).every((char) => {
          const code = char.codePointAt(0) ?? 0;
          return code > 31 && code !== 127;
        }),
      ),
    mimeType: z.enum(["video/mp4", "video/webm"]),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    visibility: z.enum(mediaVisibilities).default("PROTECTED_LESSON"),
    sourceSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type MediaCreate = z.input<typeof mediaCreateSchema>;
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;
export function mediaId(secret: string, scope: string) {
  const b = createHmac("sha256", secret).update(scope).digest().subarray(0, 16);
  b[6] = ((b[6] ?? 0) & 15) | 0x50;
  b[8] = ((b[8] ?? 0) & 63) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function fingerprint(value: object) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function transition(asset: MediaAsset, to: MediaState, actor: string): MediaAsset {
  if (!transitions[asset.status].includes(to))
    throw new AppError("MEDIA_TRANSITION_REJECTED", 409, "Media state transition is not allowed");
  const at = new Date().toISOString();
  return {
    ...asset,
    status: to,
    revision: asset.revision + 1,
    updatedAt: at,
    audit: [...asset.audit, { from: asset.status, to, at, actor }],
  };
}
export function mediaDto(asset: MediaAsset) {
  // Object paths, upload IDs, fingerprints and worker leases are not public playback credentials.
  const {
    mediaAssetId,
    courseId,
    lessonId,
    originalFilename,
    mimeType,
    sizeBytes,
    status,
    processingVersion,
    createdAt,
    updatedAt,
    durationMs,
    width,
    height,
    failureCode,
    availableRenditions,
  } = asset;
  return {
    mediaAssetId,
    courseId,
    lessonId,
    originalFilename,
    mimeType,
    sizeBytes,
    status,
    visibility: asset.visibility ?? "PROTECTED_LESSON",
    processingVersion,
    createdAt,
    updatedAt,
    durationMs,
    width,
    height,
    failureCode,
    availableRenditions,
    captionTracks: captionMetadata(asset),
  };
}
