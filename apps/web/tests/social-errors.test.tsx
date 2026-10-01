import { describe, expect, it } from "vitest";
import { ApiError, errorMessage } from "../src/lib/api";

describe("social login error messages", () => {
  it("reports a provider outage separately from invalid credentials", () => {
    const message = errorMessage(new ApiError(503, "SOCIAL_PROVIDER_UNAVAILABLE"));
    expect(message).toContain("Google/Apple");
    expect(message).toContain("không kết nối được");
    expect(message).not.toContain("Token đăng nhập không hợp lệ");
  });

  it("preserves rejection messages for invalid tokens", () => {
    expect(errorMessage(new ApiError(401, "INVALID_TOKEN"))).toContain("Token đăng nhập không hợp lệ");
  });
});
