import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useStudentBatch } from "../src/student/overview";
import { useAdminData } from "../src/admin/useAdminData";
const identity = vi.hoisted(() => ({ profile: { userId: "student-a", role: "STUDENT" } }));
vi.mock("../src/auth/session", () => ({ useSession: () => identity }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
function Student() {
  const q = useStudentBatch<string>(["/me/test"]);
  return <p>{q.data?.join(",") ?? "Loading"}</p>;
}
function Admin() {
  const q = useAdminData<string>("/test", { intervalMs: 0 });
  return <p>{q.data ?? "Loading"}</p>;
}
describe("Data never survives an account change", () => {
  it("discards a late student response after switching to a new account", async () => {
    identity.profile = { userId: "student-a", role: "STUDENT" };
    let resolveA!: (value: unknown) => void;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveA = r;
          }),
      )
      .mockResolvedValueOnce(ok("new-account"));
    vi.stubGlobal("fetch", fetch);
    const view = render(<Student />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    identity.profile = { userId: "student-b", role: "STUDENT" };
    view.rerender(<Student />);
    expect(await screen.findByText("new-account")).toBeTruthy();
    await act(async () => resolveA(ok("private-old-account")));
    expect(screen.queryByText("private-old-account")).toBeNull();
    expect((fetch.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });
  it("clears resolved admin data and ignores a stale admin request", async () => {
    identity.profile = { userId: "admin-a", role: "ADMIN" };
    let resolveA!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              resolveA = r;
            }),
        )
        .mockResolvedValueOnce(ok("admin-b-data")),
    );
    const view = render(<Admin />);
    identity.profile = { userId: "admin-b", role: "ADMIN" };
    view.rerender(<Admin />);
    expect(await screen.findByText("admin-b-data")).toBeTruthy();
    await act(async () => resolveA(ok("admin-a-secret")));
    expect(screen.queryByText("admin-a-secret")).toBeNull();
    identity.profile = { userId: "student-b", role: "STUDENT" };
    view.rerender(<Admin />);
    expect(screen.queryByText("admin-b-data")).toBeNull();
  });
});
