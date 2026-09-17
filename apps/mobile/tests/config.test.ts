import { describe, expect, it } from "vitest";
import { configuration, isLoopbackHost, isPlaceholderHost } from "../src/config";

describe("Production Configuration & Gateway Policy (P15 Local Closure)", () => {
  // A. missing production origin -> reject
  it("A. rejects missing production origin (undefined)", () => {
    expect(() => configuration("production", undefined)).toThrow("FATAL_CONFIGURATION_ERROR");
  });

  // B. empty production origin -> reject
  it("B. rejects empty or whitespace-only production origin", () => {
    expect(() => configuration("production", "")).toThrow("FATAL_CONFIGURATION_ERROR");
    expect(() => configuration("production", "   ")).toThrow("FATAL_CONFIGURATION_ERROR");
  });

  // C. example placeholder -> reject
  it("C. rejects known example/placeholder hostnames", () => {
    const placeholders = [
      "https://api.ailss.example.org",
      "https://ailss.example.org",
      "https://example.org",
      "https://example.com",
      "https://sub.example.net",
      "https://gateway.example",
      "https://testing.test",
      "https://internal.invalid",
    ];
    for (const url of placeholders) {
      expect(() => configuration("production", url)).toThrow("FATAL_CONFIGURATION_ERROR");
    }
  });

  // D. localhost -> reject
  it("D. rejects localhost origin in production", () => {
    expect(() => configuration("production", "https://localhost")).toThrow("FATAL_CONFIGURATION_ERROR");
    expect(() => configuration("production", "https://localhost:8080")).toThrow("FATAL_CONFIGURATION_ERROR");
  });

  // E. 127.0.0.1 -> reject
  it("E. rejects 127.0.0.1 origin in production", () => {
    expect(() => configuration("production", "https://127.0.0.1")).toThrow("FATAL_CONFIGURATION_ERROR");
    expect(() => configuration("production", "https://127.0.0.1:8080")).toThrow("FATAL_CONFIGURATION_ERROR");
  });

  // F. ::1 -> reject
  it("F. rejects IPv6 loopback [::1] in production", () => {
    expect(() => configuration("production", "https://[::1]")).toThrow("FATAL_CONFIGURATION_ERROR");
    expect(() => configuration("production", "https://[::1]:8080")).toThrow("FATAL_CONFIGURATION_ERROR");
  });

  // G. HTTP non-loopback -> reject
  it("G. rejects non-loopback cleartext HTTP in production", () => {
    expect(() => configuration("production", "http://gateway.ailss.vn")).toThrow("FATAL_CONFIGURATION_ERROR");
    expect(() => configuration("production", "http://api.myschool.edu.vn")).toThrow(
      "FATAL_CONFIGURATION_ERROR",
    );
  });

  // H. valid explicit HTTPS origin -> accept
  it("H. accepts valid explicit HTTPS non-placeholder origin in production", () => {
    const config = configuration("production", "https://api.gateway.ailss.vn");
    expect(config.environment).toBe("production");
    expect(config.origin).toBe("https://api.gateway.ailss.vn");
  });

  // I. development local HTTP -> allowed only in development/research profile
  it("I. allows development/research local HTTP but forbids them in production", () => {
    const devConfig = configuration("development", "http://127.0.0.1:8080");
    expect(devConfig.environment).toBe("development");
    expect(devConfig.origin).toBe("http://127.0.0.1:8080");

    const researchConfig = configuration("research", "http://10.0.2.2:8080");
    expect(researchConfig.environment).toBe("research");
    expect(researchConfig.origin).toBe("http://10.0.2.2:8080");

    // Same local HTTP is rejected in production
    expect(() => configuration("production", "http://127.0.0.1:8080")).toThrow("FATAL_CONFIGURATION_ERROR");
    expect(() => configuration("production", "http://10.0.2.2:8080")).toThrow("FATAL_CONFIGURATION_ERROR");
  });

  // Helper unit tests
  it("verifies isLoopbackHost and isPlaceholderHost helper predicates", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(true);
    expect(isLoopbackHost("api.gateway.ailss.vn")).toBe(false);

    expect(isPlaceholderHost("api.ailss.example.org")).toBe(true);
    expect(isPlaceholderHost("test.example.com")).toBe(true);
    expect(isPlaceholderHost("mock.invalid")).toBe(true);
    expect(isPlaceholderHost("api.gateway.ailss.vn")).toBe(false);
  });
});
