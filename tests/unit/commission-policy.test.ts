import { describe, expect, it } from "vitest";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";

const adminId = "11111111-1111-4111-8111-111111111111";

describe("durable platform commission timeline", () => {
  it("changes the current rate while preserving the rate for earlier payments and refunds", async () => {
    const timeline: Array<{ effective_at: Date; basis_points: number; updated_by: string }> = [];
    const db = {
      execute: async (query: string, params: unknown[]) => {
        if (query.startsWith("SELECT effective_at,basis_points,updated_by")) {
          const at = params[1] as Date;
          return timeline
            .filter((row) => row.effective_at <= at)
            .sort((a, b) => b.effective_at.getTime() - a.effective_at.getTime())
            .slice(0, 1);
        }
        if (query.startsWith("INSERT INTO commission_policy_by_effective_at")) {
          const effective_at = params[1] as Date;
          if (timeline.some((row) => row.effective_at.getTime() === effective_at.getTime()))
            return [{ "[applied]": false }];
          timeline.push({ effective_at, basis_points: params[2] as number, updated_by: adminId });
          return [{ "[applied]": true }];
        }
        throw new Error(query);
      },
    } as unknown as CassandraClient;
    const repo = new LearningCommerceRepository(db);
    const original = await repo.currentCommission();
    expect(original.basisPoints).toBe(1500);
    const previousPayment = new Date(Date.now() - 1000);
    const updated = await repo.changeCommission(2200, adminId, original.effectiveAt);
    expect(updated.basisPoints).toBe(2200);
    expect((await repo.commissionAt(previousPayment)).basisPoints).toBe(1500);
    expect((await repo.commissionAt(new Date("2026-09-26T12:00:00Z"))).basisPoints).toBe(2000);
    expect((await repo.currentCommission()).basisPoints).toBe(2200);
    await expect(repo.changeCommission(1000, adminId, original.effectiveAt)).rejects.toMatchObject({
      status: 409,
    });
  });
});
