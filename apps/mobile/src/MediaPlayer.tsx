import { useUiText } from "./use-language";
import { useEffect, useState } from "react";
import { Text, View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import type { Session } from "./session";
import { mediaError, mediaSession } from "./media";

export function MediaPlayer({ lessonId, session }: { lessonId: string; session: Session }) {
  const uiText = useUiText();
  const player = useVideoPlayer(null, (p) => {
    p.playbackRate = 1.5;
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Đang xác minh quyền xem video…");
  const [revision, setRevision] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.5);
  const [captionLabels, setCaptionLabels] = useState<string[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = player.addListener("playingChange", ({ isPlaying }) => setPlaying(isPlaying));
    const failure = player.addListener("statusChange", ({ status: next }) => {
      if (next === "error") {
        setStatus("error");
        setMessage("Không thể tải HLS. Hãy thử lại.");
      }
    });
    const authorize = async () => {
      try {
        const raw = await session.request(`/api/v1/lessons/${lessonId}/media-session`, {
          method: "POST",
          body: {},
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const data = mediaSession(raw, session.api.origin);
        setCaptionLabels(data.captionTracks.map((track) => track.label));
        const time = player.currentTime;
        const resume = player.playing;
        await player.replaceAsync({ uri: data.playlistUrl, contentType: "hls", useCaching: false });
        if (controller.signal.aborted) return;
        player.playbackRate = speed;
        if (time > 0) player.currentTime = time;
        if (resume) player.play();
        setStatus("ready");
        setMessage("Video đã sẵn sàng. Việc phát không tự đánh dấu hoàn thành bài học.");
        timer = setTimeout(() => void authorize(), Date.parse(data.expiresAt) - Date.now() - 20_000);
      } catch (error) {
        if (!controller.signal.aborted) {
          player.pause();
          setStatus("error");
          setMessage(mediaError(error));
        }
      }
    };
    void authorize();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      subscription.remove();
      failure.remove();
      // useVideoPlayer owns the native object's release on unmount. Calling
      // pause here can race that release during navigation/fast refresh.
    };
  }, [lessonId, player, revision, session]);
  return (
    <View
      style={styles.card}
      accessibilityLabel={uiText("Video bài giảng được bảo vệ")}
      testID="native-media-player"
    >
      <View style={styles.videoStage}>
        {status === "loading" && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#38BDF8" accessibilityLabel={uiText("Đang tải video")} />
          </View>
        )}
        <VideoView
          player={player}
          style={styles.video}
          nativeControls
          fullscreenOptions={{ enable: true }}
          contentFit="contain"
        />
      </View>
      <View style={styles.metaContainer}>
        <View style={styles.badgeRow}>
          <View style={styles.badgeHD}>
            <Text style={styles.badgeHDText}>HD 1080p</Text>
          </View>
          <View style={styles.badgeHLS}>
            <Text style={styles.badgeHLSText}>HLS</Text>
          </View>
        </View>
        <Text style={styles.statusText} accessibilityRole={status === "error" ? "alert" : "text"}>
          {uiText(message)}
        </Text>
        {captionLabels.length > 0 ? (
          <Text style={styles.captionText} accessibilityRole="text">
            {uiText("Phụ đề: ")}
            {captionLabels.join(", ")}
            {uiText(". Phiên bản Mobile hiện chưa hiển thị phụ đề rời; bạn có thể xem phụ đề trên Web.")}
          </Text>
        ) : null}
        <View style={styles.controls}>
          <Pressable
            style={[styles.ctrlBtn, styles.ctrlBtnPrimary]}
            accessibilityRole="button"
            accessibilityLabel={playing ? uiText("Tạm dừng video") : uiText("Phát video")}
            disabled={status !== "ready"}
            onPress={() => {
              if (player.playing) player.pause();
              else player.play();
              setPlaying(player.playing);
            }}
          >
            <Text style={styles.ctrlBtnPrimaryText}>{playing ? uiText("Tạm dừng") : uiText("Phát")}</Text>
          </Pressable>
          <Pressable
            style={styles.ctrlBtn}
            accessibilityRole="button"
            accessibilityLabel={uiText("Lùi 10 giây")}
            disabled={status !== "ready"}
            onPress={() => player.seekBy(-10)}
          >
            <Text style={styles.ctrlBtnText}>−10s</Text>
          </Pressable>
          <Pressable
            style={styles.ctrlBtn}
            accessibilityRole="button"
            accessibilityLabel={uiText("Tiến 10 giây")}
            disabled={status !== "ready"}
            onPress={() => player.seekBy(10)}
          >
            <Text style={styles.ctrlBtnText}>+10s</Text>
          </Pressable>
          <Pressable
            style={styles.ctrlBtn}
            accessibilityRole="button"
            accessibilityLabel={uiText("Đổi tốc độ phát")}
            disabled={status !== "ready"}
            onPress={() => {
              const next = speed >= 2 ? 1 : speed + 0.25;
              player.playbackRate = next;
              setSpeed(next);
            }}
          >
            <Text style={styles.ctrlBtnText}>
              {String(speed)}
              {uiText("×")}
            </Text>
          </Pressable>
          {status === "error" && (
            <Pressable
              style={[styles.ctrlBtn, styles.ctrlBtnRetry]}
              accessibilityRole="button"
              accessibilityLabel={uiText("Thử lại video")}
              onPress={() => {
                setStatus("loading");
                setRevision((value) => value + 1);
              }}
            >
              <Text style={styles.ctrlBtnRetryText}>{uiText("Thử lại")}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    marginHorizontal: -16,
    backgroundColor: "#0B1120",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    shadowColor: "#0A7E85",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  videoStage: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000000",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  video: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000000",
  },
  metaContainer: {
    padding: 14,
    gap: 10,
    backgroundColor: "rgba(15, 23, 42, 0.95)",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  badgeHD: {
    backgroundColor: "#0284C7",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeHDText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  badgeHLS: {
    backgroundColor: "rgba(34, 197, 94, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.4)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeHLSText: {
    color: "#4ADE80",
    fontSize: 10,
    fontWeight: "700",
  },
  statusText: {
    color: "#E2E8F0",
    fontSize: 12,
    lineHeight: 16,
  },
  captionText: {
    color: "#94A3B8",
    fontSize: 11,
    lineHeight: 15,
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  ctrlBtn: {
    paddingVertical: 7,
    paddingHorizontal: 13,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlBtnText: {
    color: "#F1F5F9",
    fontSize: 12,
    fontWeight: "700",
  },
  ctrlBtnPrimary: {
    backgroundColor: "rgba(10, 126, 133, 0.35)",
    borderColor: "rgba(56, 189, 248, 0.6)",
  },
  ctrlBtnPrimaryText: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "700",
  },
  ctrlBtnRetry: {
    backgroundColor: "rgba(239, 68, 68, 0.2)",
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  ctrlBtnRetryText: {
    color: "#F87171",
    fontSize: 12,
    fontWeight: "700",
  },
});
