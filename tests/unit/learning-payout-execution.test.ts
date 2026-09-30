import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";
import {
  BankApiProvider,
  type IPayoutProvider,
} from "../../apps/learning-service/src/commerce/bank-api-provider.js";
import { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import { LearningCommerceService } from "../../apps/learning-service/src/commerce/service.js";

const lecturerId = randomUUID();
const instructionId = randomUUID();
const adminId = randomUUID();
const actor: ActorContext = {
  userId: adminId,
  roles: ["ADMIN"],
  sessionId: randomUUID(),
  tokenVersion: 1,
  correlationId: randomUUID(),
  issuedAt: 0,
  expiresAt: 9999999999,
};

function setup(provider: IPayoutProvider) {
  const row = {
    lecturer_id: lecturerId,
    instruction_id: instructionId,
    amount_minor: "9000",
    currency: "VND",
    bank_name: "Mock Bank",
    account_number: "123456789",
    account_holder: "Test Lecturer",
    status: "PENDING_TRANSFER",
    created_at: new Date(),
    approved_by: null as string | null,
    approved_at: null as Date | null,
    provider_reference: null as string | null,
    failure_reason: null as string | null,
    updated_at: null as Date | null,
  };
  const audit: Array<{ state: string; reason: string | null }> = [];
  const db = {
    execute: vi.fn(async (query: string, params: unknown[]) => {
      if (query.startsWith("SELECT") && query.includes("payout_instruction_by_month")) return [{ ...row }];
      if (query.includes("SET status='SUBMITTING'")) {
        if (row.status !== "PENDING_TRANSFER" || String(params[5]) !== instructionId)
          return [{ "[applied]": false }];
        row.status = "SUBMITTING";
        row.approved_by = adminId;
        row.approved_at = params[1] as Date;
        return [{ "[applied]": true }];
      }
      if (query.includes("SET status=?")) {
        if (row.status !== "SUBMITTING") return [{ "[applied]": false }];
        row.status = String(params[0]);
        row.provider_reference = params[1] as string | null;
        row.failure_reason = params[2] as string | null;
        row.updated_at = params[3] as Date;
        return [{ "[applied]": true }];
      }
      if (query.includes("payout_audit_by_instruction")) {
        audit.push({ state: String(params[2]), reason: params[4] as string | null });
        return [{ "[applied]": true }];
      }
      throw new Error(query);
    }),
  } as unknown as CassandraClient;
  const repo = new LearningCommerceRepository(db);
  const service = new LearningCommerceService(repo, {} as never, {} as never, "secret", undefined, provider);
  return { row, audit, db, service };
}

beforeEach(() => vi.setSystemTime(new Date("2026-09-30T12:00:00Z")));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("payout approval persistence", () => {
  it.each([
    [{ status: "PAID", providerReference: "mock-123" } as const, "PAID"],
    [{ status: "PAYOUT_FAILED", reason: "PROVIDER_REJECTED" } as const, "PAYOUT_FAILED"],
    [
      { status: "RECONCILIATION_REQUIRED", reason: "PROVIDER_TIMEOUT_OR_NETWORK_ERROR" } as const,
      "RECONCILIATION_REQUIRED",
    ],
  ])("persists %s and writes an audit trail", async (outcome, status) => {
    const executePayout = vi.fn(async () => outcome);
    const { row, audit, service } = setup({ executePayout });
    const result = await service.approvePayout(actor, lecturerId, "2026-08");
    expect(result?.status).toBe(status);
    expect(row.status).toBe(status);
    expect(audit.map((entry) => entry.state)).toEqual(["SUBMITTING", status]);
    expect(JSON.stringify(audit)).not.toContain(row.account_number);
    expect(executePayout).toHaveBeenCalledWith(
      { minor: "9000", currency: "VND" },
      expect.objectContaining({ accountNumber: "123456789" }),
      `AILSS-PAYOUT-${instructionId}`,
    );
    await expect(service.approvePayout(actor, lecturerId, "2026-08")).rejects.toMatchObject({
      code: "PAYOUT_ALREADY_HANDLED",
    });
    expect(executePayout).toHaveBeenCalledTimes(1);
  });

  it("allows only one concurrent approval to call the provider", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executePayout = vi.fn(async () => {
      await gate;
      return { status: "PAID" as const, providerReference: "mock" };
    });
    const { service, row } = setup({ executePayout });
    const first = service.approvePayout(actor, lecturerId, "2026-08");
    const second = service.approvePayout(actor, lecturerId, "2026-08");
    // The first approval waits at the provider while the other loses the durable claim.
    release();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(executePayout).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("PAID");
  });

  it("blocks non-admins and invalid amount before claiming", async () => {
    const executePayout = vi.fn(async () => ({ status: "PAID" as const, providerReference: "mock" }));
    const { service, row } = setup({ executePayout });
    await expect(
      service.approvePayout({ ...actor, roles: ["LECTURER"] }, lecturerId, "2026-08"),
    ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
    row.amount_minor = "0";
    await expect(service.approvePayout(actor, lecturerId, "2026-08")).rejects.toMatchObject({
      code: "PAYOUT_INSTRUCTION_INVALID",
    });
    expect(executePayout).not.toHaveBeenCalled();
  });

  it("persists an uncertain provider exception for manual reconciliation", async () => {
    const executePayout = vi.fn(async () => {
      throw new Error("network failure");
    });
    const { service, audit } = setup({ executePayout });
    const result = await service.approvePayout(actor, lecturerId, "2026-08");
    expect(result?.status).toBe("RECONCILIATION_REQUIRED");
    expect(audit.at(-1)?.reason).toBe("PROVIDER_CALL_UNCERTAIN");
  });
});

describe("local bank REST mock", () => {
  it("sends the stable idempotency key and parses success", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fetchMock = vi.fn(async (_url: string, request: RequestInit) => {
      expect((request.headers as Record<string, string>)["idempotency-key"]).toBe("payout-ref");
      return new Response(JSON.stringify({ status: "paid", providerReference: "mock-1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new BankApiProvider({ endpoint: "http://127.0.0.1:9999/payouts", token: "test" });
    expect(
      await provider.executePayout(
        { minor: "9000", currency: "VND" },
        { bankName: "Mock", accountNumber: "123456", accountHolder: "Test" },
        "payout-ref",
      ),
    ).toEqual({ status: "PAID", providerReference: "mock-1" });
  });

  it.each([400, 409, 500])("classifies HTTP %i safely", async (status) => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status })),
    );
    const provider = new BankApiProvider({ endpoint: "http://127.0.0.1:9999/payouts", token: "test" });
    const result = await provider.executePayout(
      { minor: "9000", currency: "VND" },
      { bankName: "Mock", accountNumber: "123456", accountHolder: "Test" },
      "ref",
    );
    expect(result.status).toBe(status === 400 ? "PAYOUT_FAILED" : "RECONCILIATION_REQUIRED");
  });

  it("does not follow a mock redirect", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const fetchMock = vi.fn(async (_url: string, request: RequestInit) => {
      expect(request.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://bank.example/payouts" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new BankApiProvider({ endpoint: "http://127.0.0.1:9999/payouts", token: "test" });
    expect(
      (
        await provider.executePayout(
          { minor: "9000", currency: "VND" },
          { bankName: "Mock", accountNumber: "123456", accountHolder: "Test" },
          "ref",
        )
      ).status,
    ).toBe("RECONCILIATION_REQUIRED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a timed-out request as ambiguous and rejects a real bank URL", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    const provider = new BankApiProvider({ endpoint: "http://127.0.0.1:9999/payouts", token: "test" });
    expect(
      (
        await provider.executePayout(
          { minor: "9000", currency: "VND" },
          { bankName: "Mock", accountNumber: "123456", accountHolder: "Test" },
          "ref",
        )
      ).status,
    ).toBe("RECONCILIATION_REQUIRED");
    expect(() => new BankApiProvider({ endpoint: "https://bank.example/payouts", token: "test" })).toThrow();
  });
});
