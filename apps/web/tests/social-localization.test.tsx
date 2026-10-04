import { afterEach, describe, expect, it, vi } from "vitest";
import { mountGoogleSignInButton } from "../src/auth/social";

afterEach(() => {
  delete window.google;
  vi.unstubAllGlobals();
});
describe("Google button language preference", () => {
  it("fits a resized container and disconnects on cleanup without reinitializing sign-in", async () => {
    const initialize = vi.fn(),
      renderButton = vi.fn(),
      disconnect = vi.fn();
    let resized: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resized = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    window.google = { accounts: { id: { initialize, renderButton } } };
    const element = document.createElement("div");
    const dimensions = vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ width: 400 } as DOMRect);
    const controller = new AbortController();
    await mountGoogleSignInButton(element, "client", vi.fn(), "en", controller.signal);
    dimensions.mockReturnValue({ width: 250 } as DOMRect);
    resized?.([], {} as ResizeObserver);
    expect(renderButton).toHaveBeenCalledTimes(2);
    expect(renderButton.mock.calls[1][1]).toMatchObject({ width: 250, locale: "en" });
    resized?.([], {} as ResizeObserver);
    expect(renderButton).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenCalledOnce();
    controller.abort();
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it("fits the real mobile container instead of forcing a desktop minimum", async () => {
    const renderButton = vi.fn();
    window.google = { accounts: { id: { initialize: vi.fn(), renderButton } } };
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ width: 250 } as DOMRect);
    await mountGoogleSignInButton(element, "client", vi.fn(), "en");
    expect(renderButton.mock.calls[0][1].width).toBe(250);
  });
  it("rerenders in the chosen language without reinitializing authentication", async () => {
    const initialize = vi.fn();
    const renderButton = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton } } };
    const first = vi.fn();
    const latest = vi.fn();
    const element = document.createElement("div");
    await mountGoogleSignInButton(element, "demo-client-id", first, "vi");
    await mountGoogleSignInButton(element, "demo-client-id", latest, "en");
    expect(initialize).toHaveBeenCalledOnce();
    expect(renderButton.mock.calls[0][1].locale).toBe("vi");
    expect(renderButton.mock.calls[1][1].locale).toBe("en");
    initialize.mock.calls[0][0].callback({ credential: "test-credential" });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith("test-credential");
  });
  it("does not render a stale button after a language switch cancels its mount", async () => {
    const initialize = vi.fn();
    const renderButton = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton } } };
    const controller = new AbortController();
    controller.abort();
    await mountGoogleSignInButton(document.createElement("div"), "client", vi.fn(), "en", controller.signal);
    expect(initialize).not.toHaveBeenCalled();
    expect(renderButton).not.toHaveBeenCalled();
  });
});
