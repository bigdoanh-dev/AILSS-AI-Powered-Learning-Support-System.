import type {
  QuestionBankItemV2,
  QuestionQualityStatus,
  AssessmentBlueprint,
  BlueprintValidationReport,
  ItemAnalysisMetrics,
} from "../../../../packages/contracts/src/index.js";

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
    const total = records.length;

    // Small sample guard: if attempts < minSampleSize, return INSUFFICIENT_SAMPLE
    if (total < minSampleSize) {
      const correctCount = records.filter((r) => r.isCorrect).length;
      const difficulty = total > 0 ? Math.round((correctCount / total) * 100) / 100 : 0;
      const optionDist: Record<string, number> = {};
      for (const r of records) {
        optionDist[r.selectedOption] = (optionDist[r.selectedOption] ?? 0) + 1;
      }

      return {
        questionId,
        totalAttempts: total,
        minSampleSizeRequired: minSampleSize,
        status: "INSUFFICIENT_SAMPLE",
        itemDifficultyP: difficulty,
        difficultyIndex: difficulty,
        upperLowerDiscriminationD: null,
        discriminationIndex: 0,
        pointBiserialRpb: null,
        distractorEfficiency: [],
        optionSelectionDistribution: optionDist,
        advisoryFlags: [],
        reviewVerdict: "INSUFFICIENT_SAMPLE",
        commonMisconceptionsDetected: [],
      };
    }

    // 1. Difficulty index P = correct / total
    const correctCount = records.filter((r) => r.isCorrect).length;
    const itemDifficultyP = Math.round((correctCount / total) * 100) / 100;

    // 2. Upper/Lower Discrimination D = P_upper - P_lower (Kelley's top 27% vs bottom 27%)
    const sorted = [...records].sort((a, b) => b.totalExamScore - a.totalExamScore);
    const upperSize = Math.max(1, Math.floor(total * 0.27));
    const upperGroup = sorted.slice(0, upperSize);
    const lowerGroup = sorted.slice(total - upperSize);

    const pUpper = upperGroup.filter((r) => r.isCorrect).length / upperSize;
    const pLower = lowerGroup.filter((r) => r.isCorrect).length / upperSize;
    const dValue = Math.round((pUpper - pLower) * 100) / 100;

    const upperLowerDiscriminationD = {
      upperGroupDefinition: "TOP_27_PERCENT",
      lowerGroupDefinition: "BOTTOM_27_PERCENT",
      sampleSize: upperSize * 2,
      pUpper: Math.round(pUpper * 100) / 100,
      pLower: Math.round(pLower * 100) / 100,
      dValue,
    };

    // 3. Point-biserial correlation r_pb (corrected item-total Pearson correlation)
    // X_i' = totalExamScore - (isCorrect ? 1 : 0)
    let sumY = 0;
    let sumXp = 0;
    for (const r of records) {
      const y = r.isCorrect ? 1 : 0;
      const xp = r.totalExamScore - y;
      sumY += y;
      sumXp += xp;
    }
    const meanY = sumY / total;
    const meanXp = sumXp / total;

    let cov = 0;
    let varY = 0;
    let varXp = 0;
    for (const r of records) {
      const y = r.isCorrect ? 1 : 0;
      const xp = r.totalExamScore - y;
      const diffY = y - meanY;
      const diffXp = xp - meanXp;
      cov += diffY * diffXp;
      varY += diffY * diffY;
      varXp += diffXp * diffXp;
    }

    let rPb = 0;
    if (varY > 0 && varXp > 0) {
      rPb = cov / Math.sqrt(varY * varXp);
    }
    const roundedRpb = Math.round(rPb * 100) / 100;

    const pointBiserialRpb = {
      rPb: roundedRpb,
      sampleSize: total,
      methodVersion: "CORRECTED_ITEM_TOTAL_PEARSON" as const,
    };

    // 4. Distractor Efficiency & Option Distribution
    const optionDist: Record<string, number> = {};
    for (const r of records) {
      optionDist[r.selectedOption] = (optionDist[r.selectedOption] ?? 0) + 1;
    }

    const question = this.items.get(questionId);
    const distractorEfficiency = (question?.options ?? []).map((opt) => {
      const count = optionDist[opt.id] ?? optionDist[opt.text] ?? 0;
      const rate = Math.round((count / total) * 100);
      const isFunctioning = opt.isCorrect ? true : count / total >= 0.05;
      return {
        option: opt.id || opt.text,
        selectionCount: count,
        selectionRatePercent: rate,
        isCorrect: opt.isCorrect,
        isFunctioning,
      };
    });

    // 5. Advisory Flags (advisory only, never auto-delete)
    const advisoryFlags: (
      | "LOW_DISCRIMINATION"
      | "NEGATIVE_DISCRIMINATION"
      | "EXTREME_DIFFICULTY"
      | "NON_FUNCTIONING_DISTRACTOR"
    )[] = [];

    if (dValue < 0 || roundedRpb < 0) {
      advisoryFlags.push("NEGATIVE_DISCRIMINATION");
    } else if (dValue < 0.20 || roundedRpb < 0.20) {
      advisoryFlags.push("LOW_DISCRIMINATION");
    }

    if (itemDifficultyP < 0.15 || itemDifficultyP > 0.90) {
      advisoryFlags.push("EXTREME_DIFFICULTY");
    }

    const hasNonFunctioning = distractorEfficiency.some(
      (d) => !d.isCorrect && !d.isFunctioning,
    );
    if (hasNonFunctioning && distractorEfficiency.length > 0) {
      advisoryFlags.push("NON_FUNCTIONING_DISTRACTOR");
    }

    const reviewVerdict = advisoryFlags.length > 0 ? "REVIEW_RECOMMENDED" : "NORMAL";

    // 6. Misconceptions detection: distractors chosen by > 25% of candidates
    const misconceptions: string[] = [];
    for (const [opt, count] of Object.entries(optionDist)) {
      if (count / total > 0.25) {
        misconceptions.push(
          `High distractor attraction on Option ${opt} (${String(Math.round((count / total) * 100))}%)`,
        );
      }
    }

    return {
      questionId,
      totalAttempts: total,
      minSampleSizeRequired: minSampleSize,
      status: "CALCULATED",
      itemDifficultyP,
      difficultyIndex: itemDifficultyP,
      upperLowerDiscriminationD,
      discriminationIndex: dValue,
      pointBiserialRpb,
      distractorEfficiency,
      optionSelectionDistribution: optionDist,
      advisoryFlags,
      reviewVerdict,
      commonMisconceptionsDetected: misconceptions,
    };
  }
}
