import type { FrictionDiagnosticReport, LessonFrictionSignal } from "./model.js";

export class FrictionDiagnosticService {
  analyzeLessonFriction(signal: LessonFrictionSignal): FrictionDiagnosticReport {
    const diagnostics: string[] = [];
    const suggestedInterventions: string[] = [];
    let frictionScore = 0;

    // 1. Quiz Performance Analysis
    if (signal.averageQuizScorePercent < 55) {
      diagnostics.push(
        `Sub-standard average quiz performance (${String(signal.averageQuizScorePercent)}% < 55%)`,
      );
      suggestedInterventions.push("Add visual diagrams and worked step-by-step example solutions.");
      frictionScore += 2;
    } else if (signal.averageQuizScorePercent < 70) {
      diagnostics.push(`Moderate quiz struggle (${String(signal.averageQuizScorePercent)}%)`);
      frictionScore += 1;
    }

    // 2. Retry Attempt Multiplier
    if (signal.averageAttemptsPerStudent >= 2.5) {
      diagnostics.push(
        `High attempt churn (avg ${signal.averageAttemptsPerStudent.toFixed(1)} attempts/student)`,
      );
      suggestedInterventions.push("Review quiz question wording for ambiguity or misleading distractors.");
      frictionScore += 2;
    } else if (signal.averageAttemptsPerStudent >= 1.8) {
      diagnostics.push(`Elevated retry count (avg ${signal.averageAttemptsPerStudent.toFixed(1)} attempts)`);
      frictionScore += 1;
    }

    // 3. AI Assistant Query Spike
    if (signal.assistantQueryCount >= 20) {
      diagnostics.push(
        `High learner confusion volume (${String(signal.assistantQueryCount)} assistant queries recorded)`,
      );
      suggestedInterventions.push(
        "Include an interactive FAQ or micro-video addressing recurring student doubts.",
      );
      frictionScore += 2;
    } else if (signal.assistantQueryCount >= 8) {
      diagnostics.push(`Notable assistant inquiry activity (${String(signal.assistantQueryCount)} queries)`);
      frictionScore += 1;
    }

    // 4. Drop-off / Completion Deficit
    if (signal.completionRatePercent < 60) {
      diagnostics.push(`Severe drop-off: only ${String(signal.completionRatePercent)}% completion rate`);
      suggestedInterventions.push("Consider splitting lesson into smaller 5-10 minute digestible segments.");
      frictionScore += 2;
    }

    let frictionLevel: "HIGH" | "MEDIUM" | "LOW" = "LOW";
    if (frictionScore >= 4) {
      frictionLevel = "HIGH";
    } else if (frictionScore >= 2) {
      frictionLevel = "MEDIUM";
    }

    return {
      lessonId: signal.lessonId,
      lessonTitle: signal.lessonTitle,
      courseId: signal.courseId,
      frictionLevel,
      isHighFriction: frictionLevel === "HIGH",
      diagnostics,
      suggestedInterventions,
      metrics: {
        averageQuizScorePercent: signal.averageQuizScorePercent,
        averageAttemptsPerStudent: signal.averageAttemptsPerStudent,
        assistantQueryCount: signal.assistantQueryCount,
        completionRatePercent: signal.completionRatePercent,
      },
    };
  }
}
