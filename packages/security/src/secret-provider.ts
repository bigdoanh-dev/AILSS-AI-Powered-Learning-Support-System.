import { AppError } from "../../http/src/index.js";

export interface SecretProvider {
  readonly name: string;
  getSecret(key: string): Promise<string | undefined>;
  requireSecret(key: string): Promise<string>;
  hasSecret(key: string): Promise<boolean>;
}

/**
 * Environment-backed SecretProvider reading from process.env or a custom dictionary.
 */
export class EnvironmentSecretProvider implements SecretProvider {
  public readonly name = "ENVIRONMENT";
  readonly #env: Record<string, string | undefined>;

  public constructor(env: Record<string, string | undefined> = process.env) {
    this.#env = env;
  }

  public async getSecret(key: string): Promise<string | undefined> {
    return Promise.resolve(this.#env[key]);
  }

  public async requireSecret(key: string): Promise<string> {
    const val = this.#env[key];
    if (val === undefined || val.trim().length === 0) {
      throw new AppError(
        "SECRET_NOT_FOUND",
        500,
        `Required secret "${key}" is not set in environment`,
      );
    }
    return Promise.resolve(val);
  }

  public async hasSecret(key: string): Promise<boolean> {
    const val = this.#env[key];
    return Promise.resolve(val !== undefined && val.trim().length > 0);
  }
}

/**
 * In-memory SecretProvider for testing.
 */
export class TestSecretProvider implements SecretProvider {
  public readonly name = "TEST";
  readonly #secrets = new Map<string, string>();

  public constructor(initialSecrets?: Record<string, string>) {
    if (initialSecrets) {
      for (const [k, v] of Object.entries(initialSecrets)) {
        this.#secrets.set(k, v);
      }
    }
  }

  public set(key: string, value: string): void {
    this.#secrets.set(key, value);
  }

  public delete(key: string): void {
    this.#secrets.delete(key);
  }

  public async getSecret(key: string): Promise<string | undefined> {
    return Promise.resolve(this.#secrets.get(key));
  }

  public async requireSecret(key: string): Promise<string> {
    const val = this.#secrets.get(key);
    if (val === undefined || val.trim().length === 0) {
      throw new AppError("SECRET_NOT_FOUND", 500, `Required secret "${key}" is not set in test store`);
    }
    return Promise.resolve(val);
  }

  public async hasSecret(key: string): Promise<boolean> {
    const val = this.#secrets.get(key);
    return Promise.resolve(val !== undefined && val.trim().length > 0);
  }
}

export interface VaultConfig {
  readonly endpoint: string;
  readonly token: string;
  readonly mountPath?: string;
  readonly namespace?: string;
  readonly fetchFn?: typeof fetch;
}

/**
 * Vault-backed SecretProvider integrating with HashiCorp Vault KV V2.
 */
export class VaultSecretProvider implements SecretProvider {
  public readonly name = "VAULT";
  readonly #endpoint: string;
  readonly #token: string;
  readonly #mountPath: string;
  readonly #namespace: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #cache = new Map<string, { value: string; expiresAt: number }>();
  readonly #cacheTtlMs: number;

  public constructor(config: VaultConfig, cacheTtlMs = 60_000) {
    this.#endpoint = config.endpoint.replace(/\/+$/u, "");
    this.#token = config.token;
    this.#mountPath = (config.mountPath ?? "secret").replace(/^\/+|\/+$/gu, "");
    this.#namespace = config.namespace;
    this.#fetch = config.fetchFn ?? globalThis.fetch;
    this.#cacheTtlMs = cacheTtlMs;
  }

  public async getSecret(key: string): Promise<string | undefined> {
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    try {
      const url = `${this.#endpoint}/v1/${this.#mountPath}/data/${encodeURIComponent(key)}`;
      const headers: Record<string, string> = {
        "X-Vault-Token": this.#token,
      };
      if (this.#namespace) {
        headers["X-Vault-Namespace"] = this.#namespace;
      }

      const res = await this.#fetch(url, { headers });
      if (res.status === 404) {
        return undefined;
      }
      if (!res.ok) {
        throw new AppError(
          "VAULT_REQUEST_FAILED",
          502,
          `Vault request failed with HTTP ${String(res.status)}`,
        );
      }

      const json = (await res.json()) as {
        data?: { data?: Record<string, unknown> };
      };
      const data = json.data?.data;
      if (!data) return undefined;

      // KV v2 secret might contain "value" or single field or JSON
      const raw = data.value !== undefined ? data.value : data[key];
      if (raw === undefined) return undefined;
      const val =
        typeof raw === "string"
          ? raw
          : typeof raw === "number" || typeof raw === "boolean"
            ? String(raw)
            : JSON.stringify(raw);
      this.#cache.set(key, { value: val, expiresAt: Date.now() + this.#cacheTtlMs });
      return val;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("VAULT_UNAVAILABLE", 503, "Vault service unreachable");
    }
  }

  public async requireSecret(key: string): Promise<string> {
    const val = await this.getSecret(key);
    if (val === undefined || val.trim().length === 0) {
      throw new AppError("SECRET_NOT_FOUND", 500, `Required secret "${key}" is not set in Vault`);
    }
    return val;
  }

  public async hasSecret(key: string): Promise<boolean> {
    const val = await this.getSecret(key);
    return val !== undefined && val.trim().length > 0;
  }
}

/**
 * Known insecure or placeholder patterns forbidden in production.
 */
const INSECURE_PATTERNS = [
  /^default$/iu,
  /^secret$/iu,
  /^changeme$/iu,
  /^admin$/iu,
  /^password$/iu,
  /^123456/u,
  /^super-secret/iu,
  /^dev-secret/iu,
  /^demo/iu,
  /^test/iu,
  /^simulation/iu,
  /^mock/iu,
  /^<.*>$/u, // e.g. <INJECTED>, <TODO>
];

export interface SecretValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

/**
 * Validates secrets for production environments to fail fast on startup
 * if default, demo, test, or weak secrets are detected.
 */
export function validateProductionSecrets(
  secrets: Record<string, string | undefined>,
  options?: {
    isProduction?: boolean;
    minSecretLength?: number;
  },
): SecretValidationResult {
  const isProd = options?.isProduction ?? process.env.NODE_ENV === "production";
  if (!isProd) {
    return { valid: true, violations: [] };
  }

  const minLength = options?.minSecretLength ?? 16;
  const violations: string[] = [];

  for (const [key, value] of Object.entries(secrets)) {
    if (value === undefined || value.trim().length === 0) {
      violations.push(`Secret "${key}" is missing or empty in production`);
      continue;
    }

    const trimmed = value.trim();

    // Check length
    if (trimmed.length < minLength) {
      violations.push(
        `Secret "${key}" does not meet minimum length requirement (${String(minLength)} characters)`,
      );
      continue;
    }

    // Check insecure/demo patterns
    for (const pattern of INSECURE_PATTERNS) {
      if (pattern.test(trimmed)) {
        violations.push(
          `Secret "${key}" matches forbidden insecure/demo pattern in production`,
        );
        break;
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Startup assertion guard that throws if production secrets fail validation.
 */
export function assertProductionSecretsSafe(
  secrets: Record<string, string | undefined>,
  options?: {
    isProduction?: boolean;
    minSecretLength?: number;
  },
): void {
  const result = validateProductionSecrets(secrets, options);
  if (!result.valid) {
    throw new AppError(
      "INSECURE_PRODUCTION_SECRET",
      500,
      `Production startup aborted due to insecure secret configuration: ${result.violations.join("; ")}`,
    );
  }
}
