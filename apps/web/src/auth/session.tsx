import { useHydrated } from "../lib/hydration";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, errorMessage } from "../lib/api";
export interface Profile {
  userId: string;
  displayName: string;
  emailMasked: string;
  role: "STUDENT" | "LECTURER" | "ADMIN";
  status: string;
  lecturerVerified: boolean;
  profileVersion: number;
  createdAt: string;
  updatedAt: string;
}
export type State = "BOOTSTRAPPING" | "UNAUTHENTICATED" | "AUTHENTICATED" | "REFRESHING" | "UNAVAILABLE";
export function safeReturnTo(value: string | null): string {
  if (!value || /[%\\\s]/u.test(value)) return "/app";
  if (
    [
      "/auth/register/lecturer",
      "/auth/register/lecturer/application",
      "/auth/register/lecturer/status",
      "/app/admin/lecturer-applications",
    ].includes(value)
  )
    return value;
  if (/^\/app\/(?:teaching|admin)(?:\/[a-zA-Z0-9-]+)*$/.test(value)) return value;
  const id = "[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}";
  if (new RegExp(`^/app/purchase/${id}(?:\\?order=${id})?$`).test(value)) return value;
  if (
    new RegExp(
      `^/app/(?:purchase/${id}|learn(?:/${id}(?:/lessons/${id})?)?|classes(?:/${id})?|assessments(?:/${id})?|attempts/${id}(?:/result)?|schedule|attendance|progress|notifications|resources)$`,
    ).test(value)
  )
    return value;
  return /^\/app(?:\/account)?(?:\?[a-zA-Z0-9=&_-]*)?$/.test(value) ? value : "/app";
}
export function postLoginDestination(profile: Profile, returnTo: string | null): string {
  const home =
    profile.role === "ADMIN"
      ? "/app/admin"
      : profile.role === "LECTURER" && profile.lecturerVerified
        ? "/app/teaching"
        : "/app";
  const target = safeReturnTo(returnTo);
  if (target === "/app") return home;
  if (/^\/app\/admin(?:\/|$)/.test(target) && profile.role !== "ADMIN") return home;
  if (/^\/app\/teaching(?:\/|$)/.test(target) && (profile.role !== "LECTURER" || !profile.lecturerVerified))
    return home;
  if (
    /^\/app\/(?:learn|purchase|classes|schedule|attendance|progress|assessments|attempts|resources)(?:\/|\?|$)/.test(
      target,
    ) &&
    profile.role !== "STUDENT"
  )
    return home;
  return target;
}
export function roleLabel(p: Profile) {
  if (p.role === "LECTURER")
    return p.lecturerVerified ? "Giảng viên đã xác minh" : "Giảng viên · Chưa xác minh";
  return p.role === "ADMIN"
    ? "Quản trị viên"
    : p.role === "STUDENT"
      ? "Sinh viên"
      : "Vai trò chưa được hỗ trợ";
}
export async function sessionRequest<T>(
  route: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await fetch(`/web-session/${route}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(route === "auth/password-reset/request" ? 55000 : 20000),
    headers: {
      Accept: "application/json",
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new ApiError(response.status, result.error?.code || `HTTP_${response.status}`);
  return result.data;
}
interface Authority {
  state: State;
  profile: Profile | null;
  message: string;
  bootstrap: () => Promise<void>;
  login: (body: unknown) => Promise<Profile>;
  socialLogin: (
    provider: "google" | "apple",
    idToken: string,
    clientProfile?: { firstName?: string; lastName?: string },
  ) => Promise<Profile>;
  logout: () => Promise<void>;
  update: (name: string, key: string) => Promise<void>;
  password: (body: unknown, key: string) => Promise<void>;
}
const Context = createContext<Authority | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>("BOOTSTRAPPING");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState("");
  const epoch = useRef(0);
  const pendingLogin = useRef<number | null>(null);
  const currentState = useRef(state);
  currentState.current = state;
  function failure(error: unknown, isInitialBootstrap = false) {
    setProfile(null);
    const expired = error instanceof ApiError && error.status === 401;
    setState(expired ? "UNAUTHENTICATED" : "UNAVAILABLE");
    setMessage(
      expired
        ? isInitialBootstrap
          ? ""
          : "Phiên đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại."
        : errorMessage(error),
    );
  }
  async function bootstrap() {
    // Closing the Google popup fires focus before its login response arrives.
    // An anonymous bootstrap must not supersede that explicit authentication.
    if (pendingLogin.current !== null) return;
    const id = ++epoch.current;
    const initial = currentState.current === "BOOTSTRAPPING";
    setState(currentState.current === "AUTHENTICATED" ? "REFRESHING" : "BOOTSTRAPPING");
    try {
      const p = await sessionRequest<Profile>("bootstrap");
      if (id !== epoch.current) return;
      setProfile(p);
      setState("AUTHENTICATED");
      setMessage("");
    } catch (e) {
      if (id === epoch.current) failure(e, initial);
    }
  }
  useEffect(() => {
    void bootstrap();
    const sync = () => {
      if (document.visibilityState === "visible") void bootstrap();
    };
    const invalidate = () => {
      ++epoch.current;
      setProfile(null);
      setState("UNAUTHENTICATED");
      setMessage("Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại.");
    };
    window.addEventListener("ailss-session-invalid", invalidate);
    window.addEventListener("focus", sync);
    return () => {
      ++epoch.current;
      window.removeEventListener("focus", sync);
      window.removeEventListener("ailss-session-invalid", invalidate);
    };
  }, []);
  async function login(body: unknown) {
    const id = ++epoch.current;
    pendingLogin.current = id;
    try {
      const p = await sessionRequest<Profile>("login", "POST", body);
      if (id !== epoch.current) throw new ApiError(409, "SESSION_CHANGED");
      setProfile(p);
      setState("AUTHENTICATED");
      setMessage("");
      return p;
    } catch (e) {
      if (id === epoch.current) {
        failure(e, true);
        if (e instanceof ApiError && e.status === 401)
          setMessage("Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.");
      }
      throw e;
    } finally {
      if (pendingLogin.current === id) pendingLogin.current = null;
    }
  }
  async function socialLogin(
    provider: "google" | "apple",
    idToken: string,
    clientProfile?: { firstName?: string; lastName?: string },
  ) {
    const id = ++epoch.current;
    pendingLogin.current = id;
    try {
      const p = await sessionRequest<Profile>(`auth/social/${provider}`, "POST", {
        idToken,
        ...(clientProfile ? { clientProfile } : {}),
      });
      if (id !== epoch.current) throw new ApiError(409, "SESSION_CHANGED");
      setProfile(p);
      setState("AUTHENTICATED");
      setMessage("");
      return p;
    } catch (e) {
      if (id === epoch.current) failure(e, true);
      throw e;
    } finally {
      if (pendingLogin.current === id) pendingLogin.current = null;
    }
  }
  async function logout() {
    const id = ++epoch.current;
    try {
      await sessionRequest("logout", "POST");
      if (id !== epoch.current) return;
      window.setTimeout(() => {
        if (id !== epoch.current) return;
        setProfile(null);
        setState("UNAUTHENTICATED");
        setMessage("Đã đăng xuất và thu hồi phiên hiện tại.");
      }, 0);
    } catch (e) {
      if (id !== epoch.current) throw e;
      failure(e);
      setMessage("Chưa xác nhận được việc thu hồi phiên. Hãy thử đăng xuất lại. " + errorMessage(e));
      throw e;
    }
  }
  async function update(name: string, key: string) {
    const id = ++epoch.current;
    try {
      const p = await sessionRequest<Profile>("profile", "PATCH", { displayName: name }, key);
      if (id === epoch.current) setProfile(p);
    } catch (e) {
      if (
        id === epoch.current &&
        (!(e instanceof ApiError) || e.status === 401 || e.status === 403 || e.status >= 500)
      )
        failure(e);
      throw e;
    }
  }
  async function password(body: unknown, key: string) {
    const id = ++epoch.current;
    try {
      await sessionRequest("password", "POST", body, key);
      if (id !== epoch.current) return;
      setProfile(null);
      setState("UNAUTHENTICATED");
      setMessage("Đã đổi mật khẩu. Vui lòng đăng nhập lại.");
    } catch (e) {
      if (id !== epoch.current) throw e;
      if (
        !(e instanceof ApiError) ||
        (e.status === 401 && e.code !== "INVALID_REAUTHENTICATION") ||
        e.status === 403 ||
        e.status >= 500
      )
        failure(e);
      throw e;
    }
  }
  return (
    <Context.Provider
      value={{ state, profile, message, bootstrap, login, socialLogin, logout, update, password }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  const hydrated = useHydrated();
  if (!value) throw new Error("SessionProvider required");
  // A lazy route may hydrate after bootstrap has resolved in its parent provider.
  // Its first render must still match the server's unauthenticated loading snapshot.
  return hydrated ? value : { ...value, state: "BOOTSTRAPPING" as State, profile: null, message: "" };
}
