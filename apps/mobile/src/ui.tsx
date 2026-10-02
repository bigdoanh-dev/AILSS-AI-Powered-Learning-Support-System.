import React, { type PropsWithChildren } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  Pressable,
  ScrollView,
  View,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
  type ViewProps,
  type AccessibilityRole,
} from "react-native";
import { ScalePressable, useReducedMotionPreference } from "./motion";
import Ionicons from "@expo/vector-icons/Ionicons";
import { BlurView } from "expo-blur";
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from "expo-glass-effect";

export const tokens = {
  color: {
    brand: "#0A7E85",
    brandDark: "#065A5F",
    brandLight: "#E6F7F7",
    brandGradientStart: "#0A7E85",
    brandGradientEnd: "#14B8A6",
    ink: "#0F172A",
    inkSecondary: "#334155",
    muted: "#64748B",
    surface: "#FFFFFF",
    surfaceSubtle: "#F8FAFC",
    canvas: "#F8FAFC",
    border: "#E2E8F0",
    borderStrong: "#CBD5E1",
    danger: "#EF4444",
    dangerLight: "#FEE2E2",
    success: "#10B981",
    successLight: "#D1FAE5",
    warning: "#F59E0B",
    warningLight: "#FEF3C7",
    ai: "#8B5CF6",
    aiLight: "#EDE9FE",
    amber: "#D97706",
  },
  space: {
    xs: 4,
    small: 8,
    medium: 16,
    large: 24,
    xl: 32,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
  },
  shadow: {
    subtle: {
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.04,
      shadowRadius: 6,
      elevation: 2,
    },
    card: {
      shadowColor: "#0F172A",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.07,
      shadowRadius: 12,
      elevation: 3,
    },
    floating: {
      shadowColor: "#0A7E85",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.15,
      shadowRadius: 20,
      elevation: 6,
    },
  },
  elevation: 1,
  motion: { reduced: 0, normal: 150 },
};

export type IconName =
  | "home"
  | "compass"
  | "book"
  | "calendar"
  | "bell"
  | "user"
  | "search"
  | "star"
  | "check"
  | "clock"
  | "sparkles"
  | "play"
  | "logout"
  | "chevronRight"
  | "chevronLeft"
  | "flame"
  | "award"
  | "close"
  | "info"
  | "filter"
  | "academic"
  | "trending"
  | "lock"
  | "alert"
  | "shield"
  | "card"
  | "receipt"
  | "document"
  | "grid"
  | "settings"
  | "sound"
  | "mute"
  | "mapPin"
  | "people"
  | "scale"
  | "refresh"
  | "add"
  | "pencil"
  | "megaphone"
  | "stats"
  | "chart"
  | "trash"
  | "logoGoogle"
  | "logoApple"
  | "class"
  | "checkCircle"
  | "quiz"
  | "assignment"
  | "attendance"
  | "starFilled"
  | "eye"
  | "eyeOff"
  | "image"
  | "camera"
  | "tag";

type IoniconsGlyph = keyof typeof Ionicons.glyphMap;

const VECTOR_ICON_MAP: Record<IconName, { outline: IoniconsGlyph; filled: IoniconsGlyph }> = {
  eye: { outline: "eye-outline", filled: "eye" },
  eyeOff: { outline: "eye-off-outline", filled: "eye-off" },
  image: { outline: "image-outline", filled: "image" },
  camera: { outline: "camera-outline", filled: "camera" },
  home: { outline: "home-outline", filled: "home" },
  compass: { outline: "compass-outline", filled: "compass" },
  book: { outline: "book-outline", filled: "book" },
  calendar: { outline: "calendar-outline", filled: "calendar" },
  bell: { outline: "notifications-outline", filled: "notifications" },
  user: { outline: "person-outline", filled: "person" },
  search: { outline: "search-outline", filled: "search" },
  star: { outline: "star-outline", filled: "star" },
  starFilled: { outline: "star", filled: "star" },
  check: { outline: "checkmark-circle-outline", filled: "checkmark-circle" },
  checkCircle: { outline: "checkmark-circle-outline", filled: "checkmark-circle" },
  clock: { outline: "time-outline", filled: "time" },
  sparkles: { outline: "sparkles-outline", filled: "sparkles" },
  play: { outline: "play-circle-outline", filled: "play-circle" },
  logout: { outline: "log-out-outline", filled: "log-out" },
  chevronRight: { outline: "chevron-forward", filled: "chevron-forward" },
  chevronLeft: { outline: "chevron-back", filled: "chevron-back" },
  flame: { outline: "flame-outline", filled: "flame" },
  award: { outline: "trophy-outline", filled: "trophy" },
  close: { outline: "close", filled: "close" },
  info: { outline: "information-circle-outline", filled: "information-circle" },
  filter: { outline: "filter-outline", filled: "filter" },
  academic: { outline: "school-outline", filled: "school" },
  class: { outline: "easel-outline", filled: "easel" },
  quiz: { outline: "help-circle-outline", filled: "help-circle" },
  assignment: { outline: "document-text-outline", filled: "document-text" },
  attendance: { outline: "checkmark-done-circle-outline", filled: "checkmark-done-circle" },
  trending: { outline: "trending-up-outline", filled: "trending-up" },
  lock: { outline: "lock-closed-outline", filled: "lock-closed" },
  alert: { outline: "alert-circle-outline", filled: "alert-circle" },
  shield: { outline: "shield-checkmark-outline", filled: "shield-checkmark" },
  card: { outline: "card-outline", filled: "card" },
  receipt: { outline: "receipt-outline", filled: "receipt" },
  document: { outline: "document-text-outline", filled: "document-text" },
  grid: { outline: "grid-outline", filled: "grid" },
  settings: { outline: "settings-outline", filled: "settings" },
  sound: { outline: "volume-high-outline", filled: "volume-high" },
  mute: { outline: "volume-mute-outline", filled: "volume-mute" },
  mapPin: { outline: "location-outline", filled: "location" },
  people: { outline: "people-outline", filled: "people" },
  scale: { outline: "scale-outline", filled: "scale" },
  refresh: { outline: "refresh-outline", filled: "refresh" },
  add: { outline: "add-circle-outline", filled: "add-circle" },
  pencil: { outline: "create-outline", filled: "create" },
  megaphone: { outline: "megaphone-outline", filled: "megaphone" },
  stats: { outline: "stats-chart-outline", filled: "stats-chart" },
  chart: { outline: "stats-chart-outline", filled: "stats-chart" },
  trash: { outline: "trash-outline", filled: "trash" },
  logoGoogle: { outline: "logo-google", filled: "logo-google" },
  logoApple: { outline: "logo-apple", filled: "logo-apple" },
  tag: { outline: "pricetag-outline", filled: "pricetag" },
};

