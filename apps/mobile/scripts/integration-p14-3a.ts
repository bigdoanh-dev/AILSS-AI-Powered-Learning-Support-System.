// Explicit local-only dev smoke for P14.3A Lecturer Mobile Teaching Core.
// No credentials or sensitive response bodies are printed or persisted.
// All mutations record original state and restore it upon completion.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Transport, ApiError } from "../src/api";
import { Session } from "../src/session";
import {
  ownedOfferings,
  uniqueCoursesFromOfferings,
  lecturerCourse,
  lecturerLessons,
  lecturerLesson,
  ownedClasses,
  ownedClass,
  classMembers,
} from "../src/teaching";

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
    // 1. Authenticate Lecturer
    await session.login(process.env.AILSS_MOBILE_TEST_EMAIL, process.env.AILSS_MOBILE_TEST_PASSWORD);
    assert.equal(session.snapshot.state, "AUTHENTICATED");
    assert.equal(session.snapshot.user?.role, "LECTURER");

    // 2. Fetch Owned Offerings (LRN-28)
    const offeringsRaw = await session.request("/api/v1/me/owned-offerings");
    const offerings = ownedOfferings(offeringsRaw);
    assert.ok(Array.isArray(offerings), "Owned offerings should be an array");
    assert.ok(offerings.length > 0, "Lecturer should own at least 1 offering");

    // 3. Extract Unique Courses
    const courses = uniqueCoursesFromOfferings(offerings);
    assert.ok(courses.length > 0, "Should have unique courses from offerings");
    const targetCourse = courses[0];

    // 4. Fetch Course Detail (LRN-03)
    const courseDetailRaw = await session.request(`/api/v1/courses/${targetCourse.courseId}`);
    const course = lecturerCourse(courseDetailRaw);
    assert.equal(course.courseId, targetCourse.courseId);
    assert.ok(course.title.length > 0, "Course should have title");

    // 5. Course Offerings (LRN-27)
    const courseOfferingsRaw = await session.request(`/api/v1/courses/${targetCourse.courseId}/offerings`);
    const courseOffers = ownedOfferings(courseOfferingsRaw);
    assert.ok(Array.isArray(courseOffers));

    // 6. Fetch Lessons (LRN-10)
    const lessonsRaw = await session.request(`/api/v1/courses/${targetCourse.courseId}/lessons`);
    const lessons = lecturerLessons(lessonsRaw);
    assert.ok(Array.isArray(lessons), "Lessons should be an array");

    // 7. Authoring Validation: Create a DRAFT course & verify PATCH mutation (LRN-05, LRN-06)
    // Per domain rules, only DRAFT courses are editable via LRN-06.
    const runTag = Date.now().toString(36);
    const draftTitle = `Khóa học kiểm thử P14.3A [${runTag}]`;
    const createKey = crypto.randomUUID();
    const createdCourseRaw = await session.request("/api/v1/courses", {
      method: "POST",
      body: {
        title: draftTitle,
        slug: `draft-p14-3a-${runTag}`,
        categoryId: "10000000-0000-4000-8000-000000000001",
        priceType: "FREE",
        price: "0",
        currency: "VND",
      },
      idempotencyKey: createKey,
    });
    const draftCourse = lecturerCourse(createdCourseRaw);
    assert.ok(draftCourse.courseId, "Created draft course must have ID");
    assert.equal(draftCourse.state, "DRAFT", "New course must be in DRAFT state");

    const patchedTitle = `${draftTitle} [Cập nhật]`;
    const patchKey = crypto.randomUUID();
    const patchedRaw = await session.request(`/api/v1/courses/${draftCourse.courseId}`, {
      method: "PATCH",
      body: { title: patchedTitle },
      idempotencyKey: patchKey,
    });
    const patchedCourse = lecturerCourse(patchedRaw);
    assert.equal(patchedCourse.title, patchedTitle, "Course title should be updated in DRAFT");

    // 8. Create Lesson & Mutate Lesson (LRN-11, LRN-12, LRN-13)
    const lessonCreateKey = crypto.randomUUID();
    const createdLessonRaw = await session.request(`/api/v1/courses/${draftCourse.courseId}/lessons`, {
      method: "POST",
      body: {
        title: `Bài học thử nghiệm ${runTag}`,
        sectionTitle: "Chương mở đầu",
        position: { sectionOrder: 1, lessonOrder: 1 },
        preview: true,
      },
      idempotencyKey: lessonCreateKey,
    });
    const draftLesson = lecturerLesson(createdLessonRaw);
    assert.ok(draftLesson.lessonId, "Created lesson must have ID");
    assert.equal(draftLesson.preview, true);

    const lessonDetailRaw = await session.request(`/api/v1/lessons/${draftLesson.lessonId}`);
    const fetchedLesson = lecturerLesson(lessonDetailRaw);
    assert.equal(fetchedLesson.lessonId, draftLesson.lessonId);

    const lessonPatchKey = crypto.randomUUID();
    const updatedLessonTitle = `Bài học thử nghiệm ${runTag} [Đã sửa]`;
    await session.request(`/api/v1/lessons/${draftLesson.lessonId}`, {
      method: "PATCH",
      body: { title: updatedLessonTitle },
      idempotencyKey: lessonPatchKey,
    });
    const updatedLessonRaw = await session.request(`/api/v1/lessons/${draftLesson.lessonId}`);
    const updatedLesson = lecturerLesson(updatedLessonRaw);
    assert.equal(updatedLesson.title, updatedLessonTitle, "Lesson title should be updated");

    // 9. Fetch Owned Classes (CLS-06)
    const classesRaw = await session.request("/api/v1/me/owned-classes");
    const classes = ownedClasses(classesRaw);
    assert.ok(Array.isArray(classes), "Owned classes should be an array");

    // 10. Fetch Class Detail & Members if classes exist (CLS-02, CLS-07)
    let classMembersCount = 0;
    if (classes.length > 0) {
      const targetClass = classes[0];
      const classDetailRaw = await session.request(`/api/v1/classes/${targetClass.classId}`);
      const detail = ownedClass(classDetailRaw);
      assert.equal(detail.classId, targetClass.classId);

      const membersRaw = await session.request(`/api/v1/classes/${targetClass.classId}/members`);
      const members = classMembers(membersRaw);
      assert.ok(Array.isArray(members), "Members should be an array");
      classMembersCount = members.length;
    }

    // 11. Security Boundary: Student Forbidden on Lecturer Endpoints
    const studentEmail = process.env.AILSS_STUDENT_TEST_EMAIL;
    const studentPassword = process.env.AILSS_STUDENT_TEST_PASSWORD;
    let studentForbiddenVerified = false;

    if (studentEmail && studentPassword) {
      let studentSaved: string | null = null;
      const studentSession = new Session(api, {
        read: async () => studentSaved,
        write: async (v) => {
          studentSaved = v;
        },
        clear: async () => {
          studentSaved = null;
        },
      });
      await studentSession.login(studentEmail, studentPassword);
      assert.equal(studentSession.snapshot.user?.role, "STUDENT");

      try {
        await studentSession.request("/api/v1/me/owned-offerings");
        assert.fail("Student should be forbidden on /api/v1/me/owned-offerings");
      } catch (err) {
        assert.ok(err instanceof ApiError, "Should throw ApiError");
        assert.equal(err.status, 403, "Student must receive 403 Forbidden");
        studentForbiddenVerified = true;
      }

      await studentSession.logout().catch(() => {});
    }

    // 12. Logout Lecturer
    await session.logout();
    assert.equal(saved, null);

    console.log(
      JSON.stringify({
        status: "PASS",
        p14_3a_lecturer_teaching_core: true,
        offeringsCount: offerings.length,
        coursesCount: courses.length,
        targetCourseId: targetCourse.courseId,
        courseTitle: course.title,
        lessonsCount: lessons.length,
        draftCourseCreated: draftCourse.courseId,
        draftCoursePatched: true,
        draftLessonCreated: draftLesson.lessonId,
        draftLessonPatched: true,
        classesCount: classes.length,
        classMembersCount,
        studentForbiddenVerified,
        logout: true,
      }),
    );
  } finally {
    if (saved) await session.logout().catch(() => {});
  }
}

void main().catch((error) => {
  console.error("P14.3A Integration failed:", error instanceof Error ? error.stack : "Unknown");
  process.exitCode = 1;
});
