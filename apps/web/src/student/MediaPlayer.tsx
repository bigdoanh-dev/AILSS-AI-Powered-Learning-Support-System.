import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { useSession } from "../auth/session";
import { studentError, studentRequest } from "./api";
interface PlaybackSession {
  playlistUrl: string;
  posterUrl?: string;
  expiresAt: string;
  completionPolicy: "EXPLICIT_AUTHORITATIVE_LESSON_ACK";
  captionTracks: { captionTrackId: string; language: string; label: string; kind: "SUBTITLES" | "CAPTIONS"; format: "WEBVTT"; url: string }[];
}
export function MediaPlayer({ lessonId, title }: { lessonId: string; title: string }) {
  const { profile } = useSession();
  const video = useRef<HTMLVideoElement>(null);
  const [revision, setRevision] = useState(0),
    [message, setMessage] = useState("Đang xin quyền phát video…"),
    [failed, setFailed] = useState(false),
    [tracks, setTracks] = useState<PlaybackSession["captionTracks"]>([]),
    [selectedTrack, setSelectedTrack] = useState("");
  useEffect(() => {
    const list = video.current?.textTracks;
    if (!list) return;
    for (let index = 0; index < list.length; index++) {
      const track = list[index];
      if (track) track.mode = tracks[index]?.captionTrackId === selectedTrack ? "showing" : "disabled";
    }
  }, [tracks, selectedTrack]);
  useEffect(() => {
    const controller = new AbortController();
    let hls: Hls | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const element = video.current;
    if (!element) return;
    const stop = () => {
      hls?.destroy();
      hls = undefined;
      element.pause();
      element.removeAttribute("src");
      element.removeAttribute("poster");
      element.load();
      setTracks([]);
    };
    const authorize = async () => {
      const position = element.currentTime,
        wasPlaying = !element.paused;
      try {
        const { data } = await studentRequest<PlaybackSession>(
          `/lessons/${lessonId}/media-session`,
          controller.signal,
          "POST",
          {},
        );
        if (controller.signal.aborted) return;
        const url = new URL(data.playlistUrl);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          !url.pathname.endsWith("/master.m3u8")
        )
          throw Error("Invalid media session");
        const delay = Date.parse(data.expiresAt) - Date.now() - 20000;
        if (!Number.isFinite(delay) || delay <= 0) throw Error("Media session expired");
        if (data.posterUrl) {
          const poster = new URL(data.posterUrl);
          if (poster.origin !== url.origin || !poster.pathname.endsWith("/poster.jpg"))
            throw Error("Invalid poster URL");
          element.poster = poster.href;
        }
        const captions = (data.captionTracks ?? []).map((track) => {
          const caption = new URL(track.url);
          const playbackAssetId = url.pathname.split("/").at(-2);
          if (
            caption.origin !== url.origin ||
            !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(playbackAssetId ?? "") ||
            !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(track.captionTrackId) ||
            caption.pathname !== `/playback/${playbackAssetId}/caption-${track.captionTrackId}.vtt` ||
            !caption.searchParams.has("token") ||
            track.format !== "WEBVTT"
          ) throw Error("Invalid caption URL");
          return { ...track, url: caption.href };
        });
        hls?.destroy();
        hls = undefined;
        if (element.canPlayType("application/vnd.apple.mpegurl")) element.src = url.href;
        else {
          const { default: Player } = await import("hls.js");
          if (controller.signal.aborted) return;
          if (!Player.isSupported()) throw Error("Trình duyệt không hỗ trợ phát HLS.");
          hls = new Player({ maxBufferLength: 30 });
          hls.on(Player.Events.ERROR, (_event, data) => {
            if (data.fatal && !controller.signal.aborted) {
              stop();
              setFailed(true);
              setMessage("Không tải được video. Hãy thử lại để kiểm tra quyền truy cập.");
            }
          });
          hls.loadSource(url.href);
          hls.attachMedia(element);
        }
        const restore = () => {
          if (position > 0) element.currentTime = position;
          if (wasPlaying) void element.play().catch(() => undefined);
        };
        element.addEventListener("loadedmetadata", restore, { once: true, signal: controller.signal });
        setFailed(false);
        setTracks(captions);
        setMessage("Video đã sẵn sàng. Dùng nút phát để bắt đầu.");
        timer = setTimeout(() => void authorize(), delay);
      } catch (error) {
        if (!controller.signal.aborted) {
          stop();
          setFailed(true);
          setMessage(studentError(error));
        }
      }
    };
    void authorize();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [lessonId, profile?.userId, revision]);
  return (
    <section className="lesson-media" aria-label="Video bài giảng">
      <video
        ref={video}
        controls
        crossOrigin="anonymous"
        playsInline
        preload="metadata"
        aria-label={title}
        style={{ width: "100%", aspectRatio: "16 / 9", background: "#111", borderRadius: 16 }}
      >
        {tracks.map((track) => (
          <track
            key={`${track.captionTrackId}:${track.url}`}
            kind={track.kind === "CAPTIONS" ? "captions" : "subtitles"}
            src={track.url}
            srcLang={track.language}
            label={track.label}
          />
        ))}
        <p>Trình duyệt chưa hỗ trợ video.</p>
      </video>
      <p key={message} role={failed ? "alert" : "status"}>
        {message}
      </p>
      <label>
        Tốc độ phát{" "}
        <select
          aria-label="Tốc độ phát"
          defaultValue="1"
          onChange={(event) => {
            if (video.current) video.current.playbackRate = Number(event.target.value);
          }}
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
      </label>
      {tracks.length ? (
        <label>
          Phụ đề{" "}
          <select aria-label="Chọn phụ đề" value={selectedTrack} onChange={(event) => setSelectedTrack(event.target.value)}>
            <option value="">Tắt phụ đề</option>
            {tracks.map((track) => <option key={track.captionTrackId} value={track.captionTrackId}>{track.label}</option>)}
          </select>
        </label>
      ) : null}
      {failed ? (
        <button className="button secondary" onClick={() => setRevision((n) => n + 1)}>
          Thử lại video
        </button>
      ) : null}
      <p className="muted">
        Phát hoặc tua video không tự đánh dấu hoàn thành. Dùng mục “Ghi nhận việc học” sau khi học xong. Bài
        này {tracks.length ? "có phụ đề tùy chọn." : "chưa có phụ đề."}
      </p>
    </section>
  );
}
