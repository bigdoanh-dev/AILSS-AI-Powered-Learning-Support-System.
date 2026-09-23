import { describe, expect, it, vi } from "vitest";
import { ApiError, type RequestOptions } from "../src/api";
import { syncPendingLessonCompletions } from "../src/lesson-sync";
import type { OfflineStore } from "../src/offline-store";
import type { Session } from "../src/session";

const operation = {
  operationId: "operation-1",
  userId: "student-1",
  courseId: "course-1",
  resourceId: "lesson-1",
  idempotencyKey: "same-idempotency-key",
  createdAt: "2026-09-23T00:00:00.000Z",
  attemptCount: 0,
  state: "PENDING" as const,
};
function harness(request: ReturnType<typeof vi.fn>) {
  const states: Array<{ state: string; attempt?: boolean; errorCode?: string }> = [];
  const store = {
    listQueueableCompletions: vi.fn(async () => [operation]),
    setCompletionState: vi.fn(async (user: string, id: string, state: string, options?: { incrementAttempt?: boolean; errorCode?: string }) => {
      void user;
      void id;
      states.push({ state, attempt: options?.incrementAttempt, errorCode: options?.errorCode });
    }),
  } as unknown as OfflineStore;
  const session = {
    snapshot: { state: "AUTHENTICATED", user: { userId: "student-1", role: "STUDENT" } },
    request,
  } as unknown as Session;
  return { store, session, states };
}

describe("durable lesson completion replay", () => {
  it("replays the same operation and idempotency key, marking completion synced only after server acknowledgement", async () => {
    const request = vi.fn(async (path: string, options?: RequestOptions) => {
      void path;
      void options;
      return { accepted: true };
    });
    const h = harness(request);
    await syncPendingLessonCompletions(h.session, "student-1", h.store);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/api/v1/lessons/lesson-1/completion", {
      method: "PUT",
      body: { completed: true },
      idempotencyKey: "same-idempotency-key",
    });
    expect(h.states).toEqual([
      { state: "SYNCING", attempt: true, errorCode: undefined },
      { state: "SYNCED", attempt: undefined, errorCode: undefined },
    ]);
  });

  it("re-reads server progress on conflict and never retries as last-write-wins", async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith("/completion")) throw new ApiError("409", 409);
      return { progressVersion: 3 };
    });
    const h = harness(request);
    await syncPendingLessonCompletions(h.session, "student-1", h.store);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/lessons/lesson-1/completion",
      "/api/v1/courses/course-1/progress",
    ]);
    expect(h.states.at(-1)).toMatchObject({ state: "CONFLICT", errorCode: "SERVER_STATE_CHANGED" });
  });

  it("marks a timed-out request retryable and preserves the same payload/key for a later replay", async () => {
    let fail = true;
    const request = vi.fn(async (path: string, options?: RequestOptions) => {
      void path;
      void options;
      if (fail) throw new ApiError("timeout");
      return { accepted: true };
    });
    const h = harness(request);
    await syncPendingLessonCompletions(h.session, "student-1", h.store);
    expect(h.states.at(-1)).toMatchObject({ state: "FAILED_RETRYABLE", errorCode: "TIMEOUT" });
    fail = false;
    await syncPendingLessonCompletions(h.session, "student-1", h.store);
    expect(request.mock.calls).toHaveLength(2);
    expect(request.mock.calls[0]?.[1]).toEqual(request.mock.calls[1]?.[1]);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ idempotencyKey: "same-idempotency-key", body: { completed: true } });
    expect(h.states.at(-1)?.state).toBe("SYNCED");
  });
});
