import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "react-native";

const native = vi.hoisted(() => ({
  configure: vi.fn(),
  hasPlayServices: vi.fn(),
  signIn: vi.fn(),
  getModule: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  TurboModuleRegistry: { get: native.getModule },
}));
function googleSdkMock() {
  return {
    GoogleSignin: native,
    isSuccessResponse: (response: { type: string }) => response.type === "success",
    isErrorWithCode: (error: unknown) => Boolean(error && typeof error === "object" && "code" in error),
    statusCodes: {
      SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED",
      PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
      IN_PROGRESS: "IN_PROGRESS",
      DEVELOPER_ERROR: "DEVELOPER_ERROR",
    },
  };
}
vi.mock("@react-native-google-signin/google-signin", googleSdkMock);

import {
  getGoogleIdToken,
  isGoogleCloudConfigMissingError,
  isGoogleNativeModuleMissingError,
} from "../src/google-signin";

describe("native Google sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Platform.OS = "android";
    native.getModule.mockReturnValue({});
    native.hasPlayServices.mockResolvedValue(true);
  });

  it("handles a missing native binary without importing the enforcing SDK", async () => {
    native.getModule.mockReturnValue(null);
    vi.resetModules();
    vi.doMock("@react-native-google-signin/google-signin", () => {
      throw new Error("The native SDK must not be imported in Expo Go");
    });
    try {
      const safeModule = await import("../src/google-signin");
      await expect(safeModule.getGoogleIdToken("web-client", "ios-client")).rejects.toMatchObject({
        code: "GOOGLE_NATIVE_MODULE_MISSING",
        message: expect.stringContaining("Expo Go"),
      });
      expect(native.configure).not.toHaveBeenCalled();
      expect(native.signIn).not.toHaveBeenCalled();
    } finally {
      vi.doMock("@react-native-google-signin/google-signin", googleSdkMock);
      vi.resetModules();
    }
  });

  it("requires the iOS client ID when the native module exists", async () => {
    Platform.OS = "ios";
    await expect(getGoogleIdToken("web-client", "")).rejects.toMatchObject({
      code: "MISSING_IOS_CLIENT_ID",
    });
    expect(native.configure).not.toHaveBeenCalled();
  });

  it("returns an ID token and configures the Web audience", async () => {
    native.signIn.mockResolvedValue({ type: "success", data: { idToken: "verified-id-token" } });
    await expect(getGoogleIdToken("web-client", "ios-client")).resolves.toBe("verified-id-token");
    expect(native.configure).toHaveBeenCalledWith({ webClientId: "web-client", iosClientId: "ios-client" });
    expect(native.hasPlayServices).toHaveBeenCalledOnce();
  });

  it("leaves the app session unchanged when the Google dialog is cancelled", async () => {
    native.signIn.mockResolvedValue({ type: "cancelled" });
    await expect(getGoogleIdToken("web-client", "ios-client")).resolves.toBeNull();
  });

  it("rejects a successful response without an ID token", async () => {
    native.signIn.mockResolvedValue({ type: "success", data: { idToken: null } });
    await expect(getGoogleIdToken("web-client", "ios-client")).rejects.toThrow("mã xác thực");
  });

  it("identifies Google Cloud configuration missing errors", () => {
    expect(isGoogleCloudConfigMissingError({ code: "10" })).toBe(true);
    expect(isGoogleCloudConfigMissingError({ code: "DEVELOPER_ERROR" })).toBe(true);
    expect(isGoogleCloudConfigMissingError({ code: "MISSING_IOS_CLIENT_ID" })).toBe(true);
    expect(isGoogleCloudConfigMissingError({ message: "RNGoogleSignin could not be found" })).toBe(false);
    expect(isGoogleCloudConfigMissingError(null)).toBe(false);
    expect(isGoogleCloudConfigMissingError(new Error("network error"))).toBe(false);
  });

  it("distinguishes a missing native module from Google Cloud configuration errors", () => {
    expect(isGoogleNativeModuleMissingError({ code: "GOOGLE_NATIVE_MODULE_MISSING" })).toBe(true);
    expect(isGoogleNativeModuleMissingError(new Error("RNGoogleSignin could not be found"))).toBe(true);
    expect(isGoogleNativeModuleMissingError({ code: "MISSING_IOS_CLIENT_ID" })).toBe(false);
    expect(isGoogleNativeModuleMissingError(null)).toBe(false);
  });

  it("maps Android DEVELOPER_ERROR code to descriptive error", async () => {
    native.signIn.mockRejectedValue({ code: "10", message: "Developer error" });
    await expect(getGoogleIdToken("web-client", "ios-client")).rejects.toThrow(
      "Cần đăng ký package dev.ailss.mobile và SHA-1 trong Google Cloud Console.",
    );
  });
});
