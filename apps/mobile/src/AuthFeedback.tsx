import React, { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Icon, tokens, type IconName } from "./ui";
import { ScalePressable, PulseBadge, useReducedMotionPreference } from "./motion";

export type AuthFeedbackType = "LOGIN_SUCCESS" | "LOGIN_ERROR" | "LOGOUT_SUCCESS" | "REGISTER_SUCCESS";

export interface AuthFeedbackProps {
  visible: boolean;
  type: AuthFeedbackType;
  title: string;
  message: string;
  user?: {
    displayName?: string;
    emailMasked?: string;
    role?: string;
  } | null;
  onDismiss?: () => void;
  onProceed?: () => void;
  proceedLabel?: string;
  autoProceedMs?: number;
}

export function AuthFeedbackModal({
  visible,
  type,
  title,
  message,
  user,
  onDismiss,
  onProceed,
  proceedLabel,
  autoProceedMs = 2000,
}: AuthFeedbackProps) {
  const isSuccess = type === "LOGIN_SUCCESS" || type === "REGISTER_SUCCESS";
  const isLogout = type === "LOGOUT_SUCCESS";
  const isError = type === "LOGIN_ERROR";
  const reduceMotion = useReducedMotionPreference();

  const backdropAnim = useRef(new Animated.Value(0)).current;
  const cardScaleAnim = useRef(new Animated.Value(0.7)).current;
  const cardTranslateY = useRef(new Animated.Value(30)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    let entrance: Animated.CompositeAnimation | undefined;
    let progress: Animated.CompositeAnimation | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (reduceMotion === false) {
      backdropAnim.setValue(0);
      cardScaleAnim.setValue(0.7);
      cardTranslateY.setValue(30);
      progressAnim.setValue(0);

      entrance = Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.spring(cardScaleAnim, {
          toValue: 1,
          speed: 16,
          bounciness: 7,
          useNativeDriver: true,
        }),
        Animated.spring(cardTranslateY, {
          toValue: 0,
          speed: 18,
          bounciness: 5,
          useNativeDriver: true,
        }),
      ]);
      entrance.start();
    } else if (reduceMotion) {
      backdropAnim.setValue(1);
      cardScaleAnim.setValue(1);
      cardTranslateY.setValue(0);
      progressAnim.setValue(1);
    } else {
      backdropAnim.setValue(0);
      cardScaleAnim.setValue(0.7);
      cardTranslateY.setValue(30);
      progressAnim.setValue(0);
    }

    if ((isSuccess || isLogout) && autoProceedMs > 0 && onProceed) {
      if (reduceMotion === false) {
        progress = Animated.timing(progressAnim, {
          toValue: 1,
          duration: autoProceedMs,
          useNativeDriver: false,
        });
        progress.start();
      }

      timer = setTimeout(() => {
        onProceed();
      }, autoProceedMs);
    }

    return () => {
      entrance?.stop();
      progress?.stop();
      if (timer) clearTimeout(timer);
    };
  }, [
    autoProceedMs,
    backdropAnim,
    cardScaleAnim,
    cardTranslateY,
    isLogout,
    isSuccess,
    onProceed,
    progressAnim,
    reduceMotion,
    visible,
  ]);

  if (!visible) return null;

  const roleMeta =
    user?.role === "ADMIN"
      ? { label: "Quản trị viên (ADMIN)", color: "#DC2626", bg: "#FEE2E2", icon: "shield" as IconName }
      : user?.role === "LECTURER"
        ? { label: "Giảng viên (LECTURER)", color: "#7C3AED", bg: "#EDE9FE", icon: "academic" as IconName }
        : { label: "Học viên (STUDENT)", color: "#0A7E85", bg: "#E6F7F7", icon: "user" as IconName };

  const iconMeta = isSuccess
    ? { name: "check" as IconName, color: "#10B981", bg: "#D1FAE5", border: "#A7F3D0" }
    : isLogout
      ? { name: "logout" as IconName, color: "#2563EB", bg: "#DBEAFE", border: "#BFDBFE" }
      : { name: "alert" as IconName, color: "#EF4444", bg: "#FEE2E2", border: "#FECACA" };

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={feedbackStyles.overlay}>
        {/* Animated backdrop */}
        <Animated.View
          style={[
            feedbackStyles.backdrop,
            {
              opacity: backdropAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.65],
              }),
            },
          ]}
        />

        {/* Animated Card */}
        <Animated.View
          style={[
            feedbackStyles.cardContainer,
            {
              opacity: backdropAnim,
              transform: [{ scale: cardScaleAnim }, { translateY: cardTranslateY }],
            },
          ]}
        >
          {/* Top Decorative Indicator */}
          <View
            style={[
              feedbackStyles.topStripe,
              {
                backgroundColor: isSuccess ? "#10B981" : isLogout ? "#2563EB" : "#EF4444",
              },
            ]}
          />

          <View style={feedbackStyles.cardContent}>
            {/* Animated Icon Ring */}
            <PulseBadge style={feedbackStyles.iconWrapper}>
              <View
                style={[
                  feedbackStyles.iconCircle,
                  {
                    backgroundColor: iconMeta.bg,
                    borderColor: iconMeta.border,
                  },
                ]}
              >
                <Icon name={iconMeta.name} size={36} color={iconMeta.color} />
              </View>
            </PulseBadge>

            {/* Title & Feedback message */}
            <Text style={feedbackStyles.titleText}>{title}</Text>
            <Text style={feedbackStyles.messageText}>{message}</Text>

            {/* User Profile Capsule (if logged in) */}
            {isSuccess && user && (
              <View style={feedbackStyles.profileCapsule}>
                <View style={feedbackStyles.profileRow}>
                  <View
                    style={[
                      feedbackStyles.roleBadge,
                      { backgroundColor: roleMeta.bg, borderColor: roleMeta.color },
                    ]}
                  >
                    <Icon name={roleMeta.icon} size={14} color={roleMeta.color} />
                    <Text style={[feedbackStyles.roleBadgeText, { color: roleMeta.color }]}>
                      {roleMeta.label}
                    </Text>
                  </View>
                </View>

                {user.displayName && <Text style={feedbackStyles.displayNameText}>{user.displayName}</Text>}
                {user.emailMasked && <Text style={feedbackStyles.emailText}>{user.emailMasked}</Text>}
              </View>
            )}

            {/* Auto progress bar */}
            {(isSuccess || isLogout) && autoProceedMs > 0 && onProceed && (
              <View style={feedbackStyles.progressBarTrack}>
                <Animated.View
                  style={[
                    feedbackStyles.progressBarFill,
                    {
                      backgroundColor: isSuccess ? "#10B981" : "#2563EB",
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0%", "100%"],
                      }),
                    },
                  ]}
                />
              </View>
            )}

            {/* Action Buttons */}
            <View style={feedbackStyles.actionRow}>
              {onProceed && (
                <ScalePressable
                  style={[
                    feedbackStyles.primaryBtn,
                    {
                      backgroundColor: isSuccess ? "#0A7E85" : isLogout ? "#2563EB" : "#DC2626",
                    },
                  ]}
                  onPress={onProceed}
                >
                  <Text style={feedbackStyles.primaryBtnText}>
                    {proceedLabel ||
                      (isSuccess ? "Vào ứng dụng ngay →" : isLogout ? "Về trang chủ →" : "Đã hiểu")}
                  </Text>
                </ScalePressable>
              )}

              {isError && onDismiss && (
                <ScalePressable style={feedbackStyles.secondaryBtn} onPress={onDismiss}>
                  <Text style={feedbackStyles.secondaryBtnText}>Thử lại</Text>
                </ScalePressable>
              )}
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const { width } = Dimensions.get("window");
const cardWidth = Math.min(width - 40, 380);

const feedbackStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#0F172A",
  },
  cardContainer: {
    width: cardWidth,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  topStripe: {
    height: 6,
    width: "100%",
  },
  cardContent: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: "center",
  },
  iconWrapper: {
    marginBottom: 16,
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  titleText: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  messageText: {
    fontSize: 14,
    color: "#475569",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  profileCapsule: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    marginBottom: 16,
    gap: 4,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  displayNameText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
  emailText: {
    fontSize: 13,
    color: "#64748B",
  },
  progressBarTrack: {
    width: "100%",
    height: 4,
    backgroundColor: "#E2E8F0",
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 16,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 2,
  },
  actionRow: {
    width: "100%",
    gap: 10,
  },
  primaryBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0A7E85",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryBtn: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  secondaryBtnText: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "600",
  },
});
