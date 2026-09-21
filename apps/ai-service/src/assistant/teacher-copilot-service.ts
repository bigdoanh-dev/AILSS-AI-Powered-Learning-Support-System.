import { randomUUID } from "node:crypto";
import type {
  GeneratedQuestionDraft,
  GeneratedRubricDraft,
  MisconceptionInsight,
  StudentRiskSignal,
  StudentInterventionRecord,
  ApprovalStatus,
  RiskSignalType,
  InterventionStatus,
} from "../../../../packages/contracts/src/index.js";

export class TeacherCopilotService {
  private readonly questionDrafts = new Map<string, GeneratedQuestionDraft>();
  private readonly rubricDrafts = new Map<string, GeneratedRubricDraft>();
  private readonly interventions = new Map<string, StudentInterventionRecord>();

  // ==========================================================================
  // Question Drafting & Human Approval Gate
  // ==========================================================================
  public createQuestionDraft(input: {
    courseId: string;
    learningOutcomeId: string;
    questionType: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
    questionText: string;
    options?: { id: string; text: string }[] | undefined;
    correctAnswerSummary: string;
    explanation: string;
    difficultyProposal: "INTRODUCTORY" | "INTERMEDIATE" | "ADVANCED";
    sourceContentIds: string[];
    modelVersion?: string | undefined;
  }): GeneratedQuestionDraft {
    const draftId = randomUUID();
    const draft: GeneratedQuestionDraft = {
      draftId,
      courseId: input.courseId,
      learningOutcomeId: input.learningOutcomeId,
      questionType: input.questionType,
      questionText: input.questionText,
      options: input.options,
      correctAnswerSummary: input.correctAnswerSummary,
      explanation: input.explanation,
      difficultyProposal: input.difficultyProposal,
      sourceContentIds: input.sourceContentIds,
      modelVersion: input.modelVersion || "gemini-2.5-pro",
      promptTemplateVersion: "copilot-qgen-v2.1",
      status: "DRAFT", // strictly DRAFT until approved
      generatedAt: new Date().toISOString(),
    };
    this.questionDrafts.set(draftId, draft);
    return draft;
  }

  public updateQuestionApproval(
    draftId: string,
    action: "APPROVE" | "REJECT",
    reviewerId: string,
    rejectionReason?: string,
  ): GeneratedQuestionDraft {
    const draft = this.questionDrafts.get(draftId);
    if (!draft) throw new Error("DRAFT_NOT_FOUND");

    if (action === "APPROVE") {
      draft.status = "APPROVED";
      draft.approvedBy = reviewerId;
      draft.approvedAt = new Date().toISOString();
      delete draft.rejectionReason;
    } else {
      draft.status = "REJECTED";
      draft.rejectionReason = rejectionReason || "Rejected by instructor review.";
    }

    return draft;
  }

  public getQuestionDraft(draftId: string): GeneratedQuestionDraft | null {
    return this.questionDrafts.get(draftId) ?? null;
  }

  public listApprovedQuestionsForBank(courseId: string): GeneratedQuestionDraft[] {
    return Array.from(this.questionDrafts.values()).filter(
      (d) => d.courseId === courseId && d.status === "APPROVED",
    );
  }

  // ==========================================================================
  // Rubric Assistant
  // ==========================================================================
  public createRubricDraft(input: {
    assessmentId: string;
    courseId: string;
    title: string;
    learningOutcomeIds: string[];
    criteria: {
      title: string;
      description: string;
      maxPoints: number;
      levels: { levelName: string; points: number; description: string }[];
    }[];
  }): GeneratedRubricDraft {
    const draftId = randomUUID();
    const draft: GeneratedRubricDraft = {
      draftId,
      assessmentId: input.assessmentId,
      courseId: input.courseId,
      title: input.title,
      criteria: input.criteria.map((c) => ({ ...c, criterionId: randomUUID() })),
      totalPoints: input.criteria.reduce((sum, c) => sum + c.maxPoints, 0),
      learningOutcomeIds: input.learningOutcomeIds,
      modelVersion: "gemini-2.5-pro",
      status: "DRAFT", // strictly DRAFT
      generatedAt: new Date().toISOString(),
    };
    this.rubricDrafts.set(draftId, draft);
    return draft;
  }

  public approveRubricDraft(draftId: string, teacherId: string): GeneratedRubricDraft {
    const draft = this.rubricDrafts.get(draftId);
    if (!draft) throw new Error("RUBRIC_DRAFT_NOT_FOUND");
    draft.status = "APPROVED";
    draft.approvedBy = teacherId;
    draft.approvedAt = new Date().toISOString();
    return draft;
  }

