import { AppError } from "../../http/src/index.js";
import { readFile } from "node:fs/promises";

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
      throw new AppError("SECRET_NOT_FOUND", 500, `Required secret "${key}" is not set in environment`);
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
      const encodedPath = key.split("/").map(encodeURIComponent).join("/");
      const url = `${this.#endpoint}/v1/${this.#mountPath}/data/${encodedPath}`;
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

const RUNTIME_SECRET_KEYS = [
  "CASSANDRA_PASSWORD",
  "RABBITMQ_PASSWORD",
  "PASSWORD_IDEMPOTENCY_HMAC_KEY",
  "ADMIN_CURSOR_HMAC_KEY",
  "LEARNING_CURSOR_HMAC_KEY",
  "AI_CURSOR_HMAC_KEY",
  "NOTIFICATION_TOKEN_SECRET",
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_SECRET_KEY",
  "MEDIA_STORAGE_ACCESS_KEY",
  "MEDIA_STORAGE_SECRET_KEY",
  "MEDIA_PLAYBACK_SECRET",
  "AI_PROVIDER_API_KEY",
  "SEPAY_WEBHOOK_API_KEY",
] as const;

/** Loads service secrets before configuration validation. Production never falls back to .env. */
export async function hydrateRuntimeSecrets(
  serviceId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const providerName = environment.SECRET_PROVIDER ?? "ENVIRONMENT";
  if (providerName !== "VAULT") {
    if (environment.NODE_ENV === "production")
      throw new AppError(
        "CENTRAL_SECRET_PROVIDER_REQUIRED",
        500,
        "Production requires SECRET_PROVIDER=VAULT",
      );
    return { ...environment };
  }
  const endpoint = environment.VAULT_ADDR;
  if (!endpoint) throw new AppError("VAULT_CONFIGURATION_MISSING", 500, "VAULT_ADDR is required");
  const authentication = await vaultWorkloadToken(endpoint, environment);
  if (authentication.renewable && authentication.leaseDurationSeconds > 0) {
    startVaultTokenRenewal(endpoint, authentication.token, environment, authentication.leaseDurationSeconds);
  }
  const provider = new VaultSecretProvider({
    endpoint,
    token: authentication.token,
    mountPath: environment.VAULT_KV_MOUNT ?? "secret",
    ...(environment.VAULT_NAMESPACE ? { namespace: environment.VAULT_NAMESPACE } : {}),
  });
  const hydrated = { ...environment };
  await Promise.all(
    RUNTIME_SECRET_KEYS.map(async (key) => {
      if (hydrated[key]) return;
      const value = await provider.getSecret(`${serviceId}/${key}`);
      if (value !== undefined) hydrated[key] = value;
    }),
  );
  return hydrated;
}

interface VaultAuthentication {
  readonly token: string;
  readonly renewable: boolean;
  readonly leaseDurationSeconds: number;
}

async function vaultWorkloadToken(
  endpoint: string,
  environment: NodeJS.ProcessEnv,
): Promise<VaultAuthentication> {
  if (environment.VAULT_TOKEN) {
    return { token: environment.VAULT_TOKEN, renewable: false, leaseDurationSeconds: 0 };
  }
  const namespaceHeaders = environment.VAULT_NAMESPACE
    ? { "X-Vault-Namespace": environment.VAULT_NAMESPACE }
    : {};
  let path: string, body: Record<string, string>;
  if (environment.VAULT_KUBERNETES_ROLE) {
    const jwtPath =
      environment.VAULT_KUBERNETES_JWT_PATH ?? "/var/run/secrets/kubernetes.io/serviceaccount/token";
    path = `/v1/auth/${encodeURIComponent(environment.VAULT_KUBERNETES_MOUNT ?? "kubernetes")}/login`;
    body = { role: environment.VAULT_KUBERNETES_ROLE, jwt: (await readFile(jwtPath, "utf8")).trim() };
  } else if (environment.VAULT_APPROLE_ROLE_ID) {
    const secretId =
      environment.VAULT_APPROLE_SECRET_ID ??
      (environment.VAULT_APPROLE_SECRET_ID_PATH
        ? (await readFile(environment.VAULT_APPROLE_SECRET_ID_PATH, "utf8")).trim()
        : undefined);
    if (!secretId) throw new AppError("VAULT_CONFIGURATION_MISSING", 500, "AppRole secret ID is required");
    path = `/v1/auth/${encodeURIComponent(environment.VAULT_APPROLE_MOUNT ?? "approle")}/login`;
    body = { role_id: environment.VAULT_APPROLE_ROLE_ID, secret_id: secretId };
  } else {
    throw new AppError(
      "VAULT_WORKLOAD_IDENTITY_REQUIRED",
      500,
      "Vault token, Kubernetes auth, or AppRole auth is required",
    );
  }
  const response = await fetch(`${endpoint.replace(/\/+$/u, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...namespaceHeaders },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new AppError(
      "VAULT_AUTHENTICATION_FAILED",
      503,
      `Vault workload authentication failed with HTTP ${String(response.status)}`,
    );
  const result = (await response.json()) as {
    auth?: { client_token?: string; renewable?: boolean; lease_duration?: number };
  };
  if (!result.auth?.client_token)
    throw new AppError("VAULT_AUTHENTICATION_FAILED", 503, "Vault did not return a client token");
  return {
    token: result.auth.client_token,
    renewable: result.auth.renewable === true,
    leaseDurationSeconds: Math.max(0, result.auth.lease_duration ?? 0),
  };
}

function startVaultTokenRenewal(
  endpoint: string,
  token: string,
  environment: NodeJS.ProcessEnv,
  leaseDurationSeconds: number,
): void {
  const renewalIntervalMs = Math.max(30_000, Math.floor(leaseDurationSeconds * 500));
  const namespaceHeaders = environment.VAULT_NAMESPACE
    ? { "X-Vault-Namespace": environment.VAULT_NAMESPACE }
    : {};
  const timer = setInterval(() => {
    void fetch(`${endpoint.replace(/\/+$/u, "")}/v1/auth/token/renew-self`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Vault-Token": token,
        ...namespaceHeaders,
      },
      body: JSON.stringify({ increment: `${String(leaseDurationSeconds)}s` }),
    })
      .then((response) => {
        if (!response.ok) {
          process.emitWarning(`Vault token renewal failed with HTTP ${String(response.status)}`, {
            code: "VAULT_TOKEN_RENEWAL_FAILED",
          });
        }
      })
      .catch(() => {
        process.emitWarning("Vault token renewal request failed", { code: "VAULT_TOKEN_RENEWAL_FAILED" });
      });
  }, renewalIntervalMs);
  timer.unref();
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
        violations.push(`Secret "${key}" matches forbidden insecure/demo pattern in production`);
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
