import { readFile } from "node:fs/promises";
import { z } from "zod";

export const requiredStagingSecrets = [
  "JWT_KID",
  "HTTPS_CERT_PATH",
  "HTTPS_KEY_PATH",
  "JWT_PRIVATE_KEY_PATH",
  "JWT_PUBLIC_KEY_PATH",
  "SERVICE_TOKEN_PRIVATE_KEY_PATH",
  "SERVICE_TOKEN_PUBLIC_KEY_PATH",
  "CASSANDRA_CONTACT_POINTS",
  "CASSANDRA_LOCAL_DC",
  "CASSANDRA_CA_PATH",
  "CASSANDRA_USERNAME",
  "CASSANDRA_PASSWORD",
  "RABBITMQ_URL",
  "RABBITMQ_USERNAME",
  "RABBITMQ_PASSWORD",
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "MEDIA_STORAGE_BUCKET",
  "MEDIA_STORAGE_ACCESS_KEY",
  "MEDIA_STORAGE_SECRET_KEY",
  "MEDIA_PLAYBACK_SECRET",
  "MEDIA_QUOTA_LIMITS",
  "MEDIA_TRANSCODE_PROFILES",
  "PASSWORD_IDEMPOTENCY_HMAC_KEY",
  "ADMIN_CURSOR_HMAC_KEY",
  "LEARNING_CURSOR_HMAC_KEY",
  "AI_CURSOR_HMAC_KEY",
  "NOTIFICATION_TOKEN_SECRET",
];

export function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

export function validateStagingConfig(values, mode = "fixture") {
  const errors = [];

  const exact = (name, expected) => {
    if (values[name] !== expected) errors.push(`${name} must equal ${expected}`);
  };

  const https = (name) => {
    try {
      const url = new URL(values[name] ?? "");
      if (url.protocol !== "https:") errors.push(`${name} must be an absolute HTTPS URL`);
    } catch {
      errors.push(`${name} must be an absolute HTTPS URL`);
    }
  };

  // 1. Environment & TLS flags
  if (!["production", "staging"].includes(values.NODE_ENV ?? "")) {
    errors.push("NODE_ENV must be production or staging");
  }
  exact("CASSANDRA_TLS_ENABLED", "true");
  exact("RABBITMQ_TLS_ENABLED", "true");
  exact("OBJECT_STORAGE_USE_SSL", "true");
  exact("MEDIA_ENABLED", "true");

  // 2. HTTPS Endpoints
  https("AILSS_WEB_ORIGIN");
  https("AILSS_GATEWAY_URL");
  https("JWT_ISSUER");
  https("OBJECT_STORAGE_PUBLIC_URL");
  https("MEDIA_DELIVERY_ORIGIN");

  // 3. Storage configuration contract
  if (values.OBJECT_STORAGE_ENDPOINT && ["127.0.0.1", "localhost"].includes(values.OBJECT_STORAGE_ENDPOINT)) {
    errors.push("OBJECT_STORAGE_ENDPOINT must not point to localhost in staging/production");
  }
  if (values.OBJECT_STORAGE_PORT && Number(values.OBJECT_STORAGE_PORT) !== 443 && values.OBJECT_STORAGE_USE_SSL === "true") {
    // When using standard cloud S3 with SSL, port is typically 443
    if (isNaN(Number(values.OBJECT_STORAGE_PORT))) {
      errors.push("OBJECT_STORAGE_PORT must be a valid integer");
    }
  }

  // 4. Playback signing secret & reference
  if (mode === "runtime") {
    if (!values.MEDIA_PLAYBACK_SECRET || values.MEDIA_PLAYBACK_SECRET.length < 32) {
      errors.push("MEDIA_PLAYBACK_SECRET must be at least 32 characters long at runtime");
    }
  }

  // 5. Media Worker Policy
  if (values.MEDIA_MAX_SOURCE_BYTES) {
    const bytes = Number(values.MEDIA_MAX_SOURCE_BYTES);
    if (!Number.isInteger(bytes) || bytes <= 0 || bytes > 80_000_000_000) {
      errors.push("MEDIA_MAX_SOURCE_BYTES must be a positive integer up to 80,000,000,000");
    }
  } else {
    errors.push("MEDIA_MAX_SOURCE_BYTES must be declared");
  }

  if (values.MEDIA_MAX_DURATION_SECONDS) {
    const duration = Number(values.MEDIA_MAX_DURATION_SECONDS);
    if (!Number.isInteger(duration) || duration <= 0) {
      errors.push("MEDIA_MAX_DURATION_SECONDS must be a positive integer");
    }
  } else {
    errors.push("MEDIA_MAX_DURATION_SECONDS must be declared");
  }

  // Validate transcode profiles schema
  if (values.MEDIA_TRANSCODE_PROFILES && values.MEDIA_TRANSCODE_PROFILES !== "<INJECTED>") {
    try {
      const parsed = JSON.parse(values.MEDIA_TRANSCODE_PROFILES);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        errors.push("MEDIA_TRANSCODE_PROFILES must be a non-empty array");
      }
    } catch {
      errors.push("MEDIA_TRANSCODE_PROFILES must be valid JSON");
    }
  }

  // Validate quota limits schema
  if (values.MEDIA_QUOTA_LIMITS && values.MEDIA_QUOTA_LIMITS !== "<INJECTED>") {
    try {
      const parsed = JSON.parse(values.MEDIA_QUOTA_LIMITS);
      const keys = ["tenantOriginalBytes", "tenantDerivedBytes", "courseOriginalBytes", "courseDerivedBytes", "tenantAssets", "courseAssets"];
      for (const k of keys) {
        if (typeof parsed[k] !== "number" || parsed[k] <= 0) {
          errors.push(`MEDIA_QUOTA_LIMITS missing positive numeric key: ${k}`);
        }
      }
    } catch {
      errors.push("MEDIA_QUOTA_LIMITS must be valid JSON");
    }
  }

  // 6. Required secrets & redactions
  for (const name of requiredStagingSecrets) {
    const value = values[name];
    if (!value) {
      errors.push(`${name} must be declared`);
    } else if (mode === "fixture" && value !== "<INJECTED>") {
      errors.push(`${name} must stay redacted in fixture mode`);
    } else if (mode === "runtime" && value === "<INJECTED>") {
      errors.push(`${name} must be injected at runtime`);
    }
  }

  // 7. Forbidden test controls
  for (const name of ["AILSS_TEST_CRASH_BOUNDARY", "AILSS_TEST_CRASH_RUN_ID"]) {
    if (Object.hasOwn(values, name)) {
      errors.push(`${name} is forbidden in staging/production configuration`);
    }
  }

  return errors;
}

async function main() {
  const modeIndex = process.argv.indexOf("--mode");
  const fileIndex = process.argv.indexOf("--env-file");
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : "fixture";
  const path = fileIndex >= 0 ? process.argv[fileIndex + 1] : "config/staging.env.example";

  if (!["fixture", "runtime"].includes(mode)) {
    throw new Error("Mode must be fixture or runtime");
  }

  const content = await readFile(path, "utf8");
  const values = parseEnv(content);
  const errors = validateStagingConfig(values, mode);

  if (errors.length > 0) {
    console.error(JSON.stringify({ stage: "staging-config", status: "FAIL", mode, errors }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ stage: "staging-config", status: "PASS", mode, redacted: mode === "fixture" }));
}

if (process.argv[1] && process.argv[1].endsWith("validate-staging-config.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
