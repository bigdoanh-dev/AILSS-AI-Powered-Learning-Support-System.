import { describe, expect, it, vi } from "vitest";
import {
  EnvironmentSecretProvider,
  TestSecretProvider,
  VaultSecretProvider,
  validateProductionSecrets,
  assertProductionSecretsSafe,
} from "../../packages/security/src/index.js";

describe("SecretProvider Abstraction (P1)", () => {
  it("EnvironmentSecretProvider reads and validates secrets from environment", async () => {
    const env = {
      API_KEY: "prod-secret-alpha-999",
      EMPTY_KEY: "",
    };
    const provider = new EnvironmentSecretProvider(env);

    expect(await provider.getSecret("API_KEY")).toBe("prod-secret-alpha-999");
    expect(await provider.requireSecret("API_KEY")).toBe("prod-secret-alpha-999");
    expect(await provider.hasSecret("API_KEY")).toBe(true);

    expect(await provider.getSecret("NON_EXISTENT")).toBeUndefined();
    expect(await provider.hasSecret("NON_EXISTENT")).toBe(false);
    await expect(provider.requireSecret("NON_EXISTENT")).rejects.toMatchObject({
      code: "SECRET_NOT_FOUND",
      status: 500,
    });

    expect(await provider.hasSecret("EMPTY_KEY")).toBe(false);
    await expect(provider.requireSecret("EMPTY_KEY")).rejects.toMatchObject({
      code: "SECRET_NOT_FOUND",
      status: 500,
    });
  });

  it("TestSecretProvider supports in-memory isolation for testing", async () => {
    const provider = new TestSecretProvider({ INITIAL: "initial-val" });

    expect(await provider.getSecret("INITIAL")).toBe("initial-val");
    expect(await provider.hasSecret("INITIAL")).toBe(true);

    provider.set("DYNAMIC_KEY", "dyn-value-123");
    expect(await provider.requireSecret("DYNAMIC_KEY")).toBe("dyn-value-123");

    provider.delete("DYNAMIC_KEY");
    expect(await provider.getSecret("DYNAMIC_KEY")).toBeUndefined();
    expect(await provider.hasSecret("DYNAMIC_KEY")).toBe(false);
  });

  it("VaultSecretProvider retrieves secrets, caches them, and handles failures", async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) => {
      if (url.includes("not-found")) {
        return Promise.resolve({
          status: 404,
          ok: false,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              data: {
                value: "vault-retrieved-high-entropy-token-2026",
              },
            },
          }),
      });
    });

    const vaultProvider = new VaultSecretProvider(
      {
        endpoint: "https://vault.example.invalid:8200",
        token: "s.mockToken12345",
        mountPath: "secret",
        namespace: "ailss-prod",
        fetchFn,
      },
      5000,
    );

    const secret = await vaultProvider.requireSecret("database/credentials");
    expect(secret).toBe("vault-retrieved-high-entropy-token-2026");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Second read should use cache (no second fetch)
    const cachedSecret = await vaultProvider.getSecret("database/credentials");
    expect(cachedSecret).toBe("vault-retrieved-high-entropy-token-2026");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Non-existent key returns undefined / throws on require
    const notFound = await vaultProvider.getSecret("not-found-key");
    expect(notFound).toBeUndefined();
  });
});

describe("Production Startup Guard (P1)", () => {
  it("allows demo or short secrets in development or non-production mode", () => {
    const devSecrets = {
      JWT_SECRET: "demo",
      API_KEY: "test",
    };
    const result = validateProductionSecrets(devSecrets, { isProduction: false });
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);

    expect(() => assertProductionSecretsSafe(devSecrets, { isProduction: false })).not.toThrow();
  });

  it("rejects weak, default, simulation, and placeholder secrets in production mode", () => {
    const badSecrets = {
      DB_PASSWORD: "password",
      JWT_SECRET: "changeme",
      SEPAY_KEY: "default",
      OIDC_SECRET: "simulation-key-1234567890",
      STORAGE_SECRET: "demo-secret-key-123456",
      AI_KEY: "<INJECTED>",
    };

    const result = validateProductionSecrets(badSecrets, { isProduction: true });
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(6);

    // Verify error messages do NOT echo raw secret values
    for (const v of result.violations) {
      expect(v).not.toContain("password");
      expect(v).not.toContain("changeme");
      expect(v).not.toContain("simulation-key");
    }

    expect(() => assertProductionSecretsSafe(badSecrets, { isProduction: true })).toThrowError(
      /Production startup aborted due to insecure secret configuration/u,
    );
  });

  it("rejects secrets that fail minimum length requirement in production", () => {
    const shortSecrets = {
      SUPER_SECRET: "tooshort",
    };

    const result = validateProductionSecrets(shortSecrets, { isProduction: true, minSecretLength: 16 });
    expect(result.valid).toBe(false);
    expect(result.violations[0]).toContain('does not meet minimum length requirement (16 characters)');
  });

  it("approves strong, high-entropy secrets in production", () => {
    const strongSecrets = {
      JWT_PRIVATE_KEY: "c2VjdXJlX2VkMjU1MTlfcHJpdmF0ZV9rZXlfc3VmZmljaWVudGx5X2xvbmdfYW5kX3JhbmRvbQ==",
      DB_PASSWORD: "xK9#vL2$pQ8@zM5!wR4^tY1*bN7%cV3&",
      SEPAY_WEBHOOK_API_KEY: "a9f8b2c4e1d3056789abcdef1234567890abcdef1234567890abcdef12345678",
      STORAGE_ACCESS_KEY: "PROD_STORAGE_KEY_SECURE_987654321",
    };

    const result = validateProductionSecrets(strongSecrets, { isProduction: true, minSecretLength: 16 });
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);

    expect(() => assertProductionSecretsSafe(strongSecrets, { isProduction: true, minSecretLength: 16 })).not.toThrow();
  });
});
