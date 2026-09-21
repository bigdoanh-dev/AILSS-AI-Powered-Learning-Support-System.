import { randomUUID } from "node:crypto";
import type {
  StudyPlanV2,
  StudyPlanItem,
  StudyPlanItemStatus,
  MasteryRecordV2,
} from "../../../../packages/contracts/src/index.js";

export interface CreateStudyPlanInput {
  studentId: string;
  tenantId: string;
  courseId: string;
  weekStartDate?: string | undefined;
  availableHoursPerWeek: number;
  masteryRecords: MasteryRecordV2[];
  upcomingAssessments?: {
    assessmentId: string;
    title: string;
    dueDate: string;
    targetOutcomeIds: string[];
  }[] | undefined;
}

export class StudyPlanService {
  private readonly plansStore = new Map<string, StudyPlanV2>();

  public generateStudyPlan(input: CreateStudyPlanInput): StudyPlanV2 {
    const planId = randomUUID();
    const weekStartDate = input.weekStartDate || new Date().toISOString().slice(0, 10);
    const items: StudyPlanItem[] = [];

    // Collect mastery gaps
    const masteryGaps = input.masteryRecords
      .filter((m) => m.masteryState === "DEVELOPING" || m.masteryState === "INTRODUCED" || m.masteryState === "DECAY_RISK")
      .map((m) => ({
        conceptId: m.conceptId,
        conceptName: m.conceptId,
        currentScore: m.masteryScore,
        targetScore: 80,
      }));

    let dayOffset = 0;
    const addDate = (offsetDays: number): string => {
      const d = new Date(weekStartDate);
      d.setDate(d.getDate() + offsetDays);
      return d.toISOString().slice(0, 10);
    };

    // 1. First priority: Decay risks (Refresher session)
    const decayRisks = input.masteryRecords.filter((m) => m.masteryState === "DECAY_RISK");
    for (const item of decayRisks) {
      items.push({
        itemId: randomUUID(),
        planId,
        courseId: input.courseId,
        conceptId: item.conceptId,
        title: `Refresher: ${item.conceptId}`,
        description: "Quick revision practice to reverse knowledge decay.",
        action: "REVIEW_CONCEPT",
        status: "PENDING",
        scheduledDate: addDate(dayOffset % 7),
        estimatedMinutes: 20,
        priority: 1,
        reasonCode: "RECENCY_DECAY",
        rationale: "Skill was proficient but inactive over 21 days.",
      });
      dayOffset++;
    }

    // 2. Second priority: Developing prerequisites & core concepts
    const developing = input.masteryRecords.filter((m) => m.masteryState === "DEVELOPING" || m.masteryState === "INTRODUCED");
    for (const item of developing) {
      items.push({
        itemId: randomUUID(),
        planId,
        courseId: input.courseId,
        conceptId: item.conceptId,
        title: `Practice & Socratic Help: ${item.conceptId}`,
        description: "Solve targeted practice questions with AI Tutor support.",
        action: "PRACTICE_QUESTIONS",
        status: "PENDING",
        scheduledDate: addDate(dayOffset % 7),
        estimatedMinutes: 35,
        priority: 2,
        reasonCode: "LOW_MASTERY",
        rationale: `Current mastery is ${String(item.masteryScore)}%. Reach 80% for proficiency.`,
      });
      dayOffset++;
    }

    // 3. Upcoming assessments preparation
    const upcoming = input.upcomingAssessments ?? [];
    for (const assessment of upcoming) {
      items.push({
        itemId: randomUUID(),
        planId,
        courseId: input.courseId,
        conceptId: assessment.targetOutcomeIds[0] || "comprehensive",
        title: `Exam Prep: ${assessment.title}`,
        description: "Diagnostic readiness check before scheduled assessment.",
        action: "TAKE_DIAGNOSTIC",
        status: "PENDING",
        scheduledDate: addDate(dayOffset % 7),
        estimatedMinutes: 45,
        priority: 1,
        reasonCode: "UPCOMING_ASSESSMENT",
        rationale: `Assessment due on ${assessment.dueDate}.`,
      });
      dayOffset++;
    }

    const totalScores = input.masteryRecords.reduce((acc, r) => acc + r.masteryScore, 0);
    const overallMasteryPercent = input.masteryRecords.length > 0 ? Math.round(totalScores / input.masteryRecords.length) : 0;

    const plan: StudyPlanV2 = {
      planId,
      studentId: input.studentId,
      tenantId: input.tenantId,
      courseId: input.courseId,
      weekStartDate,
      generatedAt: new Date().toISOString(),
      items,
      overallMasteryPercent,
      masteryGaps,
      upcomingAssessments: upcoming,
    };

    this.plansStore.set(planId, plan);
    return plan;
  }

  public updateItemStatus(
    planId: string,
    itemId: string,
    newStatus: StudyPlanItemStatus,
    rescheduledDate?: string,
  ): StudyPlanItem | null {
    const plan = this.plansStore.get(planId);
    if (!plan) return null;

    const item = plan.items.find((i) => i.itemId === itemId);
    if (!item) return null;

    item.status = newStatus;
    if (newStatus === "RESCHEDULED" && rescheduledDate) {
      item.scheduledDate = rescheduledDate;
    }
    return item;
  }

  public getPlan(planId: string): StudyPlanV2 | null {
    return this.plansStore.get(planId) ?? null;
  }
}
