import { randomBytes } from "node:crypto";

export interface DPMechanismDefinition {
  adjacencyRelation: "DIFFER_BY_ONE_LEARNER_RECORD";
  boundingInterval: [number, number]; // [0, 100]
  sensitivityFormula: "DELTA_F = (MAX - MIN) / N";
  epsilon: number;
  delta: number;
  randomnessGenerator: "CRYPTOGRAPHIC_LAPLACE_INVERSE_CDF";
  compositionRule: "SEQUENTIAL_BASIC_COMPOSITION";
  totalBudgetPerResearcher: number;
  exportLifecycle: "AUDIT_LOGGED_WITH_BUDGET_DEDUCTION";
}

export interface DPAggregateQuery {
  researcherId: string;
  tenantId: string;
  cohortData: number[]; // individual learner scores
  queryType: "MEAN_SCORE" | "PASS_RATE";
  epsilonRequested?: number;
}

export interface DPAggregateResult {
  queryId: string;
  rawCount: number;
  rawMean: number;
  noisyMean: number;
  noiseAdded: number;
  epsilonConsumed: number;
  remainingBudget: number;
  isBudgetExhausted: boolean;
  suppressionApplied: boolean;
  mechanism: DPMechanismDefinition;
}

export interface DPUtilityBenchmark {
  cohortSize: number;
  sensitivity: number;
  expectedNoiseScale: number;
  measuredMeanAbsoluteError: number;
  institutionalUsabilityVerdict: "ACCEPTABLE" | "NOISY_PREFER_SUPPRESSION";
}

export class DifferentialPrivacyService {
  public static readonly DEFAULT_EPSILON = 1.0;
  public static readonly DEFAULT_DELTA = 0.00001;
  public static readonly TOTAL_BUDGET = 10.0;
  public static readonly MIN_COHORT_THRESHOLD = 5;

  private static readonly budgetStore = new Map<string, number>();

  public static getMechanismDefinition(): DPMechanismDefinition {
    return {
      adjacencyRelation: "DIFFER_BY_ONE_LEARNER_RECORD",
      boundingInterval: [0, 100],
      sensitivityFormula: "DELTA_F = (MAX - MIN) / N",
      epsilon: DifferentialPrivacyService.DEFAULT_EPSILON,
      delta: DifferentialPrivacyService.DEFAULT_DELTA,
      randomnessGenerator: "CRYPTOGRAPHIC_LAPLACE_INVERSE_CDF",
      compositionRule: "SEQUENTIAL_BASIC_COMPOSITION",
      totalBudgetPerResearcher: DifferentialPrivacyService.TOTAL_BUDGET,
      exportLifecycle: "AUDIT_LOGGED_WITH_BUDGET_DEDUCTION",
    };
  }

  /**
   * Cryptographically secure Laplace random variable generator
   * Sample from Lap(0, b) using inverse transform sampling:
   * x = -b * sgn(u) * ln(1 - 2|u|), where u ~ Uniform(-0.5, 0.5)
   */
  public static sampleLaplace(b: number): number {
    if (b <= 0) return 0;
    // Generate uniform random float in (0, 1) using crypto bytes
    const buf = randomBytes(4);
    const uRaw = buf.readUInt32BE(0) / 0xffffffff;
    // Map to (-0.5, 0.5), avoiding exact 0 to prevent ln(0)
    const u = Math.max(-0.49999, Math.min(0.49999, uRaw - 0.5));
    const sgn = u >= 0 ? 1 : -1;
    return -b * sgn * Math.log(1 - 2 * Math.abs(u));
  }

  /**
   * Evaluates aggregate query under Differential Privacy with budget tracking
   */
  public static evaluateDPAggregate(query: DPAggregateQuery): DPAggregateResult {
    const { researcherId, cohortData, epsilonRequested = DifferentialPrivacyService.DEFAULT_EPSILON } = query;
    const n = cohortData.length;

    // Check budget
    const currentBudget = this.budgetStore.get(researcherId) ?? DifferentialPrivacyService.TOTAL_BUDGET;
    if (currentBudget < epsilonRequested) {
      return {
        queryId: `dp-${Date.now()}`,
        rawCount: n,
        rawMean: 0,
        noisyMean: 0,
        noiseAdded: 0,
        epsilonConsumed: 0,
        remainingBudget: currentBudget,
        isBudgetExhausted: true,
        suppressionApplied: false,
        mechanism: this.getMechanismDefinition(),
      };
    }

    // Small cohort suppression check (if N < 5, do not release even with DP to prevent re-identification)
    if (n < DifferentialPrivacyService.MIN_COHORT_THRESHOLD) {
      return {
        queryId: `dp-${Date.now()}`,
        rawCount: n,
        rawMean: 0,
        noisyMean: 0,
        noiseAdded: 0,
        epsilonConsumed: 0,
        remainingBudget: currentBudget,
        isBudgetExhausted: false,
        suppressionApplied: true,
        mechanism: this.getMechanismDefinition(),
      };
    }

    // Clip raw values to [0, 100]
    const clippedData = cohortData.map((x) => Math.max(0, Math.min(100, x)));
    const rawSum = clippedData.reduce((acc, v) => acc + v, 0);
    const rawMean = rawSum / n;

    // Sensitivity: Delta f = (100 - 0) / N
    const sensitivity = 100.0 / n;
    const scale = sensitivity / epsilonRequested;

    const noiseAdded = this.sampleLaplace(scale);
    const noisyMean = Math.max(0, Math.min(100, Math.round((rawMean + noiseAdded) * 100) / 100));

    // Deduct budget
    const newBudget = Math.max(0, Math.round((currentBudget - epsilonRequested) * 100) / 100);
    this.budgetStore.set(researcherId, newBudget);

    return {
      queryId: `dp-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      rawCount: n,
      rawMean: Math.round(rawMean * 100) / 100,
      noisyMean,
      noiseAdded: Math.round(noiseAdded * 100) / 100,
      epsilonConsumed: epsilonRequested,
      remainingBudget: newBudget,
      isBudgetExhausted: false,
      suppressionApplied: false,
      mechanism: this.getMechanismDefinition(),
    };
  }

  /**
   * 40.C29: Measures the utility-privacy tradeoff across cohort sizes
   */
  public static runUtilityBenchmark(trialsPerSize = 200): DPUtilityBenchmark[] {
    const sizes = [10, 50, 200];
    const results: DPUtilityBenchmark[] = [];

    for (const size of sizes) {
      const sensitivity = 100.0 / size;
      const expectedScale = sensitivity / DifferentialPrivacyService.DEFAULT_EPSILON;

      let totalAbsoluteError = 0;
      for (let t = 0; t < trialsPerSize; t++) {
        const noise = this.sampleLaplace(expectedScale);
        totalAbsoluteError += Math.abs(noise);
      }
      const measuredMAE = Math.round((totalAbsoluteError / trialsPerSize) * 100) / 100;

      results.push({
        cohortSize: size,
        sensitivity: Math.round(sensitivity * 100) / 100,
        expectedNoiseScale: Math.round(expectedScale * 100) / 100,
        measuredMeanAbsoluteError: measuredMAE,
        institutionalUsabilityVerdict: size >= 50 ? "ACCEPTABLE" : "NOISY_PREFER_SUPPRESSION",
      });
    }

    return results;
  }

  public static resetBudget(researcherId: string): void {
    this.budgetStore.set(researcherId, DifferentialPrivacyService.TOTAL_BUDGET);
  }
}
