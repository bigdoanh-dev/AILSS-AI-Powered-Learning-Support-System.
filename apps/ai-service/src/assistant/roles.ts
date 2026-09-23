import type { AssistantMode, AssistantRole } from "./model.js";

export const ROLE_ALLOWED_MODES: Record<AssistantRole, readonly AssistantMode[]> = {
  PUBLIC: ["STUDENT_ADVISOR"],
  STUDENT: ["STUDENT_ADVISOR", "STUDY_BUDDY"],
  LECTURER: ["STUDENT_ADVISOR", "STUDY_BUDDY"],
  ADMIN: ["STUDENT_ADVISOR", "STUDY_BUDDY", "ADMIN_SUPPORT"],
};

export const ROLE_ALLOWED_TOOLS: Record<AssistantRole, readonly string[]> = {
  PUBLIC: ["search_courses", "get_course_details", "compare_courses"],
  STUDENT: [
    "search_courses",
    "get_course_details",
    "compare_courses",
    "get_knowledge_gaps",
    "search_course_materials",
    "explain_concept",
    "get_student_mastery",
    "get_recommended_learning_path",
    "get_prerequisite_gaps",
    "record_recommendation_feedback",
  ],
  LECTURER: [
    "search_courses",
    "get_course_details",
    "compare_courses",
    "get_knowledge_gaps",
    "search_course_materials",
    "explain_concept",
    "generate_quiz_draft",
    "diagnose_cohort_gaps",
    "suggest_remedial_actions",
    "get_student_mastery",
    "get_recommended_learning_path",
    "get_prerequisite_gaps",
    "record_recommendation_feedback",
    "get_course_version_diff",
    "identify_high_friction_lessons",
  ],
  ADMIN: [
    "search_courses",
    "get_course_details",
    "compare_courses",
    "get_knowledge_gaps",
    "search_course_materials",
    "explain_concept",
    "generate_quiz_draft",
    "diagnose_cohort_gaps",
    "suggest_remedial_actions",
    "get_student_mastery",
    "get_recommended_learning_path",
    "get_prerequisite_gaps",
    "record_recommendation_feedback",
    "get_course_version_diff",
    "identify_high_friction_lessons",
  ],
};

export function isModeAllowedForRole(role: AssistantRole, mode: AssistantMode): boolean {
  const allowed = ROLE_ALLOWED_MODES[role];
  return allowed.includes(mode);
}

export function isToolAllowedForRole(role: AssistantRole, toolName: string): boolean {
  const allowed = ROLE_ALLOWED_TOOLS[role];
  return allowed.includes(toolName);
}
