import { describe, expect, it } from "vitest";
import {
  mergeCourseProgressCrdt,
  OfflineProgressSyncQueue,
  type CourseProgressSnapshot,
} from "../src/offline-sync";

describe("Phase 21C: Offline-First Mobile Sync & CRDT Progress Queue", () => {
  const baseSnapshot: CourseProgressSnapshot = {
    courseId: "course-database-101",
    studentId: "student-42",
    completedLessonIds: ["lesson-1"],
    lessonProgress: {
      "lesson-1": {
        lessonId: "lesson-1",
        completed: true,
        progressPercent: 100,
        timeSpentSeconds: 1200,
        updatedAt: "2026-09-17T10:00:00Z",
      },
      "lesson-2": {
        lessonId: "lesson-2",
        completed: false,
        progressPercent: 30,
        timeSpentSeconds: 300,
        lastWatchedPositionSeconds: 180,
        updatedAt: "2026-09-17T10:10:00Z",
      },
    },
    overallProgressPercent: 65,
    updatedAt: "2026-09-17T10:10:00Z",
  };

  it("CRDT merge is commutative and preserves grow-only lesson completion", () => {
    // Device A (offline): completed lesson-2
    const deviceA: CourseProgressSnapshot = {
      courseId: "course-database-101",
      studentId: "student-42",
      completedLessonIds: ["lesson-1", "lesson-2"],
      lessonProgress: {
        "lesson-1": {
          lessonId: "lesson-1",
          completed: true,
          progressPercent: 100,
          timeSpentSeconds: 1200,
          updatedAt: "2026-09-17T10:00:00Z",
        },
        "lesson-2": {
          lessonId: "lesson-2",
          completed: true,
          progressPercent: 100,
          timeSpentSeconds: 900,
          lastWatchedPositionSeconds: 600,
          updatedAt: "2026-09-17T11:00:00Z",
        },
      },
      overallProgressPercent: 100,
      updatedAt: "2026-09-17T11:00:00Z",
    };

    // Device B (web/online): watched lesson-3 instead, lesson-2 still at 40%
    const deviceB: CourseProgressSnapshot = {
      courseId: "course-database-101",
      studentId: "student-42",
      completedLessonIds: ["lesson-1"],
      lessonProgress: {
        "lesson-1": {
          lessonId: "lesson-1",
          completed: true,
          progressPercent: 100,
          timeSpentSeconds: 1200,
          updatedAt: "2026-09-17T10:00:00Z",
        },
        "lesson-2": {
          lessonId: "lesson-2",
          completed: false,
          progressPercent: 40,
          timeSpentSeconds: 400,
          lastWatchedPositionSeconds: 240,
          updatedAt: "2026-09-17T10:30:00Z",
        },
        "lesson-3": {
          lessonId: "lesson-3",
          completed: true,
          progressPercent: 100,
          timeSpentSeconds: 800,
          updatedAt: "2026-09-17T10:45:00Z",
        },
      },
      overallProgressPercent: 80,
      updatedAt: "2026-09-17T10:45:00Z",
    };

    const mergedAB = mergeCourseProgressCrdt(deviceA, deviceB);
    const mergedBA = mergeCourseProgressCrdt(deviceB, deviceA);

    // Commutativity
    expect(mergedAB.completedLessonIds).toEqual(mergedBA.completedLessonIds);
    expect(mergedAB.overallProgressPercent).toEqual(mergedBA.overallProgressPercent);

    // Union of completions: lesson-1, lesson-2, and lesson-3 are ALL completed!
    expect(mergedAB.completedLessonIds).toContain("lesson-1");
    expect(mergedAB.completedLessonIds).toContain("lesson-2");
    expect(mergedAB.completedLessonIds).toContain("lesson-3");
    expect(mergedAB.lessonProgress["lesson-2"]?.completed).toBe(true);
    expect(mergedAB.lessonProgress["lesson-2"]?.progressPercent).toBe(100);
  });

  it("OfflineProgressSyncQueue enqueues mutations offline and flushes cleanly", async () => {
    const queue = new OfflineProgressSyncQueue(baseSnapshot);

    // User is offline in airplane mode, advances lesson-2
    queue.recordOfflineUpdate({
      updateId: "up-1",
      courseId: "course-database-101",
      lessonId: "lesson-2",
      completed: true,
      progressPercent: 100,
      timeSpentDeltaSeconds: 600,
      watchedPositionSeconds: 600,
      timestamp: "2026-09-17T12:00:00Z",
    });

    expect(queue.pendingQueue).toHaveLength(1);
    expect(queue.snapshot.completedLessonIds).toContain("lesson-2");

    // Connects to network and flushes
    let apiCalledWithUpdates = 0;
    const flushResult = await queue.flush(async (updates) => {
      apiCalledWithUpdates = updates.length;
      return {
        serverSnapshot: {
          ...baseSnapshot,
          completedLessonIds: ["lesson-1", "lesson-2"],
          updatedAt: "2026-09-17T12:01:00Z",
        },
      };
    });

    expect(apiCalledWithUpdates).toBe(1);
    expect(flushResult.synced).toBe(true);
    expect(flushResult.pendingQueueSize).toBe(0);
    expect(queue.pendingQueue).toHaveLength(0);
  });
});
