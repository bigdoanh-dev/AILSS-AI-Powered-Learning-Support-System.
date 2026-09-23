import { createHash, randomUUID } from "node:crypto";
import type {
  StudyPlanV2,
  StudyPlanItem,
  StudyPlanItemStatus,
  MasteryRecordV2,
} from "../../../../packages/contracts/src/index.js";

export interface CreateStudyPlanInput {
  planId?: string;
  studentId: string;
  tenantId: string;
  courseId: string;
  weekStartDate?: string | undefined;
  availableHoursPerWeek: number;
  masteryRecords: MasteryRecordV2[];
  courseRequirements?: {
    lessonId: string;
    title: string;
    learningOutcomeId: string;
    sourceVersion: number;
  }[] | undefined;
  upcomingAssessments?: {
    assessmentId: string;
    title: string;
    dueDate: string;
    targetOutcomeIds: string[];
    sourceVersion: number;
  }[] | undefined;
}

export class StudyPlanService {
  // Retained only for pure-domain callers/tests. Runtime routes persist through
  // AdaptiveRuntimeRepository and never rely on this process-local cache.
  private readonly plansStore = new Map<string, StudyPlanV2>();
  public generateStudyPlan(input: CreateStudyPlanInput): StudyPlanV2 {
    const planId = input.planId ?? randomUUID();
    const weekStartDate = input.weekStartDate || new Date().toISOString().slice(0, 10);
    const generatedAt = new Date().toISOString();
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
        itemId: deterministicItemId(planId, item.conceptId, "REVIEW_CONCEPT"),
        planId,
        courseId: input.courseId,
        conceptId: item.conceptId,
        title: `Refresher: ${item.conceptId}`,
        description: "Quick revision practice to reverse knowledge decay.",
        action: "REVIEW_CONCEPT",
        status: "PROPOSED",
        scheduledDate: addDate(dayOffset % 7),
        estimatedMinutes: 20,
        priority: 1,
        reasonCode: "RECENCY_DECAY",
        rationale: "Skill was proficient but inactive over 21 days.",
        sourceType: "MASTERY_PROJECTION",
        sourceId: item.conceptId,
        ...(item.learningOutcomeId ? { learningOutcomeId: item.learningOutcomeId } : {}),
        ...(item.masteryPolicyVersion ? { masteryPolicyVersion: item.masteryPolicyVersion } : {}),
        generatedAt,
      });
      dayOffset++;
    }

    // 2. Second priority: Developing prerequisites & core concepts
    const developing = input.masteryRecords.filter((m) => m.masteryState === "DEVELOPING" || m.masteryState === "INTRODUCED");
    for (const item of developing) {
      items.push({
        itemId: deterministicItemId(planId, item.conceptId, "REVIEW_CONCEPT"),
        planId,
        courseId: input.courseId,
        conceptId: item.conceptId,
        title: `Review concept: ${item.conceptId}`,
        description: "Review authoritative course material associated with this learning outcome.",
        action: "REVIEW_CONCEPT",
        status: "PROPOSED",
        scheduledDate: addDate(dayOffset % 7),
        estimatedMinutes: 35,
        priority: 2,
        reasonCode: "LOW_MASTERY",
        rationale: `Current mastery is ${String(item.masteryScore)}%. Reach 80% for proficiency.`,
        sourceType: "MASTERY_PROJECTION",
        sourceId: item.conceptId,
        ...(item.learningOutcomeId ? { learningOutcomeId: item.learningOutcomeId } : {}),
        ...(item.masteryPolicyVersion ? { masteryPolicyVersion: item.masteryPolicyVersion } : {}),
        generatedAt,
      });
      dayOffset++;
    }

    // 3. Upcoming assessments preparation
    for (const requirement of input.courseRequirements ?? []) {
      if (items.some((item) => item.learningOutcomeId === requirement.learningOutcomeId)) continue;
      items.push({
        itemId: deterministicItemId(planId, requirement.lessonId, "WATCH_LESSON"), planId,
        courseId: input.courseId, lessonId: requirement.lessonId, conceptId: requirement.learningOutcomeId,
        title: `Required lesson: ${requirement.title}`, description: "Complete this lesson from the published course syllabus.",
        action: "WATCH_LESSON", status: "PROPOSED", scheduledDate: addDate(dayOffset % 7),
        estimatedMinutes: 35, priority: 3, reasonCode: "TEACHER_PRIORITY",
        rationale: `Required by published course version ${String(requirement.sourceVersion)}.`,
        sourceType: "COURSE_REQUIREMENT", sourceId: requirement.lessonId,
        sourceVersion: requirement.sourceVersion,
        learningOutcomeId: requirement.learningOutcomeId, generatedAt,
      });
      dayOffset++;
    }

    // 4. Upcoming assessments preparation
    const upcoming = input.upcomingAssessments ?? [];
    for (const assessment of upcoming) {
      items.push({
        itemId: deterministicItemId(planId, assessment.assessmentId, "TAKE_DIAGNOSTIC"),
        planId,
        courseId: input.courseId,
        conceptId: assessment.targetOutcomeIds[0] || "comprehensive",
        title: `Exam Prep: ${assessment.title}`,
        description: "Diagnostic readiness check before scheduled assessment.",
        action: "TAKE_DIAGNOSTIC",
        status: "PROPOSED",
        scheduledDate: addDate(dayOffset % 7),
        estimatedMinutes: 45,
        priority: 1,
        reasonCode: "UPCOMING_ASSESSMENT",
        rationale: `Assessment due on ${assessment.dueDate}.`,
        sourceType: "ASSESSMENT",
        sourceId: assessment.assessmentId,
        sourceVersion: assessment.sourceVersion,
        dueAt: assessment.dueDate,
        ...(assessment.targetOutcomeIds[0] ? { learningOutcomeId: assessment.targetOutcomeIds[0] } : {}),
        generatedAt,
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
      generatedAt,
      items,
      overallMasteryPercent,
      masteryGaps,
      upcomingAssessments: upcoming,
    };

    this.plansStore.set(planId, plan);
    return plan;
  }

  public updateItemStatus(planId: string, itemId: string, newStatus: StudyPlanItemStatus, rescheduledDate?: string): StudyPlanItem | null {
    const item = this.plansStore.get(planId)?.items.find((candidate) => candidate.itemId === itemId);
    if (!item) return null;
    item.status = newStatus;
    if (newStatus === "RESCHEDULED" && rescheduledDate) item.scheduledDate = rescheduledDate;
    return item;
  }

  public getPlan(planId: string): StudyPlanV2 | null { return this.plansStore.get(planId) ?? null; }
}

function deterministicItemId(planId: string, target: string, action: string): string {
  const hex = createHash("sha256").update(`${planId}:${target}:${action}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
