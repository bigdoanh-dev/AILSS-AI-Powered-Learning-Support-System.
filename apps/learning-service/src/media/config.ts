import type { AppConfig } from "../../../../packages/config/src/index.js";
import type { MediaPolicy } from "./model.js";
import { S3MediaStorage } from "../../../../packages/storage/src/media.js";
export function mediaRuntime(config: AppConfig, requirePlaybackSecret = true) {
  if (!config.MEDIA_ENABLED) return undefined;
  if (
    !config.MEDIA_MAX_SOURCE_BYTES ||
    !config.MEDIA_MAX_DURATION_SECONDS ||
    (requirePlaybackSecret && (!config.MEDIA_PLAYBACK_SECRET || config.MEDIA_PLAYBACK_SECRET.length < 32)) ||
    !config.MEDIA_STORAGE_ACCESS_KEY ||
    !config.MEDIA_STORAGE_SECRET_KEY ||
    !config.OBJECT_STORAGE_PUBLIC_URL ||
    !config.MEDIA_DELIVERY_ORIGIN
  )
    throw Error("MEDIA_POLICY_AND_SECRETS_REQUIRED");
  if (
    config.NODE_ENV === "production" &&
    (!config.OBJECT_STORAGE_USE_SSL ||
      !config.OBJECT_STORAGE_PUBLIC_URL.startsWith("https://") ||
      !config.MEDIA_DELIVERY_ORIGIN.startsWith("https://"))
  )
    throw Error("MEDIA_PRODUCTION_TLS_REQUIRED");
  const policy: MediaPolicy = {
    maxSourceBytes: config.MEDIA_MAX_SOURCE_BYTES,
    maxDurationSeconds: config.MEDIA_MAX_DURATION_SECONDS,
    allowedContainers: config.MEDIA_ALLOWED_CONTAINERS.split(","),
    allowedVideoCodecs: config.MEDIA_ALLOWED_VIDEO_CODECS.split(","),
    allowedAudioCodecs: config.MEDIA_ALLOWED_AUDIO_CODECS.split(","),
    uploadTtlSeconds: config.MEDIA_UPLOAD_TTL_SECONDS,
    processingTimeoutMs: config.MEDIA_PROCESSING_TIMEOUT_MS,
    renditionHeight: config.MEDIA_RENDITION_HEIGHT,
    videoBitrate: config.MEDIA_VIDEO_BITRATE,
    playbackTtlSeconds: config.MEDIA_PLAYBACK_TTL_SECONDS,
    deliveryOrigin: config.MEDIA_DELIVERY_ORIGIN.replace(/\/$/, ""),
  };
  return {
    policy,
    secret: config.MEDIA_PLAYBACK_SECRET ?? "",
    storage: new S3MediaStorage(
      config.MEDIA_STORAGE_BUCKET,
      {
        endPoint: config.OBJECT_STORAGE_ENDPOINT,
        port: config.OBJECT_STORAGE_PORT,
        useSSL: config.OBJECT_STORAGE_USE_SSL,
        accessKey: config.MEDIA_STORAGE_ACCESS_KEY,
        secretKey: config.MEDIA_STORAGE_SECRET_KEY,
      },
      config.OBJECT_STORAGE_PUBLIC_URL,
    ),
  };
}
