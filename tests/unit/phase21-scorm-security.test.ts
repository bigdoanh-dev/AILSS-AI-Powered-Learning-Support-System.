import { describe, expect, it } from "vitest";
import { sanitizeScormZipEntryPath, validateScormPostMessage } from "../../packages/security/src/scorm.js";

describe("Phase 21.9: SCORM Security Hardening", () => {
  const sandboxDir = "/var/data/ailss/scorm_packages/pkg-123";
  const allowedOrigins = ["https://scorm-sandbox.ailss.edu.vn", "https://ailss.edu.vn"];

  describe("Zip-Slip Path Traversal Protection", () => {
    it("safely resolves legitimate content files within extraction target", () => {
      const validEntry = "content/module1/index.html";
      const resolved = sanitizeScormZipEntryPath(validEntry, sandboxDir);

      expect(resolved).toBe("/var/data/ailss/scorm_packages/pkg-123/content/module1/index.html");
    });

    it("rejects classic Unix directory traversal (../../etc/passwd)", () => {
      const maliciousEntry = "../../../../etc/passwd";
      expect(() => sanitizeScormZipEntryPath(maliciousEntry, sandboxDir)).toThrowError(
        /ZIP_SLIP_ATTEMPT_DETECTED/,
      );
    });

    it("rejects hidden internal traversal escaping target boundary", () => {
      const sneakyEntry = "content/lessons/../../../../tmp/malicious.sh";
      expect(() => sanitizeScormZipEntryPath(sneakyEntry, sandboxDir)).toThrowError(
        /ZIP_SLIP_ATTEMPT_DETECTED/,
      );
    });

    it("rejects null-byte injection in zip entry path", () => {
      const nullByteEntry = "innocent.txt\0/../../../etc/shadow";
      expect(() => sanitizeScormZipEntryPath(nullByteEntry, sandboxDir)).toThrowError(
        /ZIP_SLIP_ATTEMPT_DETECTED/,
      );
    });
  });

  describe("Sandboxed IFrame & postMessage Security", () => {
    it("accepts valid postMessage from authorized sandbox origin", () => {
      const result = validateScormPostMessage(
        "https://scorm-sandbox.ailss.edu.vn",
        {
          action: "LMSSetValue",
          parameter: "cmi.core.lesson_status",
          value: "completed",
          packageId: "pkg-123",
          attemptId: "att-456",
        },
        allowedOrigins,
      );

      expect(result.action).toBe("LMSSetValue");
      expect(result.parameter).toBe("cmi.core.lesson_status");
      expect(result.value).toBe("completed");
    });

    it("rejects postMessage from untrusted origin (anti-spoofing)", () => {
      expect(() =>
        validateScormPostMessage(
          "https://evil-hacker.com",
          {
            action: "LMSSetValue",
            parameter: "cmi.core.score.raw",
            value: "100",
            packageId: "pkg-123",
            attemptId: "att-456",
          },
          allowedOrigins,
        ),
      ).toThrowError(/UNAUTHORIZED_POSTMESSAGE_ORIGIN/);
    });

    it("rejects unsupported CMI elements or prototype pollution attempts", () => {
      expect(() =>
        validateScormPostMessage(
          "https://scorm-sandbox.ailss.edu.vn",
          {
            action: "LMSSetValue",
            parameter: "__proto__",
            value: "hacked",
            packageId: "pkg-123",
            attemptId: "att-456",
          },
          allowedOrigins,
        ),
      ).toThrowError(/UNSUPPORTED_CMI_ELEMENT/);
    });

    it("validates score range bounds on LMSSetValue", () => {
      expect(() =>
        validateScormPostMessage(
          "https://scorm-sandbox.ailss.edu.vn",
          {
            action: "LMSSetValue",
            parameter: "cmi.core.score.raw",
            value: "9999999",
            packageId: "pkg-123",
            attemptId: "att-456",
          },
          allowedOrigins,
        ),
      ).toThrowError(/INVALID_SCORE_RANGE/);
    });

    it("rejects invalid lesson status strings", () => {
      expect(() =>
        validateScormPostMessage(
          "https://scorm-sandbox.ailss.edu.vn",
          {
            action: "LMSSetValue",
            parameter: "cmi.core.lesson_status",
            value: "super_passed",
            packageId: "pkg-123",
            attemptId: "att-456",
          },
          allowedOrigins,
        ),
      ).toThrowError(/INVALID_LESSON_STATUS/);
    });
  });
});
