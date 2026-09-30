import { AppError } from "../../../../packages/http/src/index.js";

export interface PayoutDestinationAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

export type PayoutExecutionResult =
  | { status: "PAID"; providerReference: string }
  | { status: "PAYOUT_FAILED"; reason: string }
  | { status: "RECONCILIATION_REQUIRED"; reason: string };

export interface IPayoutProvider {
  executePayout(
    amount: { minor: string; currency: "VND" },
    destinationAccount: PayoutDestinationAccount,
    reference: string,
  ): Promise<PayoutExecutionResult>;
}

/** Only a local REST mock is supported; no real bank endpoint can be configured. */
export class BankApiProvider implements IPayoutProvider {
  private readonly endpoint: string;
  public constructor(config: { endpoint: string; token: string; timeoutMs?: number }) {
    const url = new URL(config.endpoint);
    if (
      process.env.NODE_ENV === "production" ||
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !config.token ||
      !Number.isInteger(config.timeoutMs ?? 5000) ||
      (config.timeoutMs ?? 5000) < 100 ||
      (config.timeoutMs ?? 5000) > 60_000 ||
      url.username ||
      url.password
    )
      throw new AppError("PAYOUT_PROVIDER_INVALID", 503, "Only a local mock payout provider is supported");
    this.endpoint = url.toString();
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 5000;
  }
  private readonly token: string;
  private readonly timeoutMs: number;

  public async executePayout(
    amount: { minor: string; currency: "VND" },
    destinationAccount: PayoutDestinationAccount,
    reference: string,
  ): Promise<PayoutExecutionResult> {
    if (!/^[1-9]\d*$/.test(amount.minor) || BigInt(amount.minor) > BigInt(Number.MAX_SAFE_INTEGER))
      throw new AppError("INVALID_PAYOUT_AMOUNT", 422, "Payout amount is invalid");
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          "idempotency-key": reference,
        },
        body: JSON.stringify({
          amountMinor: amount.minor,
          currency: amount.currency,
          destinationAccount,
          reference,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400)
        return { status: "RECONCILIATION_REQUIRED", reason: "PROVIDER_REDIRECT_BLOCKED" };
      if (response.status >= 500 || [408, 409, 429].includes(response.status))
        return { status: "RECONCILIATION_REQUIRED", reason: "PROVIDER_RESPONSE_UNCERTAIN" };
      if (!response.ok)
        return { status: "PAYOUT_FAILED", reason: `PROVIDER_REJECTED_${String(response.status)}` };
      const data: unknown = await response.json();
      if (typeof data !== "object" || data === null || !("status" in data))
        return { status: "RECONCILIATION_REQUIRED", reason: "PROVIDER_RESPONSE_INVALID" };
      if (data.status === "rejected") return { status: "PAYOUT_FAILED", reason: "PROVIDER_REJECTED" };
      if (
        data.status === "paid" &&
        "providerReference" in data &&
        typeof data.providerReference === "string" &&
        data.providerReference.length > 0
      )
        return { status: "PAID", providerReference: data.providerReference };
      return { status: "RECONCILIATION_REQUIRED", reason: "PROVIDER_RESPONSE_UNCERTAIN" };
    } catch {
      return { status: "RECONCILIATION_REQUIRED", reason: "PROVIDER_TIMEOUT_OR_NETWORK_ERROR" };
    }
  }
}

export function payoutProviderFromEnv(env: NodeJS.ProcessEnv = process.env): IPayoutProvider | undefined {
  if (!env.BANK_PAYOUT_MOCK_URL) return undefined;
  return new BankApiProvider({
    endpoint: env.BANK_PAYOUT_MOCK_URL,
    token: env.BANK_PAYOUT_MOCK_TOKEN ?? "",
    timeoutMs: Number(env.BANK_PAYOUT_TIMEOUT_MS ?? 5000),
  });
}
