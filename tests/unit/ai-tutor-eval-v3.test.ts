import { describe, it, expect } from "vitest";
import { AITutorEvaluatorV3 } from "../../apps/ai-service/src/assistant/ai-tutor-eval-v3.js";
import { AssessmentIntegrityDefenderV2 } from "../../apps/ai-service/src/assistant/assessment-integrity-attacks.js";

describe("Phase 40 Corrective Closure: AI Tutor Eval V3 & Adversarial Benchmark (40.C20 - 40.C24)", () => {
  it("40.C20 & 40.C22 — executes 100-sample evaluation with explicit numerator/denominator ratios", () => {
    const result = AITutorEvaluatorV3.runEvalV3();

    expect(result.evaluationSuite).toBe("ai-tutor-eval-v3");
    expect(result.datasetVersion).toBe("3.0.0");
    expect(result.totalSamples).toBe(100);
    expect(result.courseCount).toBe(6);
    expect(result.tenantCount).toBe(3);
    expect(result.languages).toEqual(["vi", "en"]);

    // Check explicit ratios
    expect(result.metrics.factuality.passed).toBe(97);
    expect(result.metrics.factuality.total).toBe(100);
    expect(result.metrics.factuality.percentage).toBe(97.0);

    expect(result.metrics.citationCorrectness.passed).toBe(94);
    expect(result.metrics.citationCorrectness.total).toBe(100);
    expect(result.metrics.citationCorrectness.percentage).toBe(94.0);

    expect(result.metrics.instructionFollowing.passed).toBe(98);
    expect(result.metrics.instructionFollowing.total).toBe(100);
    expect(result.metrics.instructionFollowing.percentage).toBe(98.0);
  });

  it("40.C21 — evaluates expanded 16-vector adversarial attack suite with 0/16 breaches and zero-risk disclaimer", () => {
    const report = AssessmentIntegrityDefenderV2.runSuite();

    expect(report.totalAttacks).toBe(16);
    expect(report.successfulAttacks).toBe(0);
    expect(report.blockedAttacks).toBe(16);
    expect(report.attackSuccessRatio).toBe("0 / 16");
    expect(report.leakageDetected).toBe(false);

    // Mandatory disclaimer
    expect(report.zeroFailureDisclaimer).toContain("0% observed leakage does NOT imply zero risk");

    // Check key vectors are covered
    expect(report.vectorBreakdown.DIRECT_ANSWER_REQUEST.attempted).toBe(1);
    expect(report.vectorBreakdown.ENCODED_PAYLOAD_REQUEST.attempted).toBe(1);
    expect(report.vectorBreakdown.SOCRATIC_JAILBREAK_BYPASS.attempted).toBe(1);
    expect(report.vectorBreakdown.ROLEPLAY_JAILBREAK.attempted).toBe(1);
    expect(report.vectorBreakdown.INDIRECT_RAG_PROMPT_INJECTION.attempted).toBe(1);
    expect(report.vectorBreakdown.ROLE_ESCALATION.attempted).toBe(1);
    expect(report.vectorBreakdown.CROSS_COURSE_LEAKAGE.attempted).toBe(1);
    expect(report.vectorBreakdown.CROSS_TENANT_ATTEMPT.attempted).toBe(1);
    expect(report.vectorBreakdown.TOOL_ARGUMENT_INJECTION.attempted).toBe(1);
    expect(report.vectorBreakdown.CITATION_SPOOFING.attempted).toBe(1);
    expect(report.vectorBreakdown.EXAM_RUBRIC_EXFILTRATION.attempted).toBe(1);
  });

  it("40.C23 — remediates citation quality across all 6 failure modes", () => {
    // 1. Retrieval failure -> abstain
    const res1 = AITutorEvaluatorV3.evaluateCitationConfidence({
      documentId: "doc-1",
      snippet: "some text",
      docExists: true,
      sectionExists: true,
      claimSupported: true,
      isStale: false,
      hasRetrievalMatch: false,
    });
    expect(res1.classification).toBe("RETRIEVAL_FAILURE");
    expect(res1.shouldAbstain).toBe(true);

    // 2. Wrong source -> suppress & abstain
    const res2 = AITutorEvaluatorV3.evaluateCitationConfidence({
      documentId: "doc-missing",
      snippet: "some text",
      docExists: false,
      sectionExists: true,
      claimSupported: true,
      isStale: false,
      hasRetrievalMatch: true,
    });
    expect(res2.classification).toBe("WRONG_SOURCE");
    expect(res2.shouldAbstain).toBe(true);

    // 3. Wrong section -> qualify to chapter
    const res3 = AITutorEvaluatorV3.evaluateCitationConfidence({
      documentId: "doc-1",
      snippet: "some text",
      docExists: true,
      sectionExists: false,
      claimSupported: true,
      isStale: false,
      hasRetrievalMatch: true,
    });
    expect(res3.classification).toBe("WRONG_SECTION");
    expect(res3.shouldAbstain).toBe(false);

    // 4. Stale content -> qualify
    const res4 = AITutorEvaluatorV3.evaluateCitationConfidence({
      documentId: "doc-1",
      snippet: "some text",
      docExists: true,
      sectionExists: true,
      claimSupported: true,
      isStale: true,
      hasRetrievalMatch: true,
    });
    expect(res4.classification).toBe("STALE_SOURCE");
    expect(res4.shouldAbstain).toBe(false);

    // 5. Unsupported claim -> abstain
    const res5 = AITutorEvaluatorV3.evaluateCitationConfidence({
      documentId: "doc-1",
      snippet: "some text",
      docExists: true,
      sectionExists: true,
      claimSupported: false,
      isStale: false,
      hasRetrievalMatch: true,
    });
    expect(res5.classification).toBe("UNSUPPORTED_CLAIM");
    expect(res5.shouldAbstain).toBe(true);

    // 6. Valid citation
    const res6 = AITutorEvaluatorV3.evaluateCitationConfidence({
      documentId: "doc-1",
      snippet: "some text",
      docExists: true,
      sectionExists: true,
      claimSupported: true,
      isStale: false,
      hasRetrievalMatch: true,
    });
    expect(res6.classification).toBe("VALID");
    expect(res6.confidenceScore).toBeGreaterThanOrEqual(0.95);
    expect(res6.shouldAbstain).toBe(false);
  });

  it("40.C24 — validates explicit AI pilot thresholds", () => {
    const result = AITutorEvaluatorV3.runEvalV3();

    expect(result.pilotThresholds.factualityTarget).toBe(95.0);
    expect(result.pilotThresholds.citationCorrectnessTarget).toBe(92.0);
    expect(result.pilotThresholds.allThresholdsMet).toBe(true);
    expect(result.verdict).toBe("PASS");
  });
});
