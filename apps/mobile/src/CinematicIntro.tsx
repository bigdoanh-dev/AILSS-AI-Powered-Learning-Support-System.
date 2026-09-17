import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, Pressable, Animated } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import Ionicons from "@expo/vector-icons/Ionicons";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const videoSource = require("../assets/intro_cinematic.mp4");
import {
  getHasPlayedIntroThisSession,
  markIntroAsPlayed,
  resetIntroSessionForTesting,
} from "./intro-session";

export { resetIntroSessionForTesting };

export interface CinematicIntroProps {
  onFinish?: () => void;
}

export function CinematicIntro({ onFinish }: CinematicIntroProps) {
  const shouldShow = !getHasPlayedIntroThisSession();
  const [visible, setVisible] = useState(shouldShow);
  const [isMuted, setIsMuted] = useState(true);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const isClosing = useRef(false);

  useEffect(() => {
    // Mark as played in this app launch session
    markIntroAsPlayed();
  }, []);

  const handleClose = () => {
    markIntroAsPlayed();
    if (isClosing.current) return;
    isClosing.current = true;
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 600,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
      onFinish?.();
    });
  };

  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = false;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (!player) return;
    const subscription = player.addListener("playToEnd", () => {
      handleClose();
    });
    return () => {
      subscription?.remove?.();
    };
  }, [player]);

  // Safety fallback timeout in case playback stalls or is in test environment
  useEffect(() => {
    const timer = setTimeout(() => {
      handleClose();
    }, 16000);
    return () => clearTimeout(timer);
  }, []);

  const toggleSound = () => {
    if (player) {
      player.muted = !player.muted;
      setIsMuted(player.muted);
    }
  };

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.container, { opacity: fadeAnim }]}
      pointerEvents={isClosing.current ? "none" : "auto"}
      accessibilityRole="none"
      accessibilityLabel="Video giới thiệu ứng dụng"
    >
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="cover"
      />
      <View style={styles.controlsRow}>
        <Pressable
          style={styles.controlButton}
          onPress={toggleSound}
          accessibilityRole="button"
          accessibilityLabel={isMuted ? "Bật âm thanh" : "Tắt âm thanh"}
        >
          <Ionicons
            name={isMuted ? "volume-mute" : "volume-high"}
            size={16}
            color="#ffffff"
            style={{ marginRight: 6 }}
          />
          <Text style={styles.controlButtonText}>
            {isMuted ? "Bật âm thanh" : "Đang phát"}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.controlButton, styles.skipButton]}
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Bỏ qua video giới thiệu"
        >
          <Text style={[styles.controlButtonText, styles.skipText]}>
            Bỏ qua
          </Text>
          <Ionicons name="close" size={16} color="#ffffff" style={{ marginLeft: 4 }} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#000000",
    zIndex: 99999,
    elevation: 999,
  },
  controlsRow: {
    position: "absolute",
    top: 50,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 100000,
  },
  controlButton: {
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.25)",
  },
  skipButton: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    borderColor: "rgba(255, 255, 255, 0.45)",
  },
  controlButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  skipText: {
    fontWeight: "700",
  },
});
