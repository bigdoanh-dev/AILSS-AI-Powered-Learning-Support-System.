import { z } from "zod";

export interface AssistantToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodTypeAny;
  readonly parameters: Record<string, unknown>;
  readonly allowedRoles?: readonly ("PUBLIC" | "STUDENT" | "LECTURER" | "ADMIN")[];
  readonly tenantScope?: "PUBLIC" | "ACTOR_TENANT";
  readonly courseScope?: "NONE" | "ENTITLED_COURSE";
  readonly outputSchema?: z.ZodTypeAny;
  readonly timeoutBehavior?: "RETURN_TEMPORARILY_UNAVAILABLE";
}

export const searchCoursesSchema = z.object({
  query: z.string().optional(),
  level: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).optional(),
  maxPrice: z.number().nonnegative().optional(),
});

export const getCourseDetailsSchema = z.object({
  courseId: z.string().uuid(),
});

export const compareCoursesSchema = z.object({
  courseIds: z.array(z.string().uuid()).min(2).max(4),
});

export const getKnowledgeGapsSchema = z.object({
  courseId: z.string().uuid().optional(),
});

export const searchCourseMaterialsSchema = z.object({
  courseId: z.string().uuid(),
  topic: z.string().min(1),
});

export const explainConceptSchema = z.object({
  concept: z.string().min(1),
  detailLevel: z.enum(["simple", "standard", "in_depth"]).default("standard"),
});

export const generateQuizDraftSchema = z.object({
  topic: z.string().min(1),
  difficulty: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).default("INTERMEDIATE"),
  questionCount: z.number().int().min(1).max(20).default(5),
});

export const diagnoseCohortGapsSchema = z.object({
  courseId: z.string().uuid(),
  quizId: z.string().uuid().optional(),
});

export const suggestRemedialActionsSchema = z.object({
  topic: z.string().min(1),
  lowScoringCognitiveLevel: z.enum(["RECOGNITION", "UNDERSTANDING", "APPLICATION", "ADVANCED_APPLICATION"]),
});

export const getStudentMasterySchema = z.object({
  courseId: z.string().uuid(),
});

export const getRecommendedLearningPathSchema = z.object({
  courseId: z.string().uuid(),
});

export const getPrerequisiteGapsSchema = z.object({
  courseId: z.string().uuid(),
  targetConceptId: z.string().optional(),
});

export const recordRecommendationFeedbackSchema = z.object({
  recommendationId: z.string().uuid(),
  courseId: z.string().uuid(),
  feedbackType: z.enum(["useful", "not_useful", "already_know", "too_difficult", "too_easy"]),
  comment: z.string().optional(),
});

export const getCourseVersionDiffSchema = z.object({
  courseId: z.string().uuid(),
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
});

export const identifyHighFrictionLessonsSchema = z.object({
  courseId: z.string().uuid(),
});

