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
      "/auth/register/lecturer/status",
      "/app/admin/lecturer-applications",
    ].includes(value)
  )
    return value;
  if (/^\/app\/(?:teaching|admin)(?:\/[a-zA-Z0-9-]+)*$/.test(value)) return value;
  const id = "[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}";
  if (
    new RegExp(
      `^/app/(?:learn(?:/${id}(?:/lessons/${id})?)?|classes(?:/${id})?|assessments(?:/${id})?|attempts/${id}(?:/result)?|progress|notifications|resources)$`,
    ).test(value)
  )
    return value;
  return /^\/app(?:\/account)?(?:\?[a-zA-Z0-9=&_-]*)?$/.test(value) ? value : "/app";
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
    signal: AbortSignal.timeout(20000),
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
  login: (body: unknown) => Promise<void>;
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
  const currentState = useRef(state);
  currentState.current = state;
  function failure(error: unknown, bootstrap = false) {
    setProfile(null);
    const expired = error instanceof ApiError && error.status === 401;
    setState(expired ? "UNAUTHENTICATED" : "UNAVAILABLE");
    setMessage(
      expired
        ? bootstrap
          ? ""
          : "Phiên đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại."
        : errorMessage(error),
    );
  }
  async function bootstrap() {
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
    try {
      const p = await sessionRequest<Profile>("login", "POST", body);
      if (id !== epoch.current) return;
      setProfile(p);
      setState("AUTHENTICATED");
      setMessage("");
    } catch (e) {
      if (id === epoch.current) {
        failure(e, true);
        if (e instanceof ApiError && e.status === 401)
          setMessage("Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra lại.");
      }
      throw e;
    }
  }
  async function logout() {
    const id = ++epoch.current;
    setProfile(null);
    setState("REFRESHING");
    try {
      await sessionRequest("logout", "POST");
      if (id !== epoch.current) return;
      setState("UNAUTHENTICATED");
      setMessage("Đã đăng xuất và thu hồi phiên hiện tại.");
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
    <Context.Provider value={{ state, profile, message, bootstrap, login, logout, update, password }}>
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("SessionProvider required");
  return value;
}
