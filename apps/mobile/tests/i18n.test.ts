import { describe, expect, it, beforeEach, vi } from "vitest";
import { LANGUAGES, getTranslation, TRANSLATIONS } from "../src/i18n";
import {
  getSystemSettings,
  updateSystemSettings,
  resetSettingsForTesting,
  subscribeSystemSettings,
  restoreLanguagePreference,
  persistLanguagePreference,
} from "../src/settings";
import { translateInterface, normalizeLanguage, languageLocale } from "../../../packages/localization/src";
describe("Shared Vietnamese / English localization", () => {
  beforeEach(resetSettingsForTesting);
  it("supports two languages with keyed translation parity", () => {
    expect(LANGUAGES.map((o) => o.code)).toEqual(["vi", "en"]);
    expect(Object.keys(TRANSLATIONS.vi).sort()).toEqual(Object.keys(TRANSLATIONS.en).sort());
    expect(getTranslation("nav.home", "en")).toBe("Home");
    expect(getTranslation("Họ và tên", "en")).toBe("Full name");
  });
  it("preserves unknown content and whitespace", () => {
    expect(translateInterface("  Họ và tên  ", "en")).toBe("  Full name  ");
    expect(translateInterface("Cơ sở dữ liệu của Nguyễn Văn A", "en")).toBe("Cơ sở dữ liệu của Nguyễn Văn A");
    expect(getTranslation("unknown.key", "en")).toBe("unknown.key");
    expect(languageLocale("vi")).toBe("vi-VN");
    expect(languageLocale("en")).toBe("en-US");
  });
  it.each(["ja", "ko", "zh", "en-US", "invalid", null])("normalizes invalid preference %s", async (value) => {
    expect(normalizeLanguage(value)).toBe("vi");
    await restoreLanguagePreference({ read: async () => value });
    expect(getSystemSettings().language).toBe("vi");
  });
  it("restores English without changing login security", async () => {
    await restoreLanguagePreference({ read: async () => "en" });
    expect(getSystemSettings().language).toBe("en");
    expect(getSystemSettings().requireLoginOnColdStart).toBe(true);
  });
  it("publishes only after persisting and restores after restart", async () => {
    const notify = vi.fn();
    const unsubscribe = subscribeSystemSettings(notify);
    let stored: string | null = null;
    await persistLanguagePreference("en", {
      write: async (value) => {
        expect(getSystemSettings().language).toBe("vi");
        stored = value;
      },
    });
    expect(stored).toBe("en");
    expect(notify).toHaveBeenCalledOnce();
    expect(getSystemSettings().language).toBe("en");
    resetSettingsForTesting();
    await restoreLanguagePreference({ read: async () => stored });
    expect(getSystemSettings().language).toBe("en");
    unsubscribe();
  });
  it("handles storage failure safely", async () => {
    await expect(
      persistLanguagePreference("en", {
        write: async () => {
          throw new Error("disk full");
        },
      }),
    ).rejects.toThrow("disk full");
    expect(getSystemSettings().language).toBe("vi");
    updateSystemSettings({ language: "en" });
    await restoreLanguagePreference({
      read: async () => {
        throw new Error("unavailable");
      },
    });
    expect(getSystemSettings().language).toBe("vi");
  });
});
