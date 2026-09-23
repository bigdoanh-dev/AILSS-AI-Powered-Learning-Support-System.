import { describe, it, expect, vi } from "vitest";
import { Transport, ApiError, profile, type Fetcher } from "../src/api";
import { configuration } from "../src/config";
import { Session, type SessionLifecycle, type Vault } from "../src/session";
import { destinations } from "../src/navigation";
import { getFeaturesForRole, phase41RouteAvailable } from "../src/features";
const user = {
  userId: "u",
  displayName: "Test",
  emailMasked: "t***@test.invalid",
  role: "STUDENT" as const,
  status: "ACTIVE",
};
const credential = { accessToken: "a", refreshToken: "r", sessionId: "s" };
function harness(handler?: (path: string) => Promise<unknown>) {
  let saved: string | null = null;
  const vault: Vault = {
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
    clear: async () => {
      saved = null;
    },
  };
  const api = new Transport("http://localhost");
  vi.spyOn(api, "request").mockImplementation(async (path) =>
    handler ? handler(path) : path === "/api/v1/me" ? user : credential,
  );
  const session = new Session(api, vault);
  return { session, api, vault, saved: () => saved };
}
describe("configuration", () => {
  it("requires explicit origin/environment and production HTTPS", () => {
    for (const [env, origin] of [
      [undefined, undefined],
      ["dev", "https://api.example.org"],
      ["production", "http://api.example.org"],
      ["production", "https://localhost"],
      ["development", "https://x:y@api.example.org"],
      ["development", "https://api.example.org/path"],
    ])
      expect(() => configuration(env, origin)).toThrow();
    expect(configuration("research", "http://10.0.2.2:8080").origin).toBe("http://10.0.2.2:8080");
  });
});
describe("Phase 41 route scope", () => {
  it("keeps Lecturer/Admin routes unreachable, including direct navigation and home", () => {
    for (const path of ["/admin", "/admin/users", "/teaching", "/teaching/classes/1"])
      expect(phase41RouteAvailable(path, "ADMIN")).toBe(false);
    expect(phase41RouteAvailable("/", "LECTURER")).toBe(false);
    expect(getFeaturesForRole("ADMIN")).toEqual([]);
    expect(getFeaturesForRole("LECTURER")).toEqual([]);
  });
  it("preserves the Student and guest learning paths", () => {
    expect(phase41RouteAvailable("/student", "STUDENT")).toBe(true);
    expect(phase41RouteAvailable("/", "STUDENT")).toBe(true);
    expect(phase41RouteAvailable("/courses", undefined)).toBe(true);
  });
});
describe("transport", () => {
  it.each([401, 403, 404, 409, 422, 429, 500])("normalizes %i without leaking response", async (status) => {
    const request = vi
      .fn<Fetcher>()
      .mockResolvedValue(
        new Response("secret internals", { status, headers: { "x-request-id": "request-1" } }),
      );
    await expect(
      new Transport("https://api.example.org", request).request("/api/v1/me"),
    ).rejects.toMatchObject({ status, requestId: "request-1" });
  });
  it("rejects malformed data and non-Gateway paths", async () => {
    const transport = new Transport(
      "https://api.example.org",
      vi.fn<Fetcher>().mockResolvedValue(new Response("{}")),
    );
    await expect(transport.request("/api/v1/me")).rejects.toMatchObject({ kind: "invalid" });
    await expect(transport.request("https://other.example.org")).rejects.toMatchObject({ kind: "invalid" });
  });
  it("sends a caller-generated correlation id without importing native runtime modules", async () => {
    const request = vi.fn<Fetcher>().mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } })));
    const id = "00000000-0000-4000-8000-000000000041";
    await new Transport("https://api.example.org", request, 12000, () => id).request("/api/v1/me");
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-Correlation-Id": id });
  });
  it("classifies network failure", async () => {
    await expect(
      new Transport(
        "https://api.example.org",
        vi.fn<Fetcher>().mockRejectedValue(new Error("private")),
      ).request("/api/v1/me"),
    ).rejects.toMatchObject({ kind: "network" });
  });
  it("times out and cancels fetch", async () => {
    const request: Fetcher = (_url, options) =>
      new Promise((_resolve, reject) =>
        options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    await expect(
      new Transport("https://api.example.org", request, 5).request("/api/v1/me"),
    ).rejects.toMatchObject({ kind: "timeout" });
  });
});
describe("session", () => {
  it("boots anonymously and stores only refresh material, then restores server identity", async () => {
    const h = harness();
    await h.session.restore();
    expect(h.session.snapshot.state).toBe("ANONYMOUS");
    await h.session.login("email", "password");
    expect(h.saved()).not.toContain("accessToken");
    await h.session.restore();
    expect(h.session.snapshot.user?.role).toBe("STUDENT");
  });
  it("single-flights concurrent 401s and retries using rotated access", async () => {
    const h = harness();
    await h.session.login("email", "password");
    const mock = vi.mocked(h.api.request);
    mock.mockImplementation(async (path, options) => {
      if (path.endsWith("/refresh")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ...credential, accessToken: "b" };
      }
      if (path === "/api/v1/me") return user;
      if (options?.token === "a") throw new ApiError("401", 401);
      return [];
    });
    await Promise.all(Array.from({ length: 8 }, () => h.session.request("/api/v1/notifications")));
    expect(mock.mock.calls.filter(([path]) => path.endsWith("/refresh"))).toHaveLength(1);
  });
  it("clears secure storage and memory even when remote logout is offline", async () => {
    const h = harness();
    await h.session.login("email", "password");
    vi.mocked(h.api.request).mockRejectedValue(new ApiError("network"));
    await expect(h.session.logout()).rejects.toThrow();
    expect(h.saved()).toBeNull();
    expect(h.session.snapshot.state).toBe("ANONYMOUS");
    expect(h.session.snapshot.revocationStatus).toBe("REVOCATION_UNCONFIRMED");
    await expect(h.session.request("/api/v1/me")).rejects.toMatchObject({ status: 401 });
  });
  it("does not revive a session when login resolves after logout", async () => {
    let finish!: (value: unknown) => void;
    const h = harness(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const login = h.session.login("email", "password");
    await h.session.logout();
    finish(credential);
    await login;
    expect(h.saved()).toBeNull();
    expect(h.session.snapshot.state).toBe("ANONYMOUS");
  });
  it("retains refresh on transient restore failure but deletes revoked credentials", async () => {
    const h = harness();
    await h.session.login("email", "password");
    vi.mocked(h.api.request).mockRejectedValue(new ApiError("network"));
    await h.session.restore();
    expect(h.session.snapshot.state).toBe("NETWORK_UNAVAILABLE");
    expect(h.saved()).not.toBeNull();
    vi.mocked(h.api.request).mockRejectedValue(new ApiError("401", 401));
    await h.session.restore();
    expect(h.saved()).toBeNull();
    expect(h.session.snapshot.state).toBe("SESSION_EXPIRED");
  });
  it("fails closed on corrupt storage or untrusted roles", async () => {
    const h = harness();
    await h.vault.write("{oops");
    await h.session.restore();
    expect(h.saved()).toBeNull();
    expect(() => profile({ ...user, role: "MODERATOR" })).toThrow();
  });
  it("routes only authoritative roles", () => {
    expect(destinations().map((x) => x.key)).toContain("register");
    expect(destinations("STUDENT").map((x) => x.key)).not.toContain("teaching");
    expect(destinations("LECTURER").map((x) => x.key)).toContain("teaching");
    expect(destinations("ADMIN").map((x) => x.key)).toContain("admin");
  });
});
it("enters student offline-cache mode only when a secure identity and scoped data exist", async () => {
  const h = harness();
  const lifecycle: SessionLifecycle = {
    readLastIdentity: async () => user,
    saveLastIdentity: async () => {},
    clearLastIdentity: async () => {},
    clearUserData: async () => {},
    hasOfflineData: async () => true,
  };
  const session = new Session(h.api, h.vault, lifecycle);
  await session.login("email", "password");
  vi.mocked(h.api.request).mockRejectedValue(new ApiError("network"));
  await session.restore();
  expect(session.snapshot).toMatchObject({ state: "OFFLINE_CACHE", user: { role: "STUDENT", userId: "u" } });
  await expect(session.request("/api/v1/me/courses")).rejects.toMatchObject({ status: 401 });
});
it("clears prior account cache before accepting a different server identity", async () => {
  const h = harness();
  const clearUserData = vi.fn(async () => {});
  const latestUser = { ...user, userId: "second" };
  const lifecycle: SessionLifecycle = {
    readLastIdentity: async () => user,
    saveLastIdentity: async () => {},
    clearLastIdentity: async () => {},
    clearUserData,
    hasOfflineData: async () => true,
  };
  const session = new Session(h.api, h.vault, lifecycle);
  vi.mocked(h.api.request).mockImplementation(async (path) =>
    path.endsWith("/me") ? latestUser : credential,
  );
  await session.login("email", "password");
  expect(clearUserData).toHaveBeenCalledWith("u");
});

