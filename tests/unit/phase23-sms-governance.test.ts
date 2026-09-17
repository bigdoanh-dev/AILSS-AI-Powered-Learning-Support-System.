import { describe, expect, it } from "vitest";
import {
  SimulationSmsProvider,
  SmsGovernanceGuard,
} from "../../apps/notification-worker/src/sms/index.js";

describe("Phase 23C: SMS Governance, Anti-Toll-Fraud & Rate-Limiting", () => {
  it("blocks non-security informational SMS in production pilot", () => {
    const guard = new SmsGovernanceGuard({ allowInformationalSms: false });

    const result = guard.validateOutbound({
      recipientPhone: "+84901234567",
      message: "Check out new courses on sale!",
      purpose: "INFORMATIONAL",
      requestId: "req-1",
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("SMS_INFORMATIONAL_DISABLED_IN_PILOT");
  });

  it("blocks premium-rate numbers to prevent toll-fraud attacks", () => {
    const guard = new SmsGovernanceGuard();

    const check1900 = guard.validateOutbound({
      recipientPhone: "+8419001234",
      message: "Your code is 123456",
      purpose: "TWO_FACTOR_AUTHENTICATION",
      requestId: "req-2",
    });
    expect(check1900.allowed).toBe(false);
    expect(check1900.reason).toBe("PREMIUM_RATE_NUMBER_BLOCKED");

    const check1800 = guard.validateOutbound({
      recipientPhone: "018005678",
      message: "Your code is 123456",
      purpose: "TWO_FACTOR_AUTHENTICATION",
      requestId: "req-3",
    });
    expect(check1800.allowed).toBe(false);
    expect(check1800.reason).toBe("PREMIUM_RATE_NUMBER_BLOCKED");
  });

  it("blocks unapproved country codes outside the pilot region", () => {
    const guard = new SmsGovernanceGuard({ allowedCountryCodes: ["+84"] });

    const internationalCheck = guard.validateOutbound({
      recipientPhone: "+14155552671", // US number
      message: "Your code is 123456",
      purpose: "TWO_FACTOR_AUTHENTICATION",
      requestId: "req-4",
    });

    expect(internationalCheck.allowed).toBe(false);
    expect(internationalCheck.reason).toContain("COUNTRY_CODE_NOT_PERMITTED");
  });

  it("enforces hourly and daily per-recipient rate limits", () => {
    const guard = new SmsGovernanceGuard({
      maxPerHourPerRecipient: 3,
      maxPerDayPerRecipient: 5,
    });
    const phone = "+84912345678";
    const now = Date.now();

    // First 3 within the hour are allowed
    for (let i = 0; i < 3; i++) {
      const check = guard.validateOutbound(
        {
          recipientPhone: phone,
          message: `Code ${i.toString()}`,
          purpose: "TWO_FACTOR_AUTHENTICATION",
          requestId: `req-${i.toString()}`,
        },
        now + i * 1000,
      );
      expect(check.allowed).toBe(true);
      guard.recordSent(phone, now + i * 1000);
    }

    // 4th within the same hour is blocked
    const fourthCheck = guard.validateOutbound(
      {
        recipientPhone: phone,
        message: "Code 4",
        purpose: "TWO_FACTOR_AUTHENTICATION",
        requestId: "req-4",
      },
      now + 4000,
    );
    expect(fourthCheck.allowed).toBe(false);
    expect(fourthCheck.reason).toBe("RECIPIENT_HOURLY_RATE_LIMIT_EXCEEDED");
  });

  it("SimulationSmsProvider delivers valid 2FA SMS and increments sent history", async () => {
    const guard = new SmsGovernanceGuard();
    const provider = new SimulationSmsProvider(guard, { allowInProduction: true });

    const result = await provider.send({
      recipientPhone: "+84909876543",
      message: "Mã xác thực AILSS của bạn là: 892103",
      purpose: "TWO_FACTOR_AUTHENTICATION",
      requestId: "req-sim-1",
    });

    expect(result.success).toBe(true);
    expect(result.messageSid).toMatch(/^SM_sim_/u);
    expect(provider.sentSms).toHaveLength(1);
  });
});
