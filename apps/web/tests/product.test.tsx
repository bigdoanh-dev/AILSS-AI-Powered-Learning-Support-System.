import { describe, expect, it } from "vitest";
import { stateLabel } from "../src/components/product";

describe("cross-role product vocabulary", () => {
  it("maps canonical states without merging or inventing state", () => {
    expect(stateLabel("DRAFT")).toBe("Bản nháp");
    expect(stateLabel("PUBLISHED")).toBe("Đã xuất bản");
    expect(stateLabel("PRESENT")).toBe("Có mặt");
    expect(stateLabel("SERVER_FUTURE_STATE")).toBe("SERVER_FUTURE_STATE");
  });
});
