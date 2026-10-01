import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Auth } from "../src/pages/Support";
import { SessionProvider, useSession, type Profile } from "../src/auth/session";

const sdk = vi.hoisted(() => ({ credential: vi.fn<(token: string) => void>(), mount: vi.fn() }));
vi.mock("../src/auth/social", () => ({
  mountGoogleSignInButton: sdk.mount,
  prepareAppleSignIn: vi.fn(),
  requestAppleIdToken: vi.fn(),
}));

const baseProfile = {
  userId: "fixture-user",
  displayName: "Test User",
  emailMasked: "t***@example.invalid",
  status: "ACTIVE",
  lecturerVerified: true,
} as Profile;
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const anonymous = () => ({
  ok: false,
  status: 401,
  json: async () => ({ error: { code: "SESSION_EXPIRED" } }),
});

function Workspace({ name }: { name: string }) {
  const session = useSession();
  return (
    <p>
      {name}: {session.state}: {session.profile?.displayName}
    </p>
  );
}
function show(path = "/auth/login") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <Routes>
          <Route path="/auth/login" element={<Auth />} />
          <Route path="/auth/forgot-password" element={<Auth />} />
          <Route path="/app" element={<Workspace name="student" />} />
          <Route path="/app/teaching" element={<Workspace name="lecturer" />} />
          <Route path="/app/admin" element={<Workspace name="admin" />} />
          <Route path="/app/classes" element={<Workspace name="classes" />} />
          <Route path="/auth/result" element={<p>Unexpected result page</p>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("login to the role workspace", () => {
  it("opens the OTP recovery form from the login link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url === "/web-session/config" ? ok({ googleClientId: "", appleClientId: "" }) : anonymous(),
        ),
      ),
    );
    show();
    fireEvent.click(await screen.findByRole("link", { name: "Quên mật khẩu?" }));
    await screen.findByLabelText("Email đăng ký");
    expect(screen.getByRole("button", { name: "Gửi mã OTP" })).toBeTruthy();
    expect(screen.queryByText(/Hệ thống chưa hỗ trợ gửi email/)).toBeNull();
  });
  it.each([
    ["STUDENT", "student"],
    ["LECTURER", "lecturer"],
    ["ADMIN", "admin"],
  ] as const)("opens the %s workspace after Google succeeds despite popup focus", async (role, name) => {
    let finishLogin: (value: unknown) => void = () => {};
    const fetcher = vi.fn((url: string) => {
      if (url === "/web-session/config")
        return Promise.resolve(ok({ googleClientId: "test-client", appleClientId: "" }));
      if (url === "/web-session/auth/social/google")
        return new Promise((resolve) => {
          finishLogin = resolve;
        });
      return Promise.resolve(anonymous());
    });
    vi.stubGlobal("fetch", fetcher);
    sdk.mount.mockImplementation(async (_element, _id, callback) => {
      sdk.credential = callback;
    });
    show();
    await waitFor(() => expect(sdk.mount).toHaveBeenCalledOnce());
    await act(async () => {
      sdk.credential("test-id-token");
    });
    fireEvent(window, new Event("focus"));
    await act(async () => {
      finishLogin(ok({ ...baseProfile, role }));
    });
    await screen.findByText(`${name}: AUTHENTICATED: Test User`);
    expect(screen.queryByText("Unexpected result page")).toBeNull();
    expect(fetcher.mock.calls.filter(([url]) => url === "/web-session/bootstrap")).toHaveLength(1);
  });

  it("leaves login automatically when a session already exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          ok(
            url === "/web-session/config"
              ? { googleClientId: "", appleClientId: "" }
              : { ...baseProfile, role: "ADMIN" },
          ),
        ),
      ),
    );
    show();
    await screen.findByText("admin: AUTHENTICATED: Test User");
  });

  it("keeps an allowed student return path after password login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url === "/web-session/login"
            ? ok({ ...baseProfile, role: "STUDENT" })
            : url === "/web-session/config"
              ? ok({ googleClientId: "", appleClientId: "" })
              : anonymous(),
        ),
      ),
    );
    show("/auth/login?returnTo=%2Fapp%2Fclasses");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "test-password-fixture" } });
    fireEvent.submit(screen.getByLabelText("Email").closest("form")!);
    await screen.findByText("classes: AUTHENTICATED: Test User");
  });
});
