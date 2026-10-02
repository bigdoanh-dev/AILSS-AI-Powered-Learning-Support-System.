import { ASSISTANT_TOOLS } from "./tool-registry.js";
import type { AssistantRole, ToolResult } from "./model.js";
import { isToolAllowedForRole } from "./roles.js";

export interface CourseCatalogItem {
  readonly courseId: string;
  readonly title: string;
  readonly description: string;
  readonly priceAmount: number;
  readonly priceCurrency: string;
  readonly level: string;
  readonly syllabusOutline?: readonly string[];
  readonly instructorName?: string;
}

export interface StudentKnowledgeGap {
  readonly topic: string;
  readonly cognitiveLevel: string;
  readonly accuracyRate: number;
  readonly recommendation: string;
}

export interface CourseMaterialSnippet {
  readonly courseId?: string;
  readonly lessonId: string;
  readonly lessonVersion?: number;
  readonly courseVersion?: number;
  readonly title: string;
  readonly sectionTitle?: string;
  readonly contentSnippet: string;
  readonly sourceObjectId: string;
  readonly retrievalScore: number;
  readonly sourceType: "LESSON_OBJECT";
}

export interface AssistantDomainClient {
  searchCourses(query?: string, level?: string, maxPrice?: number): Promise<readonly CourseCatalogItem[]>;
  getCourseDetails(courseId: string): Promise<CourseCatalogItem | null>;
  compareCourses(courseIds: readonly string[]): Promise<readonly CourseCatalogItem[]>;
  getKnowledgeGaps(studentId: string, courseId?: string): Promise<readonly StudentKnowledgeGap[]>;
  searchCourseMaterials(
    studentId: string,
    courseId: string,
    topic: string,
  ): Promise<readonly CourseMaterialSnippet[]>;
  generateQuizDraft(topic: string, difficulty: string, questionCount: number): Promise<unknown>;
  diagnoseCohortGaps(courseId: string, quizId?: string): Promise<unknown>;
  hasActiveAssessmentAttempt(studentId: string): Promise<boolean>;
  getStudentMastery?(studentId: string, courseId: string): Promise<unknown>;
  getRecommendedLearningPath?(studentId: string, courseId: string): Promise<unknown>;
  generateStudyPlan?(studentId: string, courseId: string, availableHoursPerWeek: number): Promise<unknown>;
  updateStudyPlanItem?(
    studentId: string,
    courseId: string,
    itemId: string,
    status: string,
    scheduledDate?: string,
  ): Promise<unknown>;
  getPrerequisiteGaps?(studentId: string, courseId: string, targetConceptId?: string): Promise<unknown>;
  recordRecommendationFeedback?(feedback: {
    studentId: string;
    recommendationId: string;
    courseId: string;
    feedbackType: string;
    comment?: string;
  }): Promise<unknown>;
  getCourseVersionDiff?(courseId: string, fromVersion: number, toVersion: number): Promise<unknown>;
  identifyHighFrictionLessons?(courseId: string): Promise<unknown>;
}

export class ToolRunner {
  public constructor(private readonly domainClient: AssistantDomainClient) {}

