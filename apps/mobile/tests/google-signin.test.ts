import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  configure: vi.fn(),
  hasPlayServices: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: native,
  isSuccessResponse: (response: { type: string }) => response.type === "success",
  isErrorWithCode: (error: unknown) => Boolean(error && typeof error === "object" && "code" in error),
  statusCodes: {
    SIGN_IN_CANCELLED: "SIGN_IN_CANCELLED",
    PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
    IN_PROGRESS: "IN_PROGRESS",
    DEVELOPER_ERROR: "DEVELOPER_ERROR",
  },
}));

import { getGoogleIdToken, isGoogleCloudConfigMissingError } from "../src/google-signin";

describe("native Google sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.hasPlayServices.mockResolvedValue(true);
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
    expect(isGoogleCloudConfigMissingError({ message: "RNGoogleSignin could not be found" })).toBe(true);
    expect(isGoogleCloudConfigMissingError(null)).toBe(false);
    expect(isGoogleCloudConfigMissingError(new Error("network error"))).toBe(false);
  });

  it("maps Android DEVELOPER_ERROR code to descriptive error", async () => {
    native.signIn.mockRejectedValue({ code: "10", message: "Developer error" });
    await expect(getGoogleIdToken("web-client", "ios-client")).rejects.toThrow(
      "Cần đăng ký package dev.ailss.mobile và SHA-1 trong Google Cloud Console.",
    );
  });
});
