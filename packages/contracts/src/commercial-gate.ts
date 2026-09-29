import crypto from "node:crypto";

/**
 * AILSS Commercial Payment & Payout Hard Gate Guard
 *
 * Enforces Phase 29.25, 29.26, and Phase 34.22 - 34.32:
 * Initial production operates in SANDBOX_ONLY payment mode and GATED payout mode.
 * Any inadvertent or unauthorized attempt to route real monetary transactions
 * fails closed immediately.
 * Enforces payment state machine, webhook durability, double-entry ledger, and refund integrity.
 */

export interface CommercialGateConfig {
  readonly enableCommercialPaymentsEnv?: string | undefined; // from process.env.ENABLE_COMMERCIAL_PAYMENTS
  readonly tenantCommercialPolicy: "SANDBOX_ONLY" | "LIVE_COMMERCIAL";
  readonly providerCredentialsConfigured: boolean;
  readonly adminAuthorizationSignature?: string | undefined;
  readonly payoutExecutionEnabled?: boolean | undefined;
  readonly externalAssessmentPassed?: boolean | undefined;
  readonly asvScanPassed?: boolean | undefined;
}

export interface PaymentGateDecision {
  readonly allowed: boolean;
  readonly mode: "SANDBOX_SIMULATOR" | "LIVE_COMMERCIAL";
  readonly reason: string;
  readonly failClosed: boolean;
}

export interface PayoutGateDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly gated: boolean;
}

export type PaymentState =
  | "CREATED"
  | "CHECKOUT_CREATED"
  | "PENDING"
  | "PAID"
  | "FAILED"
  | "EXPIRED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "RECONCILIATION_REQUIRED";

export interface PaymentEvent {
  readonly type:
    | "CHECKOUT_INITIALIZED"
    | "PROVIDER_PENDING"
    | "PAYMENT_CONFIRMED"
    | "PAYMENT_FAILED"
    | "EXPIRED"
    | "REFUND_REQUESTED"
    | "REFUND_COMPLETED"
    | "ANOMALY_DETECTED";
  readonly timestamp: string;
  readonly reason?: string;
}

export interface WebhookPayload {
  readonly eventId: string;
  readonly transactionId: string;
  readonly orderId: string;
  readonly amountMinorUnits: number; // Must be integer minor units (no float)
  readonly currency: string;
  readonly timestamp: number; // Unix epoch seconds or ms
  readonly tenantId: string;
  readonly status: "SUCCESS" | "FAILED";
}

export interface DoubleEntryLedgerEntry {
  readonly entryId: string;
  readonly transactionId: string;
  readonly orderId: string;
  readonly debitAccount: string;
  readonly creditAccount: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly recordedAt: string;
  readonly type: "SETTLEMENT" | "REFUND_REVERSAL";
}

export class CommercialGateGuard {
  /**
   * Enforces fail-closed payment routing.
   * Default production deployment fails closed into SANDBOX_SIMULATOR or rejects live requests.
   */
  public static evaluatePaymentExecution(
    config: CommercialGateConfig,
    request: {
      readonly amount: number;
      readonly currency: string;
      readonly liveSettlementRequested?: boolean;
    },
  ): PaymentGateDecision {
    // Fail-closed condition 1: Tenant policy is explicitly SANDBOX_ONLY
    if (config.tenantCommercialPolicy === "SANDBOX_ONLY") {
      if (request.liveSettlementRequested) {
        return {
          allowed: false,
          mode: "SANDBOX_SIMULATOR",
          reason: "REJECTED_LIVE_SETTLEMENT_PROHIBITED_UNDER_SANDBOX_POLICY",
          failClosed: true,
        };
      }
      return {
        allowed: true,
        mode: "SANDBOX_SIMULATOR",
        reason: "ROUTED_TO_SANDBOX_SIMULATOR_NO_MONETARY_MOVEMENT",
        failClosed: false,
      };
    }

    // Fail-closed condition 2: Live commercial requires all gates (env, creds, admin auth, external assessment, ASV)
    const featureFlagActive = config.enableCommercialPaymentsEnv === "true";
    const credentialsPresent = config.providerCredentialsConfigured;
    const adminSigned = Boolean(config.adminAuthorizationSignature);
    const externalAssessed = Boolean(config.externalAssessmentPassed);
    const asvScanned = Boolean(config.asvScanPassed);

    if (!featureFlagActive || !credentialsPresent || !adminSigned || !externalAssessed || !asvScanned) {
      return {
        allowed: false,
        mode: "SANDBOX_SIMULATOR",
        reason: `FAIL_CLOSED_INCOMPLETE_COMMERCIAL_GATES: flag=${String(featureFlagActive)}, creds=${String(credentialsPresent)}, adminAuth=${String(adminSigned)}, pentest=${String(externalAssessed)}, asv=${String(asvScanned)}`,
        failClosed: true,
      };
    }

    return {
      allowed: true,
      mode: "LIVE_COMMERCIAL",
      reason: "ALL_COMMERCIAL_GATES_VERIFIED",
      failClosed: false,
    };
  }

