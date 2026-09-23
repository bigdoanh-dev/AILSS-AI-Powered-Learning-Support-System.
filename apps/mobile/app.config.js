const { withAndroidManifest, withPodfileProperties, withXcodeProject } = require("expo/config-plugins");

function withPathSafeReactNativeBundle(config) {
  return withXcodeProject(config, (value) => {
    const phases = value.modResults.hash.project.objects.PBXShellScriptBuildPhase;
    const brokenCommand =
      "`" +
      String.raw`\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\"` +
      "`";
    const safeCommand = String.raw`REACT_NATIVE_XCODE_SCRIPT=\"$(\"$NODE_BINARY\" --print \"require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'\")\" && \"$REACT_NATIVE_XCODE_SCRIPT\"`;
    let patched = false;

    for (const phase of Object.values(phases)) {
      if (!phase.name?.includes("Bundle React Native code and images")) continue;
      if (phase.shellScript.includes(brokenCommand)) {
        phase.shellScript = phase.shellScript.replace(brokenCommand, safeCommand);
        patched = true;
      } else if (phase.shellScript.includes(safeCommand)) {
        patched = true;
      } else {
        throw Error("FATAL_IOS_CONFIGURATION_ERROR: Unexpected React Native bundle script");
      }
    }

    if (!patched) throw Error("FATAL_IOS_CONFIGURATION_ERROR: React Native bundle phase not found");
    return value;
  });
}

const PLACEHOLDER_HOSTNAMES = new Set([
  "api.ailss.example.org",
  "ailss.example.org",
  "example.org",
  "example.com",
  "example.net",
]);

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function isPlaceholderHost(hostname) {
  const lower = (hostname || "").toLowerCase();
  if (PLACEHOLDER_HOSTNAMES.has(lower)) return true;
  if (
    lower.endsWith(".example.org") ||
    lower.endsWith(".example.com") ||
    lower.endsWith(".example.net") ||
    lower.endsWith(".example") ||
    lower.endsWith(".invalid") ||
    lower.endsWith(".test")
  ) {
    return true;
  }
  return false;
}

function isLoopbackHost(hostname) {
  const lower = (hostname || "").toLowerCase();
  return LOOPBACK_HOSTNAMES.has(lower);
}

module.exports = ({ config }) => {
  const environment = process.env.EXPO_PUBLIC_AILSS_ENV;
  const origin = (process.env.EXPO_PUBLIC_AILSS_API_BASE_URL || "").trim();
  if (!["development", "research", "production"].includes(environment)) {
    throw Error("FATAL_CONFIGURATION_ERROR: Set EXPO_PUBLIC_AILSS_ENV explicitly");
  }
  if (!origin) {
    throw Error("FATAL_CONFIGURATION_ERROR: Set EXPO_PUBLIC_AILSS_API_BASE_URL explicitly");
  }
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw Error("FATAL_CONFIGURATION_ERROR: Invalid Gateway origin URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (environment === "production" &&
      (url.protocol !== "https:" || isLoopbackHost(url.hostname) || isPlaceholderHost(url.hostname)))
  ) {
    throw Error("FATAL_CONFIGURATION_ERROR: Invalid Gateway origin");
  }
  const localHttp = environment !== "production" && url.protocol === "http:";
  config.plugins = [
    ...(config.plugins ?? []).filter((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== "expo-sqlite"),
    ["expo-sqlite", { useSQLCipher: true }],
  ];
  config.ios = {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: localHttp },
      ...(localHttp
        ? { NSLocalNetworkUsageDescription: "Kết nối Gateway AILSS trong mạng phát triển." }
        : {}),
    },
  };
  const withAndroidConfig = withAndroidManifest(config, (value) => {
    const app = value.modResults.manifest.application?.[0];
    if (app) app.$["android:usesCleartextTraffic"] = String(localHttp);
    return value;
  });
  const withNativeBuildProperties = withPodfileProperties(withAndroidConfig, (value) => {
    // Expo Dev Launcher currently references RCTPackagerConnection, which is
    // absent from the bundled prebuilt React Native Core. Build RN from source
    // until Expo ships a compatible Dev Launcher/prebuilt-core combination.
    value.modResults["ios.buildReactNativeFromSource"] = "true";
    value.modResults.EXPO_USE_PRECOMPILED_MODULES = "false";
    return value;
  });
  return withPathSafeReactNativeBundle(withNativeBuildProperties);
};
