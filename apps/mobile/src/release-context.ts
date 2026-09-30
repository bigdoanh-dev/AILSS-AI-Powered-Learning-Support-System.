export interface ReleaseContextInput {
  appVersion: string;
  iosBuildNumber?: string;
  androidVersionCode?: number;
  platform: "ios" | "android" | "web" | "unknown";
  osVersion: string;
  releaseGitSha?: string;
}

export interface ReleaseContext {
  appVersion: string;
  buildNumber: string;
  releaseGitSha: string;
  platform: ReleaseContextInput["platform"];
  osVersion: string;
}

export function releaseContext(input: ReleaseContextInput): ReleaseContext {
  return {
    appVersion: input.appVersion || "unknown",
    buildNumber:
      input.platform === "ios"
        ? input.iosBuildNumber || input.appVersion || "unknown"
        : input.platform === "android"
          ? input.androidVersionCode?.toString() || input.appVersion || "unknown"
          : input.appVersion || "unknown",
    releaseGitSha:
      input.releaseGitSha && /^[a-f0-9]{7,64}$/iu.test(input.releaseGitSha)
        ? input.releaseGitSha.toLowerCase()
        : "unavailable",
    platform: input.platform,
    osVersion: input.osVersion || "unknown",
  };
}
