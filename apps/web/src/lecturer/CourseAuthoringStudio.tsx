import { TeachingCourses } from "./Teaching";
export type ContentLifecycleState = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED";
export function CourseAuthoringStudio() {
  return <TeachingCourses />;
}
