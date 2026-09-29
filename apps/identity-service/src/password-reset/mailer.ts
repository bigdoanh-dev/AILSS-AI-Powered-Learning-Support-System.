import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../../../../packages/config/src/index.js";

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

  public async sendResetCode(email: string, code: string, expiresMinutes: number): Promise<void> {
    if (!this.#transport || !this.#from) throw new Error("PASSWORD_RESET_EMAIL_UNAVAILABLE");
    await this.#transport.sendMail({
      from: this.#from,
      to: email,
      subject: "Mã xác nhận đặt lại mật khẩu AILSS",
      text: `Mã xác nhận đặt lại mật khẩu AILSS của bạn là ${code}. Mã có hiệu lực trong ${String(expiresMinutes)} phút. Nếu bạn không yêu cầu mã này, hãy bỏ qua email.`,
      html: `<!doctype html><html lang="vi"><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#102033"><main style="max-width:520px;margin:32px auto;padding:32px;background:#fff;border:1px solid #dbe3ef;border-radius:18px"><p style="color:#087eb5;font-size:13px;font-weight:700;letter-spacing:.08em">AILSS · XÁC THỰC TÀI KHOẢN</p><h1 style="font-size:24px">Đặt lại mật khẩu</h1><p>Nhập mã bên dưới để xác nhận yêu cầu của bạn. Mã chỉ sử dụng một lần và hết hạn sau ${String(expiresMinutes)} phút.</p><p style="padding:18px 20px;background:#edf7fc;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:.28em;text-align:center">${code}</p><p>Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.</p></main></body></html>`,
      headers: { "X-AILSS-Message-Type": "password-reset-otp" },
    });
  }
}
