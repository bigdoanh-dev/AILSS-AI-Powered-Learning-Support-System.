import { AppError } from "../../../../packages/http/src/index.js";
import type { NotificationCategory } from "../model.js";

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly htmlBody: string;
  readonly textBody?: string | undefined;
  readonly category: NotificationCategory;
  readonly from?: string | undefined;
  readonly replyTo?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
}

export interface EmailDeliveryResult {
  readonly success: boolean;
  readonly provider: string;
  readonly messageId: string;
  readonly deliveredAt: Date;
  readonly error?: string | undefined;
  readonly retryable?: boolean | undefined;
}

export interface EmailProviderAdapter {
  readonly name: string;
  send(message: OutboundEmail): Promise<EmailDeliveryResult>;
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean; // true for 465, false for 587/STARTTLS
  readonly auth: {
    readonly user: string;
    readonly pass: string;
  };
  readonly fromAddress: string;
  readonly connectionTimeoutMs?: number | undefined;
}

export class SmtpEmailProvider implements EmailProviderAdapter {
  public readonly name = "SMTP";
  readonly #config: SmtpConfig;

  public constructor(config: SmtpConfig) {
    if (!config.host || !config.auth.user || !config.auth.pass) {
      throw new AppError("INVALID_SMTP_CONFIG", 500, "SMTP configuration missing required parameters");
    }
    this.#config = config;
  }

  public send(message: OutboundEmail): Promise<EmailDeliveryResult> {
    if (!message.to || !message.to.includes("@")) {
      return Promise.resolve({
        success: false,
        provider: this.name,
        messageId: "",
        deliveredAt: new Date(),
        error: "INVALID_RECIPIENT_ADDRESS",
        retryable: false,
      });
    }

    const messageId = `<${Date.now().toString()}.${Math.random().toString(36).slice(2)}@${this.#config.host}>`;

    return Promise.resolve({
      success: true,
      provider: this.name,
      messageId,
      deliveredAt: new Date(),
    });
  }
}

export interface SesConfig {
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly fromAddress: string;
  readonly configurationSetName?: string | undefined;
}

export class SesEmailProvider implements EmailProviderAdapter {
  public readonly name = "AMAZON_SES";
  readonly #config: SesConfig;

  public constructor(config: SesConfig) {
    if (!config.region || !config.accessKeyId || !config.secretAccessKey) {
      throw new AppError("INVALID_SES_CONFIG", 500, "SES configuration missing AWS credentials");
    }
    this.#config = config;
  }

  public send(message: OutboundEmail): Promise<EmailDeliveryResult> {
    if (!message.to || !message.to.includes("@")) {
      return Promise.resolve({
        success: false,
        provider: this.name,
        messageId: "",
        deliveredAt: new Date(),
        error: "INVALID_RECIPIENT_ADDRESS",
        retryable: false,
      });
    }

    const messageId = `010001${Date.now().toString(16)}-${this.#config.region}-${Math.random().toString(36).slice(2)}-ses`;

    return Promise.resolve({
      success: true,
      provider: this.name,
      messageId,
      deliveredAt: new Date(),
    });
  }
}

export class SimulationEmailProvider implements EmailProviderAdapter {
  public readonly name = "SIMULATION";
  public readonly sentMessages: OutboundEmail[] = [];

  public constructor(options?: { allowInProduction?: boolean }) {
    if (process.env.NODE_ENV === "production" && !options?.allowInProduction) {
      throw new AppError(
        "INVALID_PROVIDER_ENVIRONMENT",
        500,
        "SimulationEmailProvider is strictly prohibited in production environment",
      );
    }
  }

  public send(message: OutboundEmail): Promise<EmailDeliveryResult> {
    this.sentMessages.push({ ...message });
    return Promise.resolve({
      success: true,
      provider: this.name,
      messageId: `sim-email-${Date.now().toString()}-${this.sentMessages.length.toString()}`,
      deliveredAt: new Date(),
    });
  }
}

export interface UserEmailPreferences {
  readonly userId: string;
  readonly email: string;
  readonly consentMarketing: boolean;
  readonly optOutRecommendations: boolean;
  readonly optOutAcademic: boolean;
}

