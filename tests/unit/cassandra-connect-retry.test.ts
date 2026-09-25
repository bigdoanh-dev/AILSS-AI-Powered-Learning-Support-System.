import { describe, expect, it, vi } from "vitest";
import { connectWithRetry } from "../../packages/cassandra/src/index.js";

describe("Cassandra startup connection retry", () => {
  it("retries transient connection failures with capped exponential backoff", async () => {
    const connect = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(undefined);
    const retry = vi.fn();
    const delay = vi.fn(async (_ms: number) => undefined);

    await connectWithRetry(connect, {
      attempts: 4,
      initialDelayMs: 100,
      maxDelayMs: 150,
      onRetry: retry,
      delay,
    });

    expect(connect).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([100, 150]);
    expect(retry).toHaveBeenNthCalledWith(1, expect.objectContaining({ attempt: 1 }));
    expect(retry).toHaveBeenNthCalledWith(2, expect.objectContaining({ attempt: 2 }));
  });

  it("stops after the configured bound and preserves the last connection error", async () => {
    const failure = new Error("Cassandra unavailable");
    const connect = vi.fn<() => Promise<unknown>>().mockRejectedValue(failure);
    const delay = vi.fn(async (_ms: number) => undefined);

    await expect(connectWithRetry(connect, { attempts: 3, delay })).rejects.toBe(failure);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
  });
});
