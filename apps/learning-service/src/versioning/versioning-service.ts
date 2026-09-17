import { computeSyllabusHash } from "./model.js";
import type {
  CourseRelease,
  CourseReleaseLesson,
  CourseReleaseSyllabus,
  StudentEnrollmentVersion,
  VersionDiff,
} from "./model.js";

export interface VersioningRepository {
  saveRelease(release: CourseRelease): Promise<void>;
  saveReleaseWithCas?(release: CourseRelease, expectedVersion: number): Promise<boolean>;
  getRelease(courseId: string, version: number): Promise<CourseRelease | null>;
  getLatestRelease(courseId: string): Promise<CourseRelease | null>;
  listReleases(courseId: string): Promise<CourseRelease[]>;
  saveEnrollmentVersion(enrollment: StudentEnrollmentVersion): Promise<void>;
  getEnrollmentVersion(studentId: string, courseId: string): Promise<StudentEnrollmentVersion | null>;
}

export class InMemoryVersioningRepository implements VersioningRepository {
  private readonly releases = new Map<string, Map<number, CourseRelease>>();
  private readonly enrollments = new Map<string, StudentEnrollmentVersion>();

  async saveRelease(release: CourseRelease): Promise<void> {
    let courseReleases = this.releases.get(release.courseId);
    if (!courseReleases) {
      courseReleases = new Map<number, CourseRelease>();
      this.releases.set(release.courseId, courseReleases);
    }
    courseReleases.set(release.version, { ...release });
    return Promise.resolve();
  }

  async saveReleaseWithCas(release: CourseRelease, expectedVersion: number): Promise<boolean> {
    let courseReleases = this.releases.get(release.courseId);
    if (!courseReleases) {
      courseReleases = new Map<number, CourseRelease>();
      this.releases.set(release.courseId, courseReleases);
    }
    if (courseReleases.has(release.version)) {
      return Promise.resolve(false);
    }
    const currentVer =
      courseReleases.size === 0
        ? 0
        : Math.max(...Array.from(courseReleases.keys()));
    if (currentVer !== expectedVersion) {
      return Promise.resolve(false);
    }
    courseReleases.set(release.version, { ...release });
    return Promise.resolve(true);
  }

  async getRelease(courseId: string, version: number): Promise<CourseRelease | null> {
    const courseReleases = this.releases.get(courseId);
    if (!courseReleases) return Promise.resolve(null);
    return Promise.resolve(courseReleases.get(version) ?? null);
  }

  async getLatestRelease(courseId: string): Promise<CourseRelease | null> {
    const courseReleases = this.releases.get(courseId);
    if (!courseReleases || courseReleases.size === 0) return Promise.resolve(null);
    const sortedVersions = Array.from(courseReleases.keys()).sort((a, b) => b - a);
    const latestVersion = sortedVersions[0];
    if (latestVersion === undefined) return Promise.resolve(null);
    return Promise.resolve(courseReleases.get(latestVersion) ?? null);
  }

  async listReleases(courseId: string): Promise<CourseRelease[]> {
    const courseReleases = this.releases.get(courseId);
    if (!courseReleases) return Promise.resolve([]);
    return Promise.resolve(Array.from(courseReleases.values()).sort((a, b) => b.version - a.version));
  }

  async saveEnrollmentVersion(enrollment: StudentEnrollmentVersion): Promise<void> {
    const key = `${enrollment.studentId}:${enrollment.courseId}`;
    this.enrollments.set(key, { ...enrollment });
    return Promise.resolve();
  }

  async getEnrollmentVersion(studentId: string, courseId: string): Promise<StudentEnrollmentVersion | null> {
    const key = `${studentId}:${courseId}`;
    return Promise.resolve(this.enrollments.get(key) ?? null);
  }
}

export class CourseVersioningService {
  constructor(private readonly repository: VersioningRepository) {}

  async publishRelease(input: {
    courseId: string;
    title: string;
    syllabus: CourseReleaseSyllabus;
    changeLog: string;
    publishedBy: string;
    isLecturerReviewed: boolean;
  }): Promise<CourseRelease> {
    if (!input.isLecturerReviewed) {
      throw new Error("Cannot publish course release without verified lecturer review and approval.");
    }

    const latest = await this.repository.getLatestRelease(input.courseId);
    const expectedVersion = latest ? latest.version : 0;
    const nextVersion = expectedVersion + 1;
    const contentHash = computeSyllabusHash(input.syllabus);

    const release: CourseRelease = {
      courseId: input.courseId,
      version: nextVersion,
      status: "PUBLISHED",
      title: input.title,
      syllabusJson: JSON.stringify(input.syllabus),
      contentHash,
      changeLog: input.changeLog || `Release version ${String(nextVersion)}`,
      publishedBy: input.publishedBy,
      publishedAt: new Date().toISOString(),
    };

    if (typeof this.repository.saveReleaseWithCas === "function") {
      const applied = await this.repository.saveReleaseWithCas(release, expectedVersion);
      if (!applied) {
        throw new Error(`CONCURRENT_PUBLICATION_CONFLICT: Course ${input.courseId} was concurrently modified. Expected version ${String(expectedVersion)}.`);
      }
    } else {
      await this.repository.saveRelease(release);
    }
    return release;
  }


