import { describe, expect, it, vi } from "vitest";
import {
  radarAxes,
  radarEdges,
  radarGroups,
  radarPoint,
  aggregateRadarEvidence,
} from "../../packages/learning-visuals/src/radar.js";
import { authorizeCourseMastery } from "../../apps/learning-service/src/adaptive/lecturer-mastery-router.js";
import type { ActorContext } from "../../packages/security/src/index.js";

const contents = ["SQL", "Mô hình dữ liệu", "Truy vấn"].map((label, index) => ({
  id: `lesson:${index}`,
  label,
}));
describe("Radar uses recorded learning evidence", () => {
  it("keeps unknown separate from an observed score of zero", () => {
    const axes = radarAxes(contents, [
      { conceptId: "lesson:0", masteryScore: 0, masteryState: "DEVELOPING", evidenceCount: 1 },
      { conceptId: "lesson:1", masteryScore: 0, masteryState: "NOT_OBSERVED", evidenceCount: 0 },
    ]);
    expect(axes.map((axis) => axis.score)).toEqual([0, null, null]);
    expect(radarEdges(axes)).toEqual([]);
  });
  it("preserves actual scores and never draws edges through unknown axes", () => {
    const axes = radarAxes(contents, [
      {
        conceptId: "lesson:0",
        masteryScore: 82.37,
        masteryState: "PROFICIENT",
        evidenceCount: 4,
        confidenceScore: 91,
      },
      { conceptId: "lesson:2", masteryScore: 45, masteryState: "DEVELOPING", evidenceCount: 2 },
    ]);
    expect(axes[0]).toMatchObject({ label: "SQL", score: 82.4, evidenceCount: 4, confidence: 91 });
    expect(radarEdges(axes)).toHaveLength(1);
    expect(radarPoint(0, 6, 0)).toEqual({ x: 160, y: 160 });
    expect(radarPoint(0, 6, 100)).toEqual({ x: 160, y: 54 });
  });
  it("keeps all content across groups, avoids a 1–2 axis tail, and handles invalid evidence", () => {
    for (const count of [0, 1, 2, 3, 6, 7, 8, 9, 13, 14, 20]) {
      const axes = radarAxes(
        Array.from({ length: count }, (_, index) => ({ id: String(index), label: String(index) })),
        [],
      );
      const groups = radarGroups(axes);
      expect(groups.flat()).toEqual(axes);
      expect(groups.every((group) => group.length <= 8)).toBe(true);
      if (count >= 3) expect(groups.every((group) => group.length >= 3)).toBe(true);
    }
    expect(
      radarAxes(contents, [
        { conceptId: "lesson:0", masteryScore: NaN, masteryState: "DEVELOPING", evidenceCount: 1 },
      ])[0]?.score,
    ).toBeNull();
  });
});
describe("Lecturer mastery authorization", () => {
  const actor = { userId: "lecturer", roles: ["LECTURER"] } as ActorContext;
  it("allows only the owning lecturer and an active student entitlement", async () => {
    const authority = {
      course: vi.fn().mockResolvedValue({ ownerLecturerId: "lecturer" }),
      entitlement: vi.fn().mockResolvedValue({ state: "ACTIVE" }),
    };
    await expect(authorizeCourseMastery(actor, "course", "student", authority)).resolves.toBeUndefined();
    expect(authority.entitlement).toHaveBeenCalledWith("student", "course");
    authority.entitlement.mockResolvedValue({ state: "REVOKED" });
    await expect(authorizeCourseMastery(actor, "course", "student", authority)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("rejects other lecturers, students and nonexistent courses before reading student data", async () => {
    const authority = {
      course: vi.fn().mockResolvedValue({ ownerLecturerId: "other" }),
      entitlement: vi.fn(),
    };
    await expect(authorizeCourseMastery(actor, "course", "student", authority)).rejects.toMatchObject({
      status: 403,
    });
    authority.course.mockResolvedValue({ ownerLecturerId: "lecturer" });
    await expect(
      authorizeCourseMastery({ ...actor, roles: ["STUDENT"] }, "course", "student", authority),
    ).rejects.toMatchObject({ status: 403 });
    authority.course.mockResolvedValue(undefined);
    await expect(authorizeCourseMastery(actor, "course", "student", authority)).rejects.toMatchObject({
      status: 403,
    });
    expect(authority.entitlement).not.toHaveBeenCalled();
  });
});

describe("Course radar averages", () => {
  it("uses one vote per assessed student, preserves zero and excludes missing evidence", () => {
    const summary = aggregateRadarEvidence([
      [{ conceptId: "sql", masteryScore: 80, masteryState: "PROFICIENT", evidenceCount: 10 }],
      [{ conceptId: "sql", masteryScore: 0, masteryState: "INTRODUCED", evidenceCount: 1 }],
      [{ conceptId: "sql", masteryScore: 0, masteryState: "NOT_OBSERVED", evidenceCount: 0 }],
      [],
    ]);
    expect(summary).toEqual({
      studentCount: 4,
      assessedStudentCount: 2,
      records: [
        {
          conceptId: "sql",
          masteryScore: 40,
          masteryState: "AGGREGATED",
          evidenceCount: 11,
          assessedStudentCount: 2,
        },
      ],
    });
    expect(
      radarAxes(
        [
          { id: "sql", label: "SQL" },
          { id: "python", label: "Python" },
        ],
        summary.records,
      ),
    ).toMatchObject([{ score: 40, assessedStudentCount: 2 }, { score: null }]);
  });
  it("does not double-count a concept within a student or include invalid scores", () => {
    const summary = aggregateRadarEvidence([
      [40, 80].map((masteryScore) => ({
        conceptId: "sql",
        masteryScore,
        masteryState: "DEVELOPING",
        evidenceCount: 1,
      })),
      [{ conceptId: "sql", masteryScore: 101, masteryState: "MASTERED", evidenceCount: 1 }],
    ]);
    expect(summary.assessedStudentCount).toBe(1);
    expect(summary.records[0]).toMatchObject({ masteryScore: 80, assessedStudentCount: 1, evidenceCount: 1 });
  });
});
