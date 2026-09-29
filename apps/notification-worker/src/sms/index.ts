import { AppError } from "../../../../packages/http/src/index.js";

export type SmsPurpose = "TWO_FACTOR_AUTHENTICATION" | "SECURITY_STEP_UP" | "INFORMATIONAL";

export interface OutboundSms {
  readonly recipientPhone: string;
  readonly message: string;
  readonly purpose: SmsPurpose;
  readonly requestId: string;
}

export interface SmsDeliveryResult {
  readonly success: boolean;
  readonly provider: string;
  readonly messageSid: string;
  readonly deliveredAt: Date;
  readonly error?: string | undefined;
}

export interface SmsGovernanceConfig {
  readonly allowedCountryCodes: readonly string[]; // e.g. ["+84"]
  readonly maxPerHourPerRecipient: number; // default: 3
  readonly maxPerDayPerRecipient: number; // default: 5
  readonly allowInformationalSms: boolean; // default: false in production pilot
}

export const DEFAULT_SMS_GOVERNANCE: SmsGovernanceConfig = {
  allowedCountryCodes: ["+84"],
  maxPerHourPerRecipient: 3,
  maxPerDayPerRecipient: 5,
  allowInformationalSms: false,
};

export class SmsGovernanceGuard {
  readonly #config: SmsGovernanceConfig;
  readonly #history = new Map<string, number[]>(); // phone -> timestamps

  public constructor(config: Partial<SmsGovernanceConfig> = {}) {
    this.#config = { ...DEFAULT_SMS_GOVERNANCE, ...config };
  }

  public validateOutbound(
    sms: OutboundSms,
    now = Date.now(),
  ): { readonly allowed: boolean; readonly reason?: string } {
    const phone = sms.recipientPhone.trim();

    // 1. Informational SMS policy check
    if (sms.purpose === "INFORMATIONAL" && !this.#config.allowInformationalSms) {
      return {
        allowed: false,
        reason:
          "SMS_INFORMATIONAL_DISABLED_IN_PILOT: SMS is restricted to security MFA only to prevent high telco costs",
      };
    }

    // 2. Anti-toll-fraud: Premium rate number detection
    // In Vietnam: 1900, 1800 or international premium prefixes
    if (/^(?:\+84|0)?1900/u.test(phone) || /^(?:\+84|0)?1800/u.test(phone)) {
      return {
        allowed: false,
        reason: "PREMIUM_RATE_NUMBER_BLOCKED",
      };
    }

    // 3. Country code allowlist check
    const matchedCountry = this.#config.allowedCountryCodes.some(
      (code) =>
        phone.startsWith(code) || (code === "+84" && (phone.startsWith("0") || phone.startsWith("84"))),
    );

    if (!matchedCountry) {
      return {
        allowed: false,
        reason: `COUNTRY_CODE_NOT_PERMITTED: Only [${this.#config.allowedCountryCodes.join(", ")}] allowed`,
      };
    }

    // 4. Rate limiting check (sliding window)
    const timestamps = this.#history.get(phone) ?? [];
    const oneHourAgo = now - 3600 * 1000;
    const oneDayAgo = now - 86400 * 1000;

    const lastHourCount = timestamps.filter((t) => t > oneHourAgo).length;
    if (lastHourCount >= this.#config.maxPerHourPerRecipient) {
      return {
        allowed: false,
        reason: "RECIPIENT_HOURLY_RATE_LIMIT_EXCEEDED",
      };
    }

    const lastDayCount = timestamps.filter((t) => t > oneDayAgo).length;
    if (lastDayCount >= this.#config.maxPerDayPerRecipient) {
      return {
        allowed: false,
        reason: "RECIPIENT_DAILY_RATE_LIMIT_EXCEEDED",
      };
    }

    return { allowed: true };
  }

  public recordSent(phone: string, timestamp = Date.now()): void {
    const list = this.#history.get(phone) ?? [];
    list.push(timestamp);
    // Keep only last 24 hours
    const cutoff = timestamp - 86400 * 1000;
    this.#history.set(
      phone,
      list.filter((t) => t > cutoff),
    );
  }
}

export class SimulationSmsProvider {
  public readonly name = "SIMULATION_SMS";
  public readonly sentSms: OutboundSms[] = [];
  readonly #guard: SmsGovernanceGuard;

  public constructor(guard?: SmsGovernanceGuard, options?: { allowInProduction?: boolean }) {
    if (process.env.NODE_ENV === "production" && !options?.allowInProduction) {
      throw new AppError(
        "INVALID_PROVIDER_ENVIRONMENT",
        500,
        "SimulationSmsProvider is strictly prohibited in production environment",
      );
    }
    this.#guard = guard ?? new SmsGovernanceGuard();
  }

  public send(sms: OutboundSms): Promise<SmsDeliveryResult> {
    const check = this.#guard.validateOutbound(sms);
    if (!check.allowed) {
      return Promise.resolve({
        success: false,
        provider: this.name,
        messageSid: "",
        deliveredAt: new Date(),
        error: check.reason,
      });
    }

    this.sentSms.push({ ...sms });
    this.#guard.recordSent(sms.recipientPhone);

    return Promise.resolve({
      success: true,
      provider: this.name,
      messageSid: `SM_sim_${Date.now().toString()}_${Math.random().toString(36).slice(2, 8)}`,
      deliveredAt: new Date(),
    });
  }
}
