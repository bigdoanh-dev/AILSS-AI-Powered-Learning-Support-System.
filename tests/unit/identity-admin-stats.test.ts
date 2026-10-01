import { describe, expect, it, vi } from "vitest";
import { IdentityAdminRepository } from "../../apps/identity-service/src/admin/repository.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
describe("Account statistics data integrity", () => {
  it("returns only real account counts and no invented cross-service metrics", async () => {
    const execute = vi.fn(async (_query: string, params: unknown[]) => [
      {
        get: () => (params[2] === 0 ? (params[1] === "SUSPENDED" ? 1 : params[0] === "STUDENT" ? 5 : 2) : 0),
      },
    ]);
    const repository = new IdentityAdminRepository({ execute } as unknown as CassandraClient);
    expect(await repository.getStats()).toEqual({
      totalAccounts: 12,
      students: 5,
      lecturers: 2,
      admins: 2,
      suspended: 3,
      aiSessions: null,
      completionRate: null,
      avgScore: null,
      totalLearningHours: null,
      cognitiveLevels: [],
      weekdayEngagement: [],
    });
    expect(execute).toHaveBeenCalledTimes(96);
  });
  it("does not return partial counts when any database partition fails", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ get: () => 5 }])
      .mockRejectedValue(new Error("Database unavailable"));
    const repository = new IdentityAdminRepository({ execute } as unknown as CassandraClient);
    await expect(repository.getStats()).rejects.toThrow("Database unavailable");
  });
});
