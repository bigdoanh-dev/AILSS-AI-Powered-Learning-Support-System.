import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { Breadcrumbs, EmptyState, StateChip, useUnsavedChanges } from "../components/product";
import { lecturerError, lecturerRequest, useLecturer } from "./api";
import { Field, State } from "./ui";
import GradebookDashboard, { QuizResults } from "./GradebookDashboard";

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
  questions?: Question[];
};
type Course = { courseId: string; title: string };
type ClassItem = { classId: string; name: string };
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
    courses = useLecturer<Course[] | { items: Course[] }>("/me/owned-courses"),
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
    [createDeadline, setCreateDeadline] = useState("");
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
    try {
      const r = await lecturerRequest<Quiz>("/quizzes", "POST", {
        title: rawTitle,
        targetType,
        targetId,
        questions: [],
        ...(createDeadline ? { closesAt: new Date(createDeadline).toISOString() } : {}),
      });
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
                  <p className="muted" style={{ flex: "1 1 260px" }}>
                    Câu hỏi trắc nghiệm và trả lời ngắn được hệ thống chấm tự động.
                  </p>
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
                  <p>Bài kiểm tra sẽ đóng khi đến hạn do máy chủ xác thực.</p>
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
                      const storedPolicy = "BLOCK_LATE";
                      const storedDeadline = x.closesAt;
                      const formattedDeadline = storedDeadline
                        ? new Date(storedDeadline).toLocaleString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "Chưa đặt hạn đóng";
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
    [deadline, setDeadline] = useState(() =>
      quiz.closesAt
        ? new Date(new Date(quiz.closesAt).getTime() - new Date(quiz.closesAt).getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : "",
    );
  useEffect(() => {
    setTitle(quiz.title);
    setDeadline(
      quiz.closesAt
        ? new Date(new Date(quiz.closesAt).getTime() - new Date(quiz.closesAt).getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : "",
    );
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
        closesAt: deadline ? new Date(deadline).toISOString() : null,
      });
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
            <p>Bài kiểm tra sẽ đóng khi đến hạn do máy chủ xác thực.</p>
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
  const { quizId = "" } = useParams();
  return (
    <>
      <h1>Kết quả &amp; Chấm điểm</h1>
      <Link to={`/app/teaching/assessments/${quizId}`}>← Bài kiểm tra</Link>
      <QuizResults key={quizId} quizId={quizId} />
    </>
  );
}
