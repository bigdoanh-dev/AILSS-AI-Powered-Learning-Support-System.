import { describe, it, expect, beforeEach } from "vitest";
import {
  CriticalDurabilityCoordinator,
  CriticalDurabilityCommitError,
  DURABILITY_CONTRACTS,
  OPERATION_DURABILITY_MAP,
} from "../../packages/contracts/src/critical-durability.js";

describe("Phase 34.5 - 34.10: Critical-Write Durability Implementation & Raw Failure Proof", () => {
  let coordinator: CriticalDurabilityCoordinator;

  beforeEach(() => {
    coordinator = new CriticalDurabilityCoordinator();
  });

  it("1. D0 Assessment final submission achieves 0 RPO across sudden primary region isolation", async () => {
    const submissionId = "sub-phase34-catastrophic-001";
    const submissionPayload = {
      id: submissionId,
      studentId: "student-vn-7842",
      assessmentId: "quiz-advanced-db-009",
      attemptState: "FINAL_SUBMITTED",
      answerHash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      scoreProcessingEligible: true,
      auditEventId: "audit-evt-9912",
    };

    // Client write executed under D0_CRITICAL contract
    const result = await coordinator.executeWrite("ASSESSMENT_SUBMIT", submissionPayload);
    expect(result.success).toBe(true);
    expect(result.tier).toBe("D0_CRITICAL");
    expect(result.ackRule).toBe("SYNCHRONOUS_SECONDARY_COMMIT");
    expect(result.secondaryCommitTimestamp).not.toBeNull();

    // Immediately trigger catastrophic isolation of primary region (simulated fiber cut)
    coordinator.triggerCatastrophicPrimaryIsolation();

    // Secondary region promoted to primary: verify acknowledged submission is 100% intact (0 RPO)
    const recoveredInSecondary = coordinator.inspectSecondaryRecord<typeof submissionPayload>(submissionId);
    expect(recoveredInSecondary).toBeDefined();
    expect(recoveredInSecondary?.id).toBe(submissionId);
    expect(recoveredInSecondary?.attemptState).toBe("FINAL_SUBMITTED");
    expect(recoveredInSecondary?.answerHash).toBe(submissionPayload.answerHash);
    expect(recoveredInSecondary?.scoreProcessingEligible).toBe(true);
  });

  it("2. D0 Grade finalization achieves 0 RPO across sudden primary region isolation", async () => {
    const gradeRecordId = "grade-rec-phase34-8841";
    const gradePayload = {
      id: gradeRecordId,
      studentId: "student-vn-7842",
      courseId: "course-cs-501",
      lineItemId: "lineitem-midterm-exam",
      finalScore: 94.5,
      gradingStatus: "FINALIZED",
      ltiAgsPassbackReady: true,
      immutableTimestamp: "2026-09-19T22:30:00Z",
    };

    const result = await coordinator.executeWrite("GRADE_FINALIZE", gradePayload);
    expect(result.success).toBe(true);

    coordinator.triggerCatastrophicPrimaryIsolation();

    const secondaryGrade = coordinator.inspectSecondaryRecord<typeof gradePayload>(gradeRecordId);
    expect(secondaryGrade).toBeDefined();
    expect(secondaryGrade?.finalScore).toBe(94.5);
    expect(secondaryGrade?.gradingStatus).toBe("FINALIZED");
    expect(secondaryGrade?.ltiAgsPassbackReady).toBe(true);
  });

  it("3. D0 Security session revocation fails closed in secondary region (no token resurrection)", async () => {
    const sessionId = "session-revoked-phase34-9912";
    const revocationPayload = {
      id: sessionId,
      userId: "user-attacker-malicious",
      tokenJti: "jti-compromised-token-007",
      status: "REVOKED",
      revokedAt: "2026-09-19T22:31:00Z",
      failClosedEnforced: true,
    };

    // Client executes logout / session revocation
    const result = await coordinator.executeWrite("SECURITY_SESSION_REVOKE", revocationPayload);
    expect(result.success).toBe(true);

    coordinator.triggerCatastrophicPrimaryIsolation();

    // In secondary region, verify revocation state is committed (cannot be treated as active)
    const secondarySession = coordinator.inspectSecondaryRecord<typeof revocationPayload>(sessionId);
    expect(secondarySession).toBeDefined();
    expect(secondarySession?.status).toBe("REVOKED");
    expect(secondarySession?.failClosedEnforced).toBe(true);
  });

  it("4. D0 Payment ledger mutation achieves 0 financial loss across sudden primary region loss", async () => {
    const ledgerMutationId = "tx-ledger-sandbox-3391";
    const ledgerPayload = {
      id: ledgerMutationId,
      orderId: "order-course-subscription-77",
      debitAccount: "112_GATEWAY",
      creditAccount: "511_UNEARNED_REVENUE",
      amountMinorUnits: 499000,
      currency: "VND",
      ledgerStatus: "CONFIRMED_COMMITTED",
    };

    const result = await coordinator.executeWrite("PAYMENT_CONFIRM", ledgerPayload);
    expect(result.success).toBe(true);

    coordinator.triggerCatastrophicPrimaryIsolation();

    const secondaryLedger = coordinator.inspectSecondaryRecord<typeof ledgerPayload>(ledgerMutationId);
    expect(secondaryLedger).toBeDefined();
    expect(secondaryLedger?.amountMinorUnits).toBe(499000);
    expect(secondaryLedger?.ledgerStatus).toBe("CONFIRMED_COMMITTED");
  });

  it("5. D0 Secondary commit timeout triggers fail-closed error with zero client ACK", async () => {
    const submissionId = "sub-timeout-failclosed-999";
    coordinator.setSecondaryTimeoutSimulation(true);

    await expect(
      coordinator.executeWrite("ASSESSMENT_SUBMIT", {
        id: submissionId,
        studentId: "student-vn-fail",
        attemptState: "IN_PROGRESS",
      }),
    ).rejects.toThrow(CriticalDurabilityCommitError);

    // Verify uncommitted record is rolled back and NOT ACKed in secondary
    const secondaryRecord = coordinator.inspectSecondaryRecord(submissionId);
    expect(secondaryRecord).toBeUndefined();
  });

  it("6. D0 Durability Performance Benchmark measures and records latency penalty", async () => {
    const samples = 20;
    const localLatencies: number[] = [];
    const d0Latencies: number[] = [];

    for (let i = 0; i < samples; i++) {
      // D2 Standard local write
      const d2Res = await coordinator.executeWrite("LEARNING_PROGRESS", { id: `prog-${i}`, step: i });
      localLatencies.push(d2Res.executionLatencyMs);

      // D0 Synchronous secondary commit write (with simulated 26ms cross-region network lag)
      const d0Res = await coordinator.executeWrite(
        "ASSESSMENT_SUBMIT",
        { id: `assess-${i}`, answer: i },
        { latencyOffsetMs: 26 },
      );
      d0Latencies.push(d0Res.executionLatencyMs);
    }

    localLatencies.sort((a, b) => a - b);
    d0Latencies.sort((a, b) => a - b);

    const localP50 = localLatencies[Math.floor(samples * 0.5)] ?? 12;
    const d0P50 = d0Latencies[Math.floor(samples * 0.5)] ?? 38;

    expect(d0P50).toBeGreaterThan(localP50);
    expect(DURABILITY_CONTRACTS.D0_CRITICAL.targetRpoSeconds).toBe(0);
    expect(OPERATION_DURABILITY_MAP.ASSESSMENT_SUBMIT).toBe("D0_CRITICAL");
  });
});
