import { z } from "zod";

// ============================================================================
// 40.26 - 40.28: Unified Student Learning Workspace Contracts
// ============================================================================
export const LearningGoalTypeEnum = z.enum([
  "COMPLETE_COURSE",
  "PREPARE_ASSESSMENT",
  "MASTER_TOPIC",
  "WEEKLY_STUDY_TIME",
]);
export type LearningGoalType = z.infer<typeof LearningGoalTypeEnum>;

export interface StudentLearningGoal {
  goalId: string;
  studentId: string;
  tenantId: string;
  courseId?: string | undefined;
  goalType: LearningGoalType;
  title: string;
  targetValue: number; // e.g. 100% course or 180 minutes or score 85
  currentValue: number;
  unit: "PERCENT" | "MINUTES" | "POINTS" | "TOPICS";
  targetDate: string; // ISO date
  status: "ACTIVE" | "COMPLETED" | "PAUSED";
  createdAt: string;
}

export interface TodayViewData {
  studentId: string;
  tenantId: string;
  date: string; // YYYY-MM-DD
  continueLearningItem?:
    | {
        courseId: string;
        courseTitle: string;
        lessonId: string;
        lessonTitle: string;
        progressPercent: number;
      }
    | undefined;
  dueItems: {
    id: string;
    type: "ASSESSMENT" | "PRACTICE" | "SURVEY";
    title: string;
    dueDate: string;
    urgency: "HIGH" | "MEDIUM" | "NORMAL";
  }[];
  reviewItems: {
    conceptId: string;
    conceptName: string;
    courseId: string;
    masteryScore: number;
    reason: "STALE_RETENTION" | "MISCONCEPTION";
  }[];
  recommendedNextAction: {
    recommendationId: string;
    title: string;
    rationale: string;
    actionType: string;
    isMandatory: boolean;
    canDismiss: boolean;
  };
  instructorFeedbackNotices: {
    noticeId: string;
    instructorName: string;
    courseTitle: string;
    feedbackText: string;
    sentAt: string;
  }[];
  widgetOrder: string[];
}

// ============================================================================
// 40.29 - 40.33: Curriculum & Course Authoring Studio V2 Contracts
// ============================================================================
export const ContentLifecycleStateEnum = z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"]);
export type ContentLifecycleState = z.infer<typeof ContentLifecycleStateEnum>;

export interface CourseModuleV2 {
  moduleId: string;
  title: string;
  order: number;
  learningOutcomeIds: string[];
  lessons: CourseLessonV2[];
}

export interface CourseLessonV2 {
  lessonId: string;
  moduleId: string;
  title: string;
  order: number;
  content: string;
  estimatedMinutes: number;
  learningOutcomeIds: string[];
  status: ContentLifecycleState;
}

export interface CourseVersionSnapshot {
  courseId: string;
  courseVersion: string; // e.g. "v2.1.0"
  sourceVersion?: string | undefined;
  changedBy: string;
  approvedBy: string;
  publishedAt: string;
  changeSummary: string;
  isCurrentActive: boolean;
}

export interface AiAuthoringDraftRequest {
  courseId: string;
  lessonId?: string | undefined;
  learningOutcomeId: string;
  draftType:
    "LESSON_OUTLINE" | "SUMMARY" | "PRACTICE_ACTIVITY" | "QUESTION_SUGGESTIONS" | "OUTCOME_SUGGESTIONS";
  sourceMaterialReferences: {
    documentId: string;
    documentTitle: string;
    section: string;
  }[];
  promptInstructions: string;
}

export interface AiAuthoringDraftResponse {
  draftId: string;
  courseId: string;
  draftType: string;
  generatedContent: string;
  sourceGroundingCitations: string[]; // e.g. ["Generated from Document A, Section B, Outcome C"]
  status: "DRAFT_REQUIRES_HUMAN_APPROVAL";
  humanApproved: false;
  generatedAt: string;
}

// ============================================================================
// 40.34 - 40.37: Assessment Authoring V2 Contracts
// ============================================================================
export const QuestionQualityStatusEnum = z.enum(["DRAFT", "REVIEW_REQUIRED", "APPROVED", "RETIRED"]);
export type QuestionQualityStatus = z.infer<typeof QuestionQualityStatusEnum>;

