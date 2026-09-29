import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
// prettier-ignore
// @ts-ignore
import { parseEnv, requiredStagingSecrets, validateStagingConfig } from "../../scripts/ci/validate-staging-config.mjs";

describe("Phase 42 Revision C: Staging configuration validation", () => {
  it("validates config/staging.env.example in fixture mode cleanly", async () => {
    const content = await readFile("config/staging.env.example", "utf8");
    const values = parseEnv(content);
    const errors = validateStagingConfig(values, "fixture");
    expect(errors).toEqual([]);
  });

  it("fails if required secrets are unredacted in fixture mode", async () => {
    const content = await readFile("config/staging.env.example", "utf8");
    const values = parseEnv(content);
    values.MEDIA_PLAYBACK_SECRET = "live-unredacted-secret-0123456789abcdef";
    const errors = validateStagingConfig(values, "fixture");
    expect(errors).toContain("MEDIA_PLAYBACK_SECRET must stay redacted in fixture mode");
  });

  it("fails if required secrets remain <INJECTED> in runtime mode", async () => {
    const content = await readFile("config/staging.env.example", "utf8");
    const values = parseEnv(content);
    const errors = validateStagingConfig(values, "runtime");
    expect(errors).toContain("MEDIA_PLAYBACK_SECRET must be injected at runtime");
    expect(errors).toContain("MEDIA_STORAGE_ACCESS_KEY must be injected at runtime");
    expect(errors).toContain("CASSANDRA_PASSWORD must be injected at runtime");
  });

  it("enforces HTTPS origins for media delivery and object storage", async () => {
    const content = await readFile("config/staging.env.example", "utf8");
    const values = parseEnv(content);
    values.MEDIA_DELIVERY_ORIGIN = "http://insecure-cdn.ailss.invalid";
    values.OBJECT_STORAGE_PUBLIC_URL = "http://insecure-s3.ailss.invalid";
    const errors = validateStagingConfig(values, "fixture");
    expect(errors).toContain("MEDIA_DELIVERY_ORIGIN must be an absolute HTTPS URL");
    expect(errors).toContain("OBJECT_STORAGE_PUBLIC_URL must be an absolute HTTPS URL");
  });

  it("rejects localhost/127.0.0.1 for storage endpoints in staging configuration", async () => {
    const content = await readFile("config/staging.env.example", "utf8");
    const values = parseEnv(content);
    values.OBJECT_STORAGE_ENDPOINT = "127.0.0.1";
    const errors = validateStagingConfig(values, "fixture");
    expect(errors).toContain("OBJECT_STORAGE_ENDPOINT must not point to localhost in staging/production");
  });

  it("rejects test crash boundary flags in staging/production configuration", async () => {
    const content = await readFile("config/staging.env.example", "utf8");
    const values = parseEnv(content);
    values.AILSS_TEST_CRASH_BOUNDARY = "TRUE";
    const errors = validateStagingConfig(values, "fixture");
    expect(errors).toContain("AILSS_TEST_CRASH_BOUNDARY is forbidden in staging/production configuration");
  });
});
