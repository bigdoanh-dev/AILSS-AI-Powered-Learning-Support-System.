import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SessionProvider, useSession, safeReturnTo, roleLabel, type Profile } from "../src/auth/session";
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
      <p>{s.message}</p>
      <button onClick={() => void s.bootstrap()}>retry</button>
      <button
        onClick={() =>
          void s.login({ email: "test@example.com", password: "fixture-password" }).catch(() => {})
        }
      >
        login
      </button>
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
    fireEvent.click(screen.getByText("login"));
    await screen.findByText(/Email hoặc mật khẩu chưa đúng/);
    fireEvent.click(screen.getByText("login"));
    await screen.findByText("Test");
    fireEvent.click(screen.getByText("logout"));
    await screen.findByText("UNAUTHENTICATED");
    expect(screen.queryByText("Test")).toBeNull();
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