  /**
   * Enforces strict gating on partner disbursements and revenue payouts.
   * Payouts are permanently GATED in pilot and initial production.
   */
  public static evaluatePayoutExecution(
    config: CommercialGateConfig,
    _request: { readonly recipientId: string; readonly amount: number },
  ): PayoutGateDecision {
    if (!config.payoutExecutionEnabled) {
      return {
        allowed: false,
        reason: "PAYOUT_OPERATION_GATED_IN_INITIAL_PRODUCTION",
        gated: true,
      };
    }

    // Even if enabled, payout requires explicit non-sandbox tenant policy
    if (config.tenantCommercialPolicy !== "LIVE_COMMERCIAL") {
      return {
        allowed: false,
        reason: "PAYOUT_OPERATION_PROHIBITED_UNDER_NON_COMMERCIAL_POLICY",
        gated: true,
      };
    }

    return {
      allowed: true,
      reason: "PAYOUT_OPERATION_AUTHORIZED",
      gated: false,
    };
  }

  /**
   * Enforces canonical payment state machine transitions.
   * Throws Error on any impossible or illegal transition.
   */
  public static transitionPaymentState(currentState: PaymentState, event: PaymentEvent): PaymentState {
    switch (currentState) {
      case "CREATED":
        if (event.type === "CHECKOUT_INITIALIZED") return "CHECKOUT_CREATED";
        if (event.type === "EXPIRED") return "EXPIRED";
        break;

      case "CHECKOUT_CREATED":
        if (event.type === "PROVIDER_PENDING") return "PENDING";
        if (event.type === "PAYMENT_CONFIRMED") return "PAID";
        if (event.type === "PAYMENT_FAILED") return "FAILED";
        if (event.type === "EXPIRED") return "EXPIRED";
        break;

      case "PENDING":
        if (event.type === "PAYMENT_CONFIRMED") return "PAID";
        if (event.type === "PAYMENT_FAILED") return "FAILED";
        if (event.type === "EXPIRED") return "EXPIRED";
        if (event.type === "ANOMALY_DETECTED") return "RECONCILIATION_REQUIRED";
        break;

      case "PAID":
        if (event.type === "REFUND_REQUESTED") return "REFUND_PENDING";
        if (event.type === "ANOMALY_DETECTED") return "RECONCILIATION_REQUIRED";
        break;

      case "REFUND_PENDING":
        if (event.type === "REFUND_COMPLETED") return "REFUNDED";
        if (event.type === "ANOMALY_DETECTED") return "RECONCILIATION_REQUIRED";
        break;

      case "FAILED":
      case "EXPIRED":
      case "REFUNDED":
        // Terminal states cannot transition to PAID
        break;

      case "RECONCILIATION_REQUIRED":
        if (event.type === "PAYMENT_CONFIRMED") return "PAID";
        if (event.type === "REFUND_COMPLETED") return "REFUNDED";
        break;
    }

    throw new Error(
      `ILLEGAL_PAYMENT_STATE_TRANSITION: Cannot transition from ${currentState} via ${event.type}`,
    );
  }

