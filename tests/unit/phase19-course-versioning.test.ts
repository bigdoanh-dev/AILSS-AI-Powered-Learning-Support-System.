import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CourseVersioningService,
  InMemoryVersioningRepository,
  type CourseReleaseSyllabus,
} from "../../apps/learning-service/src/versioning/index.js";

describe("Phase 19A — Course Version Pinning, Immutability & Voluntary Upgrades", () => {
  const repository = new InMemoryVersioningRepository();
  const versioningService = new CourseVersioningService(repository);

  const courseId = randomUUID();
  const lecturerId = randomUUID();
  const studentId = randomUUID();

  const sampleSyllabusV1: CourseReleaseSyllabus = {
    modules: [
      {
        moduleId: "mod-1",
        title: "Foundations of Distributed Systems",
        order: 1,
        lessons: [
          {
            lessonId: "les-1",
            title: "CAP Theorem & Partitioning",
            order: 1,
            durationMinutes: 45,
            concepts: ["CAP_THEOREM", "CONSISTENCY"],
            contentHash: "hash-les-1-v1",
          },
          {
            lessonId: "les-2",
            title: "Consensus Protocols (Raft & Paxos)",
            order: 2,
            durationMinutes: 60,
            concepts: ["RAFT_CONSENSUS"],
            contentHash: "hash-les-2-v1",
          },
        ],
      },
    ],
  };

  const sampleSyllabusV2: CourseReleaseSyllabus = {
    modules: [
      {
        moduleId: "mod-1",
        title: "Foundations of Distributed Systems",
        order: 1,
        lessons: [
          {
            lessonId: "les-1",
            title: "CAP Theorem & PACELC", // Modified
            order: 1,
            durationMinutes: 50,
            concepts: ["CAP_THEOREM", "PACELC"],
            contentHash: "hash-les-1-v2",
          },
          {
            lessonId: "les-3", // New lesson replaces les-2
            title: "Modern Quorum Systems & Dynamo Architecture",
            order: 2,
            durationMinutes: 55,
            concepts: ["QUORUM_REPLICATION"],
            contentHash: "hash-les-3-v2",
          },
        ],
      },
    ],
  };

  describe("Publication Governance & Immutability", () => {
    it("blocks release publication without verified lecturer review", async () => {
      await expect(
        versioningService.publishRelease({
          courseId,
          title: "Distributed Systems Engineering",
          syllabus: sampleSyllabusV1,
          changeLog: "Initial draft release",
          publishedBy: lecturerId,
          isLecturerReviewed: false, // Rejected!
        }),
      ).rejects.toThrow("Cannot publish course release without verified lecturer review and approval.");
    });

    it("publishes immutable release v1 with deterministic syllabus hash", async () => {
      const releaseV1 = await versioningService.publishRelease({
        courseId,
        title: "Distributed Systems Engineering",
        syllabus: sampleSyllabusV1,
        changeLog: "Initial v1 production release",
        publishedBy: lecturerId,
        isLecturerReviewed: true,
      });

      expect(releaseV1.version).toBe(1);
      expect(releaseV1.status).toBe("PUBLISHED");
      expect(releaseV1.contentHash).toBeDefined();
      expect(releaseV1.contentHash.length).toBe(64); // SHA-256 hex string
    });

    it("publishes v2 sequentially while preserving immutable v1 release intact", async () => {
      const releaseV2 = await versioningService.publishRelease({
        courseId,
        title: "Distributed Systems Engineering (2026 Edition)",
        syllabus: sampleSyllabusV2,
        changeLog: "Updated consensus module and added PACELC",
        publishedBy: lecturerId,
        isLecturerReviewed: true,
      });

      expect(releaseV2.version).toBe(2);

      // Verify v1 is still completely intact in the historical repository
      const fetchedV1 = await versioningService.getRelease(courseId, 1);
      expect(fetchedV1).not.toBeNull();
      expect(fetchedV1?.version).toBe(1);
      if (!fetchedV1) throw new Error("Expected release to exist");
      const fetchedV1Syllabus = JSON.parse(fetchedV1.syllabusJson) as CourseReleaseSyllabus;
      expect(fetchedV1Syllabus.modules[0]?.lessons[0]?.title).toBe("CAP Theorem & Partitioning");
    });
  });

  describe("Structural Course Diff Engine", () => {
    it("identifies added, removed, and modified lessons and concept changes between versions", async () => {
      const diff = await versioningService.compareVersions(courseId, 1, 2);

      expect(diff.courseId).toBe(courseId);
      expect(diff.fromVersion).toBe(1);
      expect(diff.toVersion).toBe(2);

      // les-1 had title, duration, and contentHash changed
      expect(diff.modifiedLessons).toContain("les-1");
      // les-3 was added in v2
      expect(diff.addedLessons).toContain("les-3");
      // les-2 was removed in v2
      expect(diff.removedLessons).toContain("les-2");

      // Concept changes
      const addedConcepts = diff.prerequisiteChanges.filter((c) => c.change === "ADDED").map((c) => c.conceptId);
      const removedConcepts = diff.prerequisiteChanges.filter((c) => c.change === "REMOVED").map((c) => c.conceptId);

      expect(addedConcepts).toContain("PACELC");
      expect(addedConcepts).toContain("QUORUM_REPLICATION");
      expect(removedConcepts).toContain("CONSISTENCY");
      expect(removedConcepts).toContain("RAFT_CONSENSUS");
    });
  });

  describe("Student Enrollment Pinning & Voluntary Upgrades", () => {
    it("pins student enrollment to v1 initially", async () => {
      const enrollment = await versioningService.pinEnrollmentVersion(studentId, courseId, 1);

      expect(enrollment.studentId).toBe(studentId);
      expect(enrollment.courseId).toBe(courseId);
      expect(enrollment.pinnedVersion).toBe(1);
      expect(enrollment.autoUpgradePolicy).toBe("MANUAL");
    });

    it("prevents downgrading or upgrading to an invalid version", async () => {
      await expect(
        versioningService.upgradeEnrollmentVersion({
          studentId,
          courseId,
          targetVersion: 1, // Same as current
          completedLessonIds: ["les-1"],
        }),
      ).rejects.toThrow("Target version 1 must be strictly greater than current version 1");

      await expect(
        versioningService.upgradeEnrollmentVersion({
          studentId,
          courseId,
          targetVersion: 99, // Non-existent
          completedLessonIds: ["les-1"],
        }),
      ).rejects.toThrow("Target version 99 does not exist");
    });

    it("voluntarily upgrades student to v2 while preserving progress on surviving lessons", async () => {
      // Student had completed les-1 and les-2 in v1
      const completedInV1 = ["les-1", "les-2"];

      const result = await versioningService.upgradeEnrollmentVersion({
        studentId,
        courseId,
        targetVersion: 2,
        completedLessonIds: completedInV1,
      });

      expect(result.enrollment.pinnedVersion).toBe(2);
      expect(result.enrollment.lastUpgradedAt).toBeDefined();

      // les-1 survives in v2 -> preserved
      expect(result.preservedCompletedLessons).toEqual(["les-1"]);
      // les-3 is new in v2 -> pending study
      expect(result.newPendingLessons).toEqual(["les-3"]);
    });
  });
});
