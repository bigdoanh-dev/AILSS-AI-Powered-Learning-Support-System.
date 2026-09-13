import { Suspense, act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "../src/auth/session";
afterEach(() => vi.unstubAllGlobals());
it("hydrates a delayed route with the server snapshot after Guest bootstrap resolves", async () => {
  let delayed = false;
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  function Header() {
    const session = useSession();
    if (delayed) throw loaded;
    return session.state === "BOOTSTRAPPING" ? (
      <span>Đang kiểm tra tài khoản</span>
    ) : (
      <div>Guest actions</div>
    );
  }
  const tree = (
    <SessionProvider>
      <Suspense fallback={<p>Loading</p>}>
        <Header />
      </Suspense>
    </SessionProvider>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(tree);
  document.body.append(container);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "INVALID_SESSION" } }),
    }),
  );
  delayed = true;
  const recoverable = vi.fn();
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: recoverable });
    });
    expect(fetch).toHaveBeenCalled();
    await act(async () => {
      delayed = false;
      release();
      await loaded;
    });
    expect(container.textContent).toBe("Guest actions");
    expect(recoverable).not.toHaveBeenCalled();
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});
