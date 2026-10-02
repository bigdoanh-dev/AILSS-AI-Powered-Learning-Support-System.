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

export function QuizResults({ quizId, target = "" }: { quizId: string; target?: string }) {
  const [selectedMonth, setMonth] = useState(month());
  const [cursor, setCursor] = useState("");
  const query = useLecturer<{ items: Result[]; nextCursor?: string }>(
    `/quizzes/${quizId}/results?month=${selectedMonth}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  const isClass = target.startsWith("CLASS/");
  const isCourse = target.startsWith("COURSE/");
  const classId = isClass ? target.replace("CLASS/", "") : "";
  const courseId = isCourse ? target.replace("COURSE/", "") : "";

  const classMembers = useLecturer<
    | { studentId: string; displayName?: string; emailMasked?: string }[]
    | { members: { studentId: string; displayName?: string; emailMasked?: string }[] }
  >(classId ? `/classes/${classId}/members` : null);

  const courseRoster = useLecturer<
    | { studentId: string; studentName?: string; email?: string }[]
    | { items: { studentId: string; studentName?: string; email?: string }[] }
  >(courseId ? `/courses/${courseId}/roster` : null);

  const nameMap = new Map<string, string>();
  const cMembers = Array.isArray(classMembers.data) ? classMembers.data : classMembers.data?.members || [];
  for (const m of cMembers) {
    if (m.displayName) nameMap.set(m.studentId, m.displayName);
  }
  const crMembers = Array.isArray(courseRoster.data) ? courseRoster.data : courseRoster.data?.items || [];
  for (const m of crMembers) {
    if (m.studentName) nameMap.set(m.studentId, m.studentName);
  }

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
    <div className="gradebook-table-card">
      <div className="gradebook-table-header">
        <div>
          <h2 className="gradebook-table-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#0284c7" }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Danh sách bài nộp &amp; Chấm điểm
          </h2>
          <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--muted, #64748b)" }}>
            Duyệt bài làm, chấm điểm thủ công và phản hồi trực tiếp đến học viên.
          </p>
        </div>
        <div style={{ minWidth: 200 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", display: "flex", flexDirection: "column", gap: 6 }}>
            Tháng nộp bài
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => {
                setMonth(e.target.value);
                setCursor("");
                setEditing(null);
              }}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1.5px solid #cbd5e1" }}
            />
          </label>
        </div>
      </div>

      {message && (
        <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "10px 14px" }}>
          <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#0369A1" }}>
            {message}
          </p>
        </div>
      )}

      <State q={query}>
        {(value) =>
          value.items.length ? (
            <div className="attendance-scroll">
              <table className="admin-table">
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
                      <td>
                        <strong>{nameMap.get(row.studentId) || row.studentId}</strong>
                        {nameMap.has(row.studentId) && (
                          <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>
                            {row.studentId.slice(0, 13)}...
                          </small>
                        )}
                      </td>
                      <td>
                        {row.gradingStatus === "PENDING_MANUAL_GRADING" ? (
                          <span style={{ background: "#FEF3C7", color: "#B45309", padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
                            Chờ chấm
                          </span>
                        ) : (
                          <span style={{ fontWeight: 700, color: "#0284c7" }}>
                            {row.manualScore ?? row.score} / {row.maxScore}
                          </span>
                        )}
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
                <div style={{ marginTop: 14 }}>
                  <button className="button" onClick={() => setCursor(value.nextCursor!)}>
                    Trang tiếp theo
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: "16px 0" }}>
              <p style={{ margin: 0, color: "var(--muted, #64748b)", fontSize: 13.5 }}>
                Chưa có bài nộp trong tháng này.
              </p>
            </div>
          )
        }
      </State>

      {editing && (
        <section className="form-panel" style={{ marginTop: 12, background: "#f8fafc", borderRadius: 14, border: "1.5px solid #cbd5e1" }}>
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
            <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={4000} rows={3} />
          </label>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="button" disabled={busy} onClick={() => void save()}>
              Lưu điểm
            </button>
            <button className="button secondary" disabled={busy} onClick={() => setEditing(null)}>
              Hủy
            </button>
          </div>
        </section>
      )}
    </div>
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
    <div className="gradebook-studio-container">
      <div className="gradebook-hero-header">
        <div className="gradebook-hero-main">
          <div className="gradebook-hero-title-row">
            <h1 className="gradebook-hero-title">Bảng điểm học viên</h1>
            <span className="kpi-tag accent">AI Master Radar</span>
          </div>
          <p className="gradebook-hero-desc">
            Kết quả bài kiểm tra của khóa học và lớp do bạn phụ trách. Theo dõi phân bố năng lực học tập và chấm điểm tự luận/thực hành.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link className="button secondary" to="/app/teaching/assessments" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Quản lý bài kiểm tra
          </Link>
        </div>
      </div>

      <State q={courses}>{() => null}</State>
      <State q={classes}>{() => null}</State>
      {!courses.pending &&
        !classes.pending &&
        !courses.error &&
        !classes.error &&
        !courseList.length &&
        !classList.length && (
          <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 12, padding: "14px 18px" }}>
            <p style={{ margin: 0, color: "#991B1B", fontSize: 13.5, fontWeight: 600 }}>
              Bạn chưa có khóa học hoặc lớp học để xem điểm.
            </p>
          </div>
        )}

      <div className="gradebook-selector-card">
        <div className="gradebook-selector-grid">
          <div className="gradebook-filter-field">
            <label>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#0284c7" }}>
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
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
          </div>

          {target && (
            <div className="gradebook-filter-field">
              <State q={quizzes}>
                {(items) =>
                  items.length ? (
                    <label>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#7c3aed" }}>
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                      </svg>
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
                    <div style={{ padding: "10px 0" }}>
                      <p style={{ margin: 0, fontSize: 13, color: "var(--muted, #64748b)" }}>
                        Chưa có bài kiểm tra cho mục đã chọn.
                      </p>
                    </div>
                  )
                }
              </State>
            </div>
          )}
        </div>
      </div>

      {quizId && <QuizResults key={`${target}:${quizId}`} quizId={quizId} target={target} />}
    </div>
  );
}