export const ASSISTANT_TOOLS: Record<string, AssistantToolDefinition> = {
  search_courses: {
    name: "search_courses",
    description: "Search for published courses in the AILSS catalog by keyword, level, or price range.",
    schema: searchCoursesSchema,
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keyword or subject to search for" },
        level: { type: "string", enum: ["BEGINNER", "INTERMEDIATE", "ADVANCED"] },
        maxPrice: { type: "number", description: "Maximum price filter in VND" },
      },
    },
    allowedRoles: ["PUBLIC", "STUDENT", "LECTURER", "ADMIN"],
    tenantScope: "PUBLIC",
    courseScope: "NONE",
    outputSchema: z.array(z.object({ courseId: z.string().uuid(), title: z.string() }).passthrough()),
    timeoutBehavior: "RETURN_TEMPORARILY_UNAVAILABLE",
  },
  get_course_details: {
    name: "get_course_details",
    description: "Retrieve full details of a specific course, including title, description, instructor, price, syllabus outline, and published status.",
    schema: getCourseDetailsSchema,
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "The UUID of the course" },
      },
      required: ["courseId"],
    },
  },
  compare_courses: {
    name: "compare_courses",
    description: "Compare two to four courses side-by-side on curriculum, price, and difficulty level.",
    schema: compareCoursesSchema,
    parameters: {
      type: "object",
      properties: {
        courseIds: { type: "array", items: { type: "string" }, description: "List of course UUIDs to compare" },
      },
      required: ["courseIds"],
    },
  },
  get_knowledge_gaps: {
    name: "get_knowledge_gaps",
    description: "Analyze student's quiz history and identified knowledge gaps across Bloom's cognitive levels.",
    schema: getKnowledgeGapsSchema,
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "Optional course UUID to filter gaps" },
      },
    },
  },
  search_course_materials: {
    name: "search_course_materials",
    description: "Search entitled course lessons and lecture notes for specific study concepts.",
    schema: searchCourseMaterialsSchema,
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "Course UUID to search materials for" },
        topic: { type: "string", description: "Concept or keyword in lesson notes" },
      },
      required: ["courseId", "topic"],
    },
    allowedRoles: ["STUDENT", "LECTURER", "ADMIN"],
    tenantScope: "ACTOR_TENANT",
    courseScope: "ENTITLED_COURSE",
    outputSchema: z.array(z.object({ lessonId: z.string(), title: z.string(), contentSnippet: z.string() })),
    timeoutBehavior: "RETURN_TEMPORARILY_UNAVAILABLE",
  },
  explain_concept: {
    name: "explain_concept",
    description: "Synthesize an educational breakdown of a difficult concept grounded in course materials.",
    schema: explainConceptSchema,
    parameters: {
      type: "object",
      properties: {
        concept: { type: "string", description: "Concept to explain" },
        detailLevel: { type: "string", enum: ["simple", "standard", "in_depth"] },
      },
      required: ["concept"],
    },
  },
  generate_quiz_draft: {
    name: "generate_quiz_draft",
    description: "Propose an objective quiz outline with cognitive distributions for lecturer review.",
    schema: generateQuizDraftSchema,
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to generate questions on" },
        difficulty: { type: "string", enum: ["BEGINNER", "INTERMEDIATE", "ADVANCED"] },
        questionCount: { type: "number", description: "Number of questions to draft (1-20)" },
      },
      required: ["topic"],
    },
  },
  diagnose_cohort_gaps: {
    name: "diagnose_cohort_gaps",
    description: "Analyze cohort-wide assessment results to identify topics where students struggle most.",
    schema: diagnoseCohortGapsSchema,
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "Course UUID to diagnose" },
        quizId: { type: "string", description: "Optional quiz UUID filter" },
      },
      required: ["courseId"],
    },
  },
  suggest_remedial_actions: {
    name: "suggest_remedial_actions",
    description: "Generate remedial recommendations and supplementary review materials for struggling students.",
    schema: suggestRemedialActionsSchema,
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic needing review" },
        lowScoringCognitiveLevel: {
          type: "string",
          enum: ["RECOGNITION", "UNDERSTANDING", "APPLICATION", "ADVANCED_APPLICATION"],
        },
      },
      required: ["topic", "lowScoringCognitiveLevel"],
    },
  },
  get_student_mastery: {
    name: "get_student_mastery",
    description: "Retrieve authoritative concept mastery scores and Bloom levels for a student in a course.",
    schema: getStudentMasterySchema,
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "Course UUID" },
      },
      required: ["courseId"],
    },
    allowedRoles: ["STUDENT", "LECTURER", "ADMIN"],
    tenantScope: "ACTOR_TENANT",
    courseScope: "ENTITLED_COURSE",
    outputSchema: z.array(z.object({ courseId: z.string().uuid(), masteryScore: z.number() }).passthrough()),
    timeoutBehavior: "RETURN_TEMPORARILY_UNAVAILABLE",
  },
  get_recommended_learning_path: {
    name: "get_recommended_learning_path",
    description: "Generate personalized next adaptive study steps (continue, review, practice, prerequisite unblocking) for a student.",
    schema: getRecommendedLearningPathSchema,
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "Course UUID" },
      },
      required: ["courseId"],
    },
    allowedRoles: ["STUDENT", "LECTURER", "ADMIN"],
    tenantScope: "ACTOR_TENANT",
    courseScope: "ENTITLED_COURSE",
    outputSchema: z.object({ planId: z.string().uuid(), courseId: z.string().uuid(), items: z.array(z.unknown()) }).passthrough().nullable(),
    timeoutBehavior: "RETURN_TEMPORARILY_UNAVAILABLE",
  },
  get_prerequisite_gaps: {
    name: "get_prerequisite_gaps",
    description: "Identify missing prerequisite knowledge and required foundational concepts for a course or specific topic.",
    schema: getPrerequisiteGapsSchema,
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "Course UUID" },
        targetConceptId: { type: "string", description: "Optional specific target concept" },
      },
      required: ["courseId"],
    },
  },
  record_recommendation_feedback: {
    name: "record_recommendation_feedback",
    description: "Record learner feedback (useful, not_useful, already_know, too_difficult, too_easy) on a course recommendation.",
    schema: recordRecommendationFeedbackSchema,
    parameters: {
      type: "object",
      properties: {
        recommendationId: { type: "string", description: "Recommendation UUID" },
        courseId: { type: "string", description: "Course UUID" },
        feedbackType: {
          type: "string",
          enum: ["useful", "not_useful", "already_know", "too_difficult", "too_easy"],
        },
        comment: { type: "string", description: "Optional learner comment" },
      },
      required: ["recommendationId", "courseId", "feedbackType"],
    },
  },
  get_course_version_diff: {
    name: "get_course_version_diff",
    description: "Inspect changes, added/removed lessons, and concept modifications between two published course release versions.",
    schema: getCourseVersionDiffSchema,
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "Course UUID" },
        fromVersion: { type: "number", description: "Source release version number" },
        toVersion: { type: "number", description: "Target release version number" },
      },
      required: ["courseId", "fromVersion", "toVersion"],
    },
  },
  identify_high_friction_lessons: {
    name: "identify_high_friction_lessons",
    description: "Analyze learner struggle signals across cohort to identify high-friction lessons and suggest concrete pedagogical improvements.",
    schema: identifyHighFrictionLessonsSchema,
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string", description: "Course UUID to diagnose" },
      },
      required: ["courseId"],
    },
  },
};