  public async executeTool(
    toolCallId: string,
    toolName: string,
    rawArgs: Record<string, unknown>,
    user: { readonly userId: string; readonly role: AssistantRole },
  ): Promise<ToolResult> {
    // 1. Check if tool is allowed for user's role
    if (!isToolAllowedForRole(user.role, toolName)) {
      return {
        toolCallId,
        name: toolName,
        result: null,
        error: `FORBIDDEN: Role ${user.role} is not permitted to execute tool ${toolName}`,
      };
    }

    const toolDef = ASSISTANT_TOOLS[toolName];
    if (!toolDef) {
      return {
        toolCallId,
        name: toolName,
        result: null,
        error: `TOOL_NOT_FOUND: Unknown tool ${toolName}`,
      };
    }

    // 2. Validate input schema
    const parseResult = toolDef.schema.safeParse(rawArgs);
    if (!parseResult.success) {
      return {
        toolCallId,
        name: toolName,
        result: null,
        error: `INVALID_ARGUMENTS: ${parseResult.error.message}`,
      };
    }

    const args = parseResult.data as Record<string, unknown>;

    // 3. Dispatch tool execution
    try {
      switch (toolName) {
        case "search_courses": {
          const query = typeof args.query === "string" ? args.query : undefined;
          const level = typeof args.level === "string" ? args.level : undefined;
          const maxPrice = typeof args.maxPrice === "number" ? args.maxPrice : undefined;
          const results = await this.domainClient.searchCourses(query, level, maxPrice);
          return { toolCallId, name: toolName, result: results };
        }

        case "get_course_details": {
          const courseId = String(args.courseId);
          const details = await this.domainClient.getCourseDetails(courseId);
          if (!details) {
            return { toolCallId, name: toolName, result: null, error: "COURSE_NOT_FOUND" };
          }
          return { toolCallId, name: toolName, result: details };
        }

        case "compare_courses": {
          const courseIds = args.courseIds as readonly string[];
          const courses = await this.domainClient.compareCourses(courseIds);
          return { toolCallId, name: toolName, result: courses };
        }

        case "get_knowledge_gaps": {
          const courseId = typeof args.courseId === "string" ? args.courseId : undefined;
          const gaps = await this.domainClient.getKnowledgeGaps(user.userId, courseId);
          return { toolCallId, name: toolName, result: gaps };
        }

        case "search_course_materials": {
          const courseId = String(args.courseId);
          const topic = String(args.topic);
          const materials = await this.domainClient.searchCourseMaterials(user.userId, courseId, topic);
          return { toolCallId, name: toolName, result: materials };
        }

        case "explain_concept": {
          const concept = String(args.concept);
          const detailLevel = typeof args.detailLevel === "string" ? args.detailLevel : "standard";
          return {
            toolCallId,
            name: toolName,
            result: {
              concept,
              detailLevel,
              structuredBreakdown: [
                `Core Definition of ${concept}`,
                "Key Principles & Mechanisms",
                "Practical Example & Application",
                "Common Pitfalls",
              ],
            },
          };
        }

        case "generate_quiz_draft": {
          const topic = String(args.topic);
          const difficulty = typeof args.difficulty === "string" ? args.difficulty : "INTERMEDIATE";
          const questionCount = typeof args.questionCount === "number" ? args.questionCount : 5;
          const draft = await this.domainClient.generateQuizDraft(topic, difficulty, questionCount);
          return { toolCallId, name: toolName, result: draft };
        }

        case "diagnose_cohort_gaps": {
          const courseId = String(args.courseId);
          const quizId = typeof args.quizId === "string" ? args.quizId : undefined;
          const diagnosis = await this.domainClient.diagnoseCohortGaps(courseId, quizId);
          return { toolCallId, name: toolName, result: diagnosis };
        }

        case "suggest_remedial_actions": {
          const topic = String(args.topic);
          const level = String(args.lowScoringCognitiveLevel);
          return {
            toolCallId,
            name: toolName,
            result: {
              topic,
              targetedCognitiveLevel: level,
              actions: [
                `Provide interactive worked examples for ${topic}`,
                `Assign targeted formative practice on ${level} reasoning`,
                "Schedule a 10-minute micro-lecture review session",
              ],
            },
          };
        }

        case "get_student_mastery": {
          const courseId = String(args.courseId);
          if (!this.domainClient.getStudentMastery) throw new Error("MASTERY_TOOL_NOT_CONFIGURED");
          const mastery = await this.domainClient.getStudentMastery(user.userId, courseId);
          return { toolCallId, name: toolName, result: mastery };
        }

        case "get_recommended_learning_path": {
          const courseId = String(args.courseId);
          if (!this.domainClient.getRecommendedLearningPath)
            throw new Error("STUDY_PLAN_TOOL_NOT_CONFIGURED");
          const path = await this.domainClient.getRecommendedLearningPath(user.userId, courseId);
          return { toolCallId, name: toolName, result: path };
        }

        case "generate_study_plan": {
          const courseId = String(args.courseId);
          const availableHours =
            typeof args.availableHoursPerWeek === "number" ? args.availableHoursPerWeek : 7;
          if (!this.domainClient.generateStudyPlan) throw new Error("STUDY_PLAN_TOOL_NOT_CONFIGURED");
          const plan = await this.domainClient.generateStudyPlan(user.userId, courseId, availableHours);
          return { toolCallId, name: toolName, result: plan };
        }

        case "update_study_plan_item": {
          const courseId = String(args.courseId);
          const itemId = String(args.itemId);
          const status = String(args.status);
          const scheduledDate = typeof args.scheduledDate === "string" ? args.scheduledDate : undefined;
          if (!this.domainClient.updateStudyPlanItem) throw new Error("STUDY_PLAN_TOOL_NOT_CONFIGURED");
          const updated = await this.domainClient.updateStudyPlanItem(
            user.userId,
            courseId,
            itemId,
            status,
            scheduledDate,
          );
          return { toolCallId, name: toolName, result: updated };
        }

        case "get_prerequisite_gaps": {
          const courseId = String(args.courseId);
          const targetConceptId = typeof args.targetConceptId === "string" ? args.targetConceptId : undefined;
          const gaps = this.domainClient.getPrerequisiteGaps
            ? await this.domainClient.getPrerequisiteGaps(user.userId, courseId, targetConceptId)
            : [];
          return { toolCallId, name: toolName, result: gaps };
        }

        case "record_recommendation_feedback": {
          const feedback = {
            studentId: user.userId,
            recommendationId: String(args.recommendationId),
            courseId: String(args.courseId),
            feedbackType: String(args.feedbackType),
            ...(typeof args.comment === "string" ? { comment: args.comment } : {}),
          };
          const recorded = this.domainClient.recordRecommendationFeedback
            ? await this.domainClient.recordRecommendationFeedback(feedback)
            : { status: "RECORDED", feedback };
          return { toolCallId, name: toolName, result: recorded };
        }

        case "get_course_version_diff": {
          const courseId = String(args.courseId);
          const fromVersion = Number(args.fromVersion);
          const toVersion = Number(args.toVersion);
          const diff = this.domainClient.getCourseVersionDiff
            ? await this.domainClient.getCourseVersionDiff(courseId, fromVersion, toVersion)
            : { courseId, fromVersion, toVersion, addedLessons: [], removedLessons: [], modifiedLessons: [] };
          return { toolCallId, name: toolName, result: diff };
        }

        case "identify_high_friction_lessons": {
          const courseId = String(args.courseId);
          const friction = this.domainClient.identifyHighFrictionLessons
            ? await this.domainClient.identifyHighFrictionLessons(courseId)
            : [];
          return { toolCallId, name: toolName, result: friction };
        }

        default:
          return {
            toolCallId,
            name: toolName,
            result: null,
            error: `UNHANDLED_TOOL: Tool ${toolName} has no runner binding`,
          };
      }
    } catch (error) {
      return {
        toolCallId,
        name: toolName,
        result: null,
        error: error instanceof Error ? error.message : "TOOL_EXECUTION_FAILED",
      };
    }
  }
}