  /**
   * Verifies and records a payment provider webhook with strict replay protection,
   * HMAC-SHA256 signature verification, freshness check (<= 300s), and integer minor unit validation.
   */
  public static verifyAndDeduplicateWebhook(
    payload: WebhookPayload,
    signature: string,
    secret: string,
    processedStore: Set<string>,
  ): { readonly success: boolean; readonly duplicate: boolean; readonly reason?: string } {
    // 1. Integer minor unit validation (no floats allowed)
    if (!Number.isInteger(payload.amountMinorUnits) || payload.amountMinorUnits <= 0) {
      throw new Error(
        `INVALID_MONETARY_UNIT: amountMinorUnits must be positive integer, received ${payload.amountMinorUnits}`,
      );
    }

    // 2. Freshness check: timestamp must be within 300 seconds (5 minutes)
    const nowEpochSec = Math.floor(Date.now() / 1000);
    const payloadEpochSec =
      payload.timestamp > 1_000_000_000_000 ? Math.floor(payload.timestamp / 1000) : payload.timestamp;
    if (Math.abs(nowEpochSec - payloadEpochSec) > 300) {
      return { success: false, duplicate: false, reason: "WEBHOOK_TIMESTAMP_EXPIRED" };
    }

    // 3. HMAC-SHA256 signature check
    const dataToSign = `${payload.eventId}:${payload.transactionId}:${payload.orderId}:${payload.amountMinorUnits}:${payload.currency}:${payload.timestamp}`;
    const expectedSignature = crypto.createHmac("sha256", secret).update(dataToSign).digest("hex");
    if (signature !== expectedSignature) {
      return { success: false, duplicate: false, reason: "INVALID_HMAC_SIGNATURE" };
    }

    // 4. Durable idempotency: check if event has already been processed
    const dedupeKey = `${payload.tenantId}:${payload.eventId}:${payload.transactionId}`;
    if (processedStore.has(dedupeKey)) {
      return { success: true, duplicate: true, reason: "EVENT_ALREADY_PROCESSED_IDEMPOTENT" };
    }

    processedStore.add(dedupeKey);
    return { success: true, duplicate: false };
  }

  /**
   * Generates balanced double-entry ledger records in minor units.
   */
  public static recordDoubleEntryLedger(
    transactionId: string,
    orderId: string,
    amountMinorUnits: number,
    currency: string,
    type: "SETTLEMENT" | "REFUND_REVERSAL" = "SETTLEMENT",
  ): DoubleEntryLedgerEntry {
    if (!Number.isInteger(amountMinorUnits) || amountMinorUnits <= 0) {
      throw new Error(
        `INVALID_LEDGER_AMOUNT: Must be positive integer minor units, received ${amountMinorUnits}`,
      );
    }

    const recordedAt = new Date().toISOString();
    if (type === "SETTLEMENT") {
      return {
        entryId: `ledger-${crypto.randomUUID()}`,
        transactionId,
        orderId,
        debitAccount: "112_ACCOUNTS_RECEIVABLE_PAYMENT_GATEWAY",
        creditAccount: "511_UNEARNED_COURSE_SUBSCRIPTION_REVENUE",
        amountMinorUnits,
        currency,
        recordedAt,
        type: "SETTLEMENT",
      };
    } else {
      return {
        entryId: `ledger-${crypto.randomUUID()}`,
        transactionId,
        orderId,
        debitAccount: "511_UNEARNED_COURSE_SUBSCRIPTION_REVENUE",
        creditAccount: "112_ACCOUNTS_RECEIVABLE_PAYMENT_GATEWAY",
        amountMinorUnits,
        currency,
        recordedAt,
        type: "REFUND_REVERSAL",
      };
    }
  }

  /**
   * Reconciles payment provider transaction with internal order, ledger, and course entitlement.
   */
  public static reconcilePaymentTransaction(
    order: { id: string; amountMinorUnits: number; currency: string; status: PaymentState },
    providerTx: {
      id: string;
      orderId: string;
      amountMinorUnits: number;
      currency: string;
      status: "PAID" | "FAILED";
    },
    ledgerEntries: readonly DoubleEntryLedgerEntry[],
    entitlementActive: boolean,
  ): { reconciled: boolean; discrepancies: readonly string[] } {
    const discrepancies: string[] = [];

    if (order.id !== providerTx.orderId) {
      discrepancies.push(`ORDER_ID_MISMATCH: order=${order.id}, providerTx=${providerTx.orderId}`);
    }

    if (order.amountMinorUnits !== providerTx.amountMinorUnits) {
      discrepancies.push(
        `AMOUNT_MISMATCH: order=${order.amountMinorUnits}, providerTx=${providerTx.amountMinorUnits}`,
      );
    }

    if (order.currency !== providerTx.currency) {
      discrepancies.push(`CURRENCY_MISMATCH: order=${order.currency}, providerTx=${providerTx.currency}`);
    }

    const matchingLedger = ledgerEntries.filter(
      (e) => e.orderId === order.id && e.transactionId === providerTx.id,
    );
    if (providerTx.status === "PAID") {
      if (matchingLedger.length === 0) {
        discrepancies.push("MISSING_LEDGER_RECORD_FOR_PAID_TRANSACTION");
      }
      if (!entitlementActive) {
        discrepancies.push("ENTITLEMENT_NOT_PROVISIONED_FOR_PAID_ORDER");
      }
    }

    return {
      reconciled: discrepancies.length === 0,
      discrepancies,
    };
  }
}
