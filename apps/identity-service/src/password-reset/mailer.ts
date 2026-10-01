import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../../../../packages/config/src/index.js";
import { passwordResetEmail } from "./email-template.js";

export interface PasswordResetEmailDelivery {
  readonly accepted: true;
  readonly messageId: string;
  readonly smtpResponseCode: number | undefined;
}

export class PasswordResetMailer {
  readonly #transport?: Transporter;
  readonly #from?: string;

  public constructor(config: AppConfig) {
    const host = config.SMTP_HOST?.trim();
    const user = config.SMTP_USER?.trim();
    const pass = config.SMTP_PASS?.trim();
    const from = config.SMTP_FROM?.trim();
    if (host && user && pass && from) {
      this.#transport = nodemailer.createTransport({
        host,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        requireTLS: !config.SMTP_SECURE,
        auth: { user, pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
      this.#from = from;
    }
  }

  public get isConfigured(): boolean {
    return Boolean(this.#transport && this.#from);
  }

  public async sendResetCode(
    email: string,
    code: string,
    expiresMinutes: number,
  ): Promise<PasswordResetEmailDelivery> {
    if (!this.#transport || !this.#from) throw new Error("PASSWORD_RESET_EMAIL_UNAVAILABLE");
    const delivery = await this.#transport.sendMail({
      from: this.#from,
      to: email,
      subject: "Mã xác nhận đặt lại mật khẩu AILSS",
      ...passwordResetEmail(code, expiresMinutes),
    });
    const accepted = delivery.accepted as (string | { address: string })[] | undefined;
    if (
      !accepted?.some(
        (recipient) =>
          (typeof recipient === "string" ? recipient : recipient.address).toLowerCase() ===
          email.toLowerCase(),
      )
    ) {
      throw new Error("SMTP_RECIPIENT_NOT_ACCEPTED");
    }
    const responseCode = /^(\d{3})\b/u.exec(String(delivery.response))?.[1];
    // A successful SMTP handoff is not confirmation of delivery to the inbox.
    // Retain only transport metadata, never the OTP or the complete SMTP reply.
    return {
      accepted: true,
      messageId: delivery.messageId,
      smtpResponseCode: responseCode ? Number(responseCode) : undefined,
    };
  }
}
