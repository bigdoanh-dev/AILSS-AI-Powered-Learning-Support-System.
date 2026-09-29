import type { ItemAnalysisMetrics } from "../../../../packages/contracts/src/index.js";

export interface QuestionOptionItem {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface StudentAttemptRecord {
  studentId: string;
  selectedOption: string;
  isCorrect: boolean;
  totalExamScore: number;
}

/**
 * Upper/Lower Discrimination D = P_upper - P_lower (Kelley's 27% upper/lower tails)
 */
export function computeUpperLowerDiscrimination(records: StudentAttemptRecord[], total: number) {
  const sorted = [...records].sort((a, b) => b.totalExamScore - a.totalExamScore);
  const upperSize = Math.max(1, Math.floor(total * 0.27));
  const upperGroup = sorted.slice(0, upperSize);
  const lowerGroup = sorted.slice(total - upperSize);

  const pUpper = upperGroup.filter((r) => r.isCorrect).length / upperSize;
  const pLower = lowerGroup.filter((r) => r.isCorrect).length / upperSize;
  const dValue = Math.round((pUpper - pLower) * 100) / 100;

  return {
    upperGroupDefinition: "TOP_27_PERCENT" as const,
    lowerGroupDefinition: "BOTTOM_27_PERCENT" as const,
    sampleSize: upperSize * 2,
    pUpper: Math.round(pUpper * 100) / 100,
    pLower: Math.round(pLower * 100) / 100,
    dValue,
  };
}

/**
 * Point-biserial correlation r_pb (Corrected Item-Rest Pearson Correlation)
 *
 * For each item j, the learner's comparison score is the item-rest score:
 *   X'_i = totalExamScore_i - itemScore_i (excluding the item itself).
 * Point-biserial is computed as the Pearson product-moment correlation between
 * the binary item score y_i in {0, 1} and the item-rest score X'_i.
 * If var(y) == 0 (all correct / all incorrect) or var(X') == 0 (one-item assessment),
 * returns 0.0 safely without NaN leakage.
 */
export function computePointBiserial(records: StudentAttemptRecord[], total: number) {
  if (total <= 1) {
    return {
      rPb: 0.0,
      sampleSize: total,
      scoreDefinition: "CORRECTED_TOTAL_EXCLUDING_ITEM" as const,
      methodVersion: "CORRECTED_ITEM_REST_PEARSON" as const,
    };
  }

  let sumY = 0;
  let sumXp = 0;
  for (const r of records) {
    const y = r.isCorrect ? 1 : 0;
    const xp = r.totalExamScore - y; // item-rest score
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

  let rPb = 0.0;
  if (varY > 0 && varXp > 0) {
    const denom = Math.sqrt(varY * varXp);
    rPb = denom > 0 ? cov / denom : 0.0;
  }
  const roundedRpb = isNaN(rPb) ? 0.0 : Math.round(rPb * 100) / 100;

  return {
    rPb: roundedRpb,
    sampleSize: total,
    scoreDefinition: "CORRECTED_TOTAL_EXCLUDING_ITEM" as const,
    methodVersion: "CORRECTED_ITEM_REST_PEARSON" as const,
  };
}

/**
 * Distractor Efficiency & Option Distribution
 */
export function computeDistractorEfficiency(
  options: QuestionOptionItem[],
  optionDist: Record<string, number>,
  total: number,
) {
  return options.map((opt) => {
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
}

/**
 * Advisory Psychometric Flags (advisory only, never auto-delete)
 */
export function deriveAdvisoryFlags(
  dValue: number,
  rPb: number,
  itemDifficultyP: number,
  distractorEfficiency: { isCorrect: boolean; isFunctioning: boolean }[],
) {
  const flags: (
    "LOW_DISCRIMINATION" | "NEGATIVE_DISCRIMINATION" | "EXTREME_DIFFICULTY" | "NON_FUNCTIONING_DISTRACTOR"
  )[] = [];

  if (dValue < 0 || rPb < 0) {
    flags.push("NEGATIVE_DISCRIMINATION");
  } else if (dValue < 0.2 || rPb < 0.2) {
    flags.push("LOW_DISCRIMINATION");
  }

  if (itemDifficultyP < 0.15 || itemDifficultyP > 0.9) {
    flags.push("EXTREME_DIFFICULTY");
  }

  const hasNonFunctioning = distractorEfficiency.some((d) => !d.isCorrect && !d.isFunctioning);
  if (hasNonFunctioning && distractorEfficiency.length > 0) {
    flags.push("NON_FUNCTIONING_DISTRACTOR");
  }

  const verdict = flags.length > 0 ? ("REVIEW_RECOMMENDED" as const) : ("NORMAL" as const);
  return { flags, verdict };
}

/**
 * Main Psychometrics Calculator Engine
 */
export function calculatePsychometrics(
  questionId: string,
  records: StudentAttemptRecord[],
  options: QuestionOptionItem[] = [],
  minSampleSize = 30,
): ItemAnalysisMetrics {
  const total = records.length;
  const correctCount = records.filter((r) => r.isCorrect).length;
  const difficulty = total > 0 ? Math.round((correctCount / total) * 100) / 100 : 0;

  const optionDist: Record<string, number> = {};
  for (const r of records) {
    optionDist[r.selectedOption] = (optionDist[r.selectedOption] ?? 0) + 1;
  }

  // Small sample guard: if attempts < minSampleSize, return INSUFFICIENT_SAMPLE
  if (total < minSampleSize) {
    return {
      questionId,
      totalAttempts: total,
      minSampleSizeRequired: minSampleSize,
      status: "INSUFFICIENT_SAMPLE",
      itemDifficultyP: difficulty,
      difficultyIndex: difficulty,
      upperLowerDiscriminationD: null,
      discriminationIndex: 0,
      correctedItemRestPointBiserial: null,
      itemRestPointBiserial: null,
      pointBiserialRpb: null,
      distractorEfficiency: [],
      optionSelectionDistribution: optionDist,
      advisoryFlags: [],
      reviewVerdict: "INSUFFICIENT_SAMPLE",
      commonMisconceptionsDetected: [],
    };
  }

  const upperLowerD = computeUpperLowerDiscrimination(records, total);
  const pointBiserial = computePointBiserial(records, total);
  const distractors = computeDistractorEfficiency(options, optionDist, total);
  const { flags, verdict } = deriveAdvisoryFlags(
    upperLowerD.dValue,
    pointBiserial.rPb,
    difficulty,
    distractors,
  );

  // Misconceptions: distractors chosen by > 25%
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
    itemDifficultyP: difficulty,
    difficultyIndex: difficulty,
    upperLowerDiscriminationD: upperLowerD,
    discriminationIndex: upperLowerD.dValue,
    correctedItemRestPointBiserial: pointBiserial,
    itemRestPointBiserial: pointBiserial,
    pointBiserialRpb: pointBiserial,
    distractorEfficiency: distractors,
    optionSelectionDistribution: optionDist,
    advisoryFlags: flags,
    reviewVerdict: verdict,
    commonMisconceptionsDetected: misconceptions,
  };
}
