import type {
  CurriculumMapGraph,
  CurriculumCoverageAnalysisReport,
  CurriculumEvidenceExport,
  CurriculumOutcomeLink,
} from "../../../../packages/contracts/src/index.js";

export class CurriculumIntelligenceService {
  private readonly exportsLog: CurriculumEvidenceExport[] = [];

  public buildCurriculumMap(
    programId: string,
    tenantId: string,
    links: CurriculumOutcomeLink[],
  ): CurriculumMapGraph {
    return {
      programId,
      tenantId,
      generatedAt: new Date().toISOString(),
      links,
    };
  }

  public analyzeCoverage(
    map: CurriculumMapGraph,
    knownOutcomes: { outcomeId: string; title: string }[],
    prerequisites: { source: string; target: string }[],
  ): CurriculumCoverageAnalysisReport {
    const assessedMap = new Map<string, number>();
    for (const l of map.links) {
      const current = assessedMap.get(l.learningOutcomeId) ?? 0;
      assessedMap.set(l.learningOutcomeId, current + l.assessmentEvidenceCount);
    }

    const unassessedOutcomes: string[] = [];
    const overAssessedOutcomes: string[] = [];

    for (const o of knownOutcomes) {
      const count = assessedMap.get(o.outcomeId) ?? 0;
      if (count === 0) {
        unassessedOutcomes.push(`${o.outcomeId} (${o.title})`);
      } else if (count > 15) {
        overAssessedOutcomes.push(`${o.outcomeId} (${o.title}) - ${String(count)} assessments`);
      }
    }

    // Identify prerequisite gaps (target has assessments, but source has 0)
    const prerequisiteGaps: string[] = [];
    for (const p of prerequisites) {
      const sourceCount = assessedMap.get(p.source) ?? 0;
      const targetCount = assessedMap.get(p.target) ?? 0;
      if (targetCount > 0 && sourceCount === 0) {
        prerequisiteGaps.push(
          `Target ${p.target} assessed without verified assessment on prerequisite ${p.source}`,
        );
      }
    }

    return {
      tenantId: map.tenantId,
      programId: map.programId,
      unassessedOutcomes,
      overAssessedOutcomes,
      courseOverlapGaps: [],
      prerequisiteGaps,
      contentGaps:
        unassessedOutcomes.length > 0
          ? [`Found ${String(unassessedOutcomes.length)} unassessed outcomes in curriculum`]
          : [],
      summaryVerdict: unassessedOutcomes.length === 0 ? "SUFFICIENT_COVERAGE" : "ACTION_RECOMMENDED",
    };
  }

  public exportCurriculumEvidence(input: {
    tenantId: string;
    requestedBy: string;
    userRole: string;
    map: CurriculumMapGraph;
    coverage: CurriculumCoverageAnalysisReport;
  }): CurriculumEvidenceExport {
    if (input.userRole !== "ADMIN" && input.userRole !== "INSTRUCTOR") {
      throw new Error(`Unauthorized export request for role: ${input.userRole}`);
    }

    if (input.map.tenantId !== input.tenantId || input.coverage.tenantId !== input.tenantId) {
      throw new Error("Cross-tenant curriculum export prohibited by tenant isolation policy.");
    }

    const exportId = `cur-exp-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const now = new Date().toISOString();
    const signature = `sha256-audit-${exportId}-${input.tenantId}-${input.requestedBy}`;

    const record: CurriculumEvidenceExport = {
      exportId,
      tenantId: input.tenantId,
      requestedBy: input.requestedBy,
      datasetType: "CURRICULUM_OUTCOME_COVERAGE",
      generatedAt: now,
      auditSignature: signature,
      data: {
        coverageSummary: input.coverage,
        map: input.map,
      },
    };

    this.exportsLog.push(record);
    return record;
  }

  public getExportHistory(): CurriculumEvidenceExport[] {
    return [...this.exportsLog];
  }
}
