import { describe, expect, it } from "vitest";
import { localComposeConfig } from "../../scripts/dev/compose-config.mjs";

describe("local media stack restarts", () => {
  const initialized = (file: string) => [".env.media", ".env.local"].includes(file);

  it.each(["dev-async", "demo"])("keeps provisioned media enabled for %s", (profile) => {
    const config = localComposeConfig(profile, initialized);
    expect(config.media).toBe(true);
    expect(config.args).toEqual([
      "--env-file",
      ".env",
      "--env-file",
      ".env.media",
      "--env-file",
      ".env.local",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.async.yml",
      "-f",
      "docker-compose.media.yml",
      "-f",
      "docker-compose.observability.yml",
      "--profile",
      profile,
    ]);
  });

  it("does not enable media before provisioning, or in core/research profiles", () => {
    for (const config of [
      localComposeConfig("dev-async", () => false),
      localComposeConfig("dev-core", initialized),
      localComposeConfig("research", initialized),
    ]) {
      expect(config.media).toBe(false);
      expect(config.args).not.toContain(".env.media");
      expect(config.args).not.toContain("docker-compose.media.yml");
    }
  });

  it("includes initialized media services when stopping all profiles", () => {
    expect(localComposeConfig("*", initialized).args).toContain("docker-compose.media.yml");
  });
});