  async getRelease(courseId: string, version: number): Promise<CourseRelease | null> {
    return this.repository.getRelease(courseId, version);
  }

  async listReleases(courseId: string): Promise<CourseRelease[]> {
    return this.repository.listReleases(courseId);
  }

  async compareVersions(courseId: string, fromVersion: number, toVersion: number): Promise<VersionDiff> {
    const fromRelease = await this.repository.getRelease(courseId, fromVersion);
    const toRelease = await this.repository.getRelease(courseId, toVersion);

    if (!fromRelease) {
      throw new Error(`Source version ${String(fromVersion)} not found for course ${courseId}`);
    }
    if (!toRelease) {
      throw new Error(`Target version ${String(toVersion)} not found for course ${courseId}`);
    }

    const fromSyllabus = JSON.parse(fromRelease.syllabusJson) as CourseReleaseSyllabus;
    const toSyllabus = JSON.parse(toRelease.syllabusJson) as CourseReleaseSyllabus;

    const fromLessons = new Map<string, CourseReleaseLesson>(
      fromSyllabus.modules.flatMap((m) => m.lessons.map((l) => [l.lessonId, l])),
    );
    const toLessons = new Map<string, CourseReleaseLesson>(
      toSyllabus.modules.flatMap((m) => m.lessons.map((l) => [l.lessonId, l])),
    );

    const addedLessons: string[] = [];
    const removedLessons: string[] = [];
    const modifiedLessons: string[] = [];
    const unchangedLessons: string[] = [];
    const reorderedLessons: { lessonId: string; oldOrder: number; newOrder: number }[] = [];

    for (const [id, toLesson] of toLessons.entries()) {
      const fromLesson = fromLessons.get(id);
      if (!fromLesson) {
        addedLessons.push(id);
      } else {
        const isModified =
          fromLesson.contentHash !== toLesson.contentHash ||
          fromLesson.durationMinutes !== toLesson.durationMinutes ||
          fromLesson.title !== toLesson.title;
        if (isModified) {
          modifiedLessons.push(id);
        } else {
          unchangedLessons.push(id);
        }

        if (fromLesson.order !== toLesson.order) {
          reorderedLessons.push({
            lessonId: id,
            oldOrder: fromLesson.order,
            newOrder: toLesson.order,
          });
        }
      }
    }

    for (const id of fromLessons.keys()) {
      if (!toLessons.has(id)) {
        removedLessons.push(id);
      }
    }

    // Assessment diff
    const fromAssessments = new Set(
      fromSyllabus.modules.flatMap((m) => m.lessons.flatMap((l) => l.assessmentIds ?? [])),
    );
    const toAssessments = new Set(
      toSyllabus.modules.flatMap((m) => m.lessons.flatMap((l) => l.assessmentIds ?? [])),
    );

    const addedAssessments: string[] = [];
    const removedAssessments: string[] = [];
    for (const a of toAssessments) {
      if (!fromAssessments.has(a)) addedAssessments.push(a);
    }
    for (const a of fromAssessments) {
      if (!toAssessments.has(a)) removedAssessments.push(a);
    }

    // Concept diff
    const fromConcepts = new Set(
      fromSyllabus.modules.flatMap((m) => m.lessons.flatMap((l) => l.concepts ?? [])),
    );
    const toConcepts = new Set(
      toSyllabus.modules.flatMap((m) => m.lessons.flatMap((l) => l.concepts ?? [])),
    );

    const prerequisiteChanges: { conceptId: string; change: "ADDED" | "REMOVED" }[] = [];
    for (const c of toConcepts) {
      if (!fromConcepts.has(c)) {
        prerequisiteChanges.push({ conceptId: c, change: "ADDED" });
      }
    }
    for (const c of fromConcepts) {
      if (!toConcepts.has(c)) {
        prerequisiteChanges.push({ conceptId: c, change: "REMOVED" });
      }
    }

    // Learning objectives diff
    const fromObjectives = new Set([
      ...(fromSyllabus.learningObjectives ?? []),
      ...fromSyllabus.modules.flatMap((m) => m.learningObjectives ?? []),
    ]);
    const toObjectives = new Set([
      ...(toSyllabus.learningObjectives ?? []),
      ...toSyllabus.modules.flatMap((m) => m.learningObjectives ?? []),
    ]);

    const learningObjectiveChanges: { objective: string; change: "ADDED" | "REMOVED" }[] = [];
    for (const obj of toObjectives) {
      if (!fromObjectives.has(obj)) {
        learningObjectiveChanges.push({ objective: obj, change: "ADDED" });
      }
    }
    for (const obj of fromObjectives) {
      if (!toObjectives.has(obj)) {
        learningObjectiveChanges.push({ objective: obj, change: "REMOVED" });
      }
    }

    // Determine upgrade decision
    let upgradeDecision: "STAY_ON_CURRENT" | "OPTIONAL_UPGRADE" | "MANDATORY_CORRECTION" | "ADMIN_MIGRATION" =
      "STAY_ON_CURRENT";
    if (removedAssessments.length > 0) {
      upgradeDecision = "MANDATORY_CORRECTION";
    } else if (addedLessons.length > 0 || modifiedLessons.length > 0 || prerequisiteChanges.length > 0) {
      upgradeDecision = "OPTIONAL_UPGRADE";
    }

    const humanSummary = `Phiên bản v${String(fromVersion)} -> v${String(toVersion)}: +${String(addedLessons.length)} bài học mới, -${String(removedLessons.length)} bài học đã xoá, ${String(modifiedLessons.length)} bài cập nhật, ${String(reorderedLessons.length)} thay đổi thứ tự. Yêu cầu tiên quyết: ${String(prerequisiteChanges.length)} thay đổi. Khuyến nghị nâng cấp: ${upgradeDecision}.`;

    return {
      courseId,
      fromVersion,
      toVersion,
      addedLessons,
      removedLessons,
      modifiedLessons,
      unchangedLessons,
      reorderedLessons,
      addedAssessments,
      removedAssessments,
      modifiedAssessments: [],
      prerequisiteChanges,
      learningObjectiveChanges,
      upgradeDecision,
      humanSummary,
    };
  }

