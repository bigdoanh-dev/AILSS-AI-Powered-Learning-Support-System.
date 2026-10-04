import { useLanguage } from "./use-language";
import React, { useRef, useEffect, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Animated,
  View,
  Text,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from "react-native";

export interface ScalePressableProps extends PressableProps {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  children: React.ReactNode;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

let reduceMotionSnapshot: boolean | null = null;
let reduceMotionInitialized = false;
const reduceMotionListeners = new Set<() => void>();

function updateReduceMotionSnapshot(enabled: boolean): void {
  if (reduceMotionSnapshot === enabled) return;
  reduceMotionSnapshot = enabled;
  for (const listener of reduceMotionListeners) listener();
}

function subscribeToReduceMotion(listener: () => void): () => void {
  reduceMotionListeners.add(listener);
  if (!reduceMotionInitialized) {
    reduceMotionInitialized = true;
    AccessibilityInfo.addEventListener("reduceMotionChanged", updateReduceMotionSnapshot);
    void AccessibilityInfo.isReduceMotionEnabled()
      .then(updateReduceMotionSnapshot)
      .catch(() => {
        updateReduceMotionSnapshot(true);
      });
  }
  return () => reduceMotionListeners.delete(listener);
}

function getReduceMotionSnapshot(): boolean | null {
  return reduceMotionSnapshot;
}

export function useReducedMotionPreference(): boolean | null {
  return useSyncExternalStore(subscribeToReduceMotion, getReduceMotionSnapshot, getReduceMotionSnapshot);
}

function shouldAnimate(reduceMotion: boolean | null): boolean {
  return reduceMotion === false;
}

export function ScalePressable({
  style,
  scaleTo = 0.94,
  children,
  onPressIn,
  onPressOut,
  ...props
}: ScalePressableProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotionPreference();

  const handlePressIn = (e: GestureResponderEvent) => {
    if (shouldAnimate(reduceMotion)) {
      Animated.spring(scale, {
        toValue: scaleTo,
        useNativeDriver: true,
        speed: 30,
        bounciness: 4,
      }).start();
    } else {
      scale.setValue(1);
    }
    onPressIn?.(e);
  };

  const handlePressOut = (e: GestureResponderEvent) => {
    if (shouldAnimate(reduceMotion)) {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 25,
        bounciness: 6,
      }).start();
    } else {
      scale.setValue(1);
    }
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      style={[{ transform: [{ scale }] }, style]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}

export function FadeSlideIn({
  children,
  delay = 0,
  duration = 450,
  fromY = 20,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  fromY?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(fromY)).current;
  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }

    opacity.setValue(0);
    translateY.setValue(fromY);
    let animation: Animated.CompositeAnimation | undefined;
    const timer = setTimeout(() => {
      animation = Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        }),
        Animated.spring(translateY, {
          toValue: 0,
          speed: 18,
          bounciness: 4,
          useNativeDriver: true,
        }),
      ]);
      animation.start();
    }, delay);

    return () => {
      clearTimeout(timer);
      animation?.stop();
    };
  }, [delay, duration, fromY, opacity, reduceMotion, translateY]);

  return <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

export function StaggerPop({
  children,
  index = 0,
  baseDelay = 80,
  staggerStep = 40,
  style,
}: {
  children: React.ReactNode;
  index?: number;
  baseDelay?: number;
  staggerStep?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      scale.setValue(1);
      opacity.setValue(1);
      return;
    }

    scale.setValue(0.7);
    opacity.setValue(0);
    let animation: Animated.CompositeAnimation | undefined;
    const timer = setTimeout(
      () => {
        animation = Animated.parallel([
          Animated.timing(opacity, {
            toValue: 1,
            duration: 280,
            useNativeDriver: true,
          }),
          Animated.spring(scale, {
            toValue: 1,
            speed: 22,
            bounciness: 7,
            useNativeDriver: true,
          }),
        ]);
        animation.start();
      },
      baseDelay + index * staggerStep,
    );

    return () => {
      clearTimeout(timer);
      animation?.stop();
    };
  }, [baseDelay, index, opacity, reduceMotion, scale, staggerStep]);

  return <Animated.View style={[{ opacity, transform: [{ scale }] }, style]}>{children}</Animated.View>;
}

export function PulseBadge({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.85)).current;
  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    if (!shouldAnimate(reduceMotion)) {
      scale.setValue(1);
      opacity.setValue(1);
      return;
    }

    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.08,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.85,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, reduceMotion, scale]);

  return <Animated.View style={[{ opacity, transform: [{ scale }] }, style]}>{children}</Animated.View>;
}

