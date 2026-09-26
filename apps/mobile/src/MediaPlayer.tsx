import { useEffect, useState } from "react";
import { Text, View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import type { Session } from "./session";
import { mediaError, mediaSession } from "./media";

export function MediaPlayer({ lessonId, session }: { lessonId: string; session: Session }) {
  const player = useVideoPlayer(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Đang xác minh quyền xem video…");
  const [revision, setRevision] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
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
    <View style={styles.card} accessibilityLabel="Video bài giảng được bảo vệ" testID="native-media-player">
      {status === "loading" && <ActivityIndicator accessibilityLabel="Đang tải video" />}
      <VideoView
        player={player}
        style={styles.video}
        nativeControls
        fullscreenOptions={{ enable: true }}
        contentFit="contain"
      />
      <Text accessibilityRole={status === "error" ? "alert" : "text"}>{message}</Text>
      {captionLabels.length > 0 ? (
        <Text accessibilityRole="text">
          Phụ đề: {captionLabels.join(", ")}. Phiên bản Mobile hiện chưa hiển thị phụ đề rời; bạn có thể xem phụ đề trên Web.
        </Text>
      ) : null}
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? "Tạm dừng video" : "Phát video"}
          disabled={status !== "ready"}
          onPress={() => {
            if (player.playing) player.pause();
            else player.play();
            setPlaying(player.playing);
          }}
        >
          <Text>{playing ? "Tạm dừng" : "Phát"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Lùi 10 giây"
          disabled={status !== "ready"}
          onPress={() => player.seekBy(-10)}
        >
          <Text>−10s</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tiến 10 giây"
          disabled={status !== "ready"}
          onPress={() => player.seekBy(10)}
        >
          <Text>+10s</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Đổi tốc độ phát"
          disabled={status !== "ready"}
          onPress={() => {
            const next = speed >= 2 ? 1 : speed + 0.25;
            player.playbackRate = next;
            setSpeed(next);
          }}
        >
          <Text>{String(speed)}×</Text>
        </Pressable>
        {status === "error" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Thử lại video"
            onPress={() => {
              setStatus("loading");
              setRevision((value) => value + 1);
            }}
          >
            <Text>Thử lại</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 16, backgroundColor: "#fff", borderRadius: 18, gap: 12 },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#111", borderRadius: 12 },
  controls: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
});
