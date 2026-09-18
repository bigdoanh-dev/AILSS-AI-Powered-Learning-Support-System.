/**
 * AILSS Commercial Payment & Payout Hard Gate Guard
 * 
 * Enforces Phase 29.25 and 29.26 strict fail-closed boundary:
 * Initial production operates in SANDBOX_ONLY payment mode and GATED payout mode.
 * Any inadvertent or unauthorized attempt to route real monetary transactions
 * fails closed immediately.
 */

export interface CommercialGateConfig {
  readonly enableCommercialPaymentsEnv?: string | undefined; // from process.env.ENABLE_COMMERCIAL_PAYMENTS
  readonly tenantCommercialPolicy: "SANDBOX_ONLY" | "LIVE_COMMERCIAL";
  readonly providerCredentialsConfigured: boolean;
  readonly adminAuthorizationSignature?: string | undefined;
  readonly payoutExecutionEnabled?: boolean | undefined;
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

export class CommercialGateGuard {
  /**
   * Enforces fail-closed payment routing.
   * Default production deployment fails closed into SANDBOX_SIMULATOR or rejects live requests.
   */
  public static evaluatePaymentExecution(
    config: CommercialGateConfig,
    request: { readonly amount: number; readonly currency: string; readonly liveSettlementRequested?: boolean },
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

    // Fail-closed condition 2: Live commercial requires all 4 gates
    const featureFlagActive = config.enableCommercialPaymentsEnv === "true";
    const credentialsPresent = config.providerCredentialsConfigured;
    const adminSigned = Boolean(config.adminAuthorizationSignature);

    if (!featureFlagActive || !credentialsPresent || !adminSigned) {
      return {
        allowed: false,
        mode: "SANDBOX_SIMULATOR",
        reason: `FAIL_CLOSED_INCOMPLETE_COMMERCIAL_GATES: flag=${String(featureFlagActive)}, creds=${String(credentialsPresent)}, adminAuth=${String(adminSigned)}`,
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
}
