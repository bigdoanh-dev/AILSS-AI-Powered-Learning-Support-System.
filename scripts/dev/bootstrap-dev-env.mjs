import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";

const target = new URL("../../.env", import.meta.url);
try {
  await access(target);
  console.log(".env already exists; preserving it");
} catch {
  let template = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
  template = template.replace(
    /^([^#=]+)=<INJECTED>$/gm,
    (_line, name) => `${name}=${randomBytes(24).toString("base64url")}`,
  );
  await writeFile(target, template, { mode: 0o600 });
  console.log("Created gitignored .env with random development-only secrets (mode 0600)");
}
