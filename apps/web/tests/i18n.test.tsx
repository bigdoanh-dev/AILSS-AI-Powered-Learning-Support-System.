import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { LanguageProvider, useLanguage, useUiText, LANGUAGES, TRANSLATIONS } from "../src/lib/i18n";
import { LanguageSwitcher } from "../src/components/LanguageSwitcher";

function Consumer() {
  const { setLanguage, t } = useLanguage();
  const uiText = useUiText();
  const [name, setName] = useState("Khóa học");
  return (
    <>
      <h1>{t("nav.home")}</h1>
      <button onClick={() => setLanguage("en")}>To EN</button>
      <button onClick={() => setLanguage("vi")}>To VI</button>
      <label>
        {uiText("Họ và tên")}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={uiText("Nhập email")} />
      </label>
      <p data-testid="course">Khóa học</p>
      <p data-testid="name">{name}</p>
      <LanguageSwitcher />
    </>
  );
}
const mount = () =>
  render(
    <LanguageProvider>
      <Consumer />
    </LanguageProvider>,
  );
describe("Vietnamese / English interface", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "vi";
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("exposes exactly two languages with keyed translation parity", () => {
    expect(LANGUAGES.map((o) => o.code)).toEqual(["vi", "en"]);
    expect(Object.keys(TRANSLATIONS.en).sort()).toEqual(Object.keys(TRANSLATIONS.vi).sort());
    expect(Object.values(TRANSLATIONS.en).every((v) => v.length > 0)).toBe(true);
    mount();
    expect(screen.getByRole("heading", { name: "Trang chủ" })).toBeDefined();
  });
  it("updates React labels, placeholders, html language and saved preference", () => {
    mount();
    fireEvent.click(screen.getByText("To EN"));
    expect(screen.getByRole("heading", { name: "Home" })).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Full name" }).getAttribute("placeholder")).toBe(
      "Enter your email",
    );
    expect(localStorage.getItem("ailss-language")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    fireEvent.click(screen.getByText("To VI"));
    expect(screen.getByRole("textbox", { name: "Họ và tên" })).toBeDefined();
  });
  it("does not mutate course titles or reset form state", () => {
    mount();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Tên của tôi" } });
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByText("To EN"));
      expect(screen.getByTestId("course").textContent).toBe("Khóa học");
      expect(screen.getByTestId("name").textContent).toBe("Tên của tôi");
      fireEvent.click(screen.getByText("To VI"));
    }
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Tên của tôi");
  });
  it.each(["ja", "ko", "zh", "invalid"])("migrates old preference %s to Vietnamese", (value) => {
    localStorage.setItem("ailss-language", value);
    mount();
    expect(localStorage.getItem("ailss-language")).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
  });
  it("restores English and synchronizes cross-tab changes", () => {
    localStorage.setItem("ailss-language", "en");
    mount();
    expect(screen.getByRole("heading", { name: "Home" })).toBeDefined();
    fireEvent(window, new StorageEvent("storage", { key: "ailss-language", newValue: "vi" }));
    expect(screen.getByRole("heading", { name: "Trang chủ" })).toBeDefined();
  });
  it("works when browser storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mount();
    fireEvent.click(screen.getByText("To EN"));
    expect(document.documentElement.lang).toBe("en");
  });
  it("supports keyboard selection and Escape", () => {
    mount();
    const trigger = screen.getByRole("button", { name: /Ngôn ngữ:/ });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(document.activeElement).toBe(options[0]);
    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
    fireEvent.keyDown(options[1], { key: "Enter" });
    expect(document.documentElement.lang).toBe("en");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
