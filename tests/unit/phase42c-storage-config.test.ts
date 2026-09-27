import { describe, expect, it } from "vitest";
import { loadConfig } from "../../packages/config/src/index.js";
import { mediaRuntime } from "../../apps/learning-service/src/media/config.js";
import { S3MediaStorage } from "../../packages/storage/src/media.js";

describe("Phase 42 Revision C: S3 storage and media configuration contract", () => {
  const minimalBase = {
    APP_NAME: "ailss-learning",
    SERVICE_ID: "learning-service",
    PORT: "8102",
  };

  it("parses valid external S3 configuration for development and production", () => {
    const config = loadConfig({
      ...minimalBase,
      NODE_ENV: "development",
      OBJECT_STORAGE_ENDPOINT: "s3.ap-southeast-1.amazonaws.com",
      OBJECT_STORAGE_PORT: "443",
      OBJECT_STORAGE_USE_SSL: "true",
      OBJECT_STORAGE_PUBLIC_URL: "https://s3.ap-southeast-1.amazonaws.com",
      MEDIA_STORAGE_BUCKET: "ailss-media-prod",
    });

    expect(config.OBJECT_STORAGE_ENDPOINT).toBe("s3.ap-southeast-1.amazonaws.com");
    expect(config.OBJECT_STORAGE_PORT).toBe(443);
    expect(config.OBJECT_STORAGE_USE_SSL).toBe(true);
    expect(config.OBJECT_STORAGE_PUBLIC_URL).toBe("https://s3.ap-southeast-1.amazonaws.com");
    expect(config.MEDIA_STORAGE_BUCKET).toBe("ailss-media-prod");
  });

  it("fails closed in production if MEDIA_ENABLED is true but credentials or SSL are missing", () => {
    try {
      loadConfig({
        ...minimalBase,
        NODE_ENV: "production",
        MEDIA_ENABLED: "true",
        OBJECT_STORAGE_USE_SSL: "false",
        MEDIA_STORAGE_ACCESS_KEY: "test-access-key",
        MEDIA_STORAGE_SECRET_KEY: "test-secret-key",
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.issues).toContain("Production object storage must use SSL");
    }

    try {
      loadConfig({
        ...minimalBase,
        NODE_ENV: "production",
        MEDIA_ENABLED: "true",
        OBJECT_STORAGE_USE_SSL: "true",
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.issues).toContain("Production media storage credentials are missing");
    }

    try {
      loadConfig({
        ...minimalBase,
        NODE_ENV: "production",
        MEDIA_ENABLED: "true",
        OBJECT_STORAGE_USE_SSL: "true",
        MEDIA_STORAGE_ACCESS_KEY: "test-access-key",
        MEDIA_STORAGE_SECRET_KEY: "test-secret-key",
        MEDIA_DELIVERY_ORIGIN: "http://insecure-cdn.invalid",
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.issues).toContain("Production media delivery origin must use HTTPS");
    }
  });

  it("constructs mediaRuntime properly when all required keys are supplied", () => {
    const config = loadConfig({
      ...minimalBase,
      MEDIA_ENABLED: "true",
      MEDIA_STORAGE_BUCKET: "ailss-media-prod",
      MEDIA_STORAGE_ACCESS_KEY: "actual-key-id",
      MEDIA_STORAGE_SECRET_KEY: "actual-secret-key-value",
      OBJECT_STORAGE_ENDPOINT: "s3.ap-southeast-1.amazonaws.com",
      OBJECT_STORAGE_PORT: "443",
      OBJECT_STORAGE_USE_SSL: "true",
      OBJECT_STORAGE_PUBLIC_URL: "https://s3.ap-southeast-1.amazonaws.com",
      MEDIA_MAX_SOURCE_BYTES: "5368709120",
      MEDIA_MAX_DURATION_SECONDS: "14400",
      MEDIA_PLAYBACK_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
      MEDIA_DELIVERY_ORIGIN: "https://cdn.example.invalid",
      MEDIA_QUOTA_LIMITS: JSON.stringify({
        tenantOriginalBytes: 100_000_000_000,
        tenantDerivedBytes: 200_000_000_000,
        courseOriginalBytes: 20_000_000_000,
        courseDerivedBytes: 40_000_000_000,
        tenantAssets: 1000,
        courseAssets: 200,
      }),
    });

    const runtime = mediaRuntime(config, true);
    expect(runtime).toBeDefined();
    expect(runtime?.policy.maxSourceBytes).toBe(5368709120);
    expect(runtime?.policy.maxDurationSeconds).toBe(14400);
    expect(runtime?.policy.deliveryOrigin).toBe("https://cdn.example.invalid");
    expect(runtime?.storage).toBeInstanceOf(S3MediaStorage);
  });

  it("instantiates S3MediaStorage targeting AWS S3 endpoint and validates origin URL strictly", () => {
    const storage = new S3MediaStorage(
      "ailss-media-prod",
      {
        endPoint: "s3.ap-southeast-1.amazonaws.com",
        port: 443,
        useSSL: true,
        accessKey: "mock-storage-key",
        secretKey: "mock-secret-key-1234567890",
        region: "ap-southeast-1",
      },
      "https://s3.ap-southeast-1.amazonaws.com",
    );

    expect(storage).toBeDefined();

    // Invalid origin rejection
    expect(
      () =>
        new S3MediaStorage(
          "ailss-media-prod",
          {
            endPoint: "s3.ap-southeast-1.amazonaws.com",
            port: 443,
            useSSL: true,
            accessKey: "mock-storage-key",
            secretKey: "mock-secret-key-1234567890",
          },
          "https://s3.ap-southeast-1.amazonaws.com/extra-path",
        ),
    ).toThrow("INVALID_MEDIA_STORAGE_ORIGIN");
  });
});
