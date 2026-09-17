import { useEffect, useState } from "react";

const STORAGE_KEY = "ailss-theme";
type Theme = "dark" | "light";

function getSystemPreference(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getSavedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch { return null; }
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

/** Gọi trong main.tsx trước render để tránh FOWT. */
export function initDarkMode() {
  const theme = getSavedTheme() ?? getSystemPreference();
  applyTheme(theme);
}

export function toggleDarkMode() {
  const current = document.documentElement.getAttribute("data-theme") as Theme | null;
  const next: Theme = current === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("ailss-theme-change", { detail: next }));
}

/** React hook để đọc và toggle dark mode. */
export function useDarkMode() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === "undefined") return "light";
    return (document.documentElement.getAttribute("data-theme") as Theme) ?? "light";
  });

  useEffect(() => {
    const handleChange = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("ailss-theme-change", handleChange);

    if (typeof window.matchMedia === "function") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const handleSystem = (e: MediaQueryListEvent) => {
        if (!getSavedTheme()) {
          const next: Theme = e.matches ? "dark" : "light";
          applyTheme(next);
          setTheme(next);
        }
      };
      mql.addEventListener("change", handleSystem);
      return () => {
        window.removeEventListener("ailss-theme-change", handleChange);
        mql.removeEventListener("change", handleSystem);
      };
    }

    return () => {
      window.removeEventListener("ailss-theme-change", handleChange);
    };
  }, []);

  return { theme, isDark: theme === "dark", toggle: toggleDarkMode };
}