  // ==========================================================================
  // Misconception Analysis (Privacy Preserved)
  // ==========================================================================
  public analyzeMisconceptions(input: {
    courseId: string;
    totalEnrolled: number;
    assessmentAttempts: {
      studentId: string;
      conceptId: string;
      conceptName: string;
      questionId: string;
      chosenAnswer: string;
      isCorrect: boolean;
    }[];
  }): MisconceptionInsight[] {
    const errorsByConcept = new Map<
      string,
      {
        conceptName: string;
        wrongStudents: Set<string>;
        patterns: Map<string, number>;
        questions: Set<string>;
      }
    >();

    for (const att of input.assessmentAttempts) {
      if (att.isCorrect) continue;

      let entry = errorsByConcept.get(att.conceptId);
      if (!entry) {
        entry = {
          conceptName: att.conceptName,
          wrongStudents: new Set<string>(),
          patterns: new Map<string, number>(),
          questions: new Set<string>(),
        };
        errorsByConcept.set(att.conceptId, entry);
      }

      entry.wrongStudents.add(att.studentId);
      entry.questions.add(att.questionId);
      const count = entry.patterns.get(att.chosenAnswer) ?? 0;
      entry.patterns.set(att.chosenAnswer, count + 1);
    }

    const insights: MisconceptionInsight[] = [];
    for (const [conceptId, data] of errorsByConcept.entries()) {
      let topPattern = "Confusing related definitions";
      let maxCount = 0;
      for (const [pattern, c] of data.patterns.entries()) {
        if (c > maxCount) {
          maxCount = c;
          topPattern = `Commonly selecting: ${pattern}`;
        }
      }

      const affectedCount = data.wrongStudents.size;
      const cohortPercentage =
        input.totalEnrolled > 0 ? Math.round((affectedCount / input.totalEnrolled) * 100) : 0;

      insights.push({
        misconceptionId: randomUUID(),
        courseId: input.courseId,
        conceptId,
        conceptName: data.conceptName,
        affectedLearnersCount: affectedCount,
        cohortPercentage,
        commonWrongPattern: topPattern,
        supportingQuestionIds: Array.from(data.questions),
        recommendedRemediation: `Conduct a 10-minute in-class review addressing ${topPattern} before next assignment.`,
        detectedAt: new Date().toISOString(),
      });
    }

    return insights;
  }

  // ==========================================================================
  // Early Warning & Intervention Workflow
  // ==========================================================================
  public detectRiskSignals(input: {
    studentId: string;
    courseId: string;
    tenantId: string;
    daysInactive: number;
    masteryScoreCurrent: number;
    masteryScorePrevious: number;
    failedAttemptsCount: number;
  }): StudentRiskSignal[] {
    const signals: StudentRiskSignal[] = [];

    if (input.daysInactive >= 10) {
      signals.push({
        signalId: randomUUID(),
        studentId: input.studentId,
        courseId: input.courseId,
        tenantId: input.tenantId,
        signalType: "LONG_INACTIVITY",
        severity: input.daysInactive >= 14 ? "HIGH" : "MEDIUM",
        actionableExplanation: `Student has not engaged with course materials or activities for ${input.daysInactive} days.`,
        evidenceDetails: {
          metricName: "inactivity_days",
          currentValue: input.daysInactive,
          threshold: 10,
        },
        detectedAt: new Date().toISOString(),
      });
    }

    if (input.masteryScorePrevious - input.masteryScoreCurrent >= 20) {
      signals.push({
        signalId: randomUUID(),
        studentId: input.studentId,
        courseId: input.courseId,
        tenantId: input.tenantId,
        signalType: "RAPID_MASTERY_DECLINE",
        severity: "HIGH",
        actionableExplanation: `Mastery declined rapidly from ${input.masteryScorePrevious}% to ${input.masteryScoreCurrent}%.`,
        evidenceDetails: {
          metricName: "mastery_drop",
          currentValue: input.masteryScorePrevious - input.masteryScoreCurrent,
          threshold: 20,
        },
        detectedAt: new Date().toISOString(),
      });
    }

    if (input.failedAttemptsCount >= 3) {
      signals.push({
        signalId: randomUUID(),
        studentId: input.studentId,
        courseId: input.courseId,
        tenantId: input.tenantId,
        signalType: "REPEATED_FAILED_ATTEMPTS",
        severity: "MEDIUM",
        actionableExplanation: `Student has failed ${input.failedAttemptsCount} consecutive quiz attempts on core concepts.`,
        evidenceDetails: {
          metricName: "consecutive_failures",
          currentValue: input.failedAttemptsCount,
          threshold: 3,
        },
        detectedAt: new Date().toISOString(),
      });
    }

    return signals;
  }

  public createIntervention(input: {
    tenantId: string;
    studentId: string;
    courseId: string;
    triggerSignalId: string;
    assignedBy: string;
    notes?: string | undefined;
    remediationAction?: string | undefined;
  }): StudentInterventionRecord {
    const interventionId = randomUUID();
    const record: StudentInterventionRecord = {
      interventionId,
      tenantId: input.tenantId,
      studentId: input.studentId,
      courseId: input.courseId,
      triggerSignalId: input.triggerSignalId,
      status: "OPEN",
      notes: input.notes,
      remediationAction: input.remediationAction,
      assignedBy: input.assignedBy,
      assignedAt: new Date().toISOString(),
    };
    this.interventions.set(interventionId, record);
    return record;
  }

  public updateInterventionStatus(
    interventionId: string,
    newStatus: InterventionStatus,
    resolutionSummary?: string,
  ): StudentInterventionRecord {
    const record = this.interventions.get(interventionId);
    if (!record) throw new Error("INTERVENTION_NOT_FOUND");
    record.status = newStatus;
    if (newStatus === "RESOLVED") {
      record.resolvedAt = new Date().toISOString();
      record.resolutionSummary = resolutionSummary;
    }
    return record;
  }
}
