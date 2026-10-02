import { useState } from "react";
import { useStudent, type LearningCourse, type Lesson, type Quiz } from "./api";
import { State } from "./ui";
import { LearningRadar } from "../components/LearningRadar";
import { radarAxes, type RadarEvidence } from "../../../../packages/learning-visuals/src/radar";

function CourseRadar({ courseId }: { courseId: string }) {
  const mastery = useStudent<RadarEvidence[]>(`/mastery/courses/${courseId}`);
  const lessons = useStudent<Lesson[] | { lessons: Lesson[]; items?: Lesson[] }>(
    `/courses/${courseId}/lessons`,
  );
  const quizzes = useStudent<Quiz[]>(`/targets/COURSE/${courseId}/quizzes`);
  const syllabus = Array.isArray(lessons.data)
    ? lessons.data
    : (lessons.data?.lessons ?? lessons.data?.items ?? []);
  const query = {
    pending: mastery.pending || lessons.pending || quizzes.pending,
    error: mastery.error || lessons.error || quizzes.error,
    retry: () => {
      mastery.retry();
      lessons.retry();
      quizzes.retry();
    },
  };
  return (
    <State query={query}>
      <LearningRadar
        axes={radarAxes(
          [
            ...syllabus
              .filter((item) => item.state === "READY")
              .map((item) => ({ id: `lesson:${item.lessonId}`, label: item.title })),
            ...(quizzes.data ?? []).map((item) => ({ id: `quiz:${item.quizId}`, label: item.title })),
          ],
          mastery.data ?? [],
        )}
      />
    </State>
  );
}

export function StudentLearningRadar({ courses }: { courses: LearningCourse[] }) {
  const [selected, setSelected] = useState("");
  const courseId = courses.some((course) => course.courseId === selected)
    ? selected
    : (courses[0]?.courseId ?? "");
  return (
    <section className="learning-radar-panel" aria-label="Bản đồ năng lực học tập">
      <h2>Bản đồ năng lực học tập</h2>
      <p>
        Mỗi trục là một bài học hoặc bài kiểm tra. Điểm thể hiện mức độ làm chủ từ bằng chứng học tập đã ghi
        nhận.
      </p>
      {courses.length ? (
        <>
          <div className="learning-radar-controls">
            <label>
              Khóa học xem năng lực
              <select value={courseId} onChange={(event) => setSelected(event.target.value)}>
                {courses.map((course) => (
                  <option key={course.courseId} value={course.courseId}>
                    {course.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <CourseRadar key={courseId} courseId={courseId} />
        </>
      ) : (
        <p>Đăng ký khóa học và bắt đầu học để theo dõi năng lực của bạn.</p>
      )}
    </section>
  );
}
