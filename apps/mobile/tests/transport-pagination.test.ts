import { describe, expect, it, vi } from "vitest";
import { Transport, type Fetcher } from "../src/api";
import { adminUserListResponse } from "../src/admin";
import { commentList, reviewList } from "../src/interaction";
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
describe("transport and backend envelope integration", () => {
  it("preserves user cursors while ordinary requests still return data", async () => {
    const envelope = {
      data: [{ userId: "u", displayName: "Student", role: "STUDENT", status: "ACTIVE" }],
      meta: { pagination: { hasMore: true, nextCursor: "user-next" } },
    };
    const fetcher = vi.fn<Fetcher>().mockImplementation(async () => response(envelope));
    const api = new Transport("http://localhost", fetcher);
    expect(
      adminUserListResponse(await api.request("/api/v1/admin/users", { includeMeta: true })).nextCursor,
    ).toBe("user-next");
    expect(await api.request("/api/v1/admin/users")).toEqual(envelope.data);
  });
  it("keeps review ratings for the whole course instead of recomputing one page", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(
      response({
        data: [],
        ratingSummary: { reviewCount: 45, ratingSum: 180, average: 4 },
        meta: { page: { nextCursor: "review-next", hasMore: true } },
      }),
    );
    const decoded = reviewList(
      await new Transport("http://localhost", fetcher).request("/api/v1/courses/c/reviews", {
        includeMeta: true,
      }),
    );
    expect(decoded).toMatchObject({
      nextCursor: "review-next",
      ratingSummary: { reviewCount: 45, average: 4 },
    });
  });
  it("keeps comment cursors for subsequent discussion pages", async () => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValue(
        response({ data: [], meta: { page: { nextCursor: "comment-next", hasMore: true } } }),
      );
    expect(
      commentList(
        await new Transport("http://localhost", fetcher).request("/api/v1/resources/CLASS/c/comments", {
          includeMeta: true,
        }),
      ).nextCursor,
    ).toBe("comment-next");
  });
  it("sends mutation objects once with authentication, version and command headers", async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValue(response({ data: {} }));
    const body = { currentPassword: "test-only", status: "SUSPENDED" };
    await new Transport("http://localhost", fetcher).request("/api/v1/admin/users/u/status", {
      method: "PATCH",
      body,
      token: "test-token",
      idempotencyKey: "command-key",
      headers: { "If-Match": '"v2"' },
    });
    const options = fetcher.mock.calls[0][1];
    expect(JSON.parse(String(options?.body))).toEqual(body);
    expect(options?.headers).toMatchObject({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
      "Idempotency-Key": "command-key",
      "If-Match": '"v2"',
    });
  });
});
