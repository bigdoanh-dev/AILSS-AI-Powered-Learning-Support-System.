// Explicit local-only dev smoke for P14.2A Student Learning Core.
// No credentials or sensitive response bodies are printed or persisted.
// All mutations record original state and restore it upon completion.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Transport } from "../src/api";
import { Session } from "../src/session";
import {
  courses as decodeCourses,
  courseDetail,
  offerings as decodeOfferings,
  lessonSummaries,
  lessonDetail,
  progress as decodeProgress,
} from "../src/learning";

async function main() {
  const origin = process.env.AILSS_MOBILE_TEST_ORIGIN;
  if (!origin || new URL(origin).hostname !== "127.0.0.1" || new URL(origin).protocol !== "http:") {
    throw Error("Explicit loopback dev origin required (e.g. http://127.0.0.1:8080)");
  }
  if (!process.env.AILSS_MOBILE_TEST_EMAIL || !process.env.AILSS_MOBILE_TEST_PASSWORD) {
    throw Error("Dev account credentials required in env");
  }

  let saved: string | null = null;
  const api = new Transport(origin);
  const session = new Session(api, {
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
    clear: async () => {
      saved = null;
    },
  });

  try {
    // 1. Course Discovery (Public)
    const catalog = decodeCourses(
      await api.request("/api/v1/courses?categoryId=10000000-0000-4000-8000-000000000001&limit=12"),
    );
    assert.ok(catalog.length > 0, "Catalog should have courses");
    const targetCourse = catalog[0];

    const searchResults = decodeCourses(await api.request(`/api/v1/courses/search?q=python&limit=12`));
    assert.ok(searchResults.length > 0, "Search should return matching courses");

    // 2. Course Detail & Offerings (LRN-03, LRN-27)
    const detail = courseDetail(await api.request(`/api/v1/courses/${targetCourse.courseId}`));
    assert.equal(detail.courseId, targetCourse.courseId);

    const offers = decodeOfferings(await api.request(`/api/v1/courses/${targetCourse.courseId}/offerings`));
    assert.ok(Array.isArray(offers));

    // 3. Authenticate Student
    await session.login(process.env.AILSS_MOBILE_TEST_EMAIL, process.env.AILSS_MOBILE_TEST_PASSWORD);
    assert.equal(session.snapshot.state, "AUTHENTICATED");
    assert.equal(session.snapshot.user?.role, "STUDENT");

    // 4. My Learning (LRN-15)
    const myCourses = decodeCourses(await session.request("/api/v1/me/courses"));
    assert.ok(Array.isArray(myCourses));

    // Find an enrolled course or use the target course
    const activeCourseId = myCourses.length > 0 ? myCourses[0].courseId : targetCourse.courseId;

    // 5. Syllabus (LRN-10)
    const lessons = lessonSummaries(await session.request(`/api/v1/courses/${activeCourseId}/lessons`));
    assert.ok(lessons.length > 0, "Course should have lessons");

    const targetLesson = lessons[0];

    // 6. Lesson Detail (LRN-12)
    const lesson = lessonDetail(await session.request(`/api/v1/lessons/${targetLesson.lessonId}`));
    assert.equal(lesson.lessonId, targetLesson.lessonId);

    // 7. Initial Progress (LRN-17)
    const initialProgress = decodeProgress(
      await session.request(`/api/v1/courses/${activeCourseId}/progress`),
    );

    // 8. Safe Completion Mutation with Guaranteed Restoration (LRN-18)
    const testCompletedValue = initialProgress.completedCount === 0;
    const testKey = crypto.randomUUID();

    try {
      // Apply test mutation
      await session.request(`/api/v1/lessons/${targetLesson.lessonId}/completion`, {
        method: "PUT",
        body: { completed: testCompletedValue },
        idempotencyKey: testKey,
      });

      // Verify progress updated
      const updatedProgress = decodeProgress(
        await session.request(`/api/v1/courses/${activeCourseId}/progress`),
      );
      assert.notEqual(updatedProgress.progressVersion, undefined);
      assert.equal(updatedProgress.completed, testCompletedValue);
    } finally {
      // RESTORE: Restore original completion state
      const restoreKey = crypto.randomUUID();
      await session.request(`/api/v1/lessons/${targetLesson.lessonId}/completion`, {
        method: "PUT",
        body: { completed: !testCompletedValue },
        idempotencyKey: restoreKey,
      });

      // Verify restoration equals original state
      const finalProgress = decodeProgress(
        await session.request(`/api/v1/courses/${activeCourseId}/progress`),
      );
      assert.equal(finalProgress.completedCount, initialProgress.completedCount);
      assert.equal(finalProgress.completed, initialProgress.completed);
      assert.equal(finalProgress.percent, initialProgress.percent);
    }

    // 9. Logout
    await session.logout();
    assert.equal(saved, null);

    console.log(
      JSON.stringify({
        status: "PASS",
        p14_2a_student_learning_core: true,
        catalogCount: catalog.length,
        searchCount: searchResults.length,
        targetCourseId: targetCourse.courseId,
        offeringsCount: offers.length,
        lessonsCount: lessons.length,
        progressRead: true,
        completionMutation: true,
        restorationVerified: true,
        logout: true,
      }),
    );
  } finally {
    if (saved) await session.logout().catch(() => {});
  }
}

void main().catch((error) => {
  console.error("P14.2A Integration failed:", error instanceof Error ? error.stack : "Unknown");
  process.exitCode = 1;
});
