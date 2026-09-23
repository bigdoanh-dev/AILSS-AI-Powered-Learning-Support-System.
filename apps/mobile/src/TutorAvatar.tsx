import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import robot from "../assets/tutor-bot.png";

export function TutorAvatar({
  active = false,
  decorative = false,
  size = 54,
}: { active?: boolean; decorative?: boolean; size?: number }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const motion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    }).catch(() => {
      if (mounted) setReduceMotion(true);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      motion.stopAnimation();
      motion.setValue(0);
      return;
    }
    const duration = active ? 760 : 1900;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(motion, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(motion, { toValue: 0, duration, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, motion, reduceMotion]);

  const scale = motion.interpolate({ inputRange: [0, 1], outputRange: [1, active ? 1.18 : 1.08] });
  const glowOpacity = motion.interpolate({ inputRange: [0, 1], outputRange: [0.36, active ? 0.9 : 0.62] });
  const lift = motion.interpolate({ inputRange: [0, 1], outputRange: [1, -3] });

  return (
    <View
      accessible={!decorative}
      accessibilityRole="image"
      accessibilityLabel={active ? "Robot Gia sư AI đang trả lời" : "Robot Gia sư AI"}
      importantForAccessibility={decorative ? "no-hide-descendants" : "auto"}
      style={[avatar.frame, { width: size, height: size }]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          avatar.glow,
          {
            width: size * 1.15,
            height: size * 1.15,
            borderRadius: size,
            opacity: glowOpacity,
            transform: [{ scale }],
          },
        ]}
      />
      <Animated.Image
        source={robot}
        resizeMode="contain"
        style={{ width: size, height: size * 1.12, transform: [{ translateY: lift }] }}
      />
    </View>
  );
}

const avatar = StyleSheet.create({
  frame: { alignItems: "center", justifyContent: "center" },
  glow: { position: "absolute", backgroundColor: "#62E1D4" },
});
