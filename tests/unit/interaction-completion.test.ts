import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../apps/interaction-service/src/cursor.js";
import { body, json, type Comment } from "../../apps/interaction-service/src/model.js";
import { shard } from "../../apps/interaction-service/src/repository.js";

const secret = "p9.1-test-secret-with-at-least-thirty-two-bytes";
describe("Phase 9.1 completion primitives", () => {
  it("normalizes plain text without exposing canonical recovery metadata", () => {
    expect(body("Cafe\u0301\r\nline\t2")).toBe("Café\nline\t2");
    expect(() => body("bad\0body")).toThrow("INVALID_COMMENT_BODY");
    const value: Comment = {
      commentId: "00000000-0000-4000-8000-000000000001",
      resourceType: "COURSE",
      resourceId: "00000000-0000-4000-8000-000000000002",
      parentId: null,
      authorId: "00000000-0000-4000-8000-000000000003",
      body: "safe",
      state: "ACTIVE",
      version: 2,
      createdAt: new Date("2026-08-30T00:00:00Z"),
      updatedAt: new Date("2026-08-30T00:01:00Z"),
      pendingOperationId: "00000000-0000-4000-8000-000000000004",
    };
    expect(json(value)).not.toHaveProperty("pendingOperationId");
  });
  it("signs, binds, expires and rejects tampered snapshot cursors", () => {
    const now = Date.parse("2026-09-01T00:00:00Z"),
      payload = {
        v: 1 as const,
        resourceType: "COURSE" as const,
        resourceId: "00000000-0000-4000-8000-000000000002",
        snapshotUpperBound: "2026-09-01T00:00:00.000Z",
        currentDay: "2026-08-31",
        limit: 20,
        filtersHash: "all-comments-v1" as const,
        direction: "DESC" as const,
        positions: {
          "2026-08-31:0": {
            createdAt: "2026-08-31T12:00:00.000Z",
            commentId: "00000000-0000-4000-8000-000000000001",
          },
        },
        issuedAt: Math.floor(now / 1000),
        expiresAt: Math.floor(now / 1000) + 900,
      },
      cursor = encodeCursor(secret, payload),
      binding = { resourceType: "COURSE" as const, resourceId: payload.resourceId, limit: 20 };
    expect(decodeCursor(secret, cursor, binding, now)).toEqual(payload);
    expect(() => decodeCursor(secret, `${cursor.slice(0, -1)}x`, binding, now)).toThrow("INVALID_CURSOR");
    expect(() =>
      decodeCursor(secret, cursor, { ...binding, resourceId: "00000000-0000-4000-8000-000000000099" }, now),
    ).toThrow("INVALID_CURSOR");
    expect(() => decodeCursor(secret, cursor, binding, now + 901000)).toThrow("INVALID_CURSOR");
  });
  it("uses the locked SHA-256 UUID shard derivation", () => {
    expect(shard("00000000-0000-4000-8000-000000000001")).toBeGreaterThanOrEqual(0);
    expect(shard("00000000-0000-4000-8000-000000000001")).toBeLessThan(8);
    expect(shard("00000000-0000-4000-8000-000000000001")).toBe(shard("00000000-0000-4000-8000-000000000001"));
  });
});
