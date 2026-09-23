import { describe, expect, it } from "vitest";
import { loadConfig } from "../../packages/config/src/index.js";
import {
  parseEnv,
  requiredSecrets,
  validateProductionConfig,
} from "../../scripts/ci/validate-production-config.mjs";

const fixture = parseEnv(`
NODE_ENV=production
AILSS_PROFILE=production
PAYMENT_MODE=sepay
AI_PROVIDER_MODE=production
AI_ASSISTANT_PROVIDER_MODE=external
AI_ASSISTANT_INTEGRATION_ENABLED=false
CASSANDRA_TLS_ENABLED=true
RABBITMQ_TLS_ENABLED=true
OBJECT_STORAGE_USE_SSL=true
AILSS_WEB_ORIGIN=https://learn.example.invalid
AILSS_GATEWAY_URL=https://api.example.invalid
JWT_ISSUER=https://identity.example.invalid
AI_PROVIDER_ENDPOINT=https://api.example.invalid
OBJECT_STORAGE_PUBLIC_URL=https://objects.example.invalid
`);

it("rejects the deterministic AI provider in production", () => {
  expect(() =>
    loadConfig({
      APP_NAME: "ai-worker",
      SERVICE_ID: "ai-worker",
      PORT: "8201",
      NODE_ENV: "production",
      AI_PROVIDER_MODE: "deterministic-test",
    }),
  ).toThrow("Environment configuration is invalid");
});

it("rejects a production AI worker without a provider credential", () => {
  expect(() =>
    loadConfig({
      APP_NAME: "ai-worker",
      SERVICE_ID: "ai-worker",
      PORT: "8201",
      NODE_ENV: "production",
      AI_PROVIDER_MODE: "production",
    }),
  ).toThrow("Environment configuration is invalid");
});

it("allows the assistant integration boundary only with explicit local enablement", () => {
  expect(() =>
    loadConfig({
      APP_NAME: "ai-service",
      SERVICE_ID: "ai-service",
      PORT: "8106",
      NODE_ENV: "development",
      AI_ASSISTANT_PROVIDER_MODE: "integration-only",
    }),
  ).toThrow("Environment configuration is invalid");

  expect(
    loadConfig({
      APP_NAME: "ai-service",
      SERVICE_ID: "ai-service",
      PORT: "8106",
      NODE_ENV: "development",
      AI_ASSISTANT_PROVIDER_MODE: "integration-only",
      AI_ASSISTANT_INTEGRATION_ENABLED: "true",
    }).AI_ASSISTANT_PROVIDER_MODE,
  ).toBe("integration-only");
});

it.each([
  { NODE_ENV: "production", AILSS_PROFILE: "production" },
  { NODE_ENV: "development", AILSS_PROFILE: "production" },
])("rejects the integration assistant adapter from a production-like profile", (profile) => {
  expect(() =>
    loadConfig({
      APP_NAME: "ai-service",
      SERVICE_ID: "ai-service",
      PORT: "8106",
      ...profile,
      AI_ASSISTANT_PROVIDER_MODE: "integration-only",
      AI_ASSISTANT_INTEGRATION_ENABLED: "true",
    }),
  ).toThrow("Environment configuration is invalid");
});

describe("production configuration validator", () => {
  it("rejects crash controls and missing declarations without echoing values", () => {
    const errors = validateProductionConfig({ ...fixture, AILSS_TEST_CRASH_BOUNDARY: "A_CANDIDATE" });
    expect(errors).toContain("AILSS_TEST_CRASH_BOUNDARY is forbidden in production configuration");
    expect(errors.join("\n")).not.toContain("A_CANDIDATE");
    expect(errors).toContain("AI_PROVIDER_API_KEY must be declared");
  });

  it("requires absolute HTTPS origins for Web and Gateway", () => {
    const declared = Object.fromEntries(requiredSecrets.map((name) => [name, "<INJECTED>"]));
    expect(
      validateProductionConfig({ ...fixture, ...declared, AILSS_GATEWAY_URL: "http://api.invalid" }),
    ).toContain("AILSS_GATEWAY_URL must be an absolute HTTPS URL");
  });

  it("does not permit literal SePay fields in a committed fixture", () => {
    const declared = Object.fromEntries(requiredSecrets.map((name) => [name, "<INJECTED>"]));
    expect(validateProductionConfig({ ...fixture, ...declared, SEPAY_BANK: "MB" }, "fixture")).toContain(
      "SEPAY_BANK must stay redacted in fixture mode",
    );
  });

  it("distinguishes redacted fixture placeholders from runnable secrets", () => {
    const declared = Object.fromEntries(requiredSecrets.map((name) => [name, "<INJECTED>"]));
    expect(validateProductionConfig({ ...fixture, ...declared }, "fixture")).toEqual([]);
    expect(validateProductionConfig({ ...fixture, ...declared }, "runtime")).toContain(
      "AI_PROVIDER_API_KEY must be injected at runtime",
    );
  });
});
