import type { GovernedRagService } from "./service.js";

export interface BenchmarkQuery {
  readonly id: string;
  readonly courseId: string;
  readonly courseVersion: number;
  readonly query: string;
  readonly relevantDocumentIds: readonly string[];
  readonly expectedForbiddenDocumentIds?: readonly string[];
  readonly isOutOfDomain?: boolean;
}

export interface EvaluationV3Metrics {
  readonly totalQueriesEvaluated: number;
  readonly k: number;
  readonly precisionAtK: number;
  readonly recallAtK: number;
  readonly mrr: number; // Mean Reciprocal Rank
  readonly ndcgAtK: number; // Normalized Discounted Cumulative Gain
  readonly citationSupportRate: number;
  readonly falsePositiveRate: number;
  readonly falseNegativeRate: number;
  readonly crossTenantLeakageCount: number;
  readonly crossVersionLeakageCount: number;
  readonly quarantinedLeakageCount: number;
  readonly outOfDomainRejectionAccuracy: number;
  readonly isPilotGrade: boolean;
}

export const RagEvaluationV3Runner = {
  async runBenchmark(
    service: GovernedRagService,
    queries: readonly BenchmarkQuery[],
    options: { readonly k?: number } = {},
  ): Promise<EvaluationV3Metrics> {
    const k = options.k ?? 5;

    let sumPrecision = 0;
    let sumRecall = 0;
    let sumRr = 0;
    let sumNdcg = 0;
    let totalRetrievedChunks = 0;
    let totalSupportedCitations = 0;

    let totalFalsePositives = 0;
    let totalTrueNegatives = 0;
    let totalFalseNegatives = 0;
    let totalTruePositives = 0;

    let crossTenantLeakage = 0;
    let crossVersionLeakage = 0;
    let quarantinedLeakage = 0;

    let outOfDomainCount = 0;
    let outOfDomainRejectedCorrectly = 0;

    for (const q of queries) {
      const result = await service.retrieve({
        courseId: q.courseId,
        courseVersion: q.courseVersion,
        query: q.query,
        topK: k,
      });

      const retrieved = result.chunks;
      totalRetrievedChunks += retrieved.length;

      // Handle out-of-domain queries
      if (q.isOutOfDomain) {
        outOfDomainCount++;
        if (retrieved.length === 0) {
          outOfDomainRejectedCorrectly++;
        }
      }

      // Check leakage
      for (const c of retrieved) {
        if (c.courseId !== q.courseId) {
          crossTenantLeakage++;
        }
        if (c.courseVersion !== q.courseVersion) {
          crossVersionLeakage++;
        }
        if (c.status === "QUARANTINED" || c.status === "SUPERSEDED") {
          quarantinedLeakage++;
        }
        if (q.expectedForbiddenDocumentIds?.includes(c.documentId)) {
          quarantinedLeakage++;
        }

        // Citation support check: chunk must possess non-empty text and valid created timestamp
        if (c.text && c.documentId && c.createdAt) {
          totalSupportedCitations++;
        }
      }

      // Relevant vs Irrelevant
      const relevantRetrieved = retrieved.filter((c) => q.relevantDocumentIds.includes(c.documentId));
      const irrelevantRetrieved = retrieved.filter((c) => !q.relevantDocumentIds.includes(c.documentId));

      totalTruePositives += relevantRetrieved.length;
      totalFalsePositives += irrelevantRetrieved.length;

      const missedCount = q.relevantDocumentIds.filter(
        (docId) => !retrieved.some((c) => c.documentId === docId),
      ).length;
      totalFalseNegatives += missedCount;

      if (q.isOutOfDomain && retrieved.length === 0) {
        totalTrueNegatives++;
      }

      // Precision@K
      const precision = retrieved.length > 0 ? relevantRetrieved.length / retrieved.length : (q.isOutOfDomain ? 1.0 : 0.0);
      sumPrecision += precision;

      // Recall@K
      const totalRelevant = q.relevantDocumentIds.length;
      const recall = totalRelevant > 0 ? relevantRetrieved.length / totalRelevant : (q.isOutOfDomain ? 1.0 : 0.0);
      sumRecall += recall;

      // Reciprocal Rank
      let rr = 0;
      for (let rank = 0; rank < retrieved.length; rank++) {
        const chunk = retrieved[rank];
        if (chunk && q.relevantDocumentIds.includes(chunk.documentId)) {
          rr = 1 / (rank + 1);
          break;
        }
      }
      if (q.isOutOfDomain && retrieved.length === 0) {
        rr = 1.0;
      }
      sumRr += rr;

      // NDCG@K
      let dcg = 0;
      let idcg = 0;
      for (let i = 0; i < retrieved.length; i++) {
        const chunk = retrieved[i];
        const isRel = chunk && q.relevantDocumentIds.includes(chunk.documentId) ? 1 : 0;
        dcg += isRel / Math.log2(i + 2);
      }
      for (let i = 0; i < Math.min(k, totalRelevant); i++) {
        idcg += 1 / Math.log2(i + 2);
      }
      const ndcg = idcg > 0 ? dcg / idcg : (q.isOutOfDomain ? 1.0 : 0.0);
      sumNdcg += ndcg;
    }

    const n = Math.max(1, queries.length);
    const precisionAtK = sumPrecision / n;
    const recallAtK = sumRecall / n;
    const mrr = sumRr / n;
    const ndcgAtK = sumNdcg / n;

    const citationSupportRate = totalRetrievedChunks > 0 ? totalSupportedCitations / totalRetrievedChunks : 1.0;
    const falsePositiveRate = (totalFalsePositives + totalTrueNegatives) > 0
      ? totalFalsePositives / (totalFalsePositives + Math.max(1, totalTrueNegatives))
      : 0;
    const falseNegativeRate = (totalFalseNegatives + totalTruePositives) > 0
      ? totalFalseNegatives / (totalFalseNegatives + totalTruePositives)
      : 0;

    const outOfDomainRejectionAccuracy = outOfDomainCount > 0
      ? outOfDomainRejectedCorrectly / outOfDomainCount
      : 1.0;

    const isPilotGrade =
      crossTenantLeakage === 0 &&
      crossVersionLeakage === 0 &&
      quarantinedLeakage === 0 &&
      precisionAtK >= 0.85 &&
      recallAtK >= 0.85 &&
      mrr >= 0.90 &&
      citationSupportRate >= 0.95 &&
      outOfDomainRejectionAccuracy === 1.0;

    return {
      totalQueriesEvaluated: queries.length,
      k,
      precisionAtK: Number(precisionAtK.toFixed(4)),
      recallAtK: Number(recallAtK.toFixed(4)),
      mrr: Number(mrr.toFixed(4)),
      ndcgAtK: Number(ndcgAtK.toFixed(4)),
      citationSupportRate: Number(citationSupportRate.toFixed(4)),
      falsePositiveRate: Number(falsePositiveRate.toFixed(4)),
      falseNegativeRate: Number(falseNegativeRate.toFixed(4)),
      crossTenantLeakageCount: crossTenantLeakage,
      crossVersionLeakageCount: crossVersionLeakage,
      quarantinedLeakageCount: quarantinedLeakage,
      outOfDomainRejectionAccuracy: Number(outOfDomainRejectionAccuracy.toFixed(4)),
      isPilotGrade,
    };
  },

  assertPilotReadiness(metrics: EvaluationV3Metrics): void {
    if (metrics.crossTenantLeakageCount > 0) {
      throw new Error(`VIOLATION: Cross-tenant leakage observed (${String(metrics.crossTenantLeakageCount)})`);
    }
    if (metrics.crossVersionLeakageCount > 0) {
      throw new Error(`VIOLATION: Cross-version leakage observed (${String(metrics.crossVersionLeakageCount)})`);
    }
    if (metrics.quarantinedLeakageCount > 0) {
      throw new Error(`VIOLATION: Quarantined document leakage observed (${String(metrics.quarantinedLeakageCount)})`);
    }
    if (metrics.precisionAtK < 0.85) {
      throw new Error(`VIOLATION: Precision@K (${String(metrics.precisionAtK)}) below threshold 0.85`);
    }
    if (metrics.recallAtK < 0.85) {
      throw new Error(`VIOLATION: Recall@K (${String(metrics.recallAtK)}) below threshold 0.85`);
    }
    if (metrics.mrr < 0.90) {
      throw new Error(`VIOLATION: MRR (${String(metrics.mrr)}) below threshold 0.90`);
    }
    if (metrics.citationSupportRate < 0.95) {
      throw new Error(`VIOLATION: Citation Support Rate (${String(metrics.citationSupportRate)}) below 0.95`);
    }
    if (metrics.outOfDomainRejectionAccuracy < 1.0) {
      throw new Error(`VIOLATION: Out of domain rejection accuracy (${String(metrics.outOfDomainRejectionAccuracy)}) must be 1.0`);
    }
  },
} as const;

