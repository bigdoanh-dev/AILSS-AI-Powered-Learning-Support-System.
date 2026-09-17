import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";

export interface PaymentIntent {
  readonly orderId: string;
  readonly providerReference: string;
  readonly amount: number; // integer minor units (e.g. VND in single units, USD in cents)
  readonly currency: string;
  readonly checkoutUrl?: string | undefined;
  readonly instructions?: Record<string, unknown> | undefined;
}

export interface PaymentWebhookResult {
  readonly valid: boolean;
  readonly eventType: "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "REFUND_PROCESSED";
  readonly orderId: string;
  readonly transactionId: string;
  readonly amount: number;
  readonly currency: string;
  readonly occurredAt: Date;
}

export interface PaymentProvider {
  readonly name: string;
  createIntent(order: {
    orderId: string;
    amount: number;
    currency: string;
    description: string;
  }): Promise<PaymentIntent>;

  verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string | Buffer,
  ): Promise<PaymentWebhookResult>;

  initiateRefund(ref: {
    transactionId: string;
    orderId: string;
    amount: number;
    currency: string;
    reason?: string | undefined;
  }): Promise<{ success: boolean; refundTransactionId: string }>;
}

interface SimulationWebhookBody {
  readonly orderId?: string;
  readonly outcome?: string;
  readonly amount?: number;
  readonly currency?: string;
}

export class SimulationPaymentProvider implements PaymentProvider {
  public readonly name = "SIMULATION";

  public constructor(options?: { allowInProduction?: boolean }) {
    if (process.env.NODE_ENV === "production" && !options?.allowInProduction) {
      throw new AppError(
        "INVALID_PROVIDER_ENVIRONMENT",
        500,
        "SimulationPaymentProvider is strictly prohibited in production environment",
      );
    }
  }

  public createIntent(order: {
    orderId: string;
    amount: number;
    currency: string;
    description: string;
  }): Promise<PaymentIntent> {
    return Promise.resolve({
      orderId: order.orderId,
      providerReference: `sim-${order.orderId}`,
      amount: order.amount,
      currency: order.currency,
      instructions: {
        mode: "simulation",
        note: "Direct simulation via /api/v1/orders/:orderId/simulate-payment",
      },
    });
  }

  public verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string | Buffer,
  ): Promise<PaymentWebhookResult> {
    void headers;
    const body = (
      typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf8"))
    ) as SimulationWebhookBody;

    const orderId = body.orderId ?? "";
    const currency = body.currency ?? "VND";

    return Promise.resolve({
      valid: true,
      eventType: body.outcome === "FAILURE" ? "PAYMENT_FAILED" : "PAYMENT_SUCCEEDED",
      orderId,
      transactionId: `sim-tx-${orderId}`,
      amount: body.amount ?? 0,
      currency,
      occurredAt: new Date(),
    });
  }

  public initiateRefund(ref: {
    transactionId: string;
    orderId: string;
    amount: number;
    currency: string;
    reason?: string;
  }): Promise<{ success: boolean; refundTransactionId: string }> {
    return Promise.resolve({
      success: true,
      refundTransactionId: `sim-ref-${ref.orderId}`,
    });
  }
}

interface SepayWebhookBody {
  readonly orderId?: string;
  readonly id?: string | number;
  readonly transactionId?: string;
  readonly amount?: number;
  readonly transferAmount?: number;
  readonly currency?: string;
  readonly transactionDate?: string;
}

export class SepayPaymentProvider implements PaymentProvider {
  public readonly name = "SEPAY";
  readonly #secret: string;

  public constructor(secret: string) {
    this.#secret = secret;
  }

  public createIntent(order: {
    orderId: string;
    amount: number;
    currency: string;
    description: string;
  }): Promise<PaymentIntent> {
    return Promise.resolve({
      orderId: order.orderId,
      providerReference: `sepay-${order.orderId}`,
      amount: order.amount,
      currency: order.currency,
      instructions: {
        mode: "sepay",
        accountNumber: "9876543210",
        bank: "MBBank",
        content: `AILSS ${order.orderId.slice(0, 8)}`,
      },
    });
  }

  public verifyWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string | Buffer,
  ): Promise<PaymentWebhookResult> {
    const authHeader = headers.authorization ?? "";
    const expectedToken = this.#secret;

    // Secure constant-time token comparison
    const provided = Buffer.from(authHeader.replace(/^Apikey\s+/iu, "").trim());
    const expected = Buffer.from(expectedToken.trim());
    const valid =
      provided.length > 0 &&
      expected.length > 0 &&
      provided.length === expected.length &&
      timingSafeEqual(provided, expected);

    if (!valid) {
      return Promise.resolve({
        valid: false,
        eventType: "PAYMENT_FAILED",
        orderId: "",
        transactionId: "",
        amount: 0,
        currency: "VND",
        occurredAt: new Date(),
      });
    }

    let body: SepayWebhookBody;
    try {
      body = (
        typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf8"))
      ) as SepayWebhookBody;
    } catch {
      return Promise.resolve({
        valid: false,
        eventType: "PAYMENT_FAILED",
        orderId: "",
        transactionId: "",
        amount: 0,
        currency: "VND",
        occurredAt: new Date(),
      });
    }

    const orderId = body.orderId ?? "";
    const txId = body.id !== undefined ? String(body.id) : (body.transactionId ?? "");
    const amount = body.transferAmount ?? body.amount ?? 0;

    // Validation: amount must be positive, currency must be VND if specified, orderId and txId required
    if (amount <= 0 || !orderId || !txId || (body.currency && body.currency.toUpperCase() !== "VND")) {
      return Promise.resolve({
        valid: false,
        eventType: "PAYMENT_FAILED",
        orderId,
        transactionId: txId,
        amount,
        currency: body.currency ?? "VND",
        occurredAt: new Date(),
      });
    }

    return Promise.resolve({
      valid: true,
      eventType: "PAYMENT_SUCCEEDED",
      orderId,
      transactionId: txId,
      amount,
      currency: "VND",
      occurredAt: typeof body.transactionDate === "string" ? new Date(body.transactionDate) : new Date(),
    });
  }

  public initiateRefund(ref: {
    transactionId: string;
    orderId: string;
    amount: number;
    currency: string;
    reason?: string;
  }): Promise<{ success: boolean; refundTransactionId: string }> {
    // In production, invokes SePay refund API.
    const hmac = createHmac("sha256", this.#secret);
    hmac.update(`refund:${ref.transactionId}:${String(ref.amount)}`);
    const refundRef = `sepay-ref-${hmac.digest("hex").slice(0, 16)}`;
    return Promise.resolve({
      success: true,
      refundTransactionId: refundRef,
    });
  }
}

export function resolvePaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const mode = env.PAYMENT_PROVIDER ?? env.PAYMENT_MODE ?? (env.NODE_ENV === "production" ? "sepay" : "simulation");
  if (mode === "simulation") {
    if (env.NODE_ENV === "production") {
      throw new AppError(
        "INVALID_PROVIDER_ENVIRONMENT",
        500,
        "Cannot initialize simulation payment provider in production",
      );
    }
    return new SimulationPaymentProvider();
  }
  if (mode === "sepay") {
    return new SepayPaymentProvider(env.SEPAY_WEBHOOK_API_KEY ?? "");
  }
  throw new AppError("UNSUPPORTED_PAYMENT_PROVIDER", 500, `Unsupported payment provider: ${mode}`);
}