export function FloatingElement({
  children,
  distance = 3,
  duration = 1800,
  style,
}: {
  children: React.ReactNode;
  distance?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    if (!shouldAnimate(reduceMotion)) {
      translateY.setValue(0);
      return;
    }

    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -distance,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [distance, duration, reduceMotion, translateY]);

  return <Animated.View style={[{ transform: [{ translateY }] }, style]}>{children}</Animated.View>;
}

export function AnimatedProgressBar({
  progress,
  color = "#6366F1",
  height = 7,
  style,
}: {
  progress: number;
  color?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const animatedWidth = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotionPreference();
  const targetWidth = Math.min(100, Math.max(0, progress));

  useEffect(() => {
    if (!shouldAnimate(reduceMotion)) {
      animatedWidth.setValue(targetWidth);
      return;
    }

    const animation = Animated.timing(animatedWidth, {
      toValue: targetWidth,
      duration: 800,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [animatedWidth, reduceMotion, targetWidth]);

  const widthInterpolated = animatedWidth.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View
      style={[
        {
          height,
          backgroundColor: "#E2E8F0",
          borderRadius: height / 2,
          overflow: "hidden",
          width: "100%",
        },
        style,
      ]}
    >
      <Animated.View
        style={{
          height: "100%",
          backgroundColor: color,
          borderRadius: height / 2,
          width: widthInterpolated,
        }}
      />
    </View>
  );
}

function parseMobileNumber(
  input: number | string,
  explicitDecimals?: number,
): { target: number; decimals: number } {
  if (typeof input === "number") {
    return {
      target: input,
      decimals: explicitDecimals !== undefined ? explicitDecimals : input % 1 !== 0 ? 1 : 0,
    };
  }
  const str = String(input).trim();
  const match = str.match(/^([^\d+-]*)([+-]?\d(?:[\d.,]*\d)?)(.*)$/);
  if (!match) return { target: 0, decimals: 0 };
  let cleanNum = match[2];
  let dec = explicitDecimals ?? 0;
  if (cleanNum.includes(".") && cleanNum.includes(",")) {
    if (cleanNum.lastIndexOf(".") > cleanNum.lastIndexOf(",")) {
      cleanNum = cleanNum.replace(/,/g, "");
      if (explicitDecimals === undefined) dec = cleanNum.split(".")[1]?.length || 0;
    } else {
      cleanNum = cleanNum.replace(/\./g, "").replace(",", ".");
      if (explicitDecimals === undefined) dec = cleanNum.split(".")[1]?.length || 0;
    }
  } else if (cleanNum.includes(".")) {
    const parts = cleanNum.split(".");
    if (parts.length === 2 && parts[1].length <= 2) {
      if (explicitDecimals === undefined) dec = parts[1].length;
    } else {
      cleanNum = parts.join("");
    }
  } else if (cleanNum.includes(",")) {
    const parts = cleanNum.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      cleanNum = cleanNum.replace(",", ".");
      if (explicitDecimals === undefined) dec = parts[1].length;
    } else {
      cleanNum = parts.join("");
    }
  }
  const target = parseFloat(cleanNum);
  return { target: isNaN(target) ? 0 : target, decimals: dec };
}

export function AnimatedNumber({
  value,
  duration = 800,
  prefix = "",
  suffix = "",
  decimals,
  formatter,
  style,
}: {
  value: number | string;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  formatter?: (val: number) => string;
  style?: StyleProp<TextStyle>;
}) {
  const { locale: uiLocale } = useLanguage();
  const { target, decimals: parsedDecimals } = parseMobileNumber(value, decimals);
  const [displayValue, setDisplayValue] = React.useState(0);
  const animValue = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    if (reduceMotion === null) return;
    if (reduceMotion) {
      animValue.setValue(target);
      setDisplayValue(target);
      return;
    }

    animValue.setValue(0);
    const listener = animValue.addListener(({ value: current }) => {
      setDisplayValue(current);
    });

    const animation = Animated.timing(animValue, {
      toValue: target,
      duration,
      useNativeDriver: false,
    });
    animation.start();

    return () => {
      animation.stop();
      animValue.removeListener(listener);
    };
  }, [animValue, duration, reduceMotion, target]);

  const formatted = formatter
    ? formatter(displayValue)
    : parsedDecimals > 0
      ? displayValue.toFixed(parsedDecimals)
      : Math.round(displayValue).toLocaleString(uiLocale);

  return (
    <Text style={style}>
      {prefix}
      {formatted}
      {suffix}
    </Text>
  );
}
