import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir(new URL("../../secrets/", import.meta.url), { recursive: true, mode: 0o700 });
try {
  await writeFile(
    new URL("../../secrets/grafana_admin_password", import.meta.url),
    `${randomBytes(24).toString("base64url")}\n`,
    { mode: 0o600, flag: "wx" },
  );
  console.log("Created gitignored local Grafana password file; existing credentials are preserved.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("Local Grafana password file already exists; preserving it.");
}
