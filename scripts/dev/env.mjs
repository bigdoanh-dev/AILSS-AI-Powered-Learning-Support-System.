import { readFile } from "node:fs/promises";

export async function readEnv(path = new URL("../../.env", import.meta.url)) {
  const text = await readFile(path, "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

export function required(env, name) {
  const value = env[name];
  if (!value || value === "<INJECTED>") throw new Error(`Missing injected secret: ${name}`);
  return value;
}
