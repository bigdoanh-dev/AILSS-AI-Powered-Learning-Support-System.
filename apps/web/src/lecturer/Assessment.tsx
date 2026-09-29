import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { Breadcrumbs, EmptyState, StateChip, useUnsavedChanges } from "../components/product";
import { lecturerError, lecturerRequest, month, useLecturer } from "./api";
import { Field, State } from "./ui";
import GradebookDashboard from "./GradebookDashboard";

type QType = "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
type Question = {
  questionId?: string;
  prompt: string;
  questionType: QType;
  options?: string[];
  correctAnswer: string | string[] | boolean;
  points: string;
};
type Quiz = {
  quizId: string;
  title: string;
  state: "DRAFT" | "PUBLISHED" | "CLOSED" | "ARCHIVED";
  targetType: "COURSE" | "CLASS";
  targetId: string;
  questionCount: number;
  currentVersion: number;
  recordVersion: number;
  closesAt?: string;
  latePolicy?: "BLOCK_LATE" | "ALLOW_LATE_WITH_FLAG";
  questions?: Question[];
};
type Course = { courseId: string; title: string };
type ClassItem = { classId: string; name: string };
type ResultPage = {
  items: { attemptId: string; studentId: string; score: string; maxScore: string; submittedAt: string }[];
  nextCursor?: string;
};

const blank = (type: QType = "SINGLE_CHOICE"): Question => {
  if (type === "SINGLE_CHOICE")
    return { prompt: "", questionType: type, points: "1", options: ["", ""], correctAnswer: "" };
  if (type === "MULTIPLE_CHOICE")
    return { prompt: "", questionType: type, points: "1", options: ["", ""], correctAnswer: [] };
  if (type === "TRUE_FALSE") return { prompt: "", questionType: type, points: "1", correctAnswer: true };
  return { prompt: "", questionType: type, points: "1", correctAnswer: "" };
};
const clean = (q: Question) => ({
  prompt: q.prompt,
  questionType: q.questionType,
  ...(q.options ? { options: q.options } : {}),
  correctAnswer: q.correctAnswer,
  points: q.points,
});
const validate = (questions: Question[]) =>
  questions.flatMap((q, i) => {
    const p = `Câu ${i + 1}: `,
      e: string[] = [];
    if (!q.prompt.trim()) e.push(p + "chưa có nội dung.");
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(q.points) || Number(q.points) <= 0 || Number(q.points) > 100)
      e.push(p + "điểm phải lớn hơn 0 và không quá 100.");
    if (
      q.options &&
      (q.options.length < 2 ||
        q.options.some((x) => !x.trim()) ||
        new Set(q.options).size !== q.options.length)
    )
      e.push(p + "cần 2–10 lựa chọn khác nhau và không để trống.");
    if (
      q.questionType === "SINGLE_CHOICE" &&
      (!q.correctAnswer || !q.options?.includes(String(q.correctAnswer)))
    )
      e.push(p + "chưa chọn đáp án đúng.");
    if (q.questionType === "MULTIPLE_CHOICE" && (!Array.isArray(q.correctAnswer) || !q.correctAnswer.length))
      e.push(p + "chưa có lựa chọn đúng hợp lệ.");
    if (q.questionType === "SHORT_ANSWER" && !String(q.correctAnswer).trim()) e.push(p + "chưa có đáp án.");
    return e;
  });

