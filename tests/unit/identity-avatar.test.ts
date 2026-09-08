import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { avatarRouter, parseAvatar } from "../../apps/identity-service/src/profile/avatar.js";
import { AppError, currentRequestContext } from "../../packages/http/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";

vi.mock("../../packages/http/src/index.js", async (original) => ({
  ...(await original<object>()),
  currentRequestContext: vi.fn(),
}));

// Actual 1×1 PNG. Parser accepts canonical base64 and a supported image signature.
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1cAAAAASUVORK5CYII=";
const requestId = randomUUID(),
  correlationId = randomUUID();
const actor: ActorContext = {
  userId: randomUUID(),
  sessionId: randomUUID(),
  roles: ["STUDENT"],
  tokenVersion: 1,
  correlationId,
  issuedAt: 1,
  expiresAt: 2,
};

beforeEach(() => {
  vi.mocked(currentRequestContext).mockReturnValue({ requestId, correlationId, startedAt: 1 });
});

describe("private avatar input boundary", () => {
  it("accepts PNG, JPEG and WebP and an explicit removal", () => {
    expect(parseAvatar({ dataUrl: png })).toMatchObject({ contentType: "image/png" });
    for (const [mime, bytes] of [
      ["image/jpeg", Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1])],
      ["image/webp", Buffer.from("RIFF0000WEBP", "ascii")],
    ] as const) {
      expect(parseAvatar({ dataUrl: `data:${mime};base64,${bytes.toString("base64")}` })).toEqual({
        bytes,
        contentType: mime,
      });
    }
    expect(parseAvatar({ dataUrl: null })).toBeNull();
  });

  it("rejects MIME spoofing, SVG, remote URLs, malformed base64 and ownership fields", () => {
    for (const body of [
      {},
      { dataUrl: "" },
      { dataUrl: 42 },
      { dataUrl: png.replace("image/png", "image/jpeg") },
      { dataUrl: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` },
      { dataUrl: "https://example.test/avatar.png" },
      { dataUrl: "data:image/png;base64,YWJj" },
      { dataUrl: `${png}\n` },
      { dataUrl: png.replace(/=$/, "") },
      { dataUrl: png, userId: randomUUID() },
      { dataUrl: png, role: "ADMIN" },
    ]) {
      expect(() => parseAvatar(body)).toThrow(
        expect.objectContaining({ code: "INVALID_AVATAR", status: 422 }),
      );
    }
  });

  it("enforces the decoded 256 KiB boundary even when the encoded string fits", () => {
    const bytes = Buffer.alloc(256 * 1024 + 1);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
    expect(dataUrl.length).toBeLessThan(350000);
    expect(() => parseAvatar({ dataUrl })).toThrow(expect.objectContaining({ status: 422 }));
    const maximum = bytes.subarray(0, 256 * 1024);
    expect(
      parseAvatar({ dataUrl: `data:image/png;base64,${maximum.toString("base64")}` })?.bytes,
    ).toHaveLength(256 * 1024);
  });
});

describe("private avatar authorization and persistence", () => {
  it("persists under the validated actor ID and reads it across router instances", async () => {
    const fixture = avatarFixture();
    const uploaded = await fixture.invoke("POST", { dataUrl: png });
    expect(uploaded.next).not.toHaveBeenCalled();
    expect(uploaded.json).toHaveBeenCalledWith({ data: { dataUrl: png }, meta: { requestId } });
    expect(uploaded.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(fixture.execute.mock.calls[0]?.[0]).toContain("INSERT INTO avatar_by_user");
    for (const [, params, consistency] of fixture.execute.mock.calls) {
      expect(String(params[0])).toBe(actor.userId);
      expect(consistency).toBe("LOCAL_QUORUM");
    }
    expect(fixture.read).toHaveBeenCalledWith(actor);
    // Each invocation mounts a new router; persistence comes from the database, not a session Map.
    const restored = await fixture.invoke("GET");
    expect(restored.json).toHaveBeenCalledWith({ data: { dataUrl: png }, meta: { requestId } });
    fixture.verify.mockResolvedValue({ ...actor, userId: randomUUID() });
    expect((await fixture.invoke("GET")).json).toHaveBeenCalledWith({
      data: { dataUrl: null },
      meta: { requestId },
    });
  });

  it("removes only the signed-in account image", async () => {
    const fixture = avatarFixture();
    await fixture.invoke("POST", { dataUrl: png });
    const removed = await fixture.invoke("POST", { dataUrl: null });
    expect(removed.json).toHaveBeenCalledWith({ data: { dataUrl: null }, meta: { requestId } });
    expect(fixture.execute.mock.calls.some(([query]) => query.startsWith("DELETE"))).toBe(true);
  });

  it("denies revoked sessions before any avatar database access", async () => {
    const fixture = avatarFixture();
    fixture.read.mockRejectedValue(new AppError("INVALID_ACCESS_TOKEN", 401, "Revoked"));
    const result = await fixture.invoke("POST", { dataUrl: png });
    expect(result.next).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_ACCESS_TOKEN", status: 401 }),
    );
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(result.json).not.toHaveBeenCalled();
  });

  it("fails closed for missing, forged and mismatched actor contexts", async () => {
    for (const mode of ["missing", "forged", "correlation", "context"] as const) {
      const fixture = avatarFixture();
      if (mode === "forged") fixture.verify.mockRejectedValue(new Error("signature"));
      if (mode === "correlation") fixture.verify.mockResolvedValue({ ...actor, correlationId: randomUUID() });
      if (mode === "context") vi.mocked(currentRequestContext).mockReturnValue(undefined);
      const result = await fixture.invoke("POST", { dataUrl: png }, mode !== "missing");
      expect(result.next).toHaveBeenCalledWith(
        expect.objectContaining({ code: "INVALID_ACTOR_CONTEXT", status: 401 }),
      );
      expect(fixture.read).not.toHaveBeenCalled();
      expect(fixture.execute).not.toHaveBeenCalled();
    }
  });

  it("does not store invalid input or accept unsupported methods", async () => {
    const fixture = avatarFixture();
    expect((await fixture.invoke("POST", { dataUrl: png, userId: randomUUID() })).next).toHaveBeenCalledWith(
      expect.objectContaining({ status: 422 }),
    );
    expect((await fixture.invoke("DELETE")).next).toHaveBeenCalledWith(
      expect.objectContaining({ status: 405 }),
    );
    expect(fixture.execute).not.toHaveBeenCalled();
  });
});

function avatarFixture() {
  const images = new Map<string, { content_type: string; image: Buffer }>();
  const execute = vi.fn(async (query: string, params: unknown[], _consistency: string) => {
    const owner = String(params[0]);
    if (query.startsWith("INSERT"))
      images.set(owner, { content_type: String(params[1]), image: params[2] as Buffer });
    if (query.startsWith("DELETE")) images.delete(owner);
    const row = images.get(owner);
    return query.startsWith("SELECT") && row ? [{ get: (key: string) => row[key as keyof typeof row] }] : [];
  });
  const read = vi.fn().mockResolvedValue({ userId: actor.userId });
  const verify = vi.fn().mockResolvedValue(actor);
  return {
    execute,
    read,
    verify,
    async invoke(method: string, body?: unknown, token = true) {
      const router = avatarRouter(
        { execute } as unknown as Parameters<typeof avatarRouter>[0],
        { read } as unknown as Parameters<typeof avatarRouter>[1],
        verify,
      );
      const handler = router.stack[0]?.route?.stack[0]?.handle as (
        req: Request,
        res: Response,
        next: NextFunction,
      ) => Promise<void>;
      const request = {
        method,
        body,
        header: () => (token ? "signed-context" : undefined),
      } as unknown as Request;
      const response = { json: vi.fn(), setHeader: vi.fn() };
      const next = vi.fn();
      await handler(request, response as unknown as Response, next);
      return { ...response, next };
    },
  };
}
