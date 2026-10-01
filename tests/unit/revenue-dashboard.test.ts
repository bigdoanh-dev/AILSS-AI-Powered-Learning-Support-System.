import { describe, expect, it } from "vitest";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import { LearningCommerceService } from "../../apps/learning-service/src/commerce/service.js";
import type { ActorContext } from "../../packages/security/src/index.js";

const courseId = "11111111-1111-4111-8111-111111111111";
const lecturerId = "22222222-2222-4222-8222-222222222222";
const oldOrderId = "33333333-3333-4333-8333-333333333333";

describe("authoritative lecturer revenue breakdown", () => {
  it("returns a zero-valued daily series for a lecturer without sales, scoped to that lecturer", async () => {
    const service = new LearningCommerceService(
      {
        revenueDashboard: async () => ({
          dataSource: "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION",
          range: "today",
          currency: "VND",
          dailyRevenue: [
            { day: "2026-10-01", grossMinor: "100000", refundMinor: "0", netMinor: "100000", orders: 1 },
          ],
          lecturers: [{ lecturerId: "other-lecturer", grossMinor: "100000" }],
          completeness: { status: "READY" },
        }),
      } as unknown as LearningCommerceRepository,
      {} as never,
      {} as never,
      "test",
    );
    const report = await service.lecturerRevenueDashboard(
      { userId: lecturerId, roles: ["LECTURER"] } as ActorContext,
      "today",
    );
    expect(report.lecturer).toMatchObject({
      lecturerId,
      grossMinor: "0",
      orders: 0,
      courses: [],
      dailyRevenue: [{ day: "2026-10-01", grossMinor: "0", refundMinor: "0", netMinor: "0", orders: 0 }],
    });
  });
  it("uses the original order fee when reversing an earlier sale", async () => {
    const db = {
      execute: async (query: string, params: unknown[]) => {
        if (query.includes("finance_projection_control"))
          return [{ status: "READY", backfill_through: new Date("2026-09-27T00:00:00Z"), checksum: "ok" }];
        if (query.includes("revenue_payment_facts_by_day_shard")) {
          const day = String(params[0]);
          if (params[1] !== 0) return [];
          if (day === "2026-09-26")
            return [
              {
                course_id: courseId,
                order_id: oldOrderId,
                gross_minor: "100000",
                currency: "VND",
                occurred_at: new Date("2026-09-26T12:00:00Z"),
              },
            ];
          if (day === "2026-09-27")
            return [
              {
                course_id: courseId,
                order_id: "44444444-4444-4444-8444-444444444444",
                gross_minor: "200000",
                currency: "VND",
                occurred_at: new Date("2026-09-27T12:00:00Z"),
              },
            ];
          return [];
        }
        if (query.includes("revenue_refund_facts_by_day_shard"))
          return String(params[0]) === "2026-09-27" && params[1] === 0
            ? [
                {
                  course_id: courseId,
                  order_id: oldOrderId,
                  amount_minor: "10000",
                  currency: "VND",
                  status: "PROCESSED",
                },
              ]
            : [];
        if (query.includes("FROM course_by_id"))
          return [{ owner_lecturer_id: lecturerId, title: "Cơ sở dữ liệu" }];
        if (query.includes("FROM order_by_id"))
          return [
            {
              get: (name: string) =>
                name === "paid_at"
                  ? new Date(
                      String(params[0]) === oldOrderId ? "2026-09-26T12:00:00Z" : "2026-09-27T12:00:00Z",
                    )
                  : undefined,
            },
          ];
        if (query.includes("commission_policy_by_effective_at")) return [];
        throw new Error(`Unexpected query: ${query}`);
      },
    } as unknown as CassandraClient;
    const report = await new LearningCommerceRepository(db).revenueDashboard(
      "7d",
      new Date("2026-09-27T14:00:00Z"),
    );
    expect(report.grossMinor).toBe("300000");
    expect(report.refundMinor).toBe("10000");
    expect(report.lecturers[0]).toMatchObject({
      lecturerId,
      netMinor: "290000",
      estimatedPlatformMinor: "48000",
      estimatedEarningsMinor: "242000",
      orders: 2,
    });
  });
});
