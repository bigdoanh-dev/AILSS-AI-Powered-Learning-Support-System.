import { randomBytes } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";

const target = new URL("../../.env", import.meta.url);
let template = "";
let existed = false;
try {
  await access(target);
  existed = true;
  template = await readFile(target, "utf8");
} catch {
  template = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
}

if (!existed || template.includes("<INJECTED>")) {
  template = template.replace(
    /^([^#=\r\n]+)=<INJECTED>$/gm,
    (_line, name) => `${name}=${randomBytes(24).toString("base64url")}`,
  );
  await writeFile(target, template, { mode: 0o600 });
  if (existed) {
    console.log("Injected missing development secrets into existing .env (mode 0600)");
  } else {
    console.log("Created gitignored .env with random development-only secrets (mode 0600)");
  }
} else {
  console.log(".env already exists and all secrets are configured; preserving it");
}