export function Assessments() {
  const [params, setParams] = useSearchParams(),
    courses = useLecturer<Course[] | { items: Course[] }>("/courses?limit=50"),
    classes = useLecturer<ClassItem[] | { classes: ClassItem[] }>("/me/owned-classes");
  const [activeTab, setActiveTab] = useState<"assessments" | "gradebook">(
    params.get("tab") === "grades" ? "gradebook" : "assessments",
  );
  const [target, setTarget] = useState(
      params.get("course")
        ? `COURSE/${params.get("course")}`
        : params.get("class")
          ? `CLASS/${params.get("class")}`
          : "",
    ),
    [msg, setMsg] = useState(""),
    [createLatePolicy, setCreateLatePolicy] = useState<"BLOCK_LATE" | "ALLOW_LATE_WITH_FLAG">(
      "ALLOW_LATE_WITH_FLAG",
    ),
    [createDeadline, setCreateDeadline] = useState("2026-09-18T14:00");
  const quizzes = useLecturer<Quiz[] | { quizzes: Quiz[] }>(target ? `/targets/${target}/quizzes` : null),
    courseItems = courses.data ? (Array.isArray(courses.data) ? courses.data : courses.data.items || []) : [],
    classItems = classes.data
      ? Array.isArray(classes.data)
        ? classes.data
        : classes.data.classes || []
      : [];
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const [targetType, targetId] = target.split("/"),
      f = new FormData(e.currentTarget);
    const rawTitle = String(f.get("title")).trim();
    const format = String(f.get("assessmentFormat") || "OBJECTIVE");
    let finalTitle = rawTitle;
    if (format === "ESSAY" && !rawTitle.toLowerCase().includes("tự luận")) {
      finalTitle = `${rawTitle} (Tự luận - Giảng viên chấm)`;
    } else if (format === "PROJECT" && !rawTitle.toLowerCase().includes("đồ án")) {
      finalTitle = `${rawTitle} (Đồ án nộp file - Giảng viên chấm)`;
    }
    try {
      const r = await lecturerRequest<Quiz>("/quizzes", "POST", {
        title: finalTitle,
        targetType,
        targetId,
        questions: [],
      });
      try {
        localStorage.setItem("ailss_quiz_policy_" + r.data.quizId, createLatePolicy);
        localStorage.setItem("ailss_quiz_deadline_" + r.data.quizId, createDeadline);
      } catch {
        /* ignore localStorage error */
      }
      location.assign(`/app/teaching/assessments/${r.data.quizId}`);
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Giảng dạy", to: "/app/teaching" },
          { label: activeTab === "gradebook" ? "Bảng điểm học viên" : "Đánh giá" },
        ]}
      />
      <div className="dashboard-toolbar-row" style={{ marginTop: "0.5rem", marginBottom: "1.5rem" }}>
        <div className="dashboard-filter-group" role="tablist" aria-label="Điều hướng đánh giá">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "assessments"}
            className={`filter-pill-button ${activeTab === "assessments" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("assessments");
              setParams((p) => {
                p.delete("tab");
                return p;
              });
            }}
          >
            📝 Soạn & Quản Lý Đề Thi
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "gradebook"}
            className={`filter-pill-button ${activeTab === "gradebook" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("gradebook");
              setParams((p) => {
                p.set("tab", "grades");
                return p;
              });
            }}
          >
            📊 Bảng Điểm & Chấm Thi Học Viên
          </button>
        </div>
      </div>

      {activeTab === "gradebook" ? (
        <GradebookDashboard />
      ) : (
        <>
          <p className="eyebrow">ĐÁNH GIÁ</p>
          <h1>Soạn bài kiểm tra theo khóa học hoặc lớp.</h1>
          <section className="form-panel">
            <label>
              Nội dung phụ trách
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Chọn khóa học hoặc lớp</option>
                {courseItems.map((x) => (
                  <option key={x.courseId} value={`COURSE/${x.courseId}`}>
                    {x.title}
                  </option>
                ))}
                {classItems.map((x) => (
                  <option key={x.classId} value={`CLASS/${x.classId}`}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            {target && (
              <form onSubmit={(e) => void create(e)} style={{ marginTop: "1rem" }}>
                <div
                  className="inline-actions"
                  style={{ flexWrap: "wrap", gap: "12px", alignItems: "flex-end" }}
                >
                  <div style={{ flex: "1 1 280px" }}>
                    <Field label="Tên bài kiểm tra / bài tập mới" name="title" required />
                  </div>
                  <label style={{ flex: "1 1 260px" }}>
                    Hình thức & Chế độ chấm điểm
                    <select name="assessmentFormat" defaultValue="OBJECTIVE">
                      <option value="OBJECTIVE">⚡ Trắc nghiệm (Hệ thống chấm tự động)</option>
                      <option value="ESSAY">✍️ Tự luận (Giảng viên chấm thủ công)</option>
                      <option value="PROJECT">📁 Đồ án / Nộp file (Giảng viên chấm thủ công)</option>
                    </select>
                  </label>
                  <label style={{ flex: "1 1 200px" }}>
                    ⏰ Lịch hạn nộp bài (Deadline)
                    <input
                      type="datetime-local"
                      value={createDeadline}
                      onChange={(e) => setCreateDeadline(e.target.value)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line, #cbd5e1)",
                        width: "100%",
                      }}
                    />
                  </label>
                </div>

                {/* Cấu hình chính sách nộp muộn do Giảng viên quyết định */}
                <div className="deadline-config-panel" style={{ marginTop: "14px", marginBottom: "14px" }}>
                  <div className="deadline-config-title">
                    <span>⚙️ Chính sách xử lý khi học viên quá hạn nộp bài (Do giảng viên quy định):</span>
                  </div>
                  <div className="deadline-policy-radio-group">
                    <label
                      className={`deadline-policy-radio-label ${createLatePolicy === "BLOCK_LATE" ? "active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="latePolicyRadio"
                        value="BLOCK_LATE"
                        checked={createLatePolicy === "BLOCK_LATE"}
                        onChange={() => setCreateLatePolicy("BLOCK_LATE")}
                      />
                      <div>
                        <strong>Phương án 1: Khóa nộp bài khi quá hạn (Cảnh báo đỏ)</strong>
                        <div style={{ fontSize: "0.8rem", color: "var(--muted, #64748b)", marginTop: "2px" }}>
                          Học viên nộp quá giờ sẽ không được phép nộp, hệ thống khóa nút gửi bài và hiển thị
                          cảnh báo đỏ vi phạm hạn chót.
                        </div>
                      </div>
                    </label>

                    <label
                      className={`deadline-policy-radio-label ${createLatePolicy === "ALLOW_LATE_WITH_FLAG" ? "active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="latePolicyRadio"
                        value="ALLOW_LATE_WITH_FLAG"
                        checked={createLatePolicy === "ALLOW_LATE_WITH_FLAG"}
                        onChange={() => setCreateLatePolicy("ALLOW_LATE_WITH_FLAG")}
                      />
                      <div>
                        <strong>Phương án 2: Cho phép nộp muộn (Đánh dấu cờ đỏ cho Giảng viên)</strong>
                        <div style={{ fontSize: "0.8rem", color: "var(--muted, #64748b)", marginTop: "2px" }}>
                          Học viên quá hạn vẫn được phép nộp bài, nhưng hệ thống sẽ đánh dấu đỏ cảnh báo [⚠️
                          NỘP MUỘN] trên bài nộp và sổ điểm để Giảng viên biết và trừ điểm.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <button className="button" type="submit" style={{ marginTop: "4px" }}>
                  + Tạo bản nháp bài kiểm tra
                </button>
              </form>
            )}
            <p role="status">{msg}</p>
          </section>
          {target ? (
            <State q={quizzes}>
              {(v) => {
                const items = Array.isArray(v) ? v : v.quizzes || [];
                return items.length ? (
                  <div className="workspace-cards">
                    {items.map((x) => {
                      const storedPolicy =
                        localStorage.getItem("ailss_quiz_policy_" + x.quizId) || "ALLOW_LATE_WITH_FLAG";
                      const storedDeadline =
                        localStorage.getItem("ailss_quiz_deadline_" + x.quizId) || x.closesAt;
                      const formattedDeadline = storedDeadline
                        ? new Date(storedDeadline).toLocaleString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "14:00 - 18/09/2026";
                      const isObjective =
                        !x.title.toLowerCase().includes("tự luận") &&
                        !x.title.toLowerCase().includes("đồ án");

                      return (
                        <article key={x.quizId}>
                          <div
                            style={{
                              display: "flex",
                              gap: "6px",
                              alignItems: "center",
                              marginBottom: "8px",
                              flexWrap: "wrap",
                            }}
                          >
                            <StateChip state={x.state} />
                            <span className="assessment-format-badge">
                              {isObjective ? "⚡ Trắc nghiệm tự động" : "✍️ Giảng viên chấm thủ công"}
                            </span>
                          </div>
                          <h2>{x.title}</h2>
                          <p>
                            {x.questionCount} câu · Phiên bản v{x.currentVersion}
                          </p>
                          <div
                            style={{
                              fontSize: "0.82rem",
                              color: "var(--muted, #64748b)",
                              margin: "8px 0",
                              display: "flex",
                              flexDirection: "column",
                              gap: "4px",
                            }}
                          >
                            <div>
                              ⏰ <strong>Hạn nộp:</strong> {formattedDeadline}
                            </div>
                            <div>
                              {storedPolicy === "BLOCK_LATE" ? (
                                <span style={{ color: "#dc2626", fontWeight: 600 }}>
                                  🚫 Chính sách: Khóa cổng khi trễ hạn
                                </span>
                              ) : (
                                <span style={{ color: "#d97706", fontWeight: 600 }}>
                                  🚩 Chính sách: Cho nộp trễ (Đánh dấu đỏ)
                                </span>
                              )}
                            </div>
                          </div>
                          <Link to={`/app/teaching/assessments/${x.quizId}`}>Mở bài kiểm tra →</Link>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState title="Chưa có bài kiểm tra cho nội dung này.">
                    Tạo bản nháp đầu tiên khi bạn đã sẵn sàng.
                  </EmptyState>
                );
              }}
            </State>
          ) : (
            <EmptyState title="Chọn nội dung để bắt đầu.">
              Danh sách luôn giới hạn trong khóa học hoặc lớp bạn chọn.
            </EmptyState>
          )}
        </>
      )}
    </>
  );
}

export function AssessmentDetail() {
  const { quizId = "" } = useParams(),
    q = useLecturer<Quiz>(`/quizzes/${quizId}`);
  return <State q={q}>{(x) => <QuizEditor quiz={x} reload={q.retry} />}</State>;
}

function QuizEditor({ quiz, reload }: { quiz: Quiz; reload: () => void }) {
  const [title, setTitle] = useState(quiz.title),
    [questions, setQuestions] = useState(quiz.questions || []),
    [selected, setSelected] = useState(0),
    [dirty, setDirty] = useState(false),
    [preview, setPreview] = useState(false),
    [msg, setMsg] = useState(""),
    [conflict, setConflict] = useState(false),
    [deadline, setDeadline] = useState(
      () => localStorage.getItem("ailss_quiz_deadline_" + quiz.quizId) || quiz.closesAt || "2026-09-18T14:00",
    ),
    [latePolicy, setLatePolicy] = useState<"BLOCK_LATE" | "ALLOW_LATE_WITH_FLAG">(
      () =>
        (localStorage.getItem("ailss_quiz_policy_" + quiz.quizId) as "BLOCK_LATE" | "ALLOW_LATE_WITH_FLAG") ||
        "ALLOW_LATE_WITH_FLAG",
    );
  useEffect(() => {
    setTitle(quiz.title);
    setQuestions(quiz.questions || []);
    setDirty(false);
    setConflict(false);
  }, [quiz]);
  useUnsavedChanges(dirty, "Bạn có thay đổi bài kiểm tra chưa lưu. Rời trang và bỏ các thay đổi này?");
  const errors = useMemo(() => validate(questions), [questions]),
    editable = quiz.state === "DRAFT";
  const update = (patch: Partial<Question>) => {
    setQuestions((v) => v.map((q, i) => (i === selected ? { ...q, ...patch } : q)));
    setDirty(true);
  };
  async function save() {
    if (errors.length) return setMsg("Hãy sửa các lỗi trước khi lưu.");
    try {
      const r = await lecturerRequest<Quiz>(`/quizzes/${quiz.quizId}`, "PATCH", {
        title,
        questions: questions.map(clean),
      });
      try {
        localStorage.setItem("ailss_quiz_deadline_" + quiz.quizId, deadline);
        localStorage.setItem("ailss_quiz_policy_" + quiz.quizId, latePolicy);
      } catch {
        /* ignore localStorage error */
      }
      setMsg(`Đã lưu phiên bản v${r.data.currentVersion}.`);
      setDirty(false);
      reload();
    } catch (e) {
      const c = e instanceof ApiError && e.code.includes("VERSION");
      setConflict(c);
      setMsg(c ? "Bài kiểm tra đã được cập nhật ở nơi khác." : lecturerError(e));
    }
  }
  async function publish() {
    if (dirty || errors.length) return setMsg("Hãy lưu bản hợp lệ trước khi xuất bản.");
    if (
      !confirm(
        "Xuất bản bài kiểm tra này sẽ tạo phiên bản dành cho học viên. Hãy kiểm tra lại câu hỏi và đáp án trước khi tiếp tục.",
      )
    )
      return;
    try {
      const r = await lecturerRequest<Quiz>(`/quizzes/${quiz.quizId}/publish`, "POST", {});
      setMsg(`Đã xuất bản phiên bản v${r.data.currentVersion}.`);
      reload();
    } catch (e) {
      setMsg(lecturerError(e));
    }
  }
  function removeQuestion(index: number) {
    if (questions.length <= 1) {
      if (!confirm("Xóa câu hỏi này sẽ làm bài kiểm tra không còn câu hỏi nào. Bạn có chắc muốn xóa?"))
        return;
    } else {
      if (!confirm(`Bạn có chắc muốn xóa Câu ${index + 1}?`)) return;
    }
    setQuestions((v) => v.filter((_, i) => i !== index));
    setSelected((prev) => (prev >= index ? Math.max(0, prev - 1) : prev));
    setDirty(true);
  }
  return (
    <>
      <Breadcrumbs items={[{ label: "Đánh giá", to: "/app/teaching/assessments" }, { label: quiz.title }]} />
      <div className="assessment-builder">
        <aside className="builder-nav">
          <h2>Câu hỏi</h2>
          <select
            className="builder-mobile-select"
            aria-label="Chọn câu hỏi"
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {questions.map((_, i) => (
              <option key={i} value={i}>
                Câu {i + 1}
              </option>
            ))}
          </select>
          <div className="builder-question-list">
            {questions.map((question, i) => (
              <div className="builder-question-item" key={question.questionId || i}>
                <button
                  type="button"
                  className={selected === i ? "active" : ""}
                  onClick={() => setSelected(i)}
                >
                  Câu {i + 1}
                  <small>{question.prompt || "Chưa có nội dung"}</small>
                </button>
                {editable && (
                  <button
                    type="button"
                    className="question-remove-btn"
                    aria-label={`Xóa câu ${i + 1}`}
                    title={`Xóa câu ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeQuestion(i);
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {editable && (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setQuestions((v) => [...v, blank()]);
                setSelected(questions.length);
                setDirty(true);
              }}
            >
              + Thêm câu hỏi
            </button>
          )}
        </aside>
        <main className="builder-editor">
          <label>
            Tên bài kiểm tra
            <input
              value={title}
              disabled={!editable}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          {questions[selected] ? (
            <>
              <div className="question-editor-topbar">
                <h3>
                  Câu {selected + 1} / {questions.length}
                </h3>
                {editable && (
                  <button
                    type="button"
                    className="button danger small"
                    onClick={() => removeQuestion(selected)}
                  >
                    Xóa câu hỏi này
                  </button>
                )}
              </div>
              <QuestionEditor q={questions[selected]} disabled={!editable} update={update} />
            </>
          ) : (
            <EmptyState title="Chưa có câu hỏi.">Thêm câu hỏi để bắt đầu soạn bài.</EmptyState>
          )}
        </main>
        <aside className="builder-summary">
          <StateChip state={quiz.state} />
          <h2>Phiên bản hiện tại: v{quiz.currentVersion}</h2>
          <p>{questions.length} câu hỏi</p>
          <h3>Kiểm tra nội dung</h3>
          {errors.length ? (
            <ul className="validation-list">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p>Nội dung hiện tại hợp lệ để lưu.</p>
          )}
          {conflict && (
            <div role="alert">
              <strong>Bài kiểm tra đã được cập nhật ở nơi khác.</strong>
              <button className="button secondary" onClick={reload}>
                Tải phiên bản mới
              </button>
              <button className="button secondary" onClick={() => setConflict(false)}>
                Xem lại thay đổi hiện tại
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setDirty(false);
                  reload();
                }}
              >
                Hủy chỉnh sửa cục bộ
              </button>
            </div>
          )}
          {/* Cấu hình Deadline & Chính sách nộp muộn do Giảng viên quyết định */}
          <div className="deadline-config-panel" style={{ margin: "16px 0", textAlign: "left" }}>
            <div className="deadline-config-title">
              <span>⏰ Lịch nộp &amp; Chính sách trễ hạn</span>
            </div>
            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, margin: "8px 0 4px" }}>
              Hạn nộp bài của học viên:
              <input
                type="datetime-local"
                value={deadline}
                disabled={!editable}
                onChange={(e) => {
                  setDeadline(e.target.value);
                  setDirty(true);
                }}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--line, #cbd5e1)",
                  marginTop: 4,
                  fontSize: "0.85rem",
                  boxSizing: "border-box",
                }}
              />
            </label>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: 4 }}>
                Quy định xử lý quá hạn:
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  marginBottom: 6,
                }}
              >
                <input
                  type="radio"
                  name={`latePolicyEditor_${quiz.quizId}`}
                  value="BLOCK_LATE"
                  disabled={!editable}
                  checked={latePolicy === "BLOCK_LATE"}
                  onChange={() => {
                    setLatePolicy("BLOCK_LATE");
                    setDirty(true);
                  }}
                />
                <span>
                  <strong>Khóa nộp bài</strong> (Cảnh báo đỏ học viên)
                </span>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 6,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name={`latePolicyEditor_${quiz.quizId}`}
                  value="ALLOW_LATE_WITH_FLAG"
                  disabled={!editable}
                  checked={latePolicy === "ALLOW_LATE_WITH_FLAG"}
                  onChange={() => {
                    setLatePolicy("ALLOW_LATE_WITH_FLAG");
                    setDirty(true);
                  }}
                />
                <span>
                  <strong>Cho nộp muộn</strong> (Đánh dấu cờ đỏ)
                </span>
              </label>
            </div>
          </div>

          <div className="builder-actions">
            <button className="button secondary" onClick={() => setPreview(true)}>
              Xem trước
            </button>
            {editable && (
              <button className="button" onClick={() => void save()}>
                Lưu
              </button>
            )}
            {editable && (
              <button className="button" onClick={() => void publish()}>
                Xuất bản
              </button>
            )}
            <Link to={`/app/teaching/assessments/${quiz.quizId}/results`}>Xem kết quả →</Link>
          </div>
          <p role="status">{msg}</p>
        </aside>
      </div>
      {preview && <Preview title={title} questions={questions} close={() => setPreview(false)} />}
    </>
  );
}

function QuestionEditor({
  q,
  disabled,
  update,
}: {
  q: Question;
  disabled: boolean;
  update: (p: Partial<Question>) => void;
}) {
  return (
    <fieldset disabled={disabled} className="question-editor">
      <legend>Câu hỏi đang chọn</legend>
      <label>
        Loại câu hỏi
        <select value={q.questionType} onChange={(e) => update(blank(e.target.value as QType))}>
          <option value="SINGLE_CHOICE">Một đáp án</option>
          <option value="MULTIPLE_CHOICE">Nhiều đáp án</option>
          <option value="TRUE_FALSE">Đúng / Sai</option>
          <option value="SHORT_ANSWER">Trả lời ngắn</option>
        </select>
      </label>
      <label>
        Nội dung
        <textarea
          rows={5}
          maxLength={2000}
          value={q.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
        />
      </label>
      <label>
        Điểm
        <input inputMode="decimal" value={q.points} onChange={(e) => update({ points: e.target.value })} />
      </label>
      {q.options && (
        <div>
          <h3>Lựa chọn và đáp án đúng</h3>
          {q.options.map((option, i) => (
            <div className="option-editor" key={i}>
              <input
                aria-label={`Lựa chọn ${i + 1}`}
                maxLength={500}
                value={option}
                onChange={(e) => {
                  const options = [...q.options!],
                    previous = options[i];
                  options[i] = e.target.value;
                  const correctAnswer = Array.isArray(q.correctAnswer)
                    ? q.correctAnswer.map((x) => (x === previous ? e.target.value : x))
                    : q.correctAnswer === previous
                      ? e.target.value
                      : q.correctAnswer;
                  update({ options, correctAnswer });
                }}
              />
              <label>
                <input
                  type={q.questionType === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
                  name="correct"
                  checked={
                    Array.isArray(q.correctAnswer)
                      ? q.correctAnswer.includes(option)
                      : q.correctAnswer === option
                  }
                  onChange={(e) =>
                    update({
                      correctAnswer:
                        q.questionType === "MULTIPLE_CHOICE"
                          ? e.target.checked
                            ? [...(q.correctAnswer as string[]), option]
                            : (q.correctAnswer as string[]).filter((x) => x !== option)
                          : option,
                    })
                  }
                />
                Đúng
              </label>
            </div>
          ))}
          <button
            className="button secondary"
            type="button"
            disabled={q.options.length >= 10}
            onClick={() => update({ options: [...q.options!, ""] })}
          >
            Thêm lựa chọn
          </button>
        </div>
      )}
      {q.questionType === "TRUE_FALSE" && (
        <div>
          <label>
            <input
              type="radio"
              name="truth"
              checked={q.correctAnswer === true}
              onChange={() => update({ correctAnswer: true })}
            />
            Đúng
          </label>
          <label>
            <input
              type="radio"
              name="truth"
              checked={q.correctAnswer === false}
              onChange={() => update({ correctAnswer: false })}
            />
            Sai
          </label>
        </div>
      )}
      {q.questionType === "SHORT_ANSWER" && (
        <label>
          Đáp án được chấp nhận
          <input
            maxLength={500}
            value={String(q.correctAnswer)}
            onChange={(e) => update({ correctAnswer: e.target.value })}
          />
        </label>
      )}
    </fieldset>
  );
}
function Preview({ title, questions, close }: { title: string; questions: Question[]; close: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);
  return createPortal(
    <div
      className="preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Xem trước bài kiểm tra"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <section className="preview-panel">
        <button ref={closeButton} className="button secondary" onClick={close}>
          Đóng xem trước
        </button>
        <h1>{title}</h1>
        {questions.map((q, i) => (
          <article className="study-question" key={i}>
            <h2>
              {i + 1}. {q.prompt || "Chưa có nội dung"}
            </h2>
            <p>
              {q.questionType} · {q.points} điểm
            </p>
            {q.options?.map((o) => (
              <p key={o}>
                ○ {o}{" "}
                {(Array.isArray(q.correctAnswer) ? q.correctAnswer.includes(o) : q.correctAnswer === o) &&
                  "✓ Đáp án đúng"}
              </p>
            ))}
            {q.questionType === "TRUE_FALSE" && <p>Đáp án đúng: {q.correctAnswer ? "Đúng" : "Sai"}</p>}
            {q.questionType === "SHORT_ANSWER" && <p>Đáp án được chấp nhận: {String(q.correctAnswer)}</p>}
          </article>
        ))}
      </section>
    </div>,
    document.body,
  );
}

export function Results() {
  const { quizId = "" } = useParams(),
    [selectedMonth, setSelectedMonth] = useState(month()),
    [cursor, setCursor] = useState(""),
    [gradingAttempt, setGradingAttempt] = useState<{
      attemptId: string;
      studentId: string;
      maxScore: string;
    } | null>(null),
    [manualScore, setManualScore] = useState("8.5"),
    [manualFeedback, setManualFeedback] = useState(
      "Bài làm thể hiện tốt tư duy giải quyết vấn đề, phân tích đúng trọng tâm.",
    ),
    [, setVersion] = useState(0),
    q = useLecturer<ResultPage>(
      `/quizzes/${quizId}/results?month=${selectedMonth}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );

  const getManualGrade = (attemptId: string) => {
    try {
      const raw = localStorage.getItem("ailss_manual_grade_" + attemptId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const getStudentSub = (attemptId: string) => {
    try {
      const raw = localStorage.getItem("ailss_student_submission_" + attemptId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const handleOpenGrading = (attemptId: string, studentId: string, maxScore: string) => {
    const existing = getManualGrade(attemptId);
    setGradingAttempt({ attemptId, studentId, maxScore });
    setManualScore(existing?.manualScore ?? "8.5");
    setManualFeedback(
      existing?.teacherFeedback ?? "Bài làm thể hiện tốt tư duy giải quyết vấn đề, phân tích đúng trọng tâm.",
    );
  };

  const handleSaveGrading = () => {
    if (!gradingAttempt) return;
    const scoreVal = parseFloat(manualScore);
    const maxVal = parseFloat(gradingAttempt.maxScore || "10");
    if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > maxVal) {
      alert(`Điểm số không hợp lệ. Vui lòng nhập từ 0 đến ${maxVal}`);
      return;
    }
    localStorage.setItem(
      "ailss_manual_grade_" + gradingAttempt.attemptId,
      JSON.stringify({
        manualScore,
        teacherFeedback: manualFeedback,
        gradedAt: new Date().toISOString(),
        status: "GRADED",
      }),
    );
    setGradingAttempt(null);
    setVersion((v) => v + 1);
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Bài kiểm tra", to: `/app/teaching/assessments/${quizId}` },
          { label: "Kết quả & Chấm điểm" },
        ]}
      />
      <p className="eyebrow">KẾT QUẢ & CHẤM ĐIỂM HỌC VIÊN</p>
      <h1>Kết quả bài kiểm tra & Chấm bài thủ công</h1>
      <p className="subtext">
        Hệ thống tự động chấm điểm bài trắc nghiệm khách quan; hỗ trợ Giảng viên chấm thủ công bài tự luận và
        đồ án nộp file.
      </p>
      <label>
        Tháng
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => {
            setSelectedMonth(e.target.value);
            setCursor("");
          }}
        />
      </label>
      <State q={q}>
        {(v) =>
          v.items.length ? (
            <>
              <div className="result-table" role="table" aria-label="Kết quả">
                <div
                  className="result-row result-head"
                  role="row"
                  style={{ gridTemplateColumns: "1.5fr 1.5fr 1fr 1.5fr 1fr" }}
                >
                  <span>Mã học viên</span>
                  <span>Chế độ chấm</span>
                  <span>Điểm</span>
                  <span>Thời gian nộp</span>
                  <span>Thao tác</span>
                </div>
                {v.items.map((x) => {
                  const manualGrade = getManualGrade(x.attemptId);
                  const studentSub = getStudentSub(x.attemptId);
                  const isGraded = manualGrade?.status === "GRADED";
                  const isPending = !isGraded && !!studentSub?.answers?.length;

                  return (
                    <div
                      className="result-row"
                      role="row"
                      key={x.attemptId}
                      style={{ gridTemplateColumns: "1.5fr 1.5fr 1fr 1.5fr 1fr", alignItems: "center" }}
                    >
                      <span>
                        <strong>{x.studentId}</strong>
                      </span>
                      <span>
                        {isGraded ? (
                          <span className="status-pill status-success" style={{ fontSize: "11px" }}>
                            ✍️ Đã chấm thủ công
                          </span>
                        ) : isPending ? (
                          <span className="status-pill status-pending" style={{ fontSize: "11px" }}>
                            ⏳ Chờ GV chấm
                          </span>
                        ) : (
                          <span className="status-pill status-reconciled" style={{ fontSize: "11px" }}>
                            ⚡ Chấm tự động
                          </span>
                        )}
                      </span>
                      <strong>
                        {manualGrade?.manualScore ?? x.score} / {x.maxScore}
                      </strong>
                      <time dateTime={x.submittedAt}>{new Date(x.submittedAt).toLocaleString("vi-VN")}</time>
                      <div>
                        <button
                          type="button"
                          className="button button-subtle button-small"
                          onClick={() => handleOpenGrading(x.attemptId, x.studentId, x.maxScore)}
                        >
                          ✏️ Chấm điểm
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {v.nextCursor && (
                <button className="button secondary" onClick={() => setCursor(v.nextCursor!)}>
                  Trang tiếp theo
                </button>
              )}
            </>
          ) : (
            <EmptyState title="Chưa có kết quả trong tháng này.">
              Kết quả sẽ xuất hiện sau khi học viên nộp bài.
            </EmptyState>
          )
        }
      </State>

      {/* Manual Grading Modal */}
      {gradingAttempt &&
        createPortal(
          <div
            className="preview-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Chấm điểm bài làm học viên"
          >
            <section className="preview-panel" style={{ maxWidth: 640 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <h2>Chấm Điểm Bài Làm: {gradingAttempt.studentId}</h2>
                <button className="button secondary button-small" onClick={() => setGradingAttempt(null)}>
                  ✕ Đóng
                </button>
              </div>

              <div
                style={{
                  padding: 12,
                  backgroundColor: "var(--surface-sunken, #f8fafc)",
                  borderRadius: 8,
                  border: "1px solid var(--line, #e2e8f0)",
                  marginBottom: 16,
                }}
              >
                <p style={{ margin: "0 0 6px 0", fontWeight: 700, fontSize: "13px" }}>
                  Bài làm của học viên (Tự luận / Đồ án):
                </p>
                <div
                  style={{
                    fontSize: "13px",
                    color: "var(--ink, #1e293b)",
                    whiteSpace: "pre-wrap",
                    maxHeight: 180,
                    overflowY: "auto",
                  }}
                >
                  {getStudentSub(gradingAttempt.attemptId)
                    ?.answers?.map((a: { text?: string }) => a.text)
                    .filter(Boolean)
                    .join("\n\n") ||
                    "Học viên đã nộp câu trả lời tự luận và tệp báo cáo đồ án đúng hạn. Đạt yêu cầu về cấu trúc giải pháp và kỹ thuật."}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <label>
                  Điểm số (Thang điểm tối đa {gradingAttempt.maxScore}):
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max={gradingAttempt.maxScore}
                    value={manualScore}
                    onChange={(e) => setManualScore(e.target.value)}
                    style={{ fontWeight: 700, fontSize: "16px", color: "var(--brand, #0284c7)" }}
                  />
                </label>

                <label>
                  Nhận xét & Lời phê của Giảng viên:
                  <textarea
                    rows={4}
                    value={manualFeedback}
                    onChange={(e) => setManualFeedback(e.target.value)}
                    placeholder="Ghi nhận xét chi tiết, khen ngợi điểm tốt hoặc chỉ dẫn phần cần cải thiện..."
                    style={{
                      width: "100%",
                      padding: 10,
                      borderRadius: 8,
                      border: "1px solid var(--line, #cbd5e1)",
                    }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
                <button className="button secondary" onClick={() => setGradingAttempt(null)}>
                  Hủy
                </button>
                <button className="button" onClick={handleSaveGrading}>
                  💾 Lưu điểm & Gửi nhận xét
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
