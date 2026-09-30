import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaError, mediaSession } from "../src/media";
import { ApiError } from "../src/api";

const origin = "https://learn.example.test";
const assetId = "72d31aae-a982-4d2d-b117-ffb46647bff0";
const valid = {
  playlistUrl: `${origin}/playback/${assetId}/master.m3u8?token=short-lived`,
  posterUrl: `${origin}/playback/${assetId}/poster.jpg?token=short-lived`,
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
  completionPolicy: "EXPLICIT_AUTHORITATIVE_LESSON_ACK",
};
afterEach(() => vi.unstubAllEnvs());
describe("native media authorization contract", () => {
  it("accepts only a short-lived HLS playback session from the gateway", () => {
    vi.stubEnv("EXPO_PUBLIC_AILSS_ENV", "production");
    expect(mediaSession(valid, origin)).toMatchObject(valid);
    expect(mediaSession(valid, origin).captionTracks).toEqual([]);
  });
  it("rejects foreign origin, unsigned URL, expired session and fake completion policy", () => {
    vi.stubEnv("EXPO_PUBLIC_AILSS_ENV", "production");
    expect(() =>
      mediaSession({ ...valid, playlistUrl: valid.playlistUrl.replace(origin, "https://evil.test") }, origin),
    ).toThrow();
    expect(() =>
      mediaSession({ ...valid, playlistUrl: `${origin}/playback/${assetId}/master.m3u8` }, origin),
    ).toThrow();
    expect(() =>
      mediaSession({ ...valid, expiresAt: new Date(Date.now() - 1000).toISOString() }, origin),
    ).toThrow();
    expect(() => mediaSession({ ...valid, completionPolicy: "AUTO_COMPLETE" }, origin)).toThrow();
  });
  it("keeps authorized caption metadata without accepting foreign or unsigned caption URLs", () => {
    vi.stubEnv("EXPO_PUBLIC_AILSS_ENV", "production");
    const id = "2e3a35e4-8798-4b3f-beca-94a686f64f9d";
    const caption = {
      captionTrackId: id,
      language: "vi",
      label: "Tiếng Việt",
      kind: "SUBTITLES",
      format: "WEBVTT",
      url: `${origin}/playback/${assetId}/caption-${id}.vtt?token=short-lived`,
    };
    expect(mediaSession({ ...valid, captionTracks: [caption] }, origin).captionTracks).toEqual([caption]);
    for (const url of [
      caption.url.replace(origin, "https://evil.test"),
      caption.url.replace("?token=short-lived", ""),
      caption.url.replace(id, "2e3a35e4-8798-4b3f-beca-94a686f64f9e"),
      caption.url.replace(assetId, "72d31aae-a982-4d2d-b117-ffb46647bff1"),
    ])
      expect(() => mediaSession({ ...valid, captionTracks: [{ ...caption, url }] }, origin)).toThrow();
  });
  it("rewrites local loopback delivery to simulator-reachable gateway host", () => {
    vi.stubEnv("EXPO_PUBLIC_AILSS_ENV", "development");
    const session = mediaSession(
      {
        ...valid,
        playlistUrl: valid.playlistUrl.replace(origin, "http://127.0.0.1:8080"),
        posterUrl: valid.posterUrl.replace(origin, "http://127.0.0.1:8080"),
      },
      "http://10.0.2.2:8080",
    );
    expect(new URL(session.playlistUrl).host).toBe("10.0.2.2:8080");
    expect(new URL(session.posterUrl ?? "").host).toBe("10.0.2.2:8080");
  });
  it("preserves distinct entitlement and availability errors", () => {
    expect(mediaError(new ApiError("403", 403, undefined, "MEDIA_ENTITLEMENT_REQUIRED"))).toContain("quyền");
    expect(mediaError(new ApiError("404", 404, undefined, "MEDIA_NOT_AVAILABLE"))).toContain("sẵn sàng");
  });
});
