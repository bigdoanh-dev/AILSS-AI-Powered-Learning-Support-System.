import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { Breadcrumbs, EmptyState, StateChip, useUnsavedChanges } from "../components/product";
import { lecturerError, lecturerRequest, month, useLecturer } from "./api";
import { Field, State } from "./ui";

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
  const [params] = useSearchParams(),
    courses = useLecturer<Course[] | { items: Course[] }>("/courses?limit=50"),
    classes = useLecturer<ClassItem[] | { classes: ClassItem[] }>("/me/owned-classes");
  const [target, setTarget] = useState(
      params.get("course")
        ? `COURSE/${params.get("course")}`
        : params.get("class")
          ? `CLASS/${params.get("class")}`
          : "",
    ),
    [msg, setMsg] = useState("");
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
    try {
      const r = await lecturerRequest<Quiz>("/quizzes", "POST", {
        title: String(f.get("title")),
        targetType,
        targetId,
        questions: [],
      });
      location.assign(`/app/teaching/assessments/${r.data.quizId}`);
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <Breadcrumbs items={[{ label: "Giảng dạy", to: "/app/teaching" }, { label: "Đánh giá" }]} />
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
          <form className="inline-actions" onSubmit={(e) => void create(e)}>
            <Field label="Tên bài kiểm tra mới" name="title" required />
            <button className="button">Tạo bản nháp</button>
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
                {items.map((x) => (
                  <article key={x.quizId}>
                    <StateChip state={x.state} />
                    <h2>{x.title}</h2>
                    <p>
                      {x.questionCount} câu · Phiên bản v{x.currentVersion}
                    </p>
                    <Link to={`/app/teaching/assessments/${x.quizId}`}>Mở bài kiểm tra →</Link>
                  </article>
                ))}
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
    [conflict, setConflict] = useState(false);
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
              <button
                key={question.questionId || i}
                className={selected === i ? "active" : ""}
                onClick={() => setSelected(i)}
              >
                Câu {i + 1}
                <small>{question.prompt || "Chưa có nội dung"}</small>
              </button>
            ))}
          </div>
          {editable && (
            <button
              className="button secondary"
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
            <QuestionEditor q={questions[selected]} disabled={!editable} update={update} />
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
  return (
    <div className="preview-overlay" role="dialog" aria-modal="true" aria-label="Xem trước bài kiểm tra">
      <section className="preview-panel">
        <button className="button secondary" onClick={close}>
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
    </div>
  );
}

export function Results() {
  const { quizId = "" } = useParams(),
    [selectedMonth, setSelectedMonth] = useState(month()),
    [cursor, setCursor] = useState(""),
    q = useLecturer<ResultPage>(
      `/quizzes/${quizId}/results?month=${selectedMonth}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
  return (
    <>
      <Breadcrumbs
        items={[{ label: "Bài kiểm tra", to: `/app/teaching/assessments/${quizId}` }, { label: "Kết quả" }]}
      />
      <p className="eyebrow">KẾT QUẢ GIỚI HẠN THEO THÁNG</p>
      <h1>Kết quả bài kiểm tra.</h1>
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
      <p>Mỗi trang hiển thị tối đa 50 kết quả do hệ thống trả về.</p>
      <State q={q}>
        {(v) =>
          v.items.length ? (
            <>
              <div className="result-table" role="table" aria-label="Kết quả">
                <div className="result-row result-head" role="row">
                  <span>Mã học viên</span>
                  <span>Điểm</span>
                  <span>Thời gian nộp</span>
                </div>
                {v.items.map((x) => (
                  <div className="result-row" role="row" key={x.attemptId}>
                    <span>{x.studentId}</span>
                    <strong>
                      {x.score} / {x.maxScore}
                    </strong>
                    <time dateTime={x.submittedAt}>{new Date(x.submittedAt).toLocaleString("vi-VN")}</time>
                  </div>
                ))}
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
    </>
  );
}
