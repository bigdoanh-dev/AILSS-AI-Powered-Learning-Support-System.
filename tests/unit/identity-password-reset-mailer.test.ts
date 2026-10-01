import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../../packages/config/src/index.js";
import { PasswordResetMailer } from "../../apps/identity-service/src/password-reset/mailer.js";
import { passwordResetEmail } from "../../apps/identity-service/src/password-reset/email-template.js";

const { sendMail, createTransport } = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
afterEach(() => vi.resetAllMocks());

const config = {
  SMTP_HOST: "smtp.example.invalid",
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: "sender@example.invalid",
  SMTP_PASS: "test-only-password",
  SMTP_FROM: "sender@example.invalid",
} as AppConfig;
function mailer() {
  createTransport.mockReturnValue({ sendMail });
  return new PasswordResetMailer(config);
}

describe("OTP SMTP delivery evidence", () => {
  it("returns only metadata when the intended recipient is accepted", async () => {
    const smtp = mailer();
    sendMail.mockResolvedValue({
      accepted: ["receiver@example.invalid"],
      rejected: [],
      response: "250 2.0.0 OK queued test-provider-reply",
      messageId: "<test-message@example.invalid>",
    });
    const result = await smtp.sendResetCode("receiver@example.invalid", "123456", 15);
    expect(result).toEqual({
      accepted: true,
      smtpResponseCode: 250,
      messageId: "<test-message@example.invalid>",
    });
    expect(JSON.stringify(result)).not.toContain("123456");
    expect(JSON.stringify(result)).not.toContain("test-provider-reply");
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "receiver@example.invalid",
        from: "sender@example.invalid",
        text: expect.stringContaining("123456"),
        html: expect.stringContaining("123456"),
      }),
    );
    expect(sendMail.mock.calls[0]?.[0]).not.toHaveProperty("headers");
  });
  it.each([{ accepted: [] }, { accepted: ["someone-else@example.invalid"] }])(
    "rejects handoff without acceptance of the intended recipient: %j",
    async ({ accepted }) => {
      const smtp = mailer();
      sendMail.mockResolvedValue({ accepted, response: "250 OK", messageId: "test" });
      await expect(smtp.sendResetCode("receiver@example.invalid", "123456", 15)).rejects.toThrow(
        "SMTP_RECIPIENT_NOT_ACCEPTED",
      );
    },
  );
  it("preserves transport failure for service cleanup and error logging", async () => {
    const smtp = mailer();
    sendMail.mockRejectedValue(new Error("SMTP authentication failed"));
    await expect(smtp.sendResetCode("receiver@example.invalid", "123456", 15)).rejects.toThrow(
      "SMTP authentication failed",
    );
  });
});

describe("OTP email presentation", () => {
  it("keeps the same code and expiry in HTML and plain text without remote resources", () => {
    const content = passwordResetEmail("012345", 15);
    expect(content.text).toContain("012345");
    expect(content.text).toContain("15 phút");
    expect(content.html).toContain(">012345</td>");
    expect(content.html).toContain("15 phút");
    expect(content.html).not.toMatch(/<script|<img|https?:\/\//iu);
  });

  it("escapes content inserted into HTML", () => {
    expect(passwordResetEmail('<img src="x">&', 15).html).toContain("&lt;img src=&quot;x&quot;&gt;&amp;");
  });
});
