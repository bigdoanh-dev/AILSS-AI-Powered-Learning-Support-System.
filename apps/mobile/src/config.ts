export type Environment = "development" | "research" | "production";

const PLACEHOLDER_HOSTNAMES = new Set([
  "api.ailss.example.org",
  "ailss.example.org",
  "example.org",
  "example.com",
  "example.net",
]);

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

export function isPlaceholderHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
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

export function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return LOOPBACK_HOSTNAMES.has(lower);
}

export function configuration(environment?: string, origin?: string) {
  if (!["development", "research", "production"].includes(environment ?? "")) {
    throw new Error("FATAL_CONFIGURATION_ERROR: Invalid or missing environment");
  }
  const trimmedOrigin = (origin ?? "").trim();
  if (!trimmedOrigin) {
    throw new Error("FATAL_CONFIGURATION_ERROR: Missing API base URL");
  }

  let url: URL;
  try {
    url = new URL(trimmedOrigin);
  } catch {
    throw new Error("FATAL_CONFIGURATION_ERROR: Malformed URL");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("FATAL_CONFIGURATION_ERROR: Invalid URL components");
  }

  if (environment === "production") {
    if (url.protocol !== "https:") {
      throw new Error("FATAL_CONFIGURATION_ERROR: Production must use https:");
    }
    if (isLoopbackHost(url.hostname)) {
      throw new Error("FATAL_CONFIGURATION_ERROR: Production cannot use loopback host");
    }
    if (isPlaceholderHost(url.hostname)) {
      throw new Error("FATAL_CONFIGURATION_ERROR: Production cannot use placeholder host");
    }
  }

  return { environment: environment as Environment, origin: url.origin };
}
