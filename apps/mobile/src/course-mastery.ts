import { ApiError, record, string } from "./api";
import type { CourseMasterySummary } from "../../../packages/learning-visuals/src/radar";

export function courseMasterySummary(value: unknown): CourseMasterySummary {
  const row = record(value);
  const studentCount = row.studentCount,
    assessedStudentCount = row.assessedStudentCount;
  if (
    typeof studentCount !== "number" ||
    !Number.isInteger(studentCount) ||
    studentCount < 0 ||
    typeof assessedStudentCount !== "number" ||
    !Number.isInteger(assessedStudentCount) ||
    assessedStudentCount < 0 ||
    assessedStudentCount > studentCount ||
    !Array.isArray(row.records)
  )
    throw new ApiError("invalid");
  return {
    studentCount,
    assessedStudentCount,
    records: row.records.map((entry) => {
      const item = record(entry);
      const masteryScore = item.masteryScore,
        count = item.assessedStudentCount,
        evidenceCount = item.evidenceCount;
      if (
        typeof masteryScore !== "number" ||
        !Number.isFinite(masteryScore) ||
        masteryScore < 0 ||
        masteryScore > 100 ||
        typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > assessedStudentCount ||
        typeof evidenceCount !== "number" ||
        !Number.isInteger(evidenceCount) ||
        evidenceCount < count ||
        item.masteryState !== "AGGREGATED"
      )
        throw new ApiError("invalid");
      return {
        conceptId: string(item.conceptId),
        masteryScore,
        masteryState: "AGGREGATED",
        evidenceCount,
        assessedStudentCount: count,
      };
    }),
  };
}
