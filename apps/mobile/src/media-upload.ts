import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { ApiError, record, string, type RequestOptions } from "./api";

export type MediaAssetStatus =
  | "CREATED"
  | "UPLOADING"
  | "UPLOADED"
  | "VERIFYING"
  | "QUEUED"
  | "PROCESSING"
  | "READY"
  | "FAILED"
  | "QUARANTINED"
  | "DELETED";

export interface MobileMediaAsset {
  mediaAssetId: string;
  courseId: string;
  lessonId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: MediaAssetStatus;
  failureCode?: string;
}

export interface UploadableVideo {
  uri: string;
  name: string;
  mimeType: "video/mp4" | "video/webm";
  sizeBytes: number;
}

export interface PendingMediaUpload {
  courseId: string;
  lessonId: string;
  mediaAssetId: string;
  idempotencyKey: string;
  fileName: string;
  mimeType: UploadableVideo["mimeType"];
  sizeBytes: number;
}

const secureOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

interface MediaApi {
  api: { origin: string };
  request(path: string, options?: RequestOptions): Promise<unknown>;
}

const statuses = new Set<MediaAssetStatus>([
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
]);

export function mediaUploadAsset(value: unknown): MobileMediaAsset {
  const data = record(value);
  const status = string(data.status);
  const sizeBytes = Number(data.sizeBytes);
  if (!statuses.has(status as MediaAssetStatus) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0)
    throw new ApiError("invalid");
  return {
    mediaAssetId: string(data.mediaAssetId),
    courseId: string(data.courseId),
    lessonId: string(data.lessonId),
    originalFilename: string(data.originalFilename),
    mimeType: string(data.mimeType),
    sizeBytes,
    status: status as MediaAssetStatus,
    ...(typeof data.failureCode === "string" ? { failureCode: data.failureCode } : {}),
  };
}

function endpointAssetId(assetId: string): string {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(assetId)) throw new ApiError("invalid");
  return assetId;
}

function pendingKey(origin: string, userId: string, courseId: string, lessonId: string): string {
  const url = new URL(origin);
  const scope = `${url.protocol}_${url.hostname}_${url.port || "default"}`
    .replace(/[^A-Za-z0-9_-]/gu, "_")
    .slice(0, 140);
  return `ailss.media.pending.v1.${scope}.${userId}.${courseId}.${lessonId}`;
}

function parsePendingUpload(raw: string | null): PendingMediaUpload | null {
  if (!raw) return null;
  try {
    const value = record(JSON.parse(raw));
    const sizeBytes = Number(value.sizeBytes);
    if (
      typeof value.courseId !== "string" ||
      typeof value.lessonId !== "string" ||
      typeof value.mediaAssetId !== "string" ||
      typeof value.idempotencyKey !== "string" ||
      typeof value.fileName !== "string" ||
      !["video/mp4", "video/webm"].includes(String(value.mimeType)) ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0
    )
      return null;
    endpointAssetId(value.mediaAssetId);
    endpointAssetId(value.idempotencyKey);
    return {
      courseId: value.courseId,
      lessonId: value.lessonId,
      mediaAssetId: value.mediaAssetId,
      idempotencyKey: value.idempotencyKey,
      fileName: value.fileName,
      mimeType: value.mimeType as UploadableVideo["mimeType"],
      sizeBytes,
    };
  } catch {
    return null;
  }
}

export async function loadPendingMediaUpload(
  origin: string,
  userId: string,
  courseId: string,
  lessonId: string,
): Promise<PendingMediaUpload | null> {
  const key = pendingKey(origin, userId, courseId, lessonId);
  const raw = await SecureStore.getItemAsync(key, secureOptions);
  const pending = parsePendingUpload(raw);
  if (raw && !pending) await SecureStore.deleteItemAsync(key, secureOptions);
  return pending;
}

export async function savePendingMediaUpload(
  origin: string,
  userId: string,
  pending: PendingMediaUpload,
): Promise<void> {
  await SecureStore.setItemAsync(
    pendingKey(origin, userId, pending.courseId, pending.lessonId),
    JSON.stringify(pending),
    secureOptions,
  );
}

export async function clearPendingMediaUpload(
  origin: string,
  userId: string,
  courseId: string,
  lessonId: string,
): Promise<void> {
  await SecureStore.deleteItemAsync(pendingKey(origin, userId, courseId, lessonId), secureOptions);
}

function uploadUrl(value: unknown, origin: string): string {
  let parsed: URL;
  let gateway: URL;
  try {
    parsed = new URL(string(value));
    gateway = new URL(origin);
  } catch {
    throw new ApiError("invalid");
  }
  const dev = ["development", "research"].includes(process.env.EXPO_PUBLIC_AILSS_ENV ?? "development");
  if (
    !(parsed.protocol === "https:" || (dev && gateway.protocol === "http:" && parsed.protocol === "http:")) ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    !parsed.search
  )
    throw new ApiError("invalid");
  // A media URL may use a separate object-store host, but production uploads must be TLS.
  return parsed.href;
}

