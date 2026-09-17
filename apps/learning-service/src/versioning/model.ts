import { createHash } from "node:crypto";
import { z } from "zod";

export const CourseReleaseStatus = z.enum(["DRAFT", "REVIEW", "PUBLISHED", "DEPRECATED", "ARCHIVED"]);
export type CourseReleaseStatus = z.infer<typeof CourseReleaseStatus>;

export const UpgradeDecision = z.enum([
  "STAY_ON_CURRENT",
  "OPTIONAL_UPGRADE",
  "MANDATORY_CORRECTION",
  "ADMIN_MIGRATION",
]);
export type UpgradeDecision = z.infer<typeof UpgradeDecision>;

export interface CourseReleaseLesson {
  lessonId: string;
  title: string;
  order: number;
  durationMinutes?: number | undefined;
  concepts?: string[] | undefined;
  contentHash?: string | undefined;
  assessmentIds?: string[] | undefined;
}

export interface CourseReleaseModule {
  moduleId: string;
  title: string;
  order: number;
  lessons: CourseReleaseLesson[];
  learningObjectives?: string[] | undefined;
}

export interface CourseReleaseSyllabus {
  modules: CourseReleaseModule[];
  learningObjectives?: string[] | undefined;
}

export interface CourseRelease {
  courseId: string;
  version: number;
  status: CourseReleaseStatus;
  title: string;
  syllabusJson: string;
  contentHash: string;
  changeLog: string;
  publishedBy: string;
  publishedAt: string;
}

export interface StudentEnrollmentVersion {
  studentId: string;
  courseId: string;
  pinnedVersion: number;
  enrolledAt: string;
  lastUpgradedAt?: string | undefined;
  autoUpgradePolicy: "MANUAL" | "OPT_IN";
}

export interface VersionDiff {
  courseId: string;
  fromVersion: number;
  toVersion: number;
  addedLessons: string[];
  removedLessons: string[];
  modifiedLessons: string[];
  unchangedLessons: string[];
  reorderedLessons: { lessonId: string; oldOrder: number; newOrder: number }[];
  addedAssessments: string[];
  removedAssessments: string[];
  modifiedAssessments: string[];
  prerequisiteChanges: { conceptId: string; change: "ADDED" | "REMOVED" }[];
  learningObjectiveChanges: { objective: string; change: "ADDED" | "REMOVED" }[];
  upgradeDecision: UpgradeDecision;
  humanSummary: string;
}

export function computeSyllabusHash(syllabus: CourseReleaseSyllabus): string {
  const normalized = JSON.stringify(syllabus, Object.keys(syllabus).sort());
  return createHash("sha256").update(normalized).digest("hex");
}
