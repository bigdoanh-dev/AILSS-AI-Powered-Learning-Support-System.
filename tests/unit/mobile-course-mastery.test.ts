import { describe, expect, it } from "vitest";
import { aggregateRadarEvidence } from "../../packages/learning-visuals/src/radar.js";
import { courseMasterySummary } from "../../apps/mobile/src/course-mastery.js";

describe("Mobile course mastery summary", () => {
  it("accepts the aggregate contract including real zero and empty courses", () => {
    for (const records of [
      [],
      [[{ conceptId: "sql", masteryScore: 0, masteryState: "INTRODUCED", evidenceCount: 1 }]],
    ]) {
      const summary = aggregateRadarEvidence(records);
      expect(courseMasterySummary(summary)).toEqual(summary);
    }
  });
  it("rejects impossible coverage counts and malformed summary scores", () => {
    const summary = aggregateRadarEvidence([
      [{ conceptId: "sql", masteryScore: 80, masteryState: "PROFICIENT", evidenceCount: 1 }],
    ]);
    expect(() => courseMasterySummary({ ...summary, assessedStudentCount: 2 })).toThrow();
    expect(() =>
      courseMasterySummary({ ...summary, records: [{ ...summary.records[0], masteryScore: "80" }] }),
    ).toThrow();
    expect(() =>
      courseMasterySummary({ ...summary, records: [{ ...summary.records[0], assessedStudentCount: 2 }] }),
    ).toThrow();
  });
});