export function Icon({
  name,
  size = 18,
  color,
  style,
  active = false,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  active?: boolean;
}) {
  const iconConfig = VECTOR_ICON_MAP[name];
  const glyphName = iconConfig
    ? active
      ? iconConfig.filled
      : iconConfig.outline
    : ("help-outline" as IoniconsGlyph);

  return <Ionicons name={glyphName} size={size} color={color || tokens.color.ink} style={style} />;
}

export const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
    backgroundColor: tokens.color.canvas,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: tokens.color.ink,
    letterSpacing: -0.5,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
    color: tokens.color.inkSecondary,
  },
  small: {
    fontSize: 13,
    lineHeight: 18,
    color: tokens.color.muted,
  },
  card: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 10,
    ...tokens.shadow.subtle,
  },
  cardHover: {
    borderColor: tokens.color.brandLight,
    ...tokens.shadow.card,
  },
  button: {
    minHeight: 48,
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    ...tokens.shadow.subtle,
  },
  buttonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: 0.2,
  },
  input: {
    minHeight: 50,
    borderWidth: 1.5,
    borderColor: tokens.color.border,
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: tokens.color.ink,
  },
  inputFocus: {
    borderColor: tokens.color.brand,
    backgroundColor: "#FFFFFF",
  },
  error: {
    fontSize: 14,
    fontWeight: "500",
    color: tokens.color.danger,
    lineHeight: 20,
  },
});

type NavScrollListener = (visible: boolean) => void;
const navScrollListeners = new Set<NavScrollListener>();

export function notifyNavScroll(_offsetY: number, _deltaY: number) {
  // Navigation bar is fixed permanently; no scroll auto-hide/slide animation
}

