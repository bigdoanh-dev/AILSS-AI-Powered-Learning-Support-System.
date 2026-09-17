import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LanguageProvider, useLanguage, LANGUAGES } from "../src/lib/i18n";
import { LanguageSwitcher } from "../src/components/LanguageSwitcher";

function TestConsumer() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div>
      <span data-testid="current-lang">{language}</span>
      <span data-testid="translated-home">{t("nav.home")}</span>
      <button onClick={() => setLanguage("en")}>Switch to EN</button>
      <button onClick={() => setLanguage("ja")}>Switch to JA</button>
      <LanguageSwitcher />
    </div>
  );
}

describe("Web Multi-Language Support (i18n & LanguageSwitcher)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "vi";
  });

  afterEach(() => {
    cleanup();
  });

  it("provides 5 supported languages and defaults to Vietnamese", () => {
    expect(LANGUAGES).toHaveLength(5);
    const codes = LANGUAGES.map((l) => l.code);
    expect(codes).toEqual(["vi", "en", "ja", "ko", "zh"]);

    render(
      <LanguageProvider>
        <TestConsumer />
      </LanguageProvider>
    );

    expect(screen.getByTestId("current-lang").textContent).toBe("vi");
    expect(screen.getByTestId("translated-home").textContent).toBe("Trang chủ");
  });

  it("switches language and updates html document attribute and localStorage", () => {
    render(
      <LanguageProvider>
        <TestConsumer />
      </LanguageProvider>
    );

    fireEvent.click(screen.getByText("Switch to EN"));
    expect(screen.getByTestId("current-lang").textContent).toBe("en");
    expect(screen.getByTestId("translated-home").textContent).toBe("Home");
    expect(localStorage.getItem("ailss-language")).toBe("en");
    expect(document.documentElement.lang).toBe("en");

    fireEvent.click(screen.getByText("Switch to JA"));
    expect(screen.getByTestId("current-lang").textContent).toBe("ja");
    expect(screen.getByTestId("translated-home").textContent).toBe("ホーム");
    expect(localStorage.getItem("ailss-language")).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("renders LanguageSwitcher menu button and opens dropdown with options", () => {
    render(
      <LanguageProvider>
        <TestConsumer />
      </LanguageProvider>
    );

    const switcherBtn = screen.getByRole("button", { name: /Ngôn ngữ:/i });
    expect(switcherBtn).toBeDefined();

    fireEvent.click(switcherBtn);
    expect(screen.getByText("English")).toBeDefined();
    expect(screen.getByText("日本語")).toBeDefined();
    expect(screen.getByText("한국어")).toBeDefined();
    expect(screen.getByText("中文")).toBeDefined();

    // Selecting a language from dropdown
    fireEvent.click(screen.getByText("English"));
    expect(screen.getByTestId("current-lang").textContent).toBe("en");
  });

  it("translates direct Vietnamese phrases and workspace tab keys across languages", () => {
    function AdvancedConsumer() {
      const { setLanguage, t } = useLanguage();
      return (
        <div>
          <span data-testid="t-courses">{t("Khóa học")}</span>
          <span data-testid="t-overview">{t("tab.overview")}</span>
          <span data-testid="t-help">{t("Trợ giúp")}</span>
          <span data-testid="t-ai-learning">{t("Học cùng AI")}</span>
          <span data-testid="t-explore">{t("Khám phá khóa học")}</span>
          <button onClick={() => setLanguage("en")}>To EN</button>
          <button onClick={() => setLanguage("ja")}>To JA</button>
          <button onClick={() => setLanguage("ko")}>To KO</button>
          <button onClick={() => setLanguage("zh")}>To ZH</button>
          <button onClick={() => setLanguage("vi")}>To VI</button>
        </div>
      );
    }

    render(
      <LanguageProvider>
        <AdvancedConsumer />
      </LanguageProvider>
    );

    // Initial Vietnamese
    expect(screen.getByTestId("t-courses").textContent).toBe("Khóa học");
    expect(screen.getByTestId("t-overview").textContent).toBe("Tổng quan");
    expect(screen.getByTestId("t-help").textContent).toBe("Trợ giúp");
    expect(screen.getByTestId("t-ai-learning").textContent).toBe("Học cùng AI");

    // English
    fireEvent.click(screen.getByText("To EN"));
    expect(screen.getByTestId("t-courses").textContent).toBe("Courses");
    expect(screen.getByTestId("t-overview").textContent).toBe("Overview");
    expect(screen.getByTestId("t-help").textContent).toBe("Help");
    expect(screen.getByTestId("t-ai-learning").textContent).toBe("AI Learning");
    expect(screen.getByTestId("t-explore").textContent).toBe("Explore Courses");

    // Japanese
    fireEvent.click(screen.getByText("To JA"));
    expect(screen.getByTestId("t-courses").textContent).toBe("コース");
    expect(screen.getByTestId("t-overview").textContent).toBe("概要");
    expect(screen.getByTestId("t-help").textContent).toBe("ヘルプ");

    // Korean
    fireEvent.click(screen.getByText("To KO"));
    expect(screen.getByTestId("t-courses").textContent).toBe("강좌");
    expect(screen.getByTestId("t-overview").textContent).toBe("개요");
    expect(screen.getByTestId("t-help").textContent).toBe("도움말");

    // Chinese
    fireEvent.click(screen.getByText("To ZH"));
    expect(screen.getByTestId("t-courses").textContent).toBe("课程");
    expect(screen.getByTestId("t-overview").textContent).toBe("总览");
    expect(screen.getByTestId("t-help").textContent).toBe("帮助中心");

    // Back to Vietnamese
    fireEvent.click(screen.getByText("To VI"));
    expect(screen.getByTestId("t-courses").textContent).toBe("Khóa học");
    expect(screen.getByTestId("t-overview").textContent).toBe("Tổng quan");
    expect(screen.getByTestId("t-help").textContent).toBe("Trợ giúp");
  });
});

