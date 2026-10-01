import { useState } from "react";
import { Link } from "react-router-dom";
import { useLecturer, month, lecturerRequest, lecturerError } from "./api";
import { State } from "./ui";

type Course = { courseId: string; title: string; state?: string };
type Class = { classId: string; name: string };
type Quiz = { quizId: string; title: string };
type Result = {
  attemptId: string;
  studentId: string;
  score: string;
  maxScore: string;
  submittedAt: string;
  manualScore?: string;
  teacherFeedback?: string;
  resultVersion?: number;
  gradingStatus?: string;
};

export function QuizResults({ quizId }: { quizId: string }) {
  const [selectedMonth, setMonth] = useState(month());
  const [cursor, setCursor] = useState("");
  const query = useLecturer<{ items: Result[]; nextCursor?: string }>(
    `/quizzes/${quizId}/results?month=${selectedMonth}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const [editing, setEditing] = useState<Result | null>(null);
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    if (!editing) return;
    if (
      !score.trim() ||
      !Number.isFinite(Number(score)) ||
      Number(score) < 0 ||
      Number(score) > Number(editing.maxScore)
    ) {
      setMessage(`Nhập điểm từ 0 đến ${editing.maxScore}.`);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await lecturerRequest(`/quizzes/${quizId}/grades/${editing.attemptId}`, "POST", {
        score,
        feedback,
        ...(editing.resultVersion !== undefined ? { expectedResultVersion: editing.resultVersion } : {}),
      });
      setEditing(null);
      query.retry();
      setMessage("Đã lưu điểm và nhận xét trên hệ thống.");
    } catch (error) {
      setMessage(lecturerError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <label>
        Tháng nộp bài
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => {
            setMonth(e.target.value);
            setCursor("");
            setEditing(null);
          }}
        />
      </label>
      {message && <p role="status">{message}</p>}
      <State q={query}>
        {(value) =>
          value.items.length ? (
            <div className="attendance-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Học viên</th>
                    <th>Điểm</th>
                    <th>Nộp lúc</th>
                    <th>Chấm điểm</th>
                  </tr>
                </thead>
                <tbody>
                  {value.items.map((row) => (
                    <tr key={row.attemptId}>
                      <td>{row.studentId}</td>
                      <td>
                        {row.gradingStatus === "PENDING_MANUAL_GRADING"
                          ? "Chờ chấm"
                          : `${row.manualScore ?? row.score} / ${row.maxScore}`}
                      </td>
                      <td>{new Date(row.submittedAt).toLocaleString("vi-VN")}</td>
                      <td>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => {
                            setEditing(row);
                            setScore(row.manualScore ?? "");
                            setFeedback(row.teacherFeedback ?? "");
                          }}
                        >
                          Chấm điểm
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {value.nextCursor && (
                <button className="button" onClick={() => setCursor(value.nextCursor!)}>
                  Trang tiếp theo
                </button>
              )}
            </div>
          ) : (
            <p>Chưa có bài nộp trong tháng này.</p>
          )
        }
      </State>
      {editing && (
        <section className="form-panel">
          <h2>Chấm bài của {editing.studentId}</h2>
          <label>
            Điểm
            <input
              type="number"
              min="0"
              max={editing.maxScore}
              step="0.01"
              value={score}
              onChange={(e) => setScore(e.target.value)}
            />
          </label>
          <label>
            Nhận xét
            <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={4000} />
          </label>
          <button className="button" disabled={busy} onClick={() => void save()}>
            Lưu điểm
          </button>
          <button className="button secondary" disabled={busy} onClick={() => setEditing(null)}>
            Hủy
          </button>
        </section>
      )}
    </>
  );
}
export default function GradebookDashboard() {
  const courses = useLecturer<Course[] | { items: Course[] }>("/me/owned-courses");
  const classes = useLecturer<Class[] | { classes: Class[] }>("/me/owned-classes");
  const [target, setTarget] = useState("");
  const [quizId, setQuiz] = useState("");
  const quizzes = useLecturer<Quiz[]>(target ? `/targets/${target}/quizzes` : null);
  const courseList = Array.isArray(courses.data) ? courses.data : (courses.data?.items ?? []);
  const classList = Array.isArray(classes.data) ? classes.data : (classes.data?.classes ?? []);
  return (
    <>
      <h1>Bảng điểm học viên</h1>
      <p>Kết quả bài kiểm tra của khóa học và lớp do bạn phụ trách.</p>
      <State q={courses}>{() => null}</State>
      <State q={classes}>{() => null}</State>
      {!courses.pending &&
        !classes.pending &&
        !courses.error &&
        !classes.error &&
        !courseList.length &&
        !classList.length && <p>Bạn chưa có khóa học hoặc lớp học để xem điểm.</p>}
      <label>
        Khóa học hoặc lớp
        <select
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setQuiz("");
          }}
        >
          <option value="">Chọn khóa học hoặc lớp</option>
          {courseList.map((c) => (
            <option key={c.courseId} value={`COURSE/${c.courseId}`}>
              {c.title}
              {c.state === "DRAFT" ? " — Bản nháp" : c.state === "IN_REVIEW" ? " — Chờ duyệt" : ""}
            </option>
          ))}
          {classList.map((c) => (
            <option key={c.classId} value={`CLASS/${c.classId}`}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {target && (
        <State q={quizzes}>
          {(items) =>
            items.length ? (
              <label>
                Bài kiểm tra
                <select value={quizId} onChange={(e) => setQuiz(e.target.value)}>
                  <option value="">Chọn bài kiểm tra</option>
                  {items.map((q) => (
                    <option key={q.quizId} value={q.quizId}>
                      {q.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>Chưa có bài kiểm tra cho mục đã chọn.</p>
            )
          }
        </State>
      )}
      {quizId && <QuizResults key={`${target}:${quizId}`} quizId={quizId} />}
      <Link className="button secondary" to="/app/teaching/assessments">
        Quản lý bài kiểm tra
      </Link>
    </>
  );
}