export function Page({
  children,
  style,
  scroll = true,
  testID,
  keyboardOffset = Platform.OS === "ios" ? 48 : 0,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  scroll?: boolean;
  testID?: string;
  keyboardOffset?: number;
}>) {
  const lastScrollY = React.useRef(0);
  const requestedBottomPadding = StyleSheet.flatten([styles.page, style])?.paddingBottom;
  const scrollBottomPadding =
    typeof requestedBottomPadding === "number" ? Math.max(requestedBottomPadding, 90) : 90;
  const content = !scroll ? (
    <View testID={testID} style={[styles.page, { flex: 1 }, style]}>
      {children}
    </View>
  ) : (
    <ScrollView
      testID={testID}
      contentContainerStyle={[styles.page, style, { paddingBottom: scrollBottomPadding }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(e) => {
        const currentY = e.nativeEvent.contentOffset.y;
        const deltaY = currentY - lastScrollY.current;
        lastScrollY.current = currentY;
        notifyNavScroll(currentY, deltaY);
      }}
    >
      {children}
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={keyboardOffset}
      style={{ flex: 1 }}
    >
      {content}
    </KeyboardAvoidingView>
  );
}

export interface PasswordInputProps extends React.ComponentProps<typeof TextInput> {
  containerStyle?: StyleProp<ViewStyle>;
  toggleTestID?: string;
}

export const PasswordInput = React.forwardRef<TextInput, PasswordInputProps>(function PasswordInput(
  { style, containerStyle, secureTextEntry = true, toggleTestID, ...rest },
  ref,
) {
  const [showPassword, setShowPassword] = React.useState(!secureTextEntry);

  return (
    <View style={[{ position: "relative", justifyContent: "center" }, containerStyle]}>
      <TextInput
        ref={ref}
        style={[styles.input, { paddingRight: 48 }, style]}
        secureTextEntry={!showPassword}
        autoCapitalize="none"
        {...rest}
      />
      <Pressable
        testID={toggleTestID}
        accessibilityRole="button"
        accessibilityLabel={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        onPress={() => setShowPassword((prev) => !prev)}
        style={{
          position: "absolute",
          right: 12,
          padding: 8,
          zIndex: 10,
        }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name={showPassword ? "eyeOff" : "eye"} size={20} color={tokens.color.muted} />
      </Pressable>
    </View>
  );
});

export interface NonVirtualizedListProps<T> {
  data: readonly T[] | null | undefined;
  renderItem: ({ item, index }: { item: T; index: number }) => React.ReactElement | null;
  keyExtractor?: (item: T, index: number) => string;
  ListEmptyComponent?: React.ReactNode;
  ItemSeparatorComponent?: React.ComponentType<unknown>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

export function NonVirtualizedList<T>({
  data,
  renderItem,
  keyExtractor,
  ListEmptyComponent,
  ItemSeparatorComponent,
  contentContainerStyle,
  testID,
}: NonVirtualizedListProps<T>) {
  if (!data || data.length === 0) {
    if (!ListEmptyComponent) return null;
    return React.isValidElement(ListEmptyComponent) ? ListEmptyComponent : <>{ListEmptyComponent}</>;
  }

  return (
    <View style={contentContainerStyle} testID={testID}>
      {data.map((item, index) => {
        const key = keyExtractor ? keyExtractor(item, index) : String(index);
        const Separator = ItemSeparatorComponent;
        return (
          <React.Fragment key={key}>
            {renderItem({ item, index })}
            {Separator && index < data.length - 1 ? <Separator /> : null}
          </React.Fragment>
        );
      })}
    </View>
  );
}

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "ai";
export type ButtonSize = "sm" | "md" | "lg";

export function Button({
  label,
  onPress,
  disabled = false,
  variant = "primary",
  size = "md",
  icon,
  style,
  textStyle,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const getVariantStyles = (): { button: ViewStyle; text: TextStyle } => {
    switch (variant) {
      case "secondary":
        return {
          button: {
            backgroundColor: tokens.color.brandLight,
            borderWidth: 1,
            borderColor: tokens.color.brand,
          },
          text: { color: tokens.color.brand, fontWeight: "700" },
        };
      case "outline":
        return {
          button: {
            backgroundColor: "transparent",
            borderWidth: 1.5,
            borderColor: tokens.color.borderStrong,
          },
          text: { color: tokens.color.ink, fontWeight: "600" },
        };
      case "ghost":
        return {
          button: {
            backgroundColor: "transparent",
            elevation: 0,
            shadowOpacity: 0,
            paddingVertical: 8,
            minHeight: 40,
          },
          text: { color: tokens.color.brand, fontWeight: "600" },
        };
      case "danger":
        return {
          button: {
            backgroundColor: tokens.color.danger,
          },
          text: { color: "#FFFFFF", fontWeight: "700" },
        };
      case "ai":
        return {
          button: {
            backgroundColor: tokens.color.ai,
          },
          text: { color: "#FFFFFF", fontWeight: "700" },
        };
      case "primary":
      default:
        return {
          button: {
            backgroundColor: tokens.color.brand,
          },
          text: { color: "#FFFFFF", fontWeight: "700" },
        };
    }
  };

  const getSizeStyles = (): { button: ViewStyle; text: TextStyle } => {
    switch (size) {
      case "sm":
        return {
          button: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
          text: { fontSize: 13 },
        };
      case "lg":
        return {
          button: { minHeight: 54, paddingVertical: 15, paddingHorizontal: 24, borderRadius: 16 },
          text: { fontSize: 16 },
        };
      case "md":
      default:
        return {
          button: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12 },
          text: { fontSize: 15 },
        };
    }
  };

  const vStyles = getVariantStyles();
  const sStyles = getSizeStyles();

  return (
    <ScalePressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      scaleTo={disabled ? 1 : 0.96}
      style={[styles.button, vStyles.button, sStyles.button, disabled && { opacity: 0.5 }, style]}
    >
      {icon}
      <Text style={[styles.buttonText, vStyles.text, sStyles.text, textStyle]}>{label}</Text>
    </ScalePressable>
  );
}

export function Badge({
  label,
  variant = "primary",
  icon,
}: {
  label: string;
  variant?: "primary" | "success" | "warning" | "danger" | "ai" | "neutral";
  icon?: IconName;
}) {
  const getBadgeColors = () => {
    switch (variant) {
      case "success":
        return { bg: tokens.color.successLight, text: "#065F46", border: "#A7F3D0" };
      case "warning":
        return { bg: tokens.color.warningLight, text: "#92400E", border: "#FDE68A" };
      case "danger":
        return { bg: tokens.color.dangerLight, text: "#991B1B", border: "#FECACA" };
      case "ai":
        return { bg: tokens.color.aiLight, text: "#5B21B6", border: "#DDD6FE" };
      case "neutral":
        return { bg: "#F1F5F9", text: "#475569", border: "#E2E8F0" };
      case "primary":
      default:
        return { bg: tokens.color.brandLight, text: tokens.color.brandDark, border: "#B2EBF2" };
    }
  };

  const theme = getBadgeColors();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 4,
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 9999,
      }}
    >
      {icon && <Icon name={icon} size={11} color={theme.text} />}
      <Text style={{ fontSize: 11, fontWeight: "700", color: theme.text, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function ProgressBar({
  progress,
  height = 8,
  color = tokens.color.brand,
  trackColor = tokens.color.border,
}: {
  progress: number;
  height?: number;
  color?: string;
  trackColor?: string;
}) {
  const normalized = Math.min(Math.max(progress > 1 ? progress / 100 : progress, 0), 1);
  return (
    <View
      style={{
        height,
        backgroundColor: trackColor,
        borderRadius: 9999,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <View
        style={{
          height: "100%",
          width: `${normalized * 100}%`,
          backgroundColor: color,
          borderRadius: 9999,
        }}
      />
    </View>
  );
}

export function StatCard({
  value,
  label,
  icon,
  color = tokens.color.brand,
}: {
  value: string | number;
  label: string;
  icon?: IconName;
  color?: string;
}) {
  return (
    <View
      style={[
        styles.card,
        {
          flex: 1,
          padding: 14,
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        },
      ]}
    >
      {icon && <Icon name={icon} size={20} color={color} />}
      <Text style={{ fontSize: 20, fontWeight: "800", color: tokens.color.ink }}>{value}</Text>
      <Text
        style={{
          fontSize: 11,
          fontWeight: "600",
          color: tokens.color.muted,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function SearchBar({
  value,
  onChangeText,
  onSubmit,
  placeholder = "Tìm kiếm khóa học...",
  onClear,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  onClear?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: tokens.color.surface,
        borderWidth: 1.5,
        borderColor: tokens.color.border,
        borderRadius: 16,
        paddingHorizontal: 14,
        minHeight: 48,
        gap: 10,
        ...tokens.shadow.subtle,
      }}
    >
      <Icon name="search" size={16} color={tokens.color.muted} />
      <TextInput
        style={{
          flex: 1,
          fontSize: 15,
          color: tokens.color.ink,
          paddingVertical: 10,
        }}
        placeholder={placeholder}
        placeholderTextColor={tokens.color.muted}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => {
            onChangeText("");
            onClear?.();
          }}
          hitSlop={8}
          accessibilityLabel="Xóa nội dung tìm kiếm"
        >
          <Icon name="close" size={14} color={tokens.color.muted} />
        </Pressable>
      )}
    </View>
  );
}

export function EmptyState({
  icon = "book",
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={[
        styles.card,
        {
          alignItems: "center",
          paddingVertical: 36,
          paddingHorizontal: 20,
          gap: 10,
        },
      ]}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: tokens.color.brandLight,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 6,
        }}
      >
        <Icon name={icon} size={30} color={tokens.color.brand} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: "700", color: tokens.color.ink, textAlign: "center" }}>
        {title}
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: tokens.color.muted,
          textAlign: "center",
          maxWidth: 280,
          lineHeight: 20,
        }}
      >
        {description}
      </Text>
      {actionLabel && onAction && (
        <View style={{ marginTop: 8 }}>
          <Button label={actionLabel} onPress={onAction} size="sm" />
        </View>
      )}
    </View>
  );
}