  async pinEnrollmentVersion(
    studentId: string,
    courseId: string,
    version?: number,
  ): Promise<StudentEnrollmentVersion> {
    let pinnedVersion = version;
    if (!pinnedVersion) {
      const latest = await this.repository.getLatestRelease(courseId);
      pinnedVersion = latest ? latest.version : 1;
    }

    const enrollment: StudentEnrollmentVersion = {
      studentId,
      courseId,
      pinnedVersion,
      enrolledAt: new Date().toISOString(),
      autoUpgradePolicy: "MANUAL",
    };

    await this.repository.saveEnrollmentVersion(enrollment);
    return enrollment;
  }

  async upgradeEnrollmentVersion(input: {
    studentId: string;
    courseId: string;
    targetVersion: number;
    completedLessonIds: string[];
  }): Promise<{
    enrollment: StudentEnrollmentVersion;
    diff: VersionDiff;
    preservedCompletedLessons: string[];
    newPendingLessons: string[];
  }> {
    const current = await this.repository.getEnrollmentVersion(input.studentId, input.courseId);
    if (!current) {
      throw new Error(`Enrollment not found for student ${input.studentId} in course ${input.courseId}`);
    }

    if (input.targetVersion <= current.pinnedVersion) {
      throw new Error(
        `Target version ${String(input.targetVersion)} must be strictly greater than current version ${String(current.pinnedVersion)}`,
      );
    }

    const targetRelease = await this.repository.getRelease(input.courseId, input.targetVersion);
    if (!targetRelease) {
      throw new Error(`Target version ${String(input.targetVersion)} does not exist`);
    }

    const diff = await this.compareVersions(input.courseId, current.pinnedVersion, input.targetVersion);
    const targetSyllabus = JSON.parse(targetRelease.syllabusJson) as CourseReleaseSyllabus;
    const targetLessonIds = new Set(
      targetSyllabus.modules.flatMap((m) => m.lessons.map((l) => l.lessonId)),
    );

    // Preserve completion only for lessons that still exist in the new release
    const preservedCompletedLessons = input.completedLessonIds.filter((id) => targetLessonIds.has(id));
    const preservedSet = new Set(preservedCompletedLessons);
    const newPendingLessons = Array.from(targetLessonIds).filter((id) => !preservedSet.has(id));

    const updated: StudentEnrollmentVersion = {
      ...current,
      pinnedVersion: input.targetVersion,
      lastUpgradedAt: new Date().toISOString(),
    };

    await this.repository.saveEnrollmentVersion(updated);

    return {
      enrollment: updated,
      diff,
      preservedCompletedLessons,
      newPendingLessons,
    };
  }

  async getStudentEnrollmentVersion(
    studentId: string,
    courseId: string,
  ): Promise<StudentEnrollmentVersion | null> {
    return this.repository.getEnrollmentVersion(studentId, courseId);
  }
}