export async function uploadLessonVideo(
  api: MediaApi,
  input: {
    courseId: string;
    lessonId: string;
    file: UploadableVideo;
    idempotencyKey: string;
    mediaAssetId?: string;
    signal?: AbortSignal;
    onAsset?: (asset: MobileMediaAsset) => void | Promise<void>;
    onProgress?: (complete: number, total: number) => void;
  },
): Promise<MobileMediaAsset> {
  const file = new File(input.file.uri);
  if (!file.exists || file.size !== input.file.sizeBytes)
    throw new Error("Tệp video không còn khả dụng trên thiết bị.");

  let assetId = input.mediaAssetId;
  if (!assetId) {
    const created = record(
      await api.request(`/api/v1/courses/${input.courseId}/media-assets`, {
        method: "POST",
        body: {
          lessonId: input.lessonId,
          originalFilename: input.file.name,
          mimeType: input.file.mimeType,
          sizeBytes: input.file.sizeBytes,
        },
        idempotencyKey: input.idempotencyKey,
        signal: input.signal,
      }),
    );
    const asset = mediaUploadAsset(created.asset);
    assetId = endpointAssetId(asset.mediaAssetId);
    await input.onAsset?.(asset);
  }

  const resume = record(
    await api.request(`/api/v1/media-assets/${endpointAssetId(assetId)}/upload`, { signal: input.signal }),
  );
  const partSize = Number(resume.partSize);
  if (!Number.isSafeInteger(partSize) || partSize <= 0 || !Array.isArray(resume.parts))
    throw new ApiError("invalid");
  const total = Math.ceil(input.file.sizeBytes / partSize);
  const uploaded = new Set<number>();
  for (const raw of resume.parts) {
    const part = Number(record(raw).part);
    if (Number.isInteger(part) && part > 0 && part <= total) uploaded.add(part);
  }
  input.onProgress?.(uploaded.size, total);

  for (let part = 1; part <= total; part++) {
    if (input.signal?.aborted) throw new ApiError("cancelled");
    if (uploaded.has(part)) continue;
    const result = record(
      await api.request(`/api/v1/media-assets/${assetId}/parts`, {
        method: "POST",
        body: { partNumber: part },
        signal: input.signal,
      }),
    );
    const signedUrl = uploadUrl(result.uploadUrl, api.api.origin);
    const body = file.slice((part - 1) * partSize, Math.min(part * partSize, input.file.sizeBytes));
    const controller = new AbortController();
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort);
    const timeout = setTimeout(abort, 120_000);
    try {
      const response = await expoFetch(signedUrl, {
        method: "PUT",
        body,
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Tải một phần video thất bại. Hãy thử tiếp tục phiên tải lên.");
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", abort);
    }
    uploaded.add(part);
    input.onProgress?.(uploaded.size, total);
  }

  const completed = await api.request(`/api/v1/media-assets/${assetId}/complete`, {
    method: "POST",
    body: {},
    signal: input.signal,
  });
  const asset = mediaUploadAsset(completed);
  await input.onAsset?.(asset);
  return asset;
}

export async function refreshMediaAsset(api: MediaApi, assetId: string, signal?: AbortSignal) {
  return mediaUploadAsset(await api.request(`/api/v1/media-assets/${endpointAssetId(assetId)}`, { signal }));
}

export function mediaUploadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "MEDIA_SOURCE_SIZE_REJECTED" || error.status === 413)
      return "Video vượt quá giới hạn dung lượng của máy chủ.";
    if (error.code === "MEDIA_QUOTA_EXCEEDED" || error.code === "MEDIA_QUOTA_REJECTED")
      return "Không còn đủ quota lưu trữ video cho khóa học này.";
    if (error.code === "MEDIA_LESSON_REJECTED")
      return "Bài học xem trước không nhận video riêng tư. Hãy tắt Xem trước rồi thử lại.";
    if (error.code === "MEDIA_UPLOAD_EXPIRED_OR_CLOSED")
      return "Phiên tải lên đã hết hạn. Không thể tiếp tục phiên này; hãy tạo phiên mới sau khi máy chủ đóng phiên cũ.";
    return error.requestId ? `${error.message} Mã yêu cầu: ${error.requestId}` : error.message;
  }
  return error instanceof Error ? error.message : "Không thể tải video lên.";
}

export const MEDIA_STATUS_COPY: Record<MediaAssetStatus, string> = {
  CREATED: "Đang tạo phiên tải lên",
  UPLOADING: "Đang tải lên",
  UPLOADED: "Đã nhận video",
  VERIFYING: "Đang kiểm tra tệp",
  QUEUED: "Đang chờ xử lý",
  PROCESSING: "Đang chuyển mã video",
  READY: "Video đã sẵn sàng",
  FAILED: "Xử lý thất bại",
  QUARANTINED: "Video bị cách ly",
  DELETED: "Phiên tải lên đã hủy",
};