export function HeaderBar({
  user,
  streak = 3,
  onNotificationPress,
  onAccountPress,
  hasUnreadNotifications = false,
}: {
  user?: { displayName: string; role?: string } | null;
  streak?: number;
  onNotificationPress?: () => void;
  onAccountPress?: () => void;
  hasUnreadNotifications?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 8,
        paddingHorizontal: 4,
        marginBottom: 4,
      }}
    >
      <Pressable
        onPress={onAccountPress}
        style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
        accessibilityLabel="Mở trang cá nhân"
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: tokens.color.brand,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: tokens.color.surface,
            ...tokens.shadow.subtle,
          }}
        >
          <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 16 }}>
            {user?.displayName ? user.displayName.slice(0, 1).toUpperCase() : "A"}
          </Text>
        </View>
        <View>
          <Text style={{ fontSize: 12, fontWeight: "600", color: tokens.color.muted }}>
            {user ? "Chào mừng trở lại," : "Xin chào bạn,"}
          </Text>
          <Text style={{ fontSize: 17, fontWeight: "800", color: tokens.color.ink }}>
            {user?.displayName ?? "Khách khám phá"}
          </Text>
        </View>
      </Pressable>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {user && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              backgroundColor: tokens.color.warningLight,
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderRadius: 9999,
              borderWidth: 1,
              borderColor: "#FDE68A",
            }}
          >
            <Icon name="flame" size={13} />
            <Text style={{ fontSize: 12, fontWeight: "800", color: "#B45309" }}>{streak} ngày</Text>
          </View>
        )}

        {onNotificationPress && (
          <Pressable
            onPress={onNotificationPress}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: tokens.color.surface,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: tokens.color.border,
              ...tokens.shadow.subtle,
            }}
            accessibilityLabel="Mở thông báo"
          >
            <Icon name="bell" size={17} color={tokens.color.ink} />
            {hasUnreadNotifications && (
              <View
                style={{
                  position: "absolute",
                  top: 7,
                  right: 8,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: tokens.color.danger,
                }}
              />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

export interface LiquidGlassContainerProps extends ViewProps {
  type?: "rounded" | "pill" | "circle";
  tint?: "dark" | "light" | "default";
  tintOpacity?: number;
  intensity?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function LiquidGlassContainer({
  type = "rounded",
  tint = "dark",
  tintOpacity = 0.22,
  intensity,
  style,
  children,
  ...props
}: LiquidGlassContainerProps) {
  const [nativeGlass, setNativeGlass] = React.useState(false);

  React.useEffect(() => {
    if (Platform.OS === "ios") {
      setNativeGlass(isGlassEffectAPIAvailable() && isLiquidGlassAvailable());
    }
  }, []);

  const radius = type === "pill" ? 9999 : type === "circle" ? 9999 : 24;
  const isDark = tint === "dark";

  return (
    <View
      style={[
        {
          borderRadius: radius,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: isDark ? "rgba(255, 255, 255, 0.28)" : "rgba(255, 255, 255, 0.8)",
          shadowColor: isDark ? "#061A24" : "#0A7E85",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: isDark ? 0.28 : 0.08,
          shadowRadius: 16,
          elevation: 6,
          position: "relative",
          backgroundColor: isDark ? "rgba(6, 46, 63, 0.45)" : "rgba(255, 255, 255, 0.75)",
        },
        style,
      ]}
      {...props}
    >
      {nativeGlass ? (
        <GlassView
          pointerEvents="none"
          glassEffectStyle={isDark ? "regular" : "clear"}
          colorScheme={isDark ? "dark" : "light"}
          tintColor={isDark ? "#0B2B3A" : "rgba(255, 255, 255, 0.5)"}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <BlurView
          pointerEvents="none"
          intensity={intensity ?? (Platform.OS === "ios" ? 55 : 35)}
          tint={isDark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark
              ? `rgba(6, 46, 63, ${tintOpacity})`
              : `rgba(255, 255, 255, ${tintOpacity})`,
          },
        ]}
      />
      {/* Refraction inner rim */}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            margin: 1,
            borderRadius: radius > 1 ? radius - 1 : radius,
            borderWidth: 1,
            borderColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(255, 255, 255, 0.5)",
          },
        ]}
      />
      {/* Top specular glint */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 1,
          left: 14,
          right: 14,
          height: 1,
          borderRadius: 1,
          backgroundColor: isDark ? "rgba(255, 255, 255, 0.55)" : "rgba(255, 255, 255, 0.9)",
        }}
      />
      {/* Bottom ambient glint */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: 1,
          left: 28,
          right: 28,
          height: 1,
          borderRadius: 1,
          backgroundColor: isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.3)",
        }}
      />
      {children}
    </View>
  );
}

