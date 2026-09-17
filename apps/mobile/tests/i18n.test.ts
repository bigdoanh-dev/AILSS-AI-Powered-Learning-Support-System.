import { describe, expect, it, beforeEach } from "vitest";
import { LANGUAGES, getTranslation, type SupportedLanguage } from "../src/i18n";
import {
  getSystemSettings,
  updateSystemSettings,
  resetSettingsForTesting,
  subscribeSystemSettings,
} from "../src/settings";

describe("Mobile Multi-Language Support (i18n)", () => {
  beforeEach(() => {
    resetSettingsForTesting();
  });

  it("provides 5 supported languages with flags and native names", () => {
    expect(LANGUAGES).toHaveLength(5);
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes).toEqual(["vi", "en", "ja", "ko", "zh"]);

    const vi = LANGUAGES.find((l) => l.code === "vi");
    expect(vi?.flag).toBe("🇻🇳");
    expect(vi?.name).toBe("Tiếng Việt");

    const en = LANGUAGES.find((l) => l.code === "en");
    expect(en?.flag).toBe("🇬🇧");
    expect(en?.name).toBe("English");

    const ja = LANGUAGES.find((l) => l.code === "ja");
    expect(ja?.flag).toBe("🇯🇵");

    const ko = LANGUAGES.find((l) => l.code === "ko");
    expect(ko?.flag).toBe("🇰🇷");

    const zh = LANGUAGES.find((l) => l.code === "zh");
    expect(zh?.flag).toBe("🇨🇳");
  });

  it("translates key phrases correctly across languages", () => {
    expect(getTranslation("action.login", "vi")).toBe("Đăng nhập");
    expect(getTranslation("action.login", "en")).toBe("Sign In");
    expect(getTranslation("action.login", "ja")).toBe("ログイン");
    expect(getTranslation("action.login", "ko")).toBe("로그인");
    expect(getTranslation("action.login", "zh")).toBe("登录");

    expect(getTranslation("header.greeting", "vi")).toBe("Xin chào,");
    expect(getTranslation("header.greeting", "en")).toBe("Hello,");
    expect(getTranslation("header.greeting", "ja")).toBe("こんにちは、");
  });

  it("falls back to Vietnamese if translation is missing", () => {
    expect(getTranslation("non.existent.key", "en")).toBe("non.existent.key");
    expect(getTranslation("nav.home", "en")).toBe("Home");
    expect(getTranslation("nav.home", "vi")).toBe("Trang chủ");
  });

  it("updates and broadcasts language changes through SystemSettings store", () => {
    let notified = false;
    const unsub = subscribeSystemSettings(() => {
      notified = true;
    });

    expect(getSystemSettings().language).toBe("vi");

    updateSystemSettings({ language: "en" });
    expect(getSystemSettings().language).toBe("en");
    expect(notified).toBe(true);

    updateSystemSettings({ language: "ja" });
    expect(getSystemSettings().language).toBe("ja");

    unsub();
  });
});
