import { randomUUID } from "node:crypto";
import { it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ownedCoursesRouter } from "../../apps/learning-service/src/authoring/owned-router.js";
import { currentRequestContext } from "../../packages/http/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";
vi.mock("../../packages/http/src/index.js", async (original) => ({
  ...(await original<object>()),
  currentRequestContext: vi.fn(),
}));
const userId = randomUUID(),
  correlationId = randomUUID();
const actor: ActorContext = {
  userId,
  correlationId,
  sessionId: randomUUID(),
  roles: ["LECTURER"],
  tokenVersion: 1,
  issuedAt: 1,
  expiresAt: 2,
};
beforeEach(() =>
  vi.mocked(currentRequestContext).mockReturnValue({ requestId: randomUUID(), correlationId, startedAt: 1 }),
);
function setup() {
  const execute = vi.fn().mockResolvedValue([]),
    get = vi.fn().mockResolvedValue(null),
    identity = vi.fn().mockResolvedValue({}),
    verify = vi.fn().mockResolvedValue(actor);
  const router = ownedCoursesRouter(
    { execute } as unknown as Parameters<typeof ownedCoursesRouter>[0],
    { get } as unknown as Parameters<typeof ownedCoursesRouter>[1],
    { get: identity },
    verify,
  );
  const handler = router.stack[0]?.route?.stack[0]?.handle as (
    r: Request,
    s: Response,
    n: NextFunction,
  ) => Promise<void>;
  return {
    execute,
    get,
    identity,
    verify,
    async invoke(id?: string) {
      const json = vi.fn(),
        next = vi.fn();
      await handler(
        { params: { courseId: id }, header: () => "signed-context" } as unknown as Request,
        { json } as unknown as Response,
        next,
      );
      return { json, next };
    },
  };
}
it("requires a verified lecturer before reading private projections", async () => {
  const f = setup();
  f.verify.mockResolvedValue({ ...actor, roles: ["STUDENT"] });
  const r = await f.invoke();
  expect(r.next.mock.calls[0]?.[0]).toMatchObject({ status: 403 });
  expect(f.execute).not.toHaveBeenCalled();
});
it("maps invalid tokens to 401 and never reads a course", async () => {
  const f = setup();
  f.verify.mockRejectedValue(Error("bad signature"));
  const r = await f.invoke(randomUUID());
  expect(r.next.mock.calls[0]?.[0]).toMatchObject({ status: 401 });
  expect(f.get).not.toHaveBeenCalled();
});
it("rejects a stale projection owned by another lecturer", async () => {
  const f = setup(),
    id = randomUUID();
  f.execute.mockResolvedValue([{ get: () => id }, { get: () => id }]);
  f.get.mockResolvedValue({ courseId: id, ownerLecturerId: randomUUID() });
  const r = await f.invoke();
  expect(r.json).toHaveBeenCalledWith({ data: [], meta: { limit: 100 } });
  expect(f.get).toHaveBeenCalledTimes(1);
  expect(String(f.execute.mock.calls[0]?.[1]?.[0])).toBe(userId);
});
it("does not expose another owner through the detail endpoint", async () => {
  const f = setup();
  f.get.mockResolvedValue({ ownerLecturerId: randomUUID() });
  const r = await f.invoke(randomUUID());
  expect(r.next.mock.calls[0]?.[0]).toMatchObject({ status: 404 });
  expect(r.json).not.toHaveBeenCalled();
});
