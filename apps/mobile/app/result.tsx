import { useEffect, useRef } from "react";
import {
  Text,
  View,
  StyleSheet,
  Animated,
  Dimensions,
  StatusBar,
  ScrollView,
} from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Icon, type IconName } from "../src/ui";
import {
  ScalePressable,
  PulseBadge,
  FadeSlideIn,
  StaggerPop,
  useReducedMotionPreference,
} from "../src/motion";

export default function ResultScreen() {
  const params = useLocalSearchParams<{
    type?: string;
    title?: string;
    message?: string;
    role?: string;
    name?: string;
    email?: string;
    target?: string;
  }>();

  const type = params.type || "login-success";
  const isLoginSuccess = type === "login-success";
  const isRegisterSuccess = type === "register-success";
  const isSuccess = isLoginSuccess || isRegisterSuccess;
  const isLogout = type === "logout-success";
  const isError = type === "login-failure" || type === "logout-failure" || type === "error";
  const reduceMotion = useReducedMotionPreference();

  // Animation drivers
  const heroScale = useRef(new Animated.Value(0.4)).current;
  const heroOpacity = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Destination target
  const defaultTarget =
    params.target ||
    (params.role === "ADMIN"
      ? "/admin"
      : params.role === "LECTURER"
        ? "/teaching"
        : "/");

  const autoProceedMs = isSuccess ? 2200 : isLogout ? 2000 : 0;

  useEffect(() => {
    let entrance: Animated.CompositeAnimation | undefined;
    let progress: Animated.CompositeAnimation | undefined;
    if (reduceMotion === false) {
      heroOpacity.setValue(0);
      heroScale.setValue(0.4);
      progressAnim.setValue(0);
      entrance = Animated.parallel([
        Animated.timing(heroOpacity, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.spring(heroScale, {
          toValue: 1,
          speed: 16,
          bounciness: 8,
          useNativeDriver: true,
        }),
      ]);
      entrance.start();
    } else if (reduceMotion) {
      heroOpacity.setValue(1);
      heroScale.setValue(1);
      progressAnim.setValue(1);
    } else {
      heroOpacity.setValue(0);
      heroScale.setValue(0.4);
      progressAnim.setValue(0);
    }

    if (autoProceedMs > 0) {
      if (reduceMotion === false) {
        progress = Animated.timing(progressAnim, {
          toValue: 1,
          duration: autoProceedMs,
          useNativeDriver: false,
        });
        progress.start();
      }

      const timer = setTimeout(() => {
        if (isLogout) {
          router.replace("/");
        } else if (isSuccess) {
          router.replace(defaultTarget as Href);
        }
      }, autoProceedMs);

      return () => {
        entrance?.stop();
        progress?.stop();
        clearTimeout(timer);
      };
    }
    return () => entrance?.stop();
  }, [autoProceedMs, defaultTarget, heroOpacity, heroScale, isLogout, isSuccess, progressAnim, reduceMotion]);

  const handleProceed = () => {
    if (isLogout) {
      router.replace("/");
    } else if (isSuccess) {
      router.replace(defaultTarget as Href);
    } else {
      router.replace("/login");
    }
  };

  // Role metadata styling
  const roleDisplay =
    params.role === "ADMIN"
      ? { label: "QUẢN TRỊ VIÊN (ADMIN)", color: "#DC2626", bg: "#FEE2E2", icon: "shield" as IconName }
      : params.role === "LECTURER"
        ? { label: "GIẢNG VIÊN (LECTURER)", color: "#7C3AED", bg: "#EDE9FE", icon: "academic" as IconName }
        : { label: "HỌC VIÊN (STUDENT)", color: "#0A7E85", bg: "#E6F7F7", icon: "user" as IconName };

  return (
    <View style={screenStyles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      <ScrollView
        contentContainerStyle={screenStyles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top App Identity */}
        <FadeSlideIn delay={50} duration={300}>
          <View style={screenStyles.brandRow}>
            <View style={screenStyles.brandDot} />
            <Text style={screenStyles.brandText}>AILSS LEARNING PLATFORM</Text>
          </View>
        </FadeSlideIn>

        {/* Animated Hero Icon */}
        <Animated.View
          style={[
            screenStyles.heroWrapper,
            {
              opacity: heroOpacity,
              transform: [{ scale: heroScale }],
            },
          ]}
        >
          <PulseBadge>
            <View
              style={[
                screenStyles.iconOuterRing,
                {
                  backgroundColor: isSuccess
                    ? "#D1FAE5"
                    : isLogout
                      ? "#DBEAFE"
                      : "#FEE2E2",
                  borderColor: isSuccess
                    ? "#10B981"
                    : isLogout
                      ? "#3B82F6"
                      : "#EF4444",
                },
              ]}
            >
              <View
                style={[
                  screenStyles.iconInnerCircle,
                  {
                    backgroundColor: isSuccess
                      ? "#10B981"
                      : isLogout
                        ? "#2563EB"
                        : "#DC2626",
                  },
                ]}
              >
                <Icon
                  name={
                    isSuccess
                      ? "check"
                      : isLogout
                        ? "logout"
                        : "alert"
                  }
                  size={46}
                  color="#FFFFFF"
                />
              </View>
            </View>
          </PulseBadge>
        </Animated.View>

        {/* Text Details with Stagger Animation */}
        <StaggerPop index={1} baseDelay={150}>
          <Text
            testID={isLoginSuccess ? "student-login-success" : isError ? "student-login-error" : undefined}
            style={screenStyles.titleText}
          >
            {params.title ||
              (isLoginSuccess
                ? "Đăng Nhập Thành Công!"
                : isRegisterSuccess
                  ? "Tạo Tài Khoản Thành Công!"
                  : isLogout
                    ? "Đã Đăng Xuất An Toàn"
                    : "Đăng Nhập Thất Bại")}
          </Text>
        </StaggerPop>

        <StaggerPop index={2} baseDelay={220}>
          <Text style={screenStyles.subtitleText}>
            {params.message ||
              (isLoginSuccess
                ? `Chào mừng bạn quay trở lại! Đang chuẩn bị không gian làm việc...`
                : isRegisterSuccess
                  ? `Tài khoản học viên của bạn đã sẵn sàng bắt đầu hành trình học tập.`
                  : isLogout
                    ? `Phiên làm việc trên thiết bị đã được thu hồi bảo mật.`
                    : `Thông tin tài khoản hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.`)}
          </Text>
        </StaggerPop>

        {/* User Identity Capsule (on Login Success) */}
        {isSuccess && (params.name || params.role) && (
          <StaggerPop index={3} baseDelay={300} style={screenStyles.profileCard}>
            <View
              style={[
                screenStyles.roleBadge,
                { backgroundColor: roleDisplay.bg, borderColor: roleDisplay.color },
              ]}
            >
              <Icon name={roleDisplay.icon} size={15} color={roleDisplay.color} />
              <Text style={[screenStyles.roleBadgeText, { color: roleDisplay.color }]}>
                {roleDisplay.label}
              </Text>
            </View>

            {params.name && (
              <Text style={screenStyles.profileName}>{params.name}</Text>
            )}
            {params.email && (
              <Text style={screenStyles.profileEmail}>{params.email}</Text>
            )}
          </StaggerPop>
        )}

        {/* Error Detail Capsule (on Failure) */}
        {isError && (
          <StaggerPop index={3} baseDelay={300} style={screenStyles.errorCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="alert" size={18} color="#DC2626" />
              <Text style={screenStyles.errorCardTitle}>Chi tiết thông báo:</Text>
            </View>
            <Text style={screenStyles.errorCardMessage}>
              {params.message || "Email hoặc mật khẩu chưa đúng, hoặc kết nối mạng bị gián đoạn."}
            </Text>
          </StaggerPop>
        )}

        {/* Animated Countdown Progress Bar */}
        {(isSuccess || isLogout) && (
          <StaggerPop index={4} baseDelay={360} style={screenStyles.progressSection}>
            <View style={screenStyles.progressBarTrack}>
              <Animated.View
                style={[
                  screenStyles.progressBarFill,
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
            <Text style={screenStyles.autoRedirectText}>
              Tự động chuyển tiếp sau giây lát…
            </Text>
          </StaggerPop>
        )}

        {/* Actions Button Group */}
        <StaggerPop index={5} baseDelay={420} style={screenStyles.actionsContainer}>
          <ScalePressable
            style={[
              screenStyles.primaryButton,
              {
                backgroundColor: isSuccess
                  ? "#0A7E85"
                  : isLogout
                    ? "#2563EB"
                    : "#DC2626",
              },
            ]}
            onPress={handleProceed}
          >
            <Text style={screenStyles.primaryButtonText}>
              {isSuccess
                ? "Vào không gian học tập ngay →"
                : isLogout
                  ? "Về trang chủ ngay →"
                  : "Thử đăng nhập lại"}
            </Text>
          </ScalePressable>

          {(isError || isLogout) && (
            <ScalePressable
              style={screenStyles.secondaryButton}
              onPress={() => router.replace("/")}
            >
              <Text style={screenStyles.secondaryButtonText}>← Về trang chủ</Text>
            </ScalePressable>
          )}

          {isError && (
            <ScalePressable
              style={screenStyles.ghostButton}
              onPress={() => router.replace("/login?role=admin")}
            >
              <Text style={screenStyles.ghostButtonText}>🛡️ Đăng nhập quyền Quản trị viên (Admin)</Text>
            </ScalePressable>
          )}
        </StaggerPop>
      </ScrollView>
    </View>
  );
}

const { width } = Dimensions.get("window");

const screenStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 28,
  },
  brandDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0A7E85",
  },
  brandText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 1.2,
  },
  heroWrapper: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  iconOuterRing: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    padding: 6,
  },
  iconInnerCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
  },
  titleText: {
    fontSize: 24,
    fontWeight: "900",
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.4,
  },
  subtitleText: {
    fontSize: 15,
    color: "#475569",
    textAlign: "center",
    lineHeight: 22,
    maxWidth: width - 64,
    marginBottom: 20,
  },
  profileCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    gap: 6,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 9999,
    borderWidth: 1,
    marginBottom: 4,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  profileName: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
  },
  profileEmail: {
    fontSize: 13,
    color: "#64748B",
  },
  errorCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: "#FEF2F2",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#FECACA",
    marginBottom: 20,
    gap: 6,
  },
  errorCardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#991B1B",
  },
  errorCardMessage: {
    fontSize: 13,
    color: "#7F1D1D",
    lineHeight: 18,
  },
  progressSection: {
    width: "100%",
    maxWidth: 340,
    alignItems: "center",
    marginBottom: 24,
  },
  progressBarTrack: {
    width: "100%",
    height: 5,
    backgroundColor: "#E2E8F0",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  autoRedirectText: {
    fontSize: 12,
    color: "#94A3B8",
    fontWeight: "500",
  },
  actionsContainer: {
    width: "100%",
    maxWidth: 340,
    gap: 10,
  },
  primaryButton: {
    width: "100%",
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    width: "100%",
    paddingVertical: 13,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
  },
  secondaryButtonText: {
    color: "#334155",
    fontSize: 14,
    fontWeight: "700",
  },
  ghostButton: {
    width: "100%",
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostButtonText: {
    color: "#DC2626",
    fontSize: 13,
    fontWeight: "700",
  },
});
