import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
const compiled = fileURLToPath(
  new URL("../../dist/apps/media-worker/src/backfill-quota.js", import.meta.url),
);
await access(compiled); // Compile the reviewed source with pnpm build first.
for (const name of ["ailss-learning-service", "ailss-media-worker"])
  if (
    execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8" }).trim() !==
    "false"
  )
    throw Error(`Maintenance window required: stop ${name} before quota backfill`);
execFileSync(
  "docker",
  [
    "compose",
    "--env-file",
    ".env",
    "--env-file",
    ".env.media",
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.async.yml",
    "-f",
    "docker-compose.media.yml",
    "--profile",
    "dev-async",
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "-e",
    "APP_NAME=AILSS",
    "-e",
    "SERVICE_ID=media-quota-backfill",
    "--volume",
    `${compiled}:/app/dist/apps/media-worker/src/backfill-quota.js:ro`,
    "media-worker",
    "dist/apps/media-worker/src/backfill-quota.js",
    "--maintenance-apply",
  ],
  { stdio: "inherit" },
);
