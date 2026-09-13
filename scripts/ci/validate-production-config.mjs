import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const requiredSecrets = [
  "JWT_KID",
  "HTTPS_CERT_PATH",
  "HTTPS_KEY_PATH",
  "SEPAY_WEBHOOK_API_KEY",
  "SEPAY_ACCOUNT_NUMBER",
  "SEPAY_ACCOUNT_NAME",
  "SEPAY_BANK",
  "AI_PROVIDER_MODEL",
  "AI_PROVIDER_API_KEY",
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
  "JWT_PRIVATE_KEY_PATH",
  "JWT_PUBLIC_KEY_PATH",
  "ACTOR_CONTEXT_PRIVATE_KEY_PATH",
  "ACTOR_CONTEXT_PUBLIC_KEY_PATH",
  "SERVICE_TOKEN_PRIVATE_KEY_PATH",
  "SERVICE_TOKEN_PUBLIC_KEY_PATH",
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
    if (separator < 1) throw new Error("Malformed environment declaration");
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

export function validateProductionConfig(values, mode = "fixture") {
  const errors = [];
  const exact = (name, expected) => {
    if (values[name] !== expected) errors.push(`${name} must equal ${expected}`);
  };
  const https = (name) => {
    try {
      if (new URL(values[name]).protocol !== "https:") throw new Error();
    } catch {
      errors.push(`${name} must be an absolute HTTPS URL`);
    }
  };
  exact("NODE_ENV", "production");
  exact("AILSS_PROFILE", "production");
  exact("PAYMENT_MODE", "sepay");
  exact("AI_PROVIDER_MODE", "production");
  exact("CASSANDRA_TLS_ENABLED", "true");
  exact("RABBITMQ_TLS_ENABLED", "true");
  exact("OBJECT_STORAGE_USE_SSL", "true");
  https("AILSS_WEB_ORIGIN");
  https("AILSS_GATEWAY_URL");
  https("JWT_ISSUER");
  https("AI_PROVIDER_ENDPOINT");
  https("OBJECT_STORAGE_PUBLIC_URL");
  for (const name of requiredSecrets) {
    const value = values[name];
    if (!value) errors.push(`${name} must be declared`);
    else if (mode === "fixture" && value !== "<INJECTED>")
      errors.push(`${name} must stay redacted in fixture mode`);
    else if (mode === "runtime" && value === "<INJECTED>") errors.push(`${name} must be injected at runtime`);
  }
  if (Boolean(values.HTTPS_CERT_PATH) !== Boolean(values.HTTPS_KEY_PATH))
    errors.push("HTTPS_CERT_PATH and HTTPS_KEY_PATH must be configured together");
  for (const name of ["AILSS_TEST_CRASH_BOUNDARY", "AILSS_TEST_CRASH_RUN_ID"])
    if (Object.hasOwn(values, name)) errors.push(`${name} is forbidden in production configuration`);
  return errors;
}

async function main() {
  const modeIndex = process.argv.indexOf("--mode");
  const fileIndex = process.argv.indexOf("--env-file");
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : "fixture";
  const path = fileIndex >= 0 ? process.argv[fileIndex + 1] : "config/production.env.example";
  if (!["fixture", "runtime"].includes(mode)) throw new Error("Mode must be fixture or runtime");
  const errors = validateProductionConfig(parseEnv(await readFile(path, "utf8")), mode);
  if (errors.length) {
    console.error(JSON.stringify({ stage: "production-config", status: "FAIL", mode, errors }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify({ stage: "production-config", status: "PASS", mode, redacted: mode === "fixture" }),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
