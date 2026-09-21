import type {
  QuestionBankItemV2,
  QuestionQualityStatus,
  AssessmentBlueprint,
  BlueprintValidationReport,
  ItemAnalysisMetrics,
} from "../../../../packages/contracts/src/index.js";
import { calculatePsychometrics } from "./psychometrics-calculator.js";

export class QuestionBankV2Service {
  private readonly items = new Map<string, QuestionBankItemV2>();
  private readonly attempts = new Map<
    string,
    { studentId: string; selectedOption: string; isCorrect: boolean; totalExamScore: number }[]
  >();

  public createQuestion(input: {
    questionId: string;
    tenantId: string;
    learningOutcomeIds: string[];
    prompt: string;
    questionType: "MULTIPLE_CHOICE" | "CODE_ANALYSIS" | "SHORT_ANSWER" | "ESSAY";
    options?: { id: string; text: string; isCorrect: boolean }[] | undefined;
    difficulty: number;
    bloomTaxonomyLevel: "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE" | "EVALUATE" | "CREATE";
    tags: string[];
    authorId: string;
    isAiGenerated?: boolean | undefined;
  }): QuestionBankItemV2 {
    const now = new Date().toISOString();
    const item: QuestionBankItemV2 = {
      questionId: input.questionId,
      tenantId: input.tenantId,
      version: 1,
      learningOutcomeIds: input.learningOutcomeIds,
      prompt: input.prompt,
      questionType: input.questionType,
      options: input.options,
      difficulty: Math.max(0, Math.min(1, input.difficulty)),
      bloomTaxonomyLevel: input.bloomTaxonomyLevel,
      tags: input.tags,
      // Invariant: AI-generated questions always start in DRAFT
      status: input.isAiGenerated ? "DRAFT" : "REVIEW_REQUIRED",
      authorId: input.authorId,
      usageHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    this.items.set(input.questionId, item);
    return item;
  }

  public updateQualityStatus(
    questionId: string,
    newStatus: QuestionQualityStatus,
    reviewerId: string,
  ): QuestionBankItemV2 {
    const item = this.items.get(questionId);
    if (!item) throw new Error(`Question ${questionId} not found`);

    item.status = newStatus;
    item.reviewerId = reviewerId;
    item.updatedAt = new Date().toISOString();
    if (newStatus === "APPROVED") {
      item.approvedAt = item.updatedAt;
    }

    return item;
  }

  public getQuestion(questionId: string): QuestionBankItemV2 | undefined {
    return this.items.get(questionId);
  }

  public validateAssessmentAgainstBlueprint(
    selectedQuestions: QuestionBankItemV2[],
    blueprint: AssessmentBlueprint,
  ): BlueprintValidationReport {
    const totalSelected = selectedQuestions.length;
    const coveredOutcomes = new Set<string>();
    let easyCount = 0;
    let mediumCount = 0;
    let hardCount = 0;

    for (const q of selectedQuestions) {
      for (const outcome of q.learningOutcomeIds) {
        coveredOutcomes.add(outcome);
      }
      if (q.difficulty < 0.35) easyCount++;
      else if (q.difficulty <= 0.7) mediumCount++;
      else hardCount++;
    }

    const missingOutcomes = blueprint.targetOutcomeIds.filter((id) => !coveredOutcomes.has(id));
    const coveragePercent =
      blueprint.targetOutcomeIds.length > 0
        ? Math.round(
            ((blueprint.targetOutcomeIds.length - missingOutcomes.length) /
              blueprint.targetOutcomeIds.length) *
              100,
          )
        : 100;

    const actualEasy = totalSelected > 0 ? Math.round((easyCount / totalSelected) * 100) : 0;
    const actualMedium = totalSelected > 0 ? Math.round((mediumCount / totalSelected) * 100) : 0;
    const actualHard = totalSelected > 0 ? Math.round((hardCount / totalSelected) * 100) : 0;

    const discrepancyNotices: string[] = [];
    if (totalSelected !== blueprint.desiredQuestionCount) {
      discrepancyNotices.push(
        `Question count mismatch: blueprint requires ${String(blueprint.desiredQuestionCount)}, got ${String(totalSelected)}`,
      );
    }
    if (missingOutcomes.length > 0) {
      discrepancyNotices.push(`Missing blueprint target outcomes: ${missingOutcomes.join(", ")}`);
    }

    const isAligned =
      totalSelected === blueprint.desiredQuestionCount &&
      missingOutcomes.length === 0 &&
      Math.abs(actualEasy - blueprint.difficultyDistribution.easyPercent) <= 15;

    return {
      isAligned,
      outcomeCoveragePercent: coveragePercent,
      actualDifficultyDistribution: {
        easyPercent: actualEasy,
        mediumPercent: actualMedium,
        hardPercent: actualHard,
      },
      totalPointsActual: totalSelected * 10,
      missingOutcomes,
      discrepancyNotices,
    };
  }

  public recordAttempt(
    questionId: string,
    attempt: { studentId: string; selectedOption: string; isCorrect: boolean; totalExamScore: number },
  ): void {
    const list = this.attempts.get(questionId) ?? [];
    list.push(attempt);
    this.attempts.set(questionId, list);
  }

  public static readonly DEFAULT_MIN_SAMPLE_SIZE = 30;

  public computeItemAnalysis(
    questionId: string,
    minSampleSize = QuestionBankV2Service.DEFAULT_MIN_SAMPLE_SIZE,
  ): ItemAnalysisMetrics {
    const records = this.attempts.get(questionId) ?? [];
    const question = this.items.get(questionId);
    return calculatePsychometrics(questionId, records, question?.options, minSampleSize);
  }
}
