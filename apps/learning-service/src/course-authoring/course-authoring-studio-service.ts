import type {
  CourseModuleV2,
  CourseLessonV2,
  CourseVersionSnapshot,
  ContentLifecycleState,
  AiAuthoringDraftRequest,
  AiAuthoringDraftResponse,
} from "../../../../packages/contracts/src/index.js";

export interface CourseDraftModel {
  courseId: string;
  tenantId: string;
  title: string;
  description: string;
  status: ContentLifecycleState;
  modules: CourseModuleV2[];
  currentVersion: string;
  versions: CourseVersionSnapshot[];
  updatedAt: string;
}

export class CourseAuthoringStudioService {
  private readonly courses = new Map<string, CourseDraftModel>();
  private readonly draftOutputs = new Map<string, AiAuthoringDraftResponse>();

  public createCourse(input: {
    courseId: string;
    tenantId: string;
    title: string;
    description: string;
  }): CourseDraftModel {
    const course: CourseDraftModel = {
      courseId: input.courseId,
      tenantId: input.tenantId,
      title: input.title,
      description: input.description,
      status: "DRAFT",
      modules: [],
      currentVersion: "v1.0.0-draft",
      versions: [],
      updatedAt: new Date().toISOString(),
    };
    this.courses.set(input.courseId, course);
    return course;
  }

  public getCourse(courseId: string): CourseDraftModel | undefined {
    return this.courses.get(courseId);
  }

  public addModule(
    courseId: string,
    moduleInput: { title: string; learningOutcomeIds: string[] },
  ): CourseModuleV2 {
    const course = this.courses.get(courseId);
    if (!course) throw new Error(`Course ${courseId} not found`);

    const newModule: CourseModuleV2 = {
      moduleId: `mod-${Date.now()}-${course.modules.length + 1}`,
      title: moduleInput.title,
      order: course.modules.length + 1,
      learningOutcomeIds: moduleInput.learningOutcomeIds,
      lessons: [],
    };
    course.modules.push(newModule);
    course.updatedAt = new Date().toISOString();
    return newModule;
  }

  public addLesson(
    courseId: string,
    moduleId: string,
    lessonInput: { title: string; content: string; estimatedMinutes: number; learningOutcomeIds: string[] },
  ): CourseLessonV2 {
    const course = this.courses.get(courseId);
    if (!course) throw new Error(`Course ${courseId} not found`);

    const targetMod = course.modules.find((m) => m.moduleId === moduleId);
    if (!targetMod) throw new Error(`Module ${moduleId} not found`);

    const newLesson: CourseLessonV2 = {
      lessonId: `les-${Date.now()}-${targetMod.lessons.length + 1}`,
      moduleId,
      title: lessonInput.title,
      order: targetMod.lessons.length + 1,
      content: lessonInput.content,
      estimatedMinutes: lessonInput.estimatedMinutes,
      learningOutcomeIds: lessonInput.learningOutcomeIds,
      status: "DRAFT",
    };
    targetMod.lessons.push(newLesson);
    course.updatedAt = new Date().toISOString();
    return newLesson;
  }

  public updateLifecycleStatus(
    courseId: string,
    newStatus: ContentLifecycleState,
    actor: { userId: string; role: string },
  ): void {
    const course = this.courses.get(courseId);
    if (!course) throw new Error(`Course ${courseId} not found`);

    // Invariant: Only APPROVED courses can be PUBLISHED
    if (newStatus === "PUBLISHED" && course.status !== "APPROVED") {
      throw new Error(
        `Cannot publish course: status must be APPROVED before publication. Current: ${course.status}`,
      );
    }

    // Invariant: Non-instructors cannot approve
    if (newStatus === "APPROVED" && actor.role !== "INSTRUCTOR" && actor.role !== "ADMIN") {
      throw new Error(`Unauthorized to approve course. Role: ${actor.role}`);
    }

    course.status = newStatus;
    course.updatedAt = new Date().toISOString();
  }

  public publishCourseVersion(input: {
    courseId: string;
    newVersion: string;
    changedBy: string;
    approvedBy: string;
    changeSummary: string;
  }): CourseVersionSnapshot {
    const course = this.courses.get(input.courseId);
    if (!course) throw new Error(`Course ${input.courseId} not found`);

    if (course.status !== "APPROVED") {
      throw new Error(
        "Cannot publish: Course must have APPROVED status before publishing a release version.",
      );
    }

    const snapshot: CourseVersionSnapshot = {
      courseId: input.courseId,
      courseVersion: input.newVersion,
      sourceVersion: course.currentVersion,
      changedBy: input.changedBy,
      approvedBy: input.approvedBy,
      publishedAt: new Date().toISOString(),
      changeSummary: input.changeSummary,
      isCurrentActive: true,
    };

    // Mark previous snapshots as inactive
    for (const v of course.versions) {
      v.isCurrentActive = false;
    }

    course.versions.push(snapshot);
    course.currentVersion = input.newVersion;
    course.status = "PUBLISHED";
    course.updatedAt = snapshot.publishedAt;

    return snapshot;
  }

  public requestAiDraft(request: AiAuthoringDraftRequest): AiAuthoringDraftResponse {
    const draftId = `draft-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const citations = request.sourceMaterialReferences.map(
      (ref) =>
        `Generated from ${ref.documentTitle}, Section ${ref.section}, Outcome ${request.learningOutcomeId}`,
    );

    const draftResponse: AiAuthoringDraftResponse = {
      draftId,
      courseId: request.courseId,
      draftType: request.draftType,
      generatedContent: `[AI DRAFT] Suggested content for ${request.draftType} on outcome ${request.learningOutcomeId}. Requires human teacher review.`,
      sourceGroundingCitations: citations,
      status: "DRAFT_REQUIRES_HUMAN_APPROVAL",
      humanApproved: false,
      generatedAt: new Date().toISOString(),
    };

    this.draftOutputs.set(draftId, draftResponse);
    return draftResponse;
  }

  public approveAiDraft(draftId: string, instructorId: string): void {
    const draft = this.draftOutputs.get(draftId);
    if (!draft) throw new Error(`Draft ${draftId} not found`);
    // State transitions upon instructor approval
    (draft as unknown as { humanApproved: boolean }).humanApproved = true;
    (draft as unknown as { approvedBy: string }).approvedBy = instructorId;
  }
}
