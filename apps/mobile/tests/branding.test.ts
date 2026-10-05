import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;

function png(path: string) {
  const data = readFileSync(new URL(`../${path}`, import.meta.url));
  expect(data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(data.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), colorType: data[25] };
}

describe("AILSS native branding", () => {
  it("uses the new square app icon rather than the Expo template", () => {
    expect(config.icon).toBe("./assets/branding-new/icon.png");
    expect(png(config.icon)).toMatchObject({ width: 1024, height: 1024 });
    expect(config.web.favicon).toBe(config.icon);
  });

  it("uses alpha-enabled adaptive layers without the old template background image", () => {
    const adaptive = config.android.adaptiveIcon;
    expect(adaptive.backgroundColor).toBe("#060D20");
    expect(adaptive).not.toHaveProperty("backgroundImage");
    for (const path of [adaptive.foregroundImage, adaptive.monochromeImage]) {
      expect(path).toMatch(/^\.\/assets\/branding-new\//);
      expect(png(path)).toEqual({ width: 1024, height: 1024, colorType: 6 });
    }
  });

  it("configures the native splash plugin with the same branding background", () => {
    const splashPlugins = config.plugins.filter(
      (plugin: string | [string, unknown]) =>
        (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-splash-screen",
    );
    expect(splashPlugins).toHaveLength(1);
    const [, splash] = splashPlugins[0];
    expect(splash.image).toBe("./assets/branding-new/splash-logo.png");
    expect(splash.backgroundColor).toBe(config.android.adaptiveIcon.backgroundColor);
    expect(splash.resizeMode).toBe("contain");
    expect(splash.imageWidth).toBeGreaterThan(0);
    expect(png(splash.image)).toEqual({ width: 1024, height: 1024, colorType: 6 });
  });
});
