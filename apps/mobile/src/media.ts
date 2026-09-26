import { ApiError, record, string } from "./api";

export interface MediaSession {
  playlistUrl: string;
  posterUrl?: string;
  captionTracks: { captionTrackId: string; language: string; label: string; kind: "SUBTITLES" | "CAPTIONS"; format: "WEBVTT"; url: string }[];
  expiresAt: string;
  completionPolicy: "EXPLICIT_AUTHORITATIVE_LESSON_ACK";
}
export function mediaSession(value: unknown, gatewayOrigin: string): MediaSession {
  const data = record(value);
  const expiry = string(data.expiresAt);
  if (
    !Number.isFinite(Date.parse(expiry)) ||
    Date.parse(expiry) - Date.now() < 20_000 ||
    data.completionPolicy !== "EXPLICIT_AUTHORITATIVE_LESSON_ACK"
  )
    throw new ApiError("invalid");
  const check = (raw: unknown, suffix: string) => {
    const url = new URL(string(raw));
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      !url.pathname.endsWith(suffix) ||
      !url.searchParams.has("token")
    )
      throw new ApiError("invalid");
    const gateway = new URL(gatewayOrigin);
    const local = ["development", "research"].includes(process.env.EXPO_PUBLIC_AILSS_ENV ?? "development");
    if (local && ["127.0.0.1", "localhost"].includes(url.hostname) && gateway.port === url.port)
      url.hostname = gateway.hostname;
    if (url.origin !== gateway.origin) throw new ApiError("invalid");
    if (!local && url.protocol !== "https:") throw new ApiError("invalid");
    return url.href;
  };
  const playlistUrl = check(data.playlistUrl, "/master.m3u8");
  const playbackAssetId = new URL(playlistUrl).pathname.split("/").at(-2);
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(playbackAssetId ?? ""))
    throw new ApiError("invalid");
  return {
    playlistUrl,
    ...(typeof data.posterUrl === "string" ? { posterUrl: check(data.posterUrl, "/poster.jpg") } : {}),
    captionTracks: Array.isArray(data.captionTracks) ? data.captionTracks.map((raw) => {
      const track = record(raw);
      const captionTrackId = string(track.captionTrackId);
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(captionTrackId) ||
        !["SUBTITLES", "CAPTIONS"].includes(String(track.kind)) || track.format !== "WEBVTT")
        throw new ApiError("invalid");
      return {
        captionTrackId,
        language: string(track.language),
        label: string(track.label),
        kind: track.kind as "SUBTITLES" | "CAPTIONS",
        format: "WEBVTT" as const,
        url: (() => {
          const url = check(track.url, `/caption-${captionTrackId}.vtt`);
          if (new URL(url).pathname !== `/playback/${playbackAssetId}/caption-${captionTrackId}.vtt`)
            throw new ApiError("invalid");
          return url;
        })(),
      };
    }) : [],
    expiresAt: expiry,
    completionPolicy: "EXPLICIT_AUTHORITATIVE_LESSON_ACK",
  };
}
export function mediaError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "MEDIA_ENTITLEMENT_REQUIRED" || error.status === 403)
      return "Bạn chưa có quyền xem video của khóa học này.";
    if (error.code === "MEDIA_NOT_AVAILABLE" || error.status === 404) return "Video bài học chưa sẵn sàng.";
    if (error.code === "MEDIA_UPLOAD_EXPIRED_OR_CLOSED") return "Phiên media đã hết hạn.";
  }
  return "Không thể phát video. Hãy kiểm tra mạng và thử lại.";
}
