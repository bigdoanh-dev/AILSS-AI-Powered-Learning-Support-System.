import { afterEach, describe, expect, it, vi } from "vitest";
import { startApplicationRepair } from "../../apps/identity-service/src/lecturer-application/worker.js";
import type { ApplicationService } from "../../apps/identity-service/src/lecturer-application/service.js";
import type { Command } from "../../apps/identity-service/src/lecturer-application/model.js";
describe("application bounded repair worker", () => {
  afterEach(() => vi.useRealTimers());
  it("pages past leased/failed intents and deletes only with the acquired fence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    const c = { operationId: "operation", scope: "scope", key: "key" } as Command;
    const row = {
      get: (k: string): unknown =>
        ({ intent_json: JSON.stringify(c), lease_until: new Date(0), fence: 4 })[k as "intent_json"],
    };
    const due = vi
      .fn()
      .mockResolvedValueOnce({ rows: [row], pageState: "next-page" })
      .mockResolvedValue({ rows: [] });
    const lease = vi.fn().mockResolvedValue(true),
      removeIntent = vi.fn().mockResolvedValue(undefined),
      reserve = vi.fn().mockResolvedValue(c),
      command = vi.fn().mockResolvedValue({ ...c, result: { applicationId: "id" } }),
      resume = vi.fn().mockResolvedValue({});
    const stop = startApplicationRepair({
      store: { due, lease, removeIntent, reserve, command },
      resume,
    } as unknown as ApplicationService);
    await vi.advanceTimersByTimeAsync(500);
    expect(removeIntent).toHaveBeenCalledWith(c, expect.any(String), 5);
    await vi.advanceTimersByTimeAsync(500);
    expect(due.mock.calls[1]).toEqual(["2026-09-07", 0, "next-page"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(due.mock.calls[2]).toEqual(["2026-09-07", 1, undefined]);
    stop();
  });
  it("does not execute commands while another lease is live", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    const resume = vi.fn();
    const stop = startApplicationRepair({
      store: {
        due: async () => ({
          rows: [
            {
              get: (k: string): unknown =>
                k === "intent_json" ? "{}" : k === "fence" ? 1 : new Date(Date.now() + 30000),
            },
          ],
        }),
      },
      resume,
    } as unknown as ApplicationService);
    await vi.advanceTimersByTimeAsync(500);
    expect(resume).not.toHaveBeenCalled();
    stop();
  });
});
