/**
 * Canonical Prerequisite and Cognitive Mastery Policy (Phase 20.0 Reconciliation).
 *
 * Defines explicit, platform-wide thresholds to eliminate scattered constants
 * across Mastery, Adaptive Path, Recommender, Assistant, and Diagnostics.
 */
export interface PrerequisitePolicy {
  /** Minimum score required in a hard (REQUIRED) prerequisite before dependent concepts are unlocked (70%). */
  readonly requiredPrerequisiteMastery: number;

  /** Minimum score required in a soft/advisory (RECOMMENDED) prerequisite before dependent concepts are studied without warnings (50%). */
  readonly recommendedPrerequisiteMastery: number;

  /** Remediation threshold: Concepts with mastery below 50% trigger a mandatory REVIEW action. */
  readonly reviewThreshold: number;

  /** Practice threshold: Concepts with mastery between 50% and 74% trigger a PRACTICE action to build fluency. */
  readonly practiceThreshold: number;

  /** Advanced mastery threshold: Concepts with mastery >= 85% qualify for OPTIONAL_ENRICHMENT modules. */
  readonly advancedMasteryThreshold: number;
}

export const CANONICAL_PREREQUISITE_POLICY: PrerequisitePolicy = {
  requiredPrerequisiteMastery: 70,
  recommendedPrerequisiteMastery: 50,
  reviewThreshold: 50,
  practiceThreshold: 75,
  advancedMasteryThreshold: 85,
};

export type CandidateEligibilityStatus = "ELIGIBLE" | "ELIGIBLE_WITH_WARNING" | "INELIGIBLE";
