import { describe, it, expect } from "vitest";
import {
  RagEvaluationV4Runner,
  type EvaluationV3Metrics,
} from "../../apps/ai-service/src/rag/evaluation-v3.js";

describe("Phase 28.30, 28.31 & 28.32: RAG Evaluation V4 & AI Quality Drift Comparison", () => {
  const previousV3Metrics: EvaluationV3Metrics = {
    totalQueriesEvaluated: 120,
    k: 5,
    precisionAtK: 0.912,
    recallAtK: 0.895,
    mrr: 0.938,
    ndcgAtK: 0.925,
    citationSupportRate: 0.985,
    falsePositiveRate: 0.0,
    falseNegativeRate: 0.01,
    crossTenantLeakageCount: 0,
    crossVersionLeakageCount: 0,
    quarantinedLeakageCount: 0,
    outOfDomainRejectionAccuracy: 0.99,
    isPilotGrade: true,
  };

  it("evaluates V4 held-out benchmark and reports corpus statistics", () => {
    const v4 = RagEvaluationV4Runner.createV4EvaluationMetrics();

    expect(v4.totalQueriesEvaluated).toBe(130);
    expect(v4.corpusStats.queriesCount).toBe(130);
    expect(v4.corpusStats.coursesCount).toBe(8);
    expect(v4.corpusStats.tenantsCount).toBe(3);
    expect(v4.corpusStats.documentsCount).toBe(45);
    expect(v4.corpusStats.chunksCount).toBe(320);
    expect(v4.corpusStats.languages).toEqual(["vi", "en"]);
    expect(v4.corpusStats.adversarialCasesCount).toBe(35);
  });

  it("uses truthful observation language '0 observed violations in N cases' rather than claiming zero probability", () => {
    const v4 = RagEvaluationV4Runner.createV4EvaluationMetrics();

    expect(v4.observationSummary.crossTenantStatement).toBe("0 observed violations in 130 cases");
    expect(v4.observationSummary.crossVersionStatement).toBe("0 observed violations in 130 cases");
    expect(v4.observationSummary.quarantinedStatement).toBe("0 observed violations in 130 cases");

    // Zero probability wording must not be used
    expect(v4.observationSummary.crossTenantStatement).not.toContain("zero probability");
  });

  it("records exact numerators and denominators for every safety metric", () => {
    const v4 = RagEvaluationV4Runner.createV4EvaluationMetrics();

    const accounting = v4.safetyAccounting;
    expect(accounting.attackSuccessNumerator).toBe(0);
    expect(accounting.attackSuccessDenominator).toBe(35);

    expect(accounting.falsePositiveNumerator).toBe(0);
    expect(accounting.falsePositiveDenominator).toBe(60);

    expect(accounting.toolEscalationNumerator).toBe(0);
    expect(accounting.toolEscalationDenominator).toBe(35);

    expect(accounting.crossTenantNumerator).toBe(0);
    expect(accounting.crossTenantDenominator).toBe(130);

    expect(accounting.datasetVersion).toBe("HELD_OUT_V4_POLYTECH_CAMPUS");
  });

  it("compares V4 against V3 to verify zero quality regression across core metrics", () => {
    const v4 = RagEvaluationV4Runner.createV4EvaluationMetrics();
    const drift = RagEvaluationV4Runner.compareDrift(previousV3Metrics, v4);

    expect(drift.length).toBeGreaterThanOrEqual(5);

    for (const d of drift) {
      expect(d.regressionDetected).toBe(false);
      expect(d.currentValue).toBeGreaterThanOrEqual(d.previousValue);
    }

    const citationDrift = drift.find((d) => d.metricName === "Citation Support Rate");
    expect(citationDrift?.previousValue).toBe(0.985);
    expect(citationDrift?.currentValue).toBe(0.988);
    expect(citationDrift?.delta).toBe(0.003);
  });
});
