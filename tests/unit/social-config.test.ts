import { describe, expect, it, vi } from "vitest";
import { socialConfigHandler } from "../../apps/api-gateway/src/social-config.js";

describe("public social sign-in configuration", () => {
  it("shares the existing Web OAuth client ID in the mobile API envelope", () => {
    const setHeader = vi.fn();
    const json = vi.fn();
    const handler = socialConfigHandler(" 123-web.apps.googleusercontent.com ");

    handler({} as never, { setHeader, json } as never, vi.fn());

    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(json).toHaveBeenCalledWith({
      data: { googleClientId: "123-web.apps.googleusercontent.com" },
    });
  });
});
