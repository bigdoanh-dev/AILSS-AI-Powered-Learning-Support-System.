import { describe, expect, it } from "vitest";
import {
  EmailGovernancePolicy,
  evaluateEmailGovernance,
} from "../../apps/notification-worker/src/email/index.js";

describe("Phase 24.3: Email Governance & Address Deliverability Distinction", () => {
  it("distinguishes USER_CANNOT_OPT_OUT from PROVIDER_ADDRESS_IS_UNDELIVERABLE", () => {
    const policy = new EmailGovernancePolicy();
    const liveEmail = "active-student@polytech.edu.vn";
    const bouncedEmail = "dead-mailbox@polytech.edu.vn";

    policy.addSuppression(bouncedEmail, "BOUNCE");

    // 1. Live address with SECURITY category -> USER_CANNOT_OPT_OUT
    const liveSec = evaluateEmailGovernance(policy, liveEmail, "SECURITY");
    expect(liveSec.deliverable).toBe(true);
    expect(liveSec.reason).toBe("USER_CANNOT_OPT_OUT");
    expect(liveSec.fallbackChannelRecommended).toBe(false);

    // 2. Dead/bounced address with SECURITY category -> PROVIDER_ADDRESS_IS_UNDELIVERABLE
    const bouncedSec = evaluateEmailGovernance(policy, bouncedEmail, "SECURITY");
    expect(bouncedSec.deliverable).toBe(false);
    expect(bouncedSec.reason).toBe("PROVIDER_ADDRESS_IS_UNDELIVERABLE");
    expect(bouncedSec.fallbackChannelRecommended).toBe(true);

    // 3. Live address with TRANSACTIONAL category -> DELIVERABLE
    const liveTx = evaluateEmailGovernance(policy, liveEmail, "TRANSACTIONAL");
    expect(liveTx.deliverable).toBe(true);
    expect(liveTx.reason).toBe("DELIVERABLE");

    // 4. Opted out academic alerts -> OPTED_OUT
    const optedOut = evaluateEmailGovernance(policy, liveEmail, "ACADEMIC", {
      userId: "u-1",
      email: liveEmail,
      optOutAcademic: true,
      consentMarketing: false,
      optOutRecommendations: false,
    });
    expect(optedOut.deliverable).toBe(false);
    expect(optedOut.reason).toBe("OPTED_OUT");
  });
});