export interface LiquidGlassPillProps extends ViewProps {
  tint?: "dark" | "light";
  onPress?: () => void;
  scaleTo?: number;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function LiquidGlassPill({
  tint = "dark",
  onPress,
  scaleTo = 0.93,
  testID,
  accessibilityLabel,
  accessibilityRole = "button",
  style,
  children,
  ...props
}: LiquidGlassPillProps) {
  const isDark = tint === "dark";
  const content = (
    <View
      testID={testID}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          borderRadius: 9999,
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.8)",
          borderWidth: 1,
          borderColor: isDark ? "rgba(255, 255, 255, 0.32)" : "rgba(255, 255, 255, 0.9)",
          overflow: "hidden",
          position: "relative",
          shadowColor: isDark ? "#000000" : "#0A7E85",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDark ? 0.14 : 0.06,
          shadowRadius: 4,
          elevation: 2,
        },
        style,
      ]}
      {...props}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 6,
          right: 6,
          height: 1,
          backgroundColor: isDark ? "rgba(255, 255, 255, 0.65)" : "rgba(255, 255, 255, 0.95)",
        }}
      />
      {children}
    </View>
  );

  if (onPress) {
    return (
      <ScalePressable
        onPress={onPress}
        scaleTo={scaleTo}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
      >
        {content}
      </ScalePressable>
    );
  }
  return content;
}

export interface LiquidGlassCircleProps extends ViewProps {
  size?: number;
  tint?: "dark" | "light";
  onPress?: () => void;
  scaleTo?: number;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export function LiquidGlassCircle({
  size = 38,
  tint = "dark",
  onPress,
  scaleTo = 0.92,
  testID,
  accessibilityLabel,
  accessibilityRole = "button",
  style,
  children,
  ...props
}: LiquidGlassCircleProps) {
  const isDark = tint === "dark";
  const radius = size / 2;
  const content = (
    <View
      testID={testID}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isDark ? "rgba(14, 116, 144, 0.65)" : "rgba(255, 255, 255, 0.9)",
          borderWidth: 1.5,
          borderColor: isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.95)",
          overflow: "hidden",
          position: "relative",
          shadowColor: isDark ? "#38BDF8" : "#0A7E85",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDark ? 0.25 : 0.1,
          shadowRadius: 6,
          elevation: 3,
        },
        style,
      ]}
      {...props}
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 1,
          left: 4,
          right: 4,
          height: 1,
          borderRadius: 1,
          backgroundColor: isDark ? "rgba(255, 255, 255, 0.7)" : "rgba(255, 255, 255, 0.95)",
        }}
      />
      {children}
    </View>
  );

  if (onPress) {
    return (
      <ScalePressable
        onPress={onPress}
        scaleTo={scaleTo}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
      >
        {content}
      </ScalePressable>
    );
  }
  return content;
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  rightElement,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightElement?: React.ReactNode;
}) {
  return (
    <LiquidGlassContainer
      type="rounded"
      tint="light"
      tintOpacity={0.82}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginBottom: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
        {onBack && (
          <LiquidGlassCircle size={40} tint="light" onPress={onBack} accessibilityLabel="Quay lại">
            <Icon name="chevronLeft" size={20} color={tokens.color.ink} />
          </LiquidGlassCircle>
        )}
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontSize: 18,
              fontWeight: "800",
              color: tokens.color.ink,
              letterSpacing: -0.3,
            }}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ fontSize: 12, color: tokens.color.muted, marginTop: 1 }} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {rightElement}
    </LiquidGlassContainer>
  );
}

