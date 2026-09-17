import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FrictionDiagnosticService,
  LearningExperimentationService,
} from "../../apps/learning-service/src/experimentation/index.js";
import {
  InMemoryMasteryRepository,
  LearnerMasteryService,
} from "../../apps/learning-service/src/mastery/index.js";

describe("Phase 19F/G — Lecturer Copilot Friction Diagnostics & Safe Experimentation", () => {
  describe("Cohort Mastery Distribution & High-Friction Concept Detection", () => {
    const masteryRepo = new InMemoryMasteryRepository();
    const masteryService = new LearnerMasteryService(masteryRepo);
    const courseId = randomUUID();

    it("aggregates cohort distribution and flags high-friction concepts", async () => {
      // Seed 4 students with weak scores in Distributed Consensus
      for (let i = 0; i < 4; i++) {
        await masteryService.recordEvidence({
          studentId: `student-${String(i)}`,
          courseId,
          conceptId: "DISTRIBUTED_CONSENSUS",
          conceptName: "Distributed Consensus Protocols",
          rawScorePercent: 35 + i * 5, // 35, 40, 45, 50 -> average ~ 42.5
          evidenceSource: "QUIZ",
          bloomLevel: "REMEMBER",
        });
      }

      // Seed same students with strong scores in Basic REST APIs
      for (let i = 0; i < 4; i++) {
        await masteryService.recordEvidence({
          studentId: `student-${String(i)}`,
          courseId,
          conceptId: "REST_APIS",
          conceptName: "REST API Principles",
          rawScorePercent: 90,
          evidenceSource: "QUIZ",
          bloomLevel: "APPLY",
        });
      }

      const distribution = await masteryService.getCohortMasteryDistribution(courseId);
      expect(distribution).toHaveLength(2);

      const consensusConcept = distribution.find((c) => c.conceptId === "DISTRIBUTED_CONSENSUS");
      expect(consensusConcept).toBeDefined();
      if (!consensusConcept) throw new Error("Expected consensus concept");
      expect(consensusConcept.studentCount).toBe(4);
      expect(consensusConcept.atRiskCount).toBeGreaterThanOrEqual(3);
      expect(consensusConcept.isHighFriction).toBe(true);

      const restConcept = distribution.find((c) => c.conceptId === "REST_APIS");
      expect(restConcept).toBeDefined();
      if (!restConcept) throw new Error("Expected rest concept");
      expect(restConcept.studentCount).toBe(4);
      expect(restConcept.masteredCount).toBe(4);
      expect(restConcept.isHighFriction).toBe(false);
    });
  });

  describe("Content Friction Diagnostic Service", () => {
    const diagnosticService = new FrictionDiagnosticService();

    it("detects high friction on lessons with low scores, high retry churn, and query spikes", () => {
      const report = diagnosticService.analyzeLessonFriction({
        lessonId: "les-paxos",
        lessonTitle: "Paxos & Byzantine Fault Tolerance",
        courseId: "course-dist-sys",
        averageQuizScorePercent: 48,
        averageAttemptsPerStudent: 3.2,
        assistantQueryCount: 28,
        completionRatePercent: 45,
      });

      expect(report.isHighFriction).toBe(true);
      expect(report.frictionLevel).toBe("HIGH");
      expect(report.diagnostics.length).toBeGreaterThanOrEqual(3);
      expect(report.suggestedInterventions).toContain(
        "Add visual diagrams and worked step-by-step example solutions.",
      );
      expect(report.suggestedInterventions).toContain(
        "Review quiz question wording for ambiguity or misleading distractors.",
      );
      expect(report.suggestedInterventions).toContain(
        "Include an interactive FAQ or micro-video addressing recurring student doubts.",
      );
    });

    it("marks smooth lessons as low friction", () => {
      const report = diagnosticService.analyzeLessonFriction({
        lessonId: "les-intro",
        lessonTitle: "Introduction to System Models",
        courseId: "course-dist-sys",
        averageQuizScorePercent: 88,
        averageAttemptsPerStudent: 1.1,
        assistantQueryCount: 2,
        completionRatePercent: 96,
      });

      expect(report.isHighFriction).toBe(false);
      expect(report.frictionLevel).toBe("LOW");
      expect(report.diagnostics).toHaveLength(0);
    });
  });

  describe("Safe Experimentation Framework", () => {
    const experimentService = new LearningExperimentationService();

    it("provides stable deterministic variant assignment for students without cross-contamination", () => {
      experimentService.createExperiment({
        experimentId: "exp-adaptive-paths-v1",
        name: "Adaptive vs Static Learning Path",
        variants: ["CONTROL", "ADAPTIVE_RECOMMENDATIONS_V1", "STEP_BY_STEP_V2"],
        targetMetric: "course_completion_rate",
      });

      const s1Assignment1 = experimentService.getAssignment("student-alpha", "exp-adaptive-paths-v1");
      const s1Assignment2 = experimentService.getAssignment("student-alpha", "exp-adaptive-paths-v1");

      // Stable deterministic allocation
      expect(s1Assignment1.assignedVariant).toBe(s1Assignment2.assignedVariant);

      const s2Assignment = experimentService.getAssignment("student-beta", "exp-adaptive-paths-v1");
      expect(s2Assignment.assignedVariant).toBeDefined();
    });
  });
});