it("single-flights cold start and fails closed if secure storage is unavailable", async () => {
  const h = harness();
  await h.session.login("email", "password");
  vi.mocked(h.api.request).mockClear();
  await Promise.all([h.session.restore(), h.session.restore(), h.session.restore()]);
  expect(vi.mocked(h.api.request).mock.calls.filter(([path]) => path.endsWith("/refresh"))).toHaveLength(1);
  const bad = new Session(h.api, {
    read: async () => {
      throw Error("locked");
    },
    write: async () => {},
    clear: async () => {
      throw Error("locked");
    },
  });
  await bad.restore();
  expect(bad.snapshot.state).toBe("SESSION_EXPIRED");
  expect(bad.snapshot.user).toBeUndefined();
});
it("discards protected responses arriving after logout", async () => {
  const h = harness();
  await h.session.login("email", "password");
  let finish!: (value: unknown) => void;
  vi.mocked(h.api.request).mockImplementation(async (path) =>
    path.endsWith("/logout")
      ? {}
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  const pending = h.session.request("/api/v1/me/courses");
  await h.session.logout();
  finish([{ secret: "stale" }]);
  await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
});
it("shows invalid login without exposing server details", async () => {
  const h = harness();
  vi.mocked(h.api.request).mockRejectedValue(new ApiError("401", 401));
  await h.session.login("invalid", "invalid");
  expect(h.session.snapshot.state).toBe("ANONYMOUS");
  expect(h.session.snapshot.error).toContain("Email");
  expect(h.saved()).toBeNull();
});
it("late remote logout failure cannot overwrite a newer login", async () => {
  const h = harness();
  await h.session.login("email", "password");
  let rejectLogout!: (error: unknown) => void;
  vi.mocked(h.api.request).mockImplementation(async (path) =>
    path.endsWith("/logout")
      ? new Promise((_resolve, reject) => {
          rejectLogout = reject;
        })
      : path.endsWith("/me")
        ? user
        : credential,
  );
  const logout = h.session.logout().catch(() => {});
  await vi.waitFor(() => expect(rejectLogout).toBeDefined());
  await h.session.login("email", "password");
  rejectLogout(new ApiError("network"));
  await logout;
  expect(h.session.snapshot.state).toBe("AUTHENTICATED");
});
