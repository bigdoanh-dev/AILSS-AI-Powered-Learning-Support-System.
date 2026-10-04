import { describe, expect, it, vi } from "vitest";
import { quote, vnd } from "../src/finance";

describe("exact mobile money formatting", () => {
  it("uses English separators without changing exact monetary values", () => {
    expect(vnd("9007199254740993", "en-US")).toBe("9,007,199,254,740,993 ₫");
    expect(quote("1234.56", "USD", 1500, "en-US")).toEqual({
      gross: "1,234.56 USD",
      fee: "185.18 USD",
      earnings: "1,049.38 USD",
    });
  });
  it("formats amounts without native Intl BigInt conversion", () => {
    const formatter = vi.spyOn(Intl, "NumberFormat").mockImplementation(() => {
      throw new TypeError("Cannot convert BigInt to number");
    });
    try {
      expect(vnd("0")).toBe("0 ₫");
      expect(vnd("1250000")).toBe("1.250.000 ₫");
      expect(vnd(-1250000n)).toBe("-1.250.000 ₫");
      expect(vnd("9007199254740993")).toBe("9.007.199.254.740.993 ₫");
      expect(quote("100000", "VND", 1500)).toEqual({
        gross: "100.000 VND",
        fee: "15.000 VND",
        earnings: "85.000 VND",
      });
      expect(quote("1234.56", "USD", 1500)).toEqual({
        gross: "1.234,56 USD",
        fee: "185,18 USD",
        earnings: "1.049,38 USD",
      });
      expect(formatter).not.toHaveBeenCalled();
    } finally {
      formatter.mockRestore();
    }
  });
  it("preserves exact commission arithmetic above the safe Number range", () => {
    expect(quote("9007199254740993", "VND", 1000)).toEqual({
      gross: "9.007.199.254.740.993 VND",
      fee: "900.719.925.474.099 VND",
      earnings: "8.106.479.329.266.894 VND",
    });
  });
});
