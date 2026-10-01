import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import {
  SessionProvider,
  useSession,
  safeReturnTo,
  postLoginDestination,
  roleLabel,
  sessionRequest,
  type Profile,
} from "../src/auth/session";
const profile = {
  userId: "fixture",
  displayName: "Test",
  emailMasked: "t***@example.com",
  role: "STUDENT",
  status: "ACTIVE",
  lecturerVerified: false,
} as Profile;
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const fail = (status: number, code: string) => ({
  ok: false,
  status,
  json: async () => ({ error: { code } }),
});
function Probe() {
  const s = useSession();
  return (
    <>
      <p data-testid="state">{s.state}</p>
      <p>{s.profile?.displayName}</p>
      <p data-testid="message">{s.message}</p>
      <button onClick={() => void s.bootstrap()}>retry</button>
      <button
        onClick={() =>
          void s.login({ email: "test@example.com", password: "fixture-password" }).catch(() => {})
        }
      >
        login
      </button>
      <button onClick={() => void s.socialLogin("google", "fixture-id-token").catch(() => {})}>google</button>
      <button onClick={() => void s.logout().catch(() => {})}>logout</button>
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("session authority", () => {
  it("allows SMTP delivery time for an OTP request and keeps other requests bounded", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ accepted: true })));
    await sessionRequest("auth/password-reset/request", "POST", { email: "test@example.invalid" });
    expect(timeout).toHaveBeenLastCalledWith(55_000);
    await sessionRequest("auth/password-reset/verify", "POST", { code: "123456" });
    expect(timeout).toHaveBeenLastCalledWith(20_000);
  });
  it("uses the backend role and keeps return paths within that role's workspace", () => {
    const lecturer = { ...profile, role: "LECTURER" as const, lecturerVerified: true };
    const admin = { ...profile, role: "ADMIN" as const };
    expect(postLoginDestination(profile, null)).toBe("/app");
    expect(postLoginDestination(lecturer, null)).toBe("/app/teaching");
    expect(postLoginDestination(admin, null)).toBe("/app/admin");
    expect(postLoginDestination({ ...lecturer, lecturerVerified: false }, null)).toBe("/app");
    expect(postLoginDestination(profile, "/app/classes")).toBe("/app/classes");
    expect(postLoginDestination(profile, "/app/admin/users")).toBe("/app");
    expect(postLoginDestination(lecturer, "/app/learn")).toBe("/app/teaching");
    expect(postLoginDestination(admin, "/auth/login")).toBe("/app/admin");
    expect(postLoginDestination(admin, "https://evil.test")).toBe("/app/admin");
    expect(postLoginDestination(lecturer, "/app/account")).toBe("/app/account");
  });

  it("does not revive a pending Google login after logout", async () => {
    let finishLogin: (value: unknown) => void = () => {};
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(fail(401, "SESSION_EXPIRED"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLogin = resolve;
          }),
      )
      .mockResolvedValueOnce(ok({ loggedOut: true }));
    vi.stubGlobal("fetch", fetch);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("UNAUTHENTICATED");
    fireEvent.click(screen.getByText("google"));
    fireEvent.click(screen.getByText("logout"));
    await screen.findByText("Đã đăng xuất và thu hồi phiên hiện tại.");
    await act(async () => {
      finishLogin(ok(profile));
    });
    expect(screen.getByTestId("state").textContent).toBe("UNAUTHENTICATED");
    expect(screen.queryByText("Test")).toBeNull();
  });

  it("does not let Google popup focus replace a pending social login with anonymous bootstrap", async () => {
    let finishLogin: (value: unknown) => void = () => {};
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(fail(401, "SESSION_EXPIRED"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishLogin = resolve;
          }),
      )
      .mockResolvedValue(fail(401, "SESSION_EXPIRED"));
    vi.stubGlobal("fetch", fetch);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("UNAUTHENTICATED");
    fireEvent.click(screen.getByText("google"));
    fireEvent(window, new Event("focus"));
    await act(async () => {
      finishLogin(ok(profile));
    });
    await screen.findByText("Test");
    expect(screen.getByTestId("state").textContent).toBe("AUTHENTICATED");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects unsafe and encoded return paths", () => {
    for (const v of [
      null,
      "https://evil.test",
      "//evil.test",
      "javascript:alert(1)",
      "data:text/html,test",
      "%2f%2fevil.test",
      "/app%2f..",
      "/app/../admin",
      "/app\\evil",
      "/app\n",
    ])
      expect(safeReturnTo(v)).toBe("/app");
    expect(safeReturnTo("/app/account")).toBe("/app/account");
  });
  it("distinguishes lecturer verification and supported roles", () => {
    expect(roleLabel({ ...profile, role: "LECTURER" })).toContain("Chưa xác minh");
    expect(roleLabel({ ...profile, role: "LECTURER", lecturerVerified: true })).toContain("đã xác minh");
    expect(roleLabel({ ...profile, role: "ADMIN" })).toBe("Quản trị viên");
  });
  it("bootstraps canonical profile without storing credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(ok(profile));
    vi.stubGlobal("fetch", fetch);
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("Test");
    expect(screen.getByTestId("state").textContent).toBe("AUTHENTICATED");
    expect(storage).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1].cache).toBe("no-store");
  });
  it("login error then success and logout", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(fail(401, "SESSION_EXPIRED"))
      .mockResolvedValueOnce(fail(401, "INVALID_CREDENTIALS"))
      .mockResolvedValueOnce(ok(profile))
      .mockResolvedValueOnce(ok({ loggedOut: true }));
    vi.stubGlobal("fetch", fetch);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("UNAUTHENTICATED");
    expect(screen.getByTestId("message").textContent).toBe("");
    fireEvent.click(screen.getByText("login"));
    await screen.findByText(/Email hoặc mật khẩu chưa đúng/);
    fireEvent.click(screen.getByText("login"));
    await screen.findByText("Test");
    fireEvent.click(screen.getByText("logout"));
    await screen.findByText("UNAUTHENTICATED");
    expect(screen.queryByText("Test")).toBeNull();
  });
  it("suppresses 401 notification on initial bootstrap but alerts on authenticated refresh failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(ok(profile))
      .mockResolvedValueOnce(fail(401, "SESSION_EXPIRED"));
    vi.stubGlobal("fetch", fetch);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("Test");
    expect(screen.getByTestId("state").textContent).toBe("AUTHENTICATED");
    expect(screen.getByTestId("message").textContent).toBe("");

    fireEvent.click(screen.getByText("retry"));
    await screen.findByText("UNAUTHENTICATED");
    expect(screen.queryByText("Test")).toBeNull();
    expect(screen.getByTestId("message").textContent).toBe(
      "Phiên đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại.",
    );
  });
  it("keeps initial bootstrap 401 silent without expired banner", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(fail(401, "SESSION_EXPIRED"));
    vi.stubGlobal("fetch", fetch);
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("UNAUTHENTICATED");
    expect(screen.getByTestId("message").textContent).toBe("");
  });
  it("outage hides stale private profile and retry restores", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok(profile))
        .mockResolvedValueOnce(fail(503, "GATEWAY_UNAVAILABLE"))
        .mockResolvedValueOnce(ok(profile)),
    );
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("Test");
    fireEvent.click(screen.getByText("retry"));
    await screen.findByText("UNAVAILABLE");
    expect(screen.queryByText("Test")).toBeNull();
    fireEvent.click(screen.getByText("retry"));
    await screen.findByText("Test");
  });
  it("expired session clears data; late bootstrap cannot resurrect logout", async () => {
    let resolve: (v: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok(profile))
        .mockImplementationOnce(() => new Promise((r) => (resolve = r)))
        .mockResolvedValueOnce(ok({ loggedOut: true })),
    );
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("Test");
    fireEvent.click(screen.getByText("retry"));
    fireEvent.click(screen.getByText("logout"));
    await screen.findByText("UNAUTHENTICATED");
    resolve(ok(profile));
    await waitFor(() => expect(screen.queryByText("Test")).toBeNull());
  });
});
