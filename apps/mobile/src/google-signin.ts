import { Platform, TurboModuleRegistry } from "react-native";

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
  // The SDK enforces its native module during import. Expo Go and older builds
  // must stop here so the login screen's error handler remains usable.
  if (!TurboModuleRegistry.get("RNGoogleSignin")) {
    throw Object.assign(
      new Error(
        "Bản ứng dụng hiện tại chưa hỗ trợ đăng nhập Google. Tính năng này không chạy trong Expo Go; hãy cài bản AILSS development build mới có Google Sign-In.",
      ),
      { code: "GOOGLE_NATIVE_MODULE_MISSING" },
    );
  }
  if (Platform.OS === "ios" && !iosClientId.trim()) {
    const err = new Error(
      "MISSING_IOS_CLIENT_ID: Chưa cấu hình EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID trong file môi trường để đăng nhập Google trên iOS.",
    );
    (err as unknown as { code: string }).code = "MISSING_IOS_CLIENT_ID";
    throw err;
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