function isBottomTabActive(key: string, currentRoute: string): boolean {
  return (
    (key === "attendance" && (currentRoute === "attendance" || currentRoute.includes("attendance"))) ||
    (key === "classes" &&
      (currentRoute === "classes" || currentRoute.includes("classes") || currentRoute === "schedule")) ||
    (key === "home" &&
      (currentRoute === "home" ||
        currentRoute === "teaching" ||
        currentRoute === "" ||
        currentRoute === "/" ||
        currentRoute === "/index")) ||
    (key === "teaching" && currentRoute.includes("teaching")) ||
    (key === "courses" && (currentRoute.includes("courses") || currentRoute === "/courses")) ||
    (key === "admin" && (currentRoute.includes("admin") || currentRoute === "/admin")) ||
    (key === "notifications" &&
      (currentRoute.includes("notification") || currentRoute === "notifications")) ||
    (key === "account" &&
      (currentRoute.includes("account") ||
        currentRoute === "account" ||
        currentRoute.includes("login") ||
        currentRoute.includes("settings")))
  );
}

const bottomNavStyles = StyleSheet.create({
  dock: {
    position: "absolute",
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    paddingHorizontal: 22,
    paddingTop: 4,
    paddingBottom: Platform.OS === "ios" ? 12 : 6,
    backgroundColor: "transparent",
  },
  shellShadow: {
    borderRadius: 26,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 6,
  },
  shell: {
    height: 50,
    borderRadius: 25,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.85)",
  },
  glassFill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 25,
  },
  wash: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  innerRim: {
    position: "absolute",
    top: 1.5,
    right: 1.5,
    bottom: 1.5,
    left: 1.5,
    borderRadius: 23.5,
    borderWidth: 1,
    borderColor: "rgba(18,27,34,0.1)",
  },
  topGlint: {
    position: "absolute",
    top: 1,
    left: 20,
    right: 20,
    height: 1,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  bottomGlint: {
    position: "absolute",
    bottom: 1,
    left: 28,
    right: 28,
    height: 1,
    borderRadius: 1,
    backgroundColor: "rgba(18,27,34,0.12)",
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  selection: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 8,
    borderRadius: 21,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.95)",
    backgroundColor: "rgba(255,255,255,0.24)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  selectionInnerRim: {
    position: "absolute",
    top: 1,
    right: 1,
    bottom: 1,
    left: 1,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(18,27,34,0.08)",
  },
  selectionGlint: {
    position: "absolute",
    top: 1,
    left: 6,
    right: 6,
    height: 1,
    borderRadius: 1,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  tab: {
    flex: 1,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  activeDot: {
    position: "absolute",
    bottom: 3,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: tokens.color.brand,
  },
});

