import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { classroomInternalRouter } from "../../apps/classroom-service/src/internal-router.js";
vi.mock("../../packages/http/src/index.js", async (original) => ({
  ...(await original<object>()),
  currentRequestContext: () => ({ requestId: "test", correlationId: "test" }),
}));

describe("INT-CLS-03 owner proof", () => {
  it("returns ownerLecturerId only after validating the ai-service caller", async () => {
    const classId = randomUUID(),
      ownerLecturerId = randomUUID();
    const facts = {
      classId,
      ownerLecturerId,
      classKind: "PRIVATE",
      state: "ACTIVE",
      scheduleState: "DRAFT",
      scheduleVersion: 1,
      version: 1,
      name: "AI Class",
    };
    const verify = vi.fn().mockResolvedValue({ sub: "ai-service" });
    const args: Parameters<typeof classroomInternalRouter> = [
      { getClass: vi.fn().mockResolvedValue(facts), membership: vi.fn() },
      {} as Parameters<typeof classroomInternalRouter>[1],
      { ai: { caller: "ai-service", verify } } as unknown as Parameters<typeof classroomInternalRouter>[2],
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ];
    const router = classroomInternalRouter(...args);
    const layers = router.stack as unknown as {
      route?: {
        path: string;
        stack: { handle: (request: unknown, response: unknown, next: unknown) => Promise<void> }[];
      };
    }[];
    const handle = layers.find((layer) => layer.route?.path === "/internal/v1/classes/:id/ai-context")?.route
      ?.stack[0]?.handle;
    expect(handle).toBeDefined();
    const json = vi.fn(),
      status = vi.fn().mockReturnValue({ json }),
      next = vi.fn();
    const request = { params: { id: classId }, rawHeaders: ["authorization", "Service fixture"] };
    await handle?.(request, { status }, next);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerLecturerId }) }),
    );
    verify.mockResolvedValueOnce({ sub: "assessment-service" });
    json.mockClear();
    await handle?.(request, { status }, next);
    expect(next).toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});
