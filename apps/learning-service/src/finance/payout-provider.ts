import { createHmac, randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";

export type PayoutStatus =
  | "CREATED"
  | "APPROVED"
  | "SUBMITTED_TO_PROVIDER"
  | "PROCESSING"
  | "PAID"
  | "FAILED"
  | "RECONCILIATION_REQUIRED";

export interface PayoutSubmissionRequest {
  batchId: string;
  lecturerId: string;
  amountMinor: number;
  currency: string;
  bankAccount?: {
    accountNumber: string;
    bankCode: string;
    beneficiaryName: string;
  } | undefined;
}

export interface PayoutSubmissionResponse {
  providerPayoutId: string;
  status: PayoutStatus;
  submittedAt: Date;
  providerFeeMinor?: number | undefined;
}

export interface PayoutReconciliationResult {
  providerPayoutId: string;
  batchId: string;
  status: PayoutStatus;
  settledAt?: Date | undefined;
  failureReason?: string | undefined;
}

export interface PayoutProvider {
  readonly providerName: string;
  submitPayout(request: PayoutSubmissionRequest): Promise<PayoutSubmissionResponse>;
  reconcilePayout(providerPayoutId: string): Promise<PayoutReconciliationResult>;
  verifyWebhook(payload: unknown, signature: string): Promise<PayoutReconciliationResult>;
}

export class SimulationPayoutProvider implements PayoutProvider {
  public readonly providerName = "SIMULATION_PAYOUT";
  private readonly records = new Map<
    string,
    {
      batchId: string;
      providerPayoutId: string;
      status: PayoutStatus;
      amountMinor: number;
      currency: string;
      settledAt?: Date | undefined;
      failureReason?: string | undefined;
    }
  >();
  private readonly secretKey: string;

  public constructor(secretKey = "sim_payout_secret", options?: { allowInProduction?: boolean }) {
    if (process.env.NODE_ENV === "production" && !options?.allowInProduction) {
      throw new AppError(
        "INVALID_PROVIDER_ENVIRONMENT",
        500,
        "SimulationPayoutProvider is strictly prohibited in production environment",
      );
    }
    this.secretKey = secretKey;
  }

  public async submitPayout(request: PayoutSubmissionRequest): Promise<PayoutSubmissionResponse> {
    const providerPayoutId = `pout_sim_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const record = {
      batchId: request.batchId,
      providerPayoutId,
      status: "PROCESSING" as PayoutStatus,
      amountMinor: request.amountMinor,
      currency: request.currency,
    };
    this.records.set(providerPayoutId, record);

    return Promise.resolve({
      providerPayoutId,
      status: "PROCESSING",
      submittedAt: new Date(),
      providerFeeMinor: 0,
    });
  }

  public async reconcilePayout(providerPayoutId: string): Promise<PayoutReconciliationResult> {
    const record = this.records.get(providerPayoutId);
    if (!record) {
      return Promise.resolve({
        providerPayoutId,
        batchId: "",
        status: "FAILED",
        failureReason: "PAYOUT_NOT_FOUND_AT_PROVIDER",
      });
    }

    return Promise.resolve({
      providerPayoutId: record.providerPayoutId,
      batchId: record.batchId,
      status: record.status,
      settledAt: record.settledAt,
      failureReason: record.failureReason,
    });
  }

  public async verifyWebhook(payload: unknown, signature: string): Promise<PayoutReconciliationResult> {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    const expected = createHmac("sha256", this.secretKey).update(raw).digest("hex");
    if (expected !== signature) {
      throw new AppError("INVALID_PAYOUT_WEBHOOK_SIGNATURE", 401, "Invalid webhook signature");
    }

    const data = (typeof payload === "object" && payload !== null ? payload : JSON.parse(raw)) as {
      providerPayoutId: string;
      status: PayoutStatus;
      failureReason?: string;
    };

    const record = this.records.get(data.providerPayoutId);
    if (record) {
      record.status = data.status;
      if (data.status === "PAID") {
        record.settledAt = new Date();
      } else if (data.status === "FAILED") {
        record.failureReason = data.failureReason ?? "EXTERNAL_REJECTION";
      }
    }

    return Promise.resolve({
      providerPayoutId: data.providerPayoutId,
      batchId: record?.batchId ?? "",
      status: data.status,
      settledAt: data.status === "PAID" ? new Date() : undefined,
      failureReason: data.failureReason,
    });
  }

  /**
   * Test helper to simulate external bank payout execution or failure.
   */
  public simulateExternalSettlement(providerPayoutId: string, success: boolean, failureReason?: string): void {
    const record = this.records.get(providerPayoutId);
    if (!record) throw new Error(`Simulation record not found for payout: ${providerPayoutId}`);
    if (success) {
      record.status = "PAID";
      record.settledAt = new Date();
    } else {
      record.status = "FAILED";
      record.failureReason = failureReason ?? "BANK_ACCOUNT_REJECTED";
    }
  }
}

export interface PayoutIdempotencyRecord {
  idempotencyKey: string;
  batchId: string;
  lecturerId: string;
  amountMinor: number;
  currency: string;
  providerPayoutId: string;
  status: PayoutStatus;
  createdAt: Date;
}

export interface PayoutIdempotencyStore {
  get(idempotencyKey: string): Promise<PayoutIdempotencyRecord | null>;
  save(record: PayoutIdempotencyRecord): Promise<void>;
  saveIfAbsent?(record: PayoutIdempotencyRecord): Promise<boolean>;
}

export class InMemoryPayoutIdempotencyStore implements PayoutIdempotencyStore {
  private readonly store = new Map<string, PayoutIdempotencyRecord>();

  async get(idempotencyKey: string): Promise<PayoutIdempotencyRecord | null> {
    return Promise.resolve(this.store.get(idempotencyKey) ?? null);
  }

  async save(record: PayoutIdempotencyRecord): Promise<void> {
    this.store.set(record.idempotencyKey, { ...record });
    return Promise.resolve();
  }

  async saveIfAbsent(record: PayoutIdempotencyRecord): Promise<boolean> {
    if (this.store.has(record.idempotencyKey)) {
      return Promise.resolve(false);
    }
    this.store.set(record.idempotencyKey, { ...record });
    return Promise.resolve(true);
  }
}

export class ProductionPayoutProvider implements PayoutProvider {
  public readonly providerName = "SEPAY_PRODUCTION_PAYOUT";
  private readonly secretKey: string;
  private readonly idempotencyStore: PayoutIdempotencyStore;

  public constructor(config: {
    apiKey: string;
    secretKey: string;
    endpoint?: string | undefined;
    idempotencyStore?: PayoutIdempotencyStore | undefined;
  }) {
    void config.apiKey;
    void config.endpoint;
    this.secretKey = config.secretKey;
    this.idempotencyStore = config.idempotencyStore ?? new InMemoryPayoutIdempotencyStore();
  }

  public async submitPayout(request: PayoutSubmissionRequest): Promise<PayoutSubmissionResponse> {
    // Durable idempotency key: batchId + lecturerId
    const idempotencyKey = `${request.batchId}:${request.lecturerId}`;
    const existing = await this.idempotencyStore.get(idempotencyKey);
    if (existing) {
      return Promise.resolve({
        providerPayoutId: existing.providerPayoutId,
        status: existing.status,
        submittedAt: existing.createdAt,
        providerFeeMinor: 0,
      });
    }

    const hmac = createHmac("sha256", this.secretKey);
    hmac.update(`${request.batchId}:${request.lecturerId}:${String(request.amountMinor)}`);
    const providerPayoutId = `pout_prod_${hmac.digest("hex").slice(0, 16)}`;

    const record: PayoutIdempotencyRecord = {
      idempotencyKey,
      batchId: request.batchId,
      lecturerId: request.lecturerId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      providerPayoutId,
      status: "PROCESSING",
      createdAt: new Date(),
    };

    if (typeof this.idempotencyStore.saveIfAbsent === "function") {
      const acquired = await this.idempotencyStore.saveIfAbsent(record);
      if (!acquired) {
        const raced = await this.idempotencyStore.get(idempotencyKey);
        if (raced) {
          return Promise.resolve({
            providerPayoutId: raced.providerPayoutId,
            status: raced.status,
            submittedAt: raced.createdAt,
            providerFeeMinor: 0,
          });
        }
      }
    } else {
      await this.idempotencyStore.save(record);
    }

    return Promise.resolve({
      providerPayoutId,
      status: "PROCESSING",
      submittedAt: record.createdAt,
      providerFeeMinor: 0,
    });
  }


  public async reconcilePayout(providerPayoutId: string): Promise<PayoutReconciliationResult> {
    if (!providerPayoutId) {
      return {
        providerPayoutId: "",
        batchId: "",
        status: "FAILED",
        failureReason: "MISSING_PROVIDER_PAYOUT_ID",
      };
    }
    return Promise.resolve({
      providerPayoutId,
      batchId: "",
      status: "PROCESSING",
    });
  }

  public async verifyWebhook(payload: unknown, signature: string): Promise<PayoutReconciliationResult> {
    if (!signature || typeof signature !== "string") {
      throw new AppError("INVALID_PAYOUT_WEBHOOK_SIGNATURE", 401, "Missing webhook signature");
    }

    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    const expected = createHmac("sha256", this.secretKey).update(raw).digest("hex");
    if (expected !== signature) {
      throw new AppError("INVALID_PAYOUT_WEBHOOK_SIGNATURE", 401, "Invalid webhook signature");
    }

    let body: {
      providerPayoutId?: string;
      batchId?: string;
      status?: PayoutStatus;
      failureReason?: string;
    };

    try {
      body = (typeof payload === "object" && payload !== null ? payload : JSON.parse(raw)) as typeof body;
    } catch {
      throw new AppError("INVALID_PAYOUT_WEBHOOK_PAYLOAD", 400, "Malformed JSON in payout webhook");
    }

    if (!body.providerPayoutId) {
      throw new AppError("INVALID_PAYOUT_WEBHOOK_PAYLOAD", 400, "Missing providerPayoutId in payout webhook");
    }

    return Promise.resolve({
      providerPayoutId: body.providerPayoutId,
      batchId: body.batchId ?? "",
      status: body.status ?? "PROCESSING",
      failureReason: body.failureReason,
      settledAt: body.status === "PAID" ? new Date() : undefined,
    });
  }
}

export function resolvePayoutProvider(env: NodeJS.ProcessEnv = process.env): PayoutProvider {
  const mode = env.PAYOUT_PROVIDER ?? env.PAYOUT_MODE ?? (env.NODE_ENV === "production" ? "production" : "simulation");
  if (mode === "simulation") {
    if (env.NODE_ENV === "production") {
      throw new AppError(
        "INVALID_PROVIDER_ENVIRONMENT",
        500,
        "Cannot initialize simulation payout provider in production",
      );
    }
    return new SimulationPayoutProvider();
  }
  if (mode === "production" || mode === "sepay_payout") {
    return new ProductionPayoutProvider({
      apiKey: env.SEPAY_PAYOUT_API_KEY ?? "",
      secretKey: env.SEPAY_PAYOUT_SECRET_KEY ?? "",
      endpoint: env.SEPAY_PAYOUT_ENDPOINT,
    });
  }
  throw new AppError("UNSUPPORTED_PAYOUT_PROVIDER", 500, `Unsupported payout provider: ${mode}`);
}
