import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Dialog } from "../components/ui";
import {
  useStudent,
  useCommand,
  dateLabel,
  isUuid,
  type LearningCourse,
  type ClassItem,
  type Quiz,
  type Attempt,
  type Result,
  type Answer,
  type Question,
} from "./api";
import { Heading, State, Empty, Status } from "./ui";
import { useUnsavedChanges } from "../components/product";
export function Assessments() {
  const [params] = useSearchParams();
  const c = params.get("course"),
    k = params.get("class");
  const [target, setTarget] = useState(c && isUuid(c) ? "COURSE/" + c : k && isUuid(k) ? "CLASS/" + k : "");
  const courses = useStudent<LearningCourse[]>("/me/courses"),
    classes = useStudent<ClassItem[]>("/me/classes");
  return (
    <>
      <Heading title="Bài kiểm tra">Chọn khóa học hoặc lớp để xem bài kiểm tra được cung cấp.</Heading>
      <section className="study-card">
        <State query={courses}>
          <State query={classes}>
            <label>
              Khóa học hoặc lớp
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Chọn nơi học</option>
                {courses.data?.map((v) => (
                  <option key={v.courseId} value={"COURSE/" + v.courseId}>
                    {v.title}
                  </option>
                ))}
                {classes.data?.map((v) => (
                  <option key={v.classId} value={"CLASS/" + v.classId}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </State>
        </State>
      </section>
      {target ? (
        <QuizList key={target} target={target} />
      ) : (
        <Empty>
          Chọn nơi học để xem bài kiểm tra. <Link to="/app/learn">Mở học tập →</Link>
        </Empty>
      )}
    </>
  );
}
function QuizList({ target }: { target: string }) {
  const q = useStudent<Quiz[]>("/targets/" + target + "/quizzes");
  return (
    <State query={q}>
      {q.data?.length ? (
        <div className="study-grid">
          {q.data.map((v) => (
            <article className="study-card" key={v.quizId}>
              <h2>{v.title}</h2>
              <p>{v.questionCount} câu hỏi</p>
              <Link to={"/app/assessments/" + v.quizId}>Xem bài kiểm tra →</Link>
            </article>
          ))}
        </div>
      ) : (
        <Empty>Chưa có bài kiểm tra khả dụng cho nơi học này.</Empty>
      )}
    </State>
  );
}
export function QuizDetail() {
  const { quizId = "" } = useParams(),
    q = useStudent<Quiz>("/quizzes/" + quizId),
    command = useCommand(),
    navigate = useNavigate();
  return (
    <>
      <Link to="/app/assessments">← Bài kiểm tra</Link>
      <Heading title={q.data?.title || "Bài kiểm tra"} />
      <State query={q}>
        {q.data && (
          <section className="study-card">
            <h2>Chuẩn bị làm bài</h2>
            <p>
              {q.data.questionCount} câu hỏi
              {q.data.durationSeconds ? ` · ${q.data.durationSeconds / 60} phút` : ""}
            </p>
            {q.data.opensAt && <p>Mở lúc {dateLabel(q.data.opensAt)} · Asia/Ho_Chi_Minh</p>}
            {q.data.closesAt && <p>Đóng lúc {dateLabel(q.data.closesAt)} · Asia/Ho_Chi_Minh</p>}
            <p>Số lần làm tối đa: {q.data.attemptLimit ?? 1}.</p>
            <p>
              Nếu bạn đang có lần làm bài chưa nộp, hệ thống sẽ mở lại lần đó. Thời gian bắt đầu được tính khi
              bạn bấm nút bên dưới.
            </p>
            <button
              className="button"
              disabled={command.busy}
              onClick={async () => {
                const a = await command.run<Attempt>("/quizzes/" + quizId + "/attempts", "POST");
                if (a) navigate("/app/attempts/" + a.attemptId);
              }}
            >
              Bắt đầu / tiếp tục làm bài
            </button>
            <Status command={command} />
          </section>
        )}
      </State>
    </>
  );
}
export function AttemptPage() {
  const { attemptId = "" } = useParams(),
    query = useStudent<Attempt>("/attempts/" + attemptId),
    command = useCommand(),
    navigate = useNavigate();
  const [active, setActive] = useState<Attempt | null>(null);
  return (
    <>
      <Heading title="Lần làm bài của bạn" />
      <State query={query}>
        {query.data && (
          <>
            {query.data.state === "SUBMITTED" ? (
              <section className="study-card">
                <h2>Bài đã nộp</h2>
                <Link className="button" to={"/app/attempts/" + attemptId + "/result"}>
                  Xem kết quả →
                </Link>
              </section>
            ) : query.data.state === "EXPIRED" ? (
              <Empty>
                Bài kiểm tra đã hết thời gian.{" "}
                <Link to={"/app/assessments/" + query.data.quizId}>Về bài kiểm tra</Link>
              </Empty>
            ) : active ? (
              <AnswerForm
                key={active.attemptId}
                attempt={active}
                onSuccess={() => navigate("/app/attempts/" + active.attemptId + "/result")}
              />
            ) : (
              <section className="study-card">
                <h2>
                  {query.data.state === "CREATED"
                    ? "Lần làm bài đã được tạo"
                    : "Tiếp tục lần làm bài đang diễn ra"}
                </h2>
                {query.data.deadlineAt && (
                  <p>Hạn nộp: {dateLabel(query.data.deadlineAt)} · Asia/Ho_Chi_Minh</p>
                )}
                <p>Câu trả lời chưa nộp không được tự động lưu. Giữ trang này mở trong khi làm bài.</p>
                <button
                  className="button"
                  disabled={command.busy}
                  onClick={async () => {
                    const next = await command.run<Attempt>(
                      "/quizzes/" + query.data!.quizId + "/attempts",
                      "POST",
                    );
                    if (next) {
                      if (next.attemptId !== attemptId) navigate("/app/attempts/" + next.attemptId);
                      else setActive(next);
                    }
                  }}
                >
                  Tải câu hỏi và tiếp tục
                </button>
                <Status command={command} />
              </section>
            )}
          </>
        )}
      </State>
    </>
  );
}
function AnswerForm({ attempt, onSuccess }: { attempt: Attempt; onSuccess: () => void }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({}),
    [confirm, setConfirm] = useState(false),
    [frozen, setFrozen] = useState(false),
    [current, setCurrent] = useState(0),
    command = useCommand();
  const submission = useRef<{
    fingerprint: string;
    payload: { answers: Answer[]; clientSubmittedAt: string };
  } | null>(null);
  const questions = attempt.questions || [];
  const answered = (q: Question) => {
    const a = answers[q.questionId];
    return (
      !!a &&
      ("text" in a ? !!a.text.trim() : "selectedOptionIds" in a ? a.selectedOptionIds.length > 0 : true)
    );
  };
  const answeredCount = questions.filter(answered).length;
  useUnsavedChanges(
    answeredCount > 0 && !frozen,
    "Câu trả lời chưa nộp không được lưu trên máy chủ. Rời trang và bỏ bài đang làm?",
  );
  const changed = (answer: Answer) => {
    setAnswers((v) => ({ ...v, [answer.questionId]: answer }));
  };
  return (
    <section className="study-card study-assessment">
      <h2>Trả lời câu hỏi</h2>
      {attempt.deadlineAt && <AttemptTimer deadline={attempt.deadlineAt} />}
      <p>
        Câu trả lời chưa nộp không được lưu trên máy chủ. Làm mới hoặc đóng trang có thể làm mất nội dung.
      </p>
      <p>
        {answeredCount} / {questions.length} câu đã trả lời.
      </p>
      <nav className="question-nav" aria-label="Đi đến câu hỏi">
        {questions.map((q, i) => (
          <a
            key={q.questionId}
            className={`${answered(q) ? "answered" : "unanswered"} ${current === i ? "current" : ""}`}
            href={"#q-" + q.questionId}
            aria-current={current === i ? "step" : undefined}
            onClick={() => setCurrent(i)}
            aria-label={`Câu ${i + 1}: ${answered(q) ? "đã trả lời" : "chưa trả lời"}`}
          >
            {i + 1}
          </a>
        ))}
      </nav>
      <fieldset disabled={frozen || command.busy} className="answer-fields">
        <legend className="sr-only">Nội dung bài làm</legend>
        {questions.map((q, i) => (
          <fieldset id={"q-" + q.questionId} key={q.questionId} className="study-question">
            <legend>
              {i + 1}. {q.prompt}
            </legend>
            <QuestionInput question={q} answer={answers[q.questionId]} onChange={changed} />
          </fieldset>
        ))}
      </fieldset>
      <button
        className="button"
        disabled={frozen || command.busy || !questions.length}
        onClick={() => setConfirm(true)}
      >
        Nộp bài
      </button>
      {command.message === "Dịch vụ tạm thời không khả dụng. Hãy thử lại." ? (
        <p role="status">
          Chưa thể xác nhận trạng thái nộp bài. Hãy thử lại để kiểm tra và tiếp tục yêu cầu trước.
        </p>
      ) : (
        <Status command={command} />
      )}
      <Dialog
        open={confirm}
        onClose={() => {
          if (!command.busy) setConfirm(false);
        }}
        title="Xác nhận nộp bài"
      >
        <h2>Bạn đã sẵn sàng nộp?</h2>
        <p>
          Đã trả lời: {answeredCount}. Chưa trả lời: {questions.length - answeredCount}. Sau khi nộp thành
          công, bạn không thể sửa câu trả lời.
        </p>
        <button
          className="button"
          disabled={command.busy}
          onClick={async () => {
            const list = Object.values(answers),
              fingerprint = JSON.stringify(list);
            if (submission.current?.fingerprint !== fingerprint)
              submission.current = {
                fingerprint,
                payload: { answers: list, clientSubmittedAt: new Date().toISOString() },
              };
            const result = await command.run<Result>(
              "/attempts/" + attempt.attemptId + "/submit",
              "POST",
              submission.current.payload,
            );
            if (result) {
              setFrozen(true);
              setConfirm(false);
              onSuccess();
            }
          }}
        >
          Xác nhận nộp bài
        </button>
        <button className="button secondary" disabled={command.busy} onClick={() => setConfirm(false)}>
          Tiếp tục kiểm tra
        </button>
        {command.message === "Dịch vụ tạm thời không khả dụng. Hãy thử lại." ? (
          <p role="status">
            Chưa thể xác nhận trạng thái nộp bài. Hãy thử lại để kiểm tra và tiếp tục yêu cầu trước.
          </p>
        ) : (
          <Status command={command} />
        )}
      </Dialog>
    </section>
  );
}
function AttemptTimer({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now()),
      timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const left = Math.max(0, Date.parse(deadline) - now),
    seconds = Math.floor(left / 1000),
    hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    rest = seconds % 60;
  return (
    <p className="attempt-timer" role="timer">
      <strong>
        Thời gian còn lại: {hours ? `${hours}:` : ""}
        {String(minutes).padStart(2, "0")}:{String(rest).padStart(2, "0")}
      </strong>
      <br />
      <span>Hạn nộp theo máy chủ: {dateLabel(deadline)} · Asia/Ho_Chi_Minh</span>
      {left === 0 && (
        <>
          <br />
          <span>Đồng hồ đã về 0. Hệ thống sẽ xác nhận trạng thái khi bạn thực hiện thao tác tiếp theo.</span>
        </>
      )}
    </p>
  );
}
function QuestionInput({
  question: q,
  answer: a,
  onChange,
}: {
  question: Question;
  answer?: Answer;
  onChange: (a: Answer) => void;
}) {
  if (q.questionType === "SHORT_ANSWER")
    return (
      <label>
        Câu trả lời ngắn
        <input
          maxLength={500}
          value={a && "text" in a ? a.text : ""}
          onChange={(e) => onChange({ questionId: q.questionId, text: e.target.value })}
        />
      </label>
    );
  if (q.questionType === "TRUE_FALSE")
    return (
      <>
        {[true, false].map((v) => (
          <label className="answer-option" key={String(v)}>
            <input
              type="radio"
              name={q.questionId}
              checked={!!a && "value" in a && a.value === v}
              onChange={() => onChange({ questionId: q.questionId, value: v })}
            />
            {v ? "Đúng" : "Sai"}
          </label>
        ))}
      </>
    );
  return (
    <>
      {q.options?.map((option) => (
        <label className="answer-option" key={option}>
          <input
            type={q.questionType === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
            name={q.questionId}
            checked={
              q.questionType === "MULTIPLE_CHOICE"
                ? !!a && "selectedOptionIds" in a && a.selectedOptionIds.includes(option)
                : !!a && "selectedOptionId" in a && a.selectedOptionId === option
            }
            onChange={(e) => {
              if (q.questionType === "MULTIPLE_CHOICE") {
                const previous = a && "selectedOptionIds" in a ? a.selectedOptionIds : [];
                onChange({
                  questionId: q.questionId,
                  selectedOptionIds: e.target.checked
                    ? [...previous, option]
                    : previous.filter((v) => v !== option),
                });
              } else onChange({ questionId: q.questionId, selectedOptionId: option });
            }}
          />
          {option}
        </label>
      ))}
    </>
  );
}
export function ResultPage() {
  const { attemptId = "" } = useParams(),
    q = useStudent<Result>("/attempts/" + attemptId + "/result");
  return (
    <>
      <Heading title="Kết quả bài kiểm tra" />
      <State query={q}>
        {q.data && (
          <section className="study-welcome">
            <p className="eyebrow">ĐIỂM CỦA BẠN</p>
            <h2>
              {q.data.score} / {q.data.maxScore}
            </h2>
            <p>Đã nộp lúc {dateLabel(q.data.submittedAt)} · Asia/Ho_Chi_Minh</p>
            <p>Hãy dành thời gian ôn lại những phần bạn còn chưa chắc chắn.</p>
            <Link className="button" to="/app/learn">
              Trở lại học tập →
            </Link>
          </section>
        )}
      </State>
    </>
  );
}