export interface QuestionBankItemV2 {
  questionId: string;
  tenantId: string;
  version: number;
  learningOutcomeIds: string[];
  prompt: string;
  questionType: "MULTIPLE_CHOICE" | "CODE_ANALYSIS" | "SHORT_ANSWER" | "ESSAY";
  options?: { id: string; text: string; isCorrect: boolean }[] | undefined;
  difficulty: number; // 0.0 - 1.0
  bloomTaxonomyLevel: "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE" | "EVALUATE" | "CREATE";
  tags: string[];
  status: QuestionQualityStatus;
  authorId: string;
  reviewerId?: string | undefined;
  usageHistory: { assessmentId: string; usedAt: string }[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string | undefined;
}

export interface AssessmentBlueprint {
  blueprintId: string;
  courseId: string;
  title: string;
  targetOutcomeIds: string[];
  desiredQuestionCount: number;
  difficultyDistribution: {
    easyPercent: number; // e.g. 30%
    mediumPercent: number; // e.g. 50%
    hardPercent: number; // e.g. 20%
  };
  questionTypes: ("MULTIPLE_CHOICE" | "CODE_ANALYSIS" | "SHORT_ANSWER")[];
  totalPoints: number;
}

export interface BlueprintValidationReport {
  isAligned: boolean;
  outcomeCoveragePercent: number;
  actualDifficultyDistribution: {
    easyPercent: number;
    mediumPercent: number;
    hardPercent: number;
  };
  totalPointsActual: number;
  missingOutcomes: string[];
  discrepancyNotices: string[];
}

export interface UpperLowerDiscriminationDetail {
  upperGroupDefinition: string; // e.g. "TOP_27_PERCENT"
  lowerGroupDefinition: string; // e.g. "BOTTOM_27_PERCENT"
  sampleSize: number;
  pUpper: number;
  pLower: number;
  dValue: number; // P_upper - P_lower (-1.0 to 1.0)
}

export interface PointBiserialDetail {
  rPb: number; // Corrected item-rest point-biserial correlation (-1.0 to 1.0)
  sampleSize: number;
  scoreDefinition: "CORRECTED_TOTAL_EXCLUDING_ITEM";
  methodVersion: "CORRECTED_ITEM_REST_PEARSON";
}

export interface DistractorEfficiencyDetail {
  option: string;
  selectionCount: number;
  selectionRatePercent: number;
  isCorrect: boolean;
  isFunctioning: boolean; // chosen by >= 5% of students
}

export interface ItemAnalysisMetrics {
  questionId: string;
  totalAttempts: number;
  minSampleSizeRequired: number;
  status: "CALCULATED" | "INSUFFICIENT_SAMPLE";
  // 1. Difficulty P = correct / total
  itemDifficultyP: number;
  difficultyIndex: number; // backward-compatibility alias to itemDifficultyP
  // 2. Upper/Lower Discrimination D = P_upper - P_lower
  upperLowerDiscriminationD: UpperLowerDiscriminationDetail | null;
  discriminationIndex: number; // backward-compatibility alias to D
  // 3. Point-biserial correlation r_pb (item-rest correlation)
  correctedItemRestPointBiserial: PointBiserialDetail | null;
  itemRestPointBiserial: PointBiserialDetail | null;
  pointBiserialRpb: PointBiserialDetail | null;
  // 4. Distractor analysis
  distractorEfficiency: DistractorEfficiencyDetail[];
  optionSelectionDistribution: Record<string, number>;
  // Advisory review rules (advisory only, never auto-delete)
  advisoryFlags: (
    "LOW_DISCRIMINATION" | "NEGATIVE_DISCRIMINATION" | "EXTREME_DIFFICULTY" | "NON_FUNCTIONING_DISTRACTOR"
  )[];
  reviewVerdict: "NORMAL" | "REVIEW_RECOMMENDED" | "INSUFFICIENT_SAMPLE";
  commonMisconceptionsDetected: string[];
}

// ============================================================================
// 40.38 - 40.40: Curriculum Intelligence Contracts
// ============================================================================
export interface CurriculumOutcomeLink {
  programOutcomeCode: string;
  courseOutcomeCode: string;
  learningOutcomeId: string;
  learningOutcomeTitle: string;
  assessmentEvidenceCount: number;
}

export interface CurriculumMapGraph {
  programId: string;
  tenantId: string;
  generatedAt: string;
  links: CurriculumOutcomeLink[];
}

export interface CurriculumCoverageAnalysisReport {
  tenantId: string;
  programId: string;
  unassessedOutcomes: string[];
  overAssessedOutcomes: string[];
  courseOverlapGaps: string[];
  prerequisiteGaps: string[];
  contentGaps: string[];
  summaryVerdict: "SUFFICIENT_COVERAGE" | "ACTION_RECOMMENDED";
}

export interface CurriculumEvidenceExport {
  exportId: string;
  tenantId: string;
  requestedBy: string;
  datasetType: "CURRICULUM_OUTCOME_COVERAGE";
  generatedAt: string;
  auditSignature: string;
  data: {
    coverageSummary: CurriculumCoverageAnalysisReport;
    map: CurriculumMapGraph;
  };
}

// ============================================================================
// 40.41 - 40.43: Institutional Fleet Operations Contracts
// ============================================================================
export interface InstitutionTemplate {
  templateId: string;
  name: string;
  description: string;
  identitySetup: {
    protocol: "OIDC" | "SAML";
    discoveryUrlPattern: string;
    allowedDomainRules: string[];
    // NOTE: Secrets are strictly omitted; never copied between tenants!
  };
  featurePolicy: Record<string, boolean>;
  aiPolicy: {
    allowedPedagogicalModes: string[];
    requireTeacherReviewForAiContent: boolean;
    studentDirectChatEnabled: boolean;
  };
  defaultLearningConfig: {
    gradingScale: string;
    masteryPolicyId: string;
    passingScore: number;
  };
  notificationConfig: {
    digestFrequency: "DAILY" | "WEEKLY";
    smsEnabled: boolean;
  };
  createdAt: string;
}

export interface BulkOperationPreview {
  targetTenantCount: number;
  targetTenantIds: string[];
  operationType: "CONFIG_VALIDATION" | "FEATURE_ENABLEMENT" | "POLICY_UPDATE";
  changesSummary: Record<string, unknown>;
  dryRunPassed: boolean;
  validationIssues: { tenantId: string; issue: string }[];
}

export type ConfigDriftStatus = "IN_SYNC" | "DRIFTED" | "ERROR";

export interface TenantConfigDriftReport {
  tenantId: string;
  tenantName: string;
  status: ConfigDriftStatus;
  driftedFields: { field: string; expected: unknown; actual: unknown }[];
  inspectedAt: string;
}

// ============================================================================
// 40.44 - 40.46: Product Experimentation Contracts
// ============================================================================
export const FORBIDDEN_EXPERIMENT_DOMAINS = [
  "GRADE_CORRECTNESS",
  "CREDENTIAL_VALIDITY",
  "AUTHORIZATION_POLICY",
  "SECURITY_INTEGRITY",
  "PAYMENT_CORRECTNESS",
] as const;

export interface ExperimentDefinition {
  experimentId: string;
  name: string;
  hypothesis: string;
  experimentDomain:
    "RECOMMENDATION_RANKING" | "STUDY_PLAN_UI" | "TUTOR_PEDAGOGICAL_MODES" | "NOTIFICATION_TIMING";
  variants: ("CONTROL" | "TREATMENT_A" | "TREATMENT_B")[];
  tenantAllowlist: string[];
  startDate: string;
  endDate: string;
  status: "DRAFT" | "RUNNING" | "CONCLUDED" | "TERMINATED";
}

export interface ExperimentAssignment {
  experimentId: string;
  studentId: string;
  tenantId: string;
  cohort: string;
  assignedVariant: "CONTROL" | "TREATMENT_A" | "TREATMENT_B";
  assignedAt: string;
}

export interface ExperimentEvaluationMetrics {
  experimentId: string;
  totalParticipants: number;
  variantMetrics: Record<
    string,
    {
      participants: number;
      activityCompletionRate: number; // e.g. 0.82
      recommendationAcceptanceRate: number; // e.g. 0.74
      masteryImprovementDelta: number; // e.g. +6.5%
      studentRetryRate: number; // e.g. 0.35
      tutorSatisfactionScore: number; // e.g. 4.6 / 5.0
    }
  >;
  statisticallySignificant: boolean;
  learningOutcomeImpact: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
}
