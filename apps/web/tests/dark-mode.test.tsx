import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { initDarkMode, toggleDarkMode, useDarkMode } from "../src/lib/darkMode";

describe("Dark Mode System", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("initializes with light mode by default and applies attribute", () => {
    initDarkMode();
    const theme = document.documentElement.getAttribute("data-theme");
    expect(theme === "light" || theme === "dark").toBe(true);
  });

  it("toggles dark mode and updates localStorage and document attribute", () => {
    document.documentElement.setAttribute("data-theme", "light");
    toggleDarkMode();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("ailss-theme")).toBe("dark");

    toggleDarkMode();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("ailss-theme")).toBe("light");
  });

  it("useDarkMode hook reacts to toggle calls", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const { result } = renderHook(() => useDarkMode());

    expect(result.current.theme).toBe("light");
    expect(result.current.isDark).toBe(false);

    act(() => {
      result.current.toggle();
    });

    expect(result.current.theme).toBe("dark");
    expect(result.current.isDark).toBe(true);
  });
});
