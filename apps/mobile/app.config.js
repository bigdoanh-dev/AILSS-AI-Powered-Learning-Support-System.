const { withAndroidManifest } = require("expo/config-plugins");

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
  return withAndroidManifest(config, (value) => {
    const app = value.modResults.manifest.application?.[0];
    if (app) app.$["android:usesCleartextTraffic"] = String(localHttp);
    return value;
  });
};