export function BottomNavBar({
  currentRoute,
  onNavigate,
  role,
}: {
  currentRoute: string;
  onNavigate: (route: string) => void;
  role?: string;
}) {
  const tabs =
    role === "LECTURER"
      ? [
          { key: "home", label: "Trang chủ", icon: "home" as IconName, path: "/teaching" },
          { key: "courses", label: "Khóa học", icon: "book" as IconName, path: "/teaching/courses" },
          { key: "classes", label: "Lớp học", icon: "class" as IconName, path: "/teaching/classes" },
          { key: "notifications", label: "Thông báo", icon: "bell" as IconName, path: "/notifications" },
          { key: "account", label: "Cá nhân", icon: "user" as IconName, path: "/account" },
        ]
      : role === "ADMIN"
        ? [
            { key: "home", label: "Trang chủ", icon: "home" as IconName, path: "/" },
            { key: "admin", label: "Quản trị", icon: "shield" as IconName, path: "/admin" },
            { key: "notifications", label: "Thông báo", icon: "bell" as IconName, path: "/notifications" },
            { key: "account", label: "Cá nhân", icon: "user" as IconName, path: "/account" },
          ]
        : role === "STUDENT"
          ? [
              { key: "home", label: "Trang chủ", icon: "home" as IconName, path: "/" },
              { key: "courses", label: "Khóa học", icon: "book" as IconName, path: "/courses" },
              { key: "classes", label: "Lớp học", icon: "class" as IconName, path: "/classes" },
              {
                key: "attendance",
                label: "Điểm danh",
                icon: "checkCircle" as IconName,
                path: "/classes?tab=attendance",
              },
              { key: "account", label: "Cá nhân", icon: "user" as IconName, path: "/account" },
            ]
          : [
              { key: "home", label: "Trang chủ", icon: "home" as IconName, path: "/" },
              { key: "courses", label: "Khóa học", icon: "book" as IconName, path: "/courses" },
              { key: "classes", label: "Lớp học", icon: "class" as IconName, path: "/login" },
              { key: "account", label: "Đăng nhập", icon: "user" as IconName, path: "/login" },
            ];

  const [nativeGlass, setNativeGlass] = React.useState(false);
  const [rowWidth, setRowWidth] = React.useState(0);
  const reduceMotion = useReducedMotionPreference();
  const indicatorX = React.useRef(new Animated.Value(0)).current;
  const previousIndex = React.useRef<number | null>(null);
  const activeKey = [
    "attendance",
    "classes",
    "teaching",
    "courses",
    "admin",
    "notifications",
    "account",
    "home",
  ].find((key) => tabs.some((tab) => tab.key === key && isBottomTabActive(key, currentRoute)));
  const activeIndex = tabs.findIndex((tab) => tab.key === activeKey);
  const tabWidth = rowWidth > 0 ? (rowWidth - 12) / tabs.length : 0;

  React.useEffect(() => {
    if (Platform.OS === "ios") {
      setNativeGlass(isGlassEffectAPIAvailable() && isLiquidGlassAvailable());
    }
  }, []);

  React.useEffect(() => {
    if (tabWidth <= 0 || activeIndex < 0) return;
    const nextX = activeIndex * tabWidth;
    indicatorX.stopAnimation();
    if (previousIndex.current === null || reduceMotion !== false) {
      indicatorX.setValue(nextX);
    } else {
      Animated.spring(indicatorX, {
        toValue: nextX,
        useNativeDriver: true,
        speed: 19,
        bounciness: 5,
      }).start();
    }
    previousIndex.current = activeIndex;
  }, [activeIndex, indicatorX, reduceMotion, tabWidth]);

  return (
    <View pointerEvents="box-none" style={bottomNavStyles.dock}>
      <View style={bottomNavStyles.shellShadow}>
        <View style={bottomNavStyles.shell}>
          {nativeGlass ? (
            <GlassView
              pointerEvents="none"
              glassEffectStyle="clear"
              colorScheme="light"
              style={bottomNavStyles.glassFill}
            />
          ) : (
            <BlurView
              pointerEvents="none"
              intensity={Platform.OS === "ios" ? 50 : 35}
              tint="light"
              style={bottomNavStyles.glassFill}
            />
          )}
          <View pointerEvents="none" style={bottomNavStyles.wash} />
          <View pointerEvents="none" style={bottomNavStyles.innerRim} />
          <View pointerEvents="none" style={bottomNavStyles.topGlint} />
          <View pointerEvents="none" style={bottomNavStyles.bottomGlint} />
          <View
            style={bottomNavStyles.row}
            onLayout={(event) => setRowWidth(Math.round(event.nativeEvent.layout.width))}
          >
            {activeIndex >= 0 && tabWidth > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[
                  bottomNavStyles.selection,
                  {
                    width: tabWidth - 8,
                    transform: [{ translateX: indicatorX }],
                  },
                ]}
              >
                {nativeGlass && (
                  <GlassView
                    pointerEvents="none"
                    glassEffectStyle="clear"
                    colorScheme="light"
                    style={StyleSheet.absoluteFill}
                  />
                )}
                <View pointerEvents="none" style={bottomNavStyles.selectionInnerRim} />
                <View pointerEvents="none" style={bottomNavStyles.selectionGlint} />
              </Animated.View>
            )}
            {tabs.map((tab, index) => {
              const isActive = index === activeIndex;
              return (
                <ScalePressable
                  key={tab.key}
                  testID={`app-nav-${tab.key}`}
                  onPress={() => onNavigate(tab.path)}
                  scaleTo={0.92}
                  style={bottomNavStyles.tab}
                  accessibilityRole="tab"
                  accessibilityLabel={tab.label}
                  accessibilityState={{ selected: isActive }}
                >
                  <Icon
                    name={tab.icon}
                    size={22}
                    color={isActive ? "#0F172A" : "rgba(24,31,38,0.65)"}
                    active={isActive}
                  />
                  {isActive && <View style={bottomNavStyles.activeDot} />}
                </ScalePressable>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

export function AdaptivePathCard({
  action,
  conceptTitle,
  reason,
  score,
  onStartAction,
}: {
  action: "REVIEW" | "PRACTICE" | "OPTIONAL_ENRICHMENT";
  conceptTitle: string;
  reason: string;
  score: number;
  onStartAction?: () => void;
}) {
  const isReview = action === "REVIEW";
  const isPractice = action === "PRACTICE";
  const badgeColor = isReview
    ? tokens.color.danger
    : isPractice
      ? tokens.color.warning
      : tokens.color.success;
  const badgeBg = isReview
    ? tokens.color.dangerLight
    : isPractice
      ? tokens.color.warningLight
      : tokens.color.successLight;

  return (
    <View
      style={{
        backgroundColor: tokens.color.surface,
        borderRadius: tokens.radius.md,
        padding: tokens.space.medium,
        borderWidth: 1,
        borderColor: tokens.color.border,
        marginVertical: tokens.space.small,
        ...tokens.shadow.subtle,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: tokens.space.small,
        }}
      >
        <Text
          style={{ fontSize: 11, fontWeight: "700", color: tokens.color.brand, textTransform: "uppercase" }}
        >
          Lộ trình thích ứng
        </Text>
        <View style={{ backgroundColor: badgeBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: badgeColor }}>{action}</Text>
        </View>
      </View>
      <Text style={{ fontSize: 15, fontWeight: "700", color: tokens.color.ink, marginBottom: 4 }}>
        {conceptTitle}
      </Text>
      <Text style={{ fontSize: 12, color: tokens.color.muted, lineHeight: 18, marginBottom: 12 }}>
        {reason} (Năng lực hiện tại: {score}%)
      </Text>
      {onStartAction ? (
        <ScalePressable
          onPress={onStartAction}
          style={{
            backgroundColor: tokens.color.brand,
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: tokens.radius.sm,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}>
            {isReview ? "Ôn tập ngay" : isPractice ? "Luyện tập tăng cường" : "Học nâng cao"}
          </Text>
        </ScalePressable>
      ) : null}
    </View>
  );
}

export function VersionPinningIndicator({
  pinnedVersion,
  latestVersion,
  isPinned,
  onTogglePin,
}: {
  pinnedVersion: number;
  latestVersion: number;
  isPinned: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: tokens.radius.sm,
        backgroundColor: tokens.color.surfaceSubtle,
        borderWidth: 1,
        borderColor: tokens.color.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="award" size={14} color={tokens.color.muted} />
        <Text style={{ fontSize: 12, color: tokens.color.inkSecondary }}>
          Bản: <Text style={{ fontWeight: "700" }}>v{pinnedVersion}.0</Text>{" "}
          {isPinned
            ? "(Đã ghim)"
            : latestVersion > pinnedVersion
              ? `(Có bản v${latestVersion}.0)`
              : "(Mới nhất)"}
        </Text>
      </View>
      {onTogglePin ? (
        <ScalePressable onPress={onTogglePin} style={{ paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", color: tokens.color.brand }}>
            {isPinned ? "Bỏ ghim" : "Ghim bản này"}
          </Text>
        </ScalePressable>
      ) : null}
    </View>
  );
}

export function RefundRequestModal({
  visible,
  courseTitle,
  coursePrice,
  progressPercent,
  purchaseDate,
  onClose,
  onSubmitRefund,
}: {
  visible: boolean;
  courseTitle: string;
  coursePrice: string;
  progressPercent: number;
  purchaseDate: string;
  onClose: () => void;
  onSubmitRefund: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const isEligible = progressPercent < 20;

  if (!visible) return null;

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.6)",
        justifyContent: "center",
        alignItems: "center",
        padding: tokens.space.medium,
        zIndex: 9999,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: tokens.color.surface,
          borderRadius: tokens.radius.lg,
          padding: tokens.space.large,
          ...tokens.shadow.floating,
        }}
      >
        <Text style={{ fontSize: 17, fontWeight: "700", color: tokens.color.ink, marginBottom: 4 }}>
          Yêu Cầu Hoàn Tiền Khóa Học
        </Text>
        <Text style={{ fontSize: 13, color: tokens.color.muted, marginBottom: 12 }}>
          {courseTitle} • {coursePrice}
        </Text>

        <View
          style={{
            padding: 10,
            borderRadius: tokens.radius.sm,
            backgroundColor: isEligible ? tokens.color.successLight : tokens.color.dangerLight,
            marginBottom: 12,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: isEligible ? tokens.color.success : tokens.color.danger,
            }}
          >
            {isEligible
              ? `✓ Hợp lệ: Tiến độ ${progressPercent}% (< 20%), trong thời hạn 7 ngày từ ${purchaseDate}.`
              : `✕ Không hợp lệ: Tiến độ ${progressPercent}% (vượt ngưỡng 20% chính sách hoàn tiền).`}
          </Text>
        </View>

        <Text style={{ fontSize: 12, fontWeight: "600", color: tokens.color.inkSecondary, marginBottom: 4 }}>
          Lý do yêu cầu hoàn tiền:
        </Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Nhập lý do hoàn tiền..."
          multiline
          numberOfLines={3}
          style={{
            borderWidth: 1,
            borderColor: tokens.color.borderStrong,
            borderRadius: tokens.radius.sm,
            padding: 8,
            fontSize: 13,
            minHeight: 64,
            textAlignVertical: "top",
            marginBottom: 16,
          }}
        />

        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
          <ScalePressable
            onPress={onClose}
            style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: tokens.radius.sm }}
          >
            <Text style={{ fontSize: 13, color: tokens.color.muted }}>Đóng</Text>
          </ScalePressable>
          <ScalePressable
            disabled={!isEligible || !reason.trim()}
            onPress={() => onSubmitRefund(reason)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 14,
              borderRadius: tokens.radius.sm,
              backgroundColor: isEligible && reason.trim() ? tokens.color.brand : tokens.color.border,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: "#FFFFFF" }}>Gửi yêu cầu</Text>
          </ScalePressable>
        </View>
      </View>
    </View>
  );
}
