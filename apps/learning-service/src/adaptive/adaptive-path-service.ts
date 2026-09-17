import { randomUUID } from "node:crypto";
import { CANONICAL_PREREQUISITE_POLICY } from "../../../../packages/contracts/src/index.js";
import type { LearnerMasteryService } from "../mastery/mastery-service.js";
import type { AdaptiveLearningPath, AdaptivePathItem } from "./model.js";


export interface CourseOutlineConcept {
  conceptId: string;
  conceptName: string;
  lessonId?: string;
  order: number;
}

export class AdaptivePathService {
  constructor(private readonly masteryService: LearnerMasteryService) {}

  async generatePath(input: {
    studentId: string;
    courseId: string;
    courseConcepts: CourseOutlineConcept[];
    completedLessonIds: string[];
  }): Promise<AdaptiveLearningPath> {
    const studentMastery = await this.masteryService.getStudentMastery(input.studentId, input.courseId);
    const masteryMap = new Map(studentMastery.map((m) => [m.conceptId, m]));
    const completedSet = new Set(input.completedLessonIds);

    const items: AdaptivePathItem[] = [];

    for (const concept of input.courseConcepts) {
      const mastery = masteryMap.get(concept.conceptId);
      const isCompleted = concept.lessonId ? completedSet.has(concept.lessonId) : false;

      // Check prerequisite gaps
      const gaps = await this.masteryService.findPrerequisiteGaps(
        input.studentId,
        input.courseId,
        concept.conceptId,
      );

      if (gaps.length > 0) {
        items.push({
          itemId: randomUUID(),
          courseId: input.courseId,
          lessonId: concept.lessonId,
          conceptId: concept.conceptId,
          conceptName: concept.conceptName,
          action: "REVISIT_PREREQUISITE",
          priority: 1, // Highest priority: unblock foundation first
          rationale: `Foundation gap in ${gaps.map((g) => g.prerequisiteConceptId).join(", ")}. Master prerequisites before proceeding.`,
          prerequisiteGaps: gaps.map((g) => ({
            prerequisiteConceptId: g.prerequisiteConceptId,
            currentScore: g.currentPrereqMastery,
            requiredScore: g.requiredScore,
          })),
        });
        continue;
      }

      if (!mastery || mastery.evidenceCount === 0) {
        if (!isCompleted) {
          items.push({
            itemId: randomUUID(),
            courseId: input.courseId,
            lessonId: concept.lessonId,
            conceptId: concept.conceptId,
            conceptName: concept.conceptName,
            action: "CONTINUE",
            priority: 2,
            rationale: "Next uncompleted topic with prerequisites satisfied.",
          });
        }
      } else if (mastery.masteryScore < CANONICAL_PREREQUISITE_POLICY.reviewThreshold) {
        items.push({
          itemId: randomUUID(),
          courseId: input.courseId,
          lessonId: concept.lessonId,
          conceptId: concept.conceptId,
          conceptName: concept.conceptName,
          action: "REVIEW",
          priority: 2,
          rationale: `Mastery score is ${String(mastery.masteryScore)}%. Review core materials and definitions.`,
        });
      } else if (mastery.masteryScore < CANONICAL_PREREQUISITE_POLICY.practiceThreshold) {
        items.push({
          itemId: randomUUID(),
          courseId: input.courseId,
          lessonId: concept.lessonId,
          conceptId: concept.conceptId,
          conceptName: concept.conceptName,
          action: "PRACTICE",
          priority: 3,
          rationale: `Mastery score is ${String(mastery.masteryScore)}%. Solve practice quizzes to reach proficiency.`,
        });
      } else if (mastery.masteryScore >= CANONICAL_PREREQUISITE_POLICY.advancedMasteryThreshold && isCompleted) {
        items.push({
          itemId: randomUUID(),
          courseId: input.courseId,
          lessonId: concept.lessonId,
          conceptId: concept.conceptId,
          conceptName: concept.conceptName,
          action: "OPTIONAL_ENRICHMENT",
          priority: 5,
          rationale: `Mastered (${String(mastery.masteryScore)}%). Optional advanced topics available.`,
        });
      }

    }

    // Sort by priority ascending (1 = highest urgency), then by original outline order
    items.sort((a, b) => a.priority - b.priority);

    // Calculate overall average mastery
    const totalScore = studentMastery.reduce((acc, curr) => acc + curr.masteryScore, 0);
    const overallMasteryPercent =
      studentMastery.length > 0 ? Math.round(totalScore / studentMastery.length) : 0;

    return {
      studentId: input.studentId,
      courseId: input.courseId,
      generatedAt: new Date().toISOString(),
      items,
      overallMasteryPercent,
    };
  }
}
