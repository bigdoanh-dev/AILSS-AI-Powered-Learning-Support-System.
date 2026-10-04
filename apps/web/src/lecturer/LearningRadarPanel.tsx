import { useUiText } from "../lib/i18n";
import { useState } from "react";
import { useLecturer } from "./api";
import { State } from "./ui";
import { LearningRadar } from "../components/LearningRadar";
import {
  radarAxes,
  type RadarEvidence,
  type CourseMasterySummary,
} from "../../../../packages/learning-visuals/src/radar";

type Member = { studentId: string; studentName?: string };
function ContentRadar({ courseId, studentId }: { courseId: string; studentId?: string }) {
  const uiText = useUiText();
  const mastery = useLecturer<RadarEvidence[] | CourseMasterySummary>(
    studentId ? `/courses/${courseId}/students/${studentId}/mastery` : `/courses/${courseId}/mastery-summary`,
  );
  const summary = !Array.isArray(mastery.data) ? mastery.data : undefined;
  const records = Array.isArray(mastery.data) ? mastery.data : (summary?.records ?? []);
  const lessons = useLecturer<
    | { lessonId: string; title: string; state: string }[]
    | { lessons: { lessonId: string; title: string; state: string }[] }
  >(`/courses/${courseId}/lessons`);
  const quizzes = useLecturer<{ quizId: string; title: string }[]>(`/targets/COURSE/${courseId}/quizzes`);
  const syllabus = Array.isArray(lessons.data) ? lessons.data : (lessons.data?.lessons ?? []);
  const query = {
    data: mastery.data,
    pending: mastery.pending || lessons.pending || quizzes.pending,
    error: mastery.error || lessons.error || quizzes.error,
    retry: () => {
      mastery.retry();
      lessons.retry();
      quizzes.retry();
    },
  };
  return (
    <State q={query}>
      {() => (
        <>
          {summary && (
            <p>
              {summary.assessedStudentCount}/{summary.studentCount}{" "}
              {uiText(
                " học viên có kết quả đánh giá. Mỗi trục là điểm trung bình của những người đã được đánh giá ở nội dung đó.",
              )}
            </p>
          )}
          <LearningRadar
            studentCount={summary?.studentCount}
            axes={radarAxes(
              [
                ...syllabus
                  .filter((item) => item.state === "READY")
                  .map((item) => ({ id: `lesson:${item.lessonId}`, label: item.title })),
                ...(quizzes.data ?? []).map((item) => ({ id: `quiz:${item.quizId}`, label: item.title })),
              ],
              records,
            )}
          />
        </>
      )}
    </State>
  );
}
function IndividualRadar({ courseId }: { courseId: string }) {
  const uiText = useUiText();
  const roster = useLecturer<Member[] | { items: Member[] }>(`/courses/${courseId}/roster`);
  const [selected, setSelected] = useState("");
  const members = Array.isArray(roster.data) ? roster.data : (roster.data?.items ?? []);
  const studentId = members.some((member) => member.studentId === selected)
    ? selected
    : (members[0]?.studentId ?? "");
  return (
    <div>
      <State q={roster}>
        {() =>
          members.length ? (
            <>
              <div className="learning-radar-controls">
                <label>
                  {uiText("Học viên xem năng lực")}
                  <select value={studentId} onChange={(event) => setSelected(event.target.value)}>
                    {members.map((member) => (
                      <option key={member.studentId} value={member.studentId}>
                        {member.studentName || `Học viên ${member.studentId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <ContentRadar key={`${courseId}:${studentId}`} courseId={courseId} studentId={studentId} />
            </>
          ) : (
            <p>{uiText("Chưa có học viên ghi danh khóa học này.")}</p>
          )
        }
      </State>
    </div>
  );
}
export function LecturerLearningRadar({ courseId }: { courseId: string }) {
  const uiText = useUiText();
  const [individual, setIndividual] = useState(false);
  return (
    <section className="learning-radar-panel" aria-label={uiText("Tổng quan năng lực khóa học")}>
      <h2>{uiText("Tổng quan năng lực khóa học")}</h2>
      <p>
        {uiText(
          "Theo dõi nội dung học viên đang nắm tốt và nội dung cần hỗ trợ trong khóa học bạn phụ trách.",
        )}
      </p>
      <ContentRadar key={courseId} courseId={courseId} />
      <details onToggle={(event) => setIndividual(event.currentTarget.open)}>
        <summary>{uiText("Xem chi tiết từng học viên")}</summary>
        {individual && <IndividualRadar key={courseId} courseId={courseId} />}
      </details>
    </section>
  );
}
