import { useHydrated } from "../lib/hydration";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { sessionRequest, useSession } from "../auth/session";

type Theme = "light" | "dark";
const ThemeContext = createContext({ theme: "light" as Theme, toggle: () => {} });
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ailss-theme");
      setTheme(
        saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
          ? "dark"
          : "light",
      );
    } catch {
      /* The page remains usable when browser storage is disabled. */
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.lang = "vi";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#11272e" : "#ffffff");
  }, [theme]);
  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try {
      localStorage.setItem("ailss-theme", next);
    } catch {
      /* Optional preference storage. */
    }
  }
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
export function ThemeToggle() {
  const { theme: currentTheme, toggle } = useContext(ThemeContext);
  const theme = useHydrated() ? currentTheme : "light";
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggle}
      aria-label={theme === "light" ? "Bật chế độ tối" : "Bật chế độ sáng"}
      title={theme === "light" ? "Chế độ tối" : "Chế độ sáng"}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        {theme === "light" ? (
          <path d="M20 15.6A8.6 8.6 0 0 1 8.4 4 8.6 8.6 0 1 0 20 15.6Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          </>
        )}
      </svg>
    </button>
  );
}

const AvatarContext = createContext<{ url: string | null; reload: () => void }>({
  url: null,
  reload: () => {},
});
export function AvatarProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  const id = profile?.userId;
  const [image, setImage] = useState<{ id?: string; url: string | null }>({ url: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    if (id)
      void sessionRequest<{ dataUrl: string | null }>("avatar")
        .then((x) => {
          if (live) setImage({ id, url: x.dataUrl });
        })
        .catch(() => {
          if (live) setImage({ id, url: null });
        });
    return () => {
      live = false;
    };
  }, [id, revision]);
  return (
    <AvatarContext.Provider
      value={{ url: image.id === id ? image.url : null, reload: () => setRevision((r) => r + 1) }}
    >
      {children}
    </AvatarContext.Provider>
  );
}
export const useAvatar = () => useContext(AvatarContext);
export function Avatar({ large = false }: { large?: boolean }) {
  const { url } = useAvatar();
  const { profile } = useSession();
  return (
    <span className={`user-avatar ${large ? "large" : ""}`} aria-hidden="true">
      {url ? (
        <img src={url} alt="" width={large ? 96 : 38} height={large ? 96 : 38} />
      ) : (
        profile?.displayName.trim().split(/\s+/).slice(-1)[0]?.slice(0, 1).toUpperCase() || "A"
      )}
    </span>
  );
}
