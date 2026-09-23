import { describe, expect, it } from "vitest";
import { releaseContext } from "../src/release-context";

describe("provider-neutral mobile release context", () => {
  it("exposes build/platform/runtime metadata without accepting malformed Git identity", () => {
    expect(
      releaseContext({
        appVersion: "14.1.0",
        iosBuildNumber: "14100",
        androidVersionCode: 14100,
        platform: "ios",
        osVersion: "26.2",
        releaseGitSha: "../../secret",
      }),
    ).toEqual({
      appVersion: "14.1.0",
      buildNumber: "14100",
      releaseGitSha: "unavailable",
      platform: "ios",
      osVersion: "26.2",
    });
  });
  it("selects Android versionCode for Android and accepts a Git SHA", () => {
    expect(
      releaseContext({
        appVersion: "14.1.0",
        androidVersionCode: 14100,
        platform: "android",
        osVersion: "36",
        releaseGitSha: "ABCDEF1234",
      }),
    ).toMatchObject({ buildNumber: "14100", releaseGitSha: "abcdef1234", platform: "android" });
  });
});
