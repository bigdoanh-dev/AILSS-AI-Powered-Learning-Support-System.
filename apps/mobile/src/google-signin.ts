import { Platform, TurboModuleRegistry } from "react-native";

export type GoogleSignInAvailability =
  | { available: true }
  | { available: false; code: "GOOGLE_NATIVE_MODULE_MISSING" | "MISSING_IOS_CLIENT_ID"; message: string };

export function googleSignInAvailability(iosClientId: string): GoogleSignInAvailability {
  // Never import the enforcing SDK just to decide whether to show its button.
  if (!TurboModuleRegistry.get("RNGoogleSignin")) {
    return {
      available: false,
      code: "GOOGLE_NATIVE_MODULE_MISSING",
      message:
        "Google chưa khả dụng trong bản app này. Hãy mở bản AILSS đã cài có hỗ trợ Google, hoặc đăng nhập bằng email.",
    };
  }
  if (Platform.OS === "ios" && !iosClientId.trim()) {
    return {
      available: false,
      code: "MISSING_IOS_CLIENT_ID",
      message:
        "Đăng nhập Google chưa được thiết lập cho bản iPhone này. Bạn vẫn có thể đăng nhập bằng email.",
    };
  }
  return { available: true };
}

export function isGoogleNativeModuleMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  return err.code === "GOOGLE_NATIVE_MODULE_MISSING" || String(err.message ?? "").includes("RNGoogleSignin");
}

export function isGoogleCloudConfigMissingError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object") {
    const err = error as Record<string, unknown>;
    const code = String(err.code || "");
    const msg = String(err.message || "");
    if (
      code === "10" ||
      code === "DEVELOPER_ERROR" ||
      code === "MISSING_IOS_CLIENT_ID" ||
      code === "PLAY_SERVICES_NOT_AVAILABLE" ||
      msg.includes("DEVELOPER_ERROR") ||
      msg.includes("Google Play Services") ||
      msg.includes("MISSING_IOS_CLIENT_ID") ||
      msg.includes("Google Cloud")
    ) {
      return true;
    }
  }
  return false;
}

export async function getGoogleIdToken(webClientId: string, iosClientId: string): Promise<string | null> {
  const availability = googleSignInAvailability(iosClientId);
  if (!availability.available) {
    throw Object.assign(
      new Error(
        availability.code === "GOOGLE_NATIVE_MODULE_MISSING"
          ? "Google Sign-In cần bản AILSS development build; Expo Go không có mô-đun này."
          : "MISSING_IOS_CLIENT_ID: Chưa cấu hình EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID cho bản iPhone.",
      ),
      { code: availability.code },
    );
  }

  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } =
    await import("@react-native-google-signin/google-signin");

  try {
    GoogleSignin.configure({ webClientId, iosClientId });
    if (Platform.OS === "android") {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return null;
    if (!response.data.idToken) {
      throw new Error("Google không trả về mã xác thực. Hãy kiểm tra OAuth Web Client ID.");
    }
    return response.data.idToken;
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) return null;
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        const err = new Error("PLAY_SERVICES_NOT_AVAILABLE: Thiết bị cần Google Play Services để đăng nhập.");
        (err as unknown as { code: string }).code = "PLAY_SERVICES_NOT_AVAILABLE";
        throw err;
      }
      if (error.code === statusCodes.IN_PROGRESS) return null;
      if (
        String(error.code) === "10" ||
        (statusCodes as Record<string, unknown>).DEVELOPER_ERROR === error.code
      ) {
        const err = new Error(
          "DEVELOPER_ERROR: Cần đăng ký package dev.ailss.mobile và SHA-1 trong Google Cloud Console.",
        );
        (err as unknown as { code: string }).code = "DEVELOPER_ERROR";
        throw err;
      }
    }
    throw error;
  }
}
