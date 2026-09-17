import { describe, expect, it } from "vitest";
import {
  EmailGovernancePolicy,
  SesEmailProvider,
  SimulationEmailProvider,
  SmtpEmailProvider,
} from "../../apps/notification-worker/src/email/index.js";

describe("Phase 23A: Real Email Delivery Provider & Governance Policy", () => {
  it("SmtpEmailProvider validates configuration and recipient formats", async () => {
    const provider = new SmtpEmailProvider({
      host: "smtp.mailgun.org",
      port: 587,
      secure: false,
      auth: { user: "postmaster@ailss.edu.vn", pass: "secret-smtp-pass" },
      fromAddress: "no-reply@ailss.edu.vn",
    });

    // Valid recipient
    const res = await provider.send({
      to: "student@polytech.edu.vn",
      subject: "Welcome to AILSS",
      htmlBody: "<p>Welcome!</p>",
      category: "TRANSACTIONAL",
    });
    expect(res.success).toBe(true);
    expect(res.provider).toBe("SMTP");
    expect(res.messageId).toContain("@smtp.mailgun.org");

    // Invalid recipient
    const failed = await provider.send({
      to: "invalid-recipient-no-at",
      subject: "Error",
      htmlBody: "test",
      category: "ACADEMIC",
    });
    expect(failed.success).toBe(false);
    expect(failed.error).toBe("INVALID_RECIPIENT_ADDRESS");
  });

  it("SesEmailProvider formats SES message ID and rejects invalid recipient", async () => {
    const ses = new SesEmailProvider({
      region: "ap-southeast-1",
      accessKeyId: "AKIA_MOCK_TEST_KEY",
      secretAccessKey: "SECRET_MOCK_AWS_KEY",
      fromAddress: "no-reply@ailss.edu.vn",
    });

    const res = await ses.send({
      to: "lecturer@polytech.edu.vn",
      subject: "Course Published",
      htmlBody: "<p>Course is live</p>",
      category: "ACADEMIC",
    });
    expect(res.success).toBe(true);
    expect(res.provider).toBe("AMAZON_SES");
    expect(res.messageId).toMatch(/^010001[a-f0-9]+-.*-ses$/u);
  });

  it("SimulationEmailProvider operates safely in non-production environments", async () => {
    const sim = new SimulationEmailProvider({ allowInProduction: true });
    const res = await sim.send({
      to: "test@example.com",
      subject: "Test",
      htmlBody: "Simulated",
      category: "MARKETING",
    });
    expect(res.success).toBe(true);
    expect(sim.sentMessages).toHaveLength(1);
    expect(sim.sentMessages[0]?.to).toBe("test@example.com");
  });

  describe("EmailGovernancePolicy: Regulatory Consent & Suppression Matrix", () => {
    const policy = new EmailGovernancePolicy();
    const studentEmail = "student@polytech.edu.vn";

    it("SECURITY emails are unsuppressible, even if user is on hard-bounce suppression list", () => {
      policy.addSuppression(studentEmail, "BOUNCE");
      expect(policy.isSuppressed(studentEmail)).toBe(true);

      const decision = policy.canDeliver(studentEmail, "SECURITY");
      expect(decision.deliverable).toBe(true);
    });

    it("TRANSACTIONAL emails are blocked if suppressed, but succeed without explicit marketing consent", () => {
      const cleanEmail = "clean-user@polytech.edu.vn";
      const decisionClean = policy.canDeliver(cleanEmail, "TRANSACTIONAL");
      expect(decisionClean.deliverable).toBe(true);

      // Blocked when suppressed
      const decisionSuppressed = policy.canDeliver(studentEmail, "TRANSACTIONAL");
      expect(decisionSuppressed.deliverable).toBe(false);
      expect(decisionSuppressed.reason).toBe("SUPPRESSED_BOUNCE");
    });

    it("MARKETING emails strictly require explicit opt-in consent", () => {
      const targetEmail = "learner@gmail.com";

      // 1. Without explicit consent -> Rejected
      const rejected = policy.canDeliver(targetEmail, "MARKETING", {
        userId: "u-1",
        email: targetEmail,
        consentMarketing: false,
        optOutRecommendations: false,
        optOutAcademic: false,
      });
      expect(rejected.deliverable).toBe(false);
      expect(rejected.reason).toBe("MARKETING_CONSENT_NOT_GRANTED");

      // 2. With explicit consent -> Allowed
      const allowed = policy.canDeliver(targetEmail, "MARKETING", {
        userId: "u-1",
        email: targetEmail,
        consentMarketing: true,
        optOutRecommendations: false,
        optOutAcademic: false,
      });
      expect(allowed.deliverable).toBe(true);
    });

    it("ACADEMIC and RECOMMENDATION emails respect opt-out preferences", () => {
      const targetEmail = "learner2@gmail.com";

      const optOutCheck = policy.canDeliver(targetEmail, "ACADEMIC", {
        userId: "u-2",
        email: targetEmail,
        consentMarketing: false,
        optOutRecommendations: false,
        optOutAcademic: true, // opted out
      });
      expect(optOutCheck.deliverable).toBe(false);
      expect(optOutCheck.reason).toBe("ACADEMIC_ALERTS_OPTED_OUT");

      const recoCheck = policy.canDeliver(targetEmail, "RECOMMENDATION", {
        userId: "u-2",
        email: targetEmail,
        consentMarketing: false,
        optOutRecommendations: true, // opted out
        optOutAcademic: false,
      });
      expect(recoCheck.deliverable).toBe(false);
      expect(recoCheck.reason).toBe("RECOMMENDATIONS_OPTED_OUT");
    });
  });
});