// ---------------------------------------------------------------------------
// Phase 26.20 & 26.21: RAG Benchmark Methodology & Statistical Confidence Intervals
// ---------------------------------------------------------------------------

export interface RagBenchmarkMethodology {
  readonly numberOfTenants: number;
  readonly numberOfCourses: number;
  readonly numberOfCourseVersions: number;
  readonly numberOfDocuments: number;
  readonly numberOfChunks: number;
  readonly numberOfQueries: number;
  readonly languages: readonly string[];
  readonly datasetSplits: {
    readonly developmentSetSize: number;
    readonly heldOutEvaluationSetSize: number;
    readonly adversarialAttackSetSize: number;
  };
  readonly confidenceIntervals: {
    readonly precisionAtK: { readonly mean: number; readonly ci95Lower: number; readonly ci95Upper: number };
    readonly recallAtK: { readonly mean: number; readonly ci95Lower: number; readonly ci95Upper: number };
    readonly mrr: { readonly mean: number; readonly ci95Lower: number; readonly ci95Upper: number };
  };
}

export function computeBootstrapConfidenceInterval(
  sampleValues: readonly number[],
): { readonly mean: number; readonly ci95Lower: number; readonly ci95Upper: number } {
  if (sampleValues.length === 0) {
    return { mean: 0, ci95Lower: 0, ci95Upper: 0 };
  }
  const mean = sampleValues.reduce((acc, v) => acc + v, 0) / sampleValues.length;
  const variance =
    sampleValues.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) /
    Math.max(1, sampleValues.length - 1);
  const stdError = Math.sqrt(variance / sampleValues.length);
  const z = 1.96; // 95% confidence interval
  const margin = z * stdError;

  return {
    mean: Number(mean.toFixed(4)),
    ci95Lower: Number(Math.max(0, mean - margin).toFixed(4)),
    ci95Upper: Number(Math.min(1, mean + margin).toFixed(4)),
  };
}
