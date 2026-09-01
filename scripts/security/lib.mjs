import { execFile } from "node:child_process";
import { mkdir, chmod, access } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const exec = promisify(execFile);
export const root = new URL("../../", import.meta.url);
export const generated = new URL("infrastructure/tls/generated/", root);
export const filePath = (value) => (value instanceof URL ? fileURLToPath(value) : value);

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}
export async function protect(path) {
  await chmod(path, 0o600);
}

export async function openssl(args, options = {}) {
  try {
    return await exec("openssl", args, { cwd: options.cwd, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    const safe =
      error instanceof Error
        ? error.message.replaceAll(/password=[^\s]+/g, "password=<redacted>")
        : "unknown";
    throw new Error(`OpenSSL failed safely: ${safe}`);
  }
}