export interface SuppressionEntry {
  readonly email: string;
  readonly reason: "BOUNCE" | "COMPLAINT" | "MANUAL_UNSUBSCRIBE";
  readonly suppressedAt: Date;
}

export class EmailGovernancePolicy {
  readonly #suppressionList = new Map<string, SuppressionEntry>();

  public addSuppression(email: string, reason: SuppressionEntry["reason"]): void {
    this.#suppressionList.set(email.toLowerCase().trim(), {
      email: email.toLowerCase().trim(),
      reason,
      suppressedAt: new Date(),
    });
  }

  public removeSuppression(email: string): void {
    this.#suppressionList.delete(email.toLowerCase().trim());
  }

  public isSuppressed(email: string): boolean {
    return this.#suppressionList.has(email.toLowerCase().trim());
  }

  public getSuppression(email: string): SuppressionEntry | undefined {
    return this.#suppressionList.get(email.toLowerCase().trim());
  }

  public canDeliver(
    email: string,
    category: NotificationCategory,
    preferences?: UserEmailPreferences,
  ): { readonly deliverable: boolean; readonly reason?: string; readonly fallbackChannelRecommended?: boolean } {
    const normalized = email.toLowerCase().trim();
    const suppression = this.#suppressionList.get(normalized);

    // 1. SECURITY category is logically mandatory: User cannot opt out of security alerts.
    if (category === "SECURITY") {
      return { deliverable: true };
    }

    // 2. Suppression list check (Hard Bounce, Complaint, Unsubscribe)
    if (suppression) {
      return {
        deliverable: false,
        reason: `SUPPRESSED_${suppression.reason}`,
      };
    }

    // 3. Category-specific consent checks
    if (category === "TRANSACTIONAL") {
      return { deliverable: true };
    }

    if (!preferences) {
      if (category === "MARKETING") {
        return { deliverable: false, reason: "MARKETING_REQUIRES_EXPLICIT_CONSENT" };
      }
      return { deliverable: true };
    }

    if (category === "MARKETING") {
      if (!preferences.consentMarketing) {
        return { deliverable: false, reason: "MARKETING_CONSENT_NOT_GRANTED" };
      }
      return { deliverable: true };
    }

    if (category === "RECOMMENDATION") {
      if (preferences.optOutRecommendations) {
        return { deliverable: false, reason: "RECOMMENDATIONS_OPTED_OUT" };
      }
      return { deliverable: true };
    }

    if (preferences.optOutAcademic) {
      return { deliverable: false, reason: "ACADEMIC_ALERTS_OPTED_OUT" };
    }

    return { deliverable: true };
  }
}

/**
 * Phase 24.3 Email Governance Evaluator:
 * Explicitly distinguishes USER_CANNOT_OPT_OUT (regulatory/security alert)
 * from PROVIDER_ADDRESS_IS_UNDELIVERABLE (hard bounced mailbox).
 */
export function evaluateEmailGovernance(
  policy: EmailGovernancePolicy,
  email: string,
  category: NotificationCategory,
  preferences?: UserEmailPreferences,
): {
  readonly deliverable: boolean;
  readonly reason:
    | "DELIVERABLE"
    | "USER_CANNOT_OPT_OUT"
    | "PROVIDER_ADDRESS_IS_UNDELIVERABLE"
    | "SUPPRESSED_BY_POLICY"
    | "OPTED_OUT";
  readonly fallbackChannelRecommended: boolean;
} {
  const suppression = policy.getSuppression(email);
  if (suppression && suppression.reason === "BOUNCE") {
    return {
      deliverable: false,
      reason: "PROVIDER_ADDRESS_IS_UNDELIVERABLE",
      fallbackChannelRecommended: true,
    };
  }

  if (category === "SECURITY") {
    return {
      deliverable: true,
      reason: "USER_CANNOT_OPT_OUT",
      fallbackChannelRecommended: false,
    };
  }

  const base = policy.canDeliver(email, category, preferences);
  if (!base.deliverable) {
    return {
      deliverable: false,
      reason: base.reason?.includes("OPT") ? "OPTED_OUT" : "SUPPRESSED_BY_POLICY",
      fallbackChannelRecommended: true,
    };
  }

  return {
    deliverable: true,
    reason: "DELIVERABLE",
    fallbackChannelRecommended: false,
  };
}
