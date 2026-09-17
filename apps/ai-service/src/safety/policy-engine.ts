import { evaluateAssessmentIntegrity } from "./assessment-guard.js";
import { evaluatePromptInjection } from "./jailbreak-detector.js";
import type { SafetyContext, SafetyPolicyResult } from "./policy-types.js";
import { evaluateLearnerWellbeing } from "./wellbeing-boundary.js";

export class LearnerSafetyPolicyEngine {
  public evaluate(context: SafetyContext, now: Date = new Date()): SafetyPolicyResult {
    // 1. Prompt injection / Jailbreak defense (Highest precedence)
    const injectionResult = evaluatePromptInjection(context, now);
    if (injectionResult) {
      return injectionResult;
    }

    // 2. Assessment integrity check
    const assessmentResult = evaluateAssessmentIntegrity(context, now);
    if (assessmentResult && !assessmentResult.allowed) {
      return assessmentResult;
    }

    // 3. Wellbeing boundaries
    const wellbeingResult = evaluateLearnerWellbeing(context, now);

    // 4. If assessment returned a warning, prioritize it over pure allow
    if (assessmentResult?.decision === "ALLOW_WITH_WARNING") {
      const combinedWarning =
        assessmentResult.warning && wellbeingResult?.warning
          ? `${assessmentResult.warning} | ${wellbeingResult.warning}`
          : (assessmentResult.warning ?? wellbeingResult?.warning);
      return {
        ...assessmentResult,
        ...(combinedWarning ? { warning: combinedWarning } : {}),
      };
    }

    if (wellbeingResult) {
      return wellbeingResult;
    }

    // 5. Default ALLOW
    return {
      allowed: true,
      policyId: "DEFAULT_LEARNER_SAFETY",
      decision: "ALLOW",
      reasonCode: "STANDARD_LEARNING_INTERACTION",
      timestamp: now,
    };
  }
}
