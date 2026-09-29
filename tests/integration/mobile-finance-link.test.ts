import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";
import { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import { LearningCommerceService } from "../../apps/learning-service/src/commerce/service.js";
import {
  adminReport,
  commission,
  lecturerReport,
  payoutAccount,
  payouts,
  preparePayouts,
  quote,
  readCommission,
  saveCommission,
} from "../../apps/mobile/src/finance.js";
import { adminConversation, roleConversation } from "../../apps/mobile/src/admin-ai.js";

const actor = (role: "ADMIN" | "LECTURER" | "STUDENT", userId = randomUUID()): ActorContext => ({
  userId,
  roles: [role],
  sessionId: randomUUID(),
  tokenVersion: 1,
  correlationId: randomUUID(),
  issuedAt: 0,
  expiresAt: 9999999999,
});

describe("mobile role and finance links", () => {
  it("propagates an admin rate change to lecturer price preview and reconciled revenue without repricing an earlier sale", async () => {
    const admin = actor("ADMIN"),
      teacher = actor("LECTURER"),
      student = actor("STUDENT");
    const courseId = randomUUID(),
      oldOrder = randomUUID(),
      newOrder = randomUUID();
    const oldPaidAt = new Date(Date.now() - 10_000);
    const newPaidAt = new Date(Date.now() + 2_000);
    const today = new Date().toISOString().slice(0, 10);
    const timeline: Array<{ effective_at: Date; basis_points: number; updated_by: string }> = [];
    const db = {
      execute: async (query: string, params: unknown[]) => {
        if (query.includes("commission_policy_by_effective_at") && query.startsWith("SELECT"))
          return timeline
            .filter((row) => row.effective_at <= (params[1] as Date))
            .sort((a, b) => b.effective_at.getTime() - a.effective_at.getTime())
            .slice(0, 1);
        if (query.includes("commission_policy_by_effective_at") && query.startsWith("INSERT")) {
          timeline.push({
            effective_at: params[1] as Date,
            basis_points: params[2] as number,
            updated_by: admin.userId,
          });
          return [{ "[applied]": true }];
        }
        if (query.includes("finance_projection_control"))
          return [{ status: "READY", backfill_through: new Date(`${today}T00:00:00Z`), checksum: "ok" }];
        if (query.includes("revenue_payment_facts_by_day_shard"))
          return params[1] === 0 && String(params[0]) === today
            ? [oldOrder, newOrder].map((order_id) => ({
                order_id,
                course_id: courseId,
                gross_minor: "100000",
                currency: "VND",
                occurred_at: order_id === oldOrder ? oldPaidAt : newPaidAt,
              }))
            : [];
        if (query.includes("revenue_refund_facts_by_day_shard"))
          return params[1] === 0 && String(params[0]) === today
            ? [
                {
                  order_id: oldOrder,
                  course_id: courseId,
                  amount_minor: "10000",
                  currency: "VND",
                  status: "PROCESSED",
                },
              ]
            : [];
        if (query.includes("FROM order_by_id"))
          return [
            {
              get: (name: string) =>
                name === "paid_at" ? (String(params[0]) === oldOrder ? oldPaidAt : newPaidAt) : undefined,
            },
          ];
        if (query.includes("FROM course_by_id"))
          return [{ owner_lecturer_id: teacher.userId, title: "Cassandra" }];
        throw new Error(query);
      },
    } as unknown as CassandraClient;
    const service = new LearningCommerceService(
      new LearningCommerceRepository(db),
      {} as never,
      {} as never,
      "secret",
    );
    const client = (user: ActorContext) => ({
      request: async (path: string, options?: { body?: unknown }) => {
        if (path === "/api/v1/admin/commission" && options?.body) {
          const input = options.body as { basisPoints: number; expectedEffectiveAt: string };
          return service.changeCommission(user, input.basisPoints, input.expectedEffectiveAt);
        }
        if (path === "/api/v1/admin/commission" || path === "/api/v1/me/commission")
          return service.commission(user);
        if (path.startsWith("/api/v1/admin/dashboard/revenue")) return service.revenueDashboard(user, "7d");
        if (path.startsWith("/api/v1/me/dashboard/revenue"))
          return service.lecturerRevenueDashboard(user, "7d");
        throw new Error(path);
      },
    });
    const adminApi = client(admin),
      lecturerApi = client(teacher);
    const original = await readCommission(adminApi, "ADMIN");
    expect(original.basisPoints).toBe(1500);
    const updated = await saveCommission(adminApi, original, "22", randomUUID());
    expect(updated.basisPoints).toBe(2200);
    expect((await readCommission(lecturerApi, "LECTURER")).basisPoints).toBe(2200);
    expect(quote("100000", "VND", updated.basisPoints)).toEqual({
      gross: "100.000 VND",
      fee: "22.000 VND",
      earnings: "78.000 VND",
    });
    expect(quote("0", "VND", updated.basisPoints)?.earnings).toBe("0 VND");
    expect(quote("100.50", "VND", updated.basisPoints)).toBeNull();
    const teacherReport = lecturerReport(await lecturerApi.request("/api/v1/me/dashboard/revenue?range=7d"));
    const platformReport = adminReport(await adminApi.request("/api/v1/admin/dashboard/revenue?range=7d"));
    expect(teacherReport.lecturer.estimatedPlatformMinor).toBe("35500");
    expect(teacherReport.lecturer.estimatedEarningsMinor).toBe("154500");
    expect(platformReport.netMinor).toBe("190000");
    expect(platformReport.lecturers[0]?.lecturerId).toBe(teacher.userId);
    await expect(service.changeCommission(teacher, 500, updated.effectiveAt)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.commission(student)).rejects.toMatchObject({ status: 403 });
    await expect(service.lecturerRevenueDashboard(admin, "7d")).rejects.toMatchObject({ status: 403 });
    await expect(service.revenueDashboard(teacher, "7d")).rejects.toMatchObject({ status: 403 });
    await expect(saveCommission(adminApi, original, "10", randomUUID())).rejects.toMatchObject({
      status: 409,
    });
  });

  it("links a lecturer payout account to admin one-person and all-person preparation", async () => {
    const teacher = actor("LECTURER"),
      admin = actor("ADMIN");
    let account: { bankName: string; accountNumber: string; accountHolder: string } | undefined;
    const instructions = new Map<string, unknown>();
    const repo = {
      revenueDashboard: async () => ({
        lecturers: [{ lecturerId: teacher.userId, estimatedEarningsMinor: "85000" }],
      }),
      payoutAccount: async () => account,
      savePayoutAccount: async (_id: string, input: typeof account) => {
        account = input;
        return input;
      },
      payoutInstructions: async () => [...instructions.values()],
      preparePayoutInstruction: async (
        _month: string,
        id: string,
        amountMinor: string,
        input: typeof account,
      ) => {
        instructions.set(id, { lecturerId: id, amountMinor, ...input, status: "PENDING_TRANSFER" });
      },
    };
    const service = new LearningCommerceService(repo as never, {} as never, {} as never, "secret");
    account =
      payoutAccount(
        await service.savePayoutAccount(teacher, {
          bankName: "Ngân hàng A",
          accountNumber: "123456789",
          accountHolder: "NGUYEN VAN A",
        }),
      ) ?? undefined;
    const before = payouts(await service.payoutInstructions(admin));
    expect(before.candidates[0]?.accountConfigured).toBe(true);
    const api = {
      request: async (_path: string, options?: { body?: unknown }) =>
        service.preparePayouts(admin, (options?.body as { lecturerId?: string })?.lecturerId),
    };
    const one = await preparePayouts(api, teacher.userId, randomUUID());
    const all = await preparePayouts(api, undefined, randomUUID());
    expect(one.instructions).toHaveLength(1);
    expect(all.instructions).toHaveLength(1);
    expect(all.instructions[0]?.status).toBe("PENDING_TRANSFER");
  });

  it("keeps admin AI history scoped to the admin mode", () => {
    const id = randomUUID();
    expect(
      adminConversation({
        conversation: { conversationId: id, mode: "ADMIN_SUPPORT" },
        messages: [{ messageId: randomUUID(), sender: "ASSISTANT", content: "Mở báo cáo quản trị" }],
      }).messages[0]?.content,
    ).toBe("Mở báo cáo quản trị");
    expect(() =>
      adminConversation({ conversation: { conversationId: id, mode: "STUDENT_ADVISOR" }, messages: [] }),
    ).toThrow();
    expect(
      roleConversation(
        { conversation: { conversationId: id, mode: "LECTURER_COPILOT" }, messages: [] },
        "LECTURER_COPILOT",
      ).conversationId,
    ).toBe(id);
    expect(() =>
      roleConversation(
        { conversation: { conversationId: id, mode: "ADMIN_SUPPORT" }, messages: [] },
        "LECTURER_COPILOT",
      ),
    ).toThrow();
  });
});
