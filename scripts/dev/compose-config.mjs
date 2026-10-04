import { existsSync } from "node:fs";

// A provisioned media stack must stay enabled across ordinary local restarts.
// .env.media is created by initialize-media.mjs, never by the core bootstrap.
export function localComposeConfig(profile, exists = existsSync) {
  const media = ["dev-async", "demo", "*"].includes(profile) && exists(".env.media");
  const files = [
    "docker-compose.yml",
    ...(profile !== "dev-core" ? ["docker-compose.async.yml"] : []),
    ...(media ? ["docker-compose.media.yml"] : []),
    "docker-compose.observability.yml",
  ];
  const envFiles = [
    ".env",
    ...(media ? [".env.media"] : []),
    ...(exists(".env.local") ? [".env.local"] : []),
  ];
  return {
    media,
    args: [
      ...envFiles.flatMap((file) => ["--env-file", file]),
      ...files.flatMap((file) => ["-f", file]),
      "--profile",
      profile,
    ],
  };
}
