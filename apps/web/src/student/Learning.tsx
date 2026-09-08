import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../auth/session";
import { normalizeQuery } from "../lib/api";
import {
  useStudent,
  useCommand,
  safeContentUrl,
  monthNow,
  type LearningCourse,
  type Lesson,
  type Progress,
  type ClassItem,
  type Notices,
} from "./api";
import { Heading, State, Empty, ProgressView, Status, NextPage } from "./ui";
import Discussion from "./Discussion";
export function StudentHome() {
  const { profile } = useSession();
  const courses = useStudent<LearningCourse[]>("/me/courses"),
    classes = useStudent<ClassItem[]>("/me/classes"),
    notices = useStudent<Notices>("/notifications?month=" + monthNow() + "&limit=3");
  return (
    <>
      <Heading title={`Xin chào, ${profile?.displayName}.`}>
        Dành một chút thời gian cho điều bạn muốn hiểu sâu hơn.
      </Heading>
      <div className="study-welcome">
        <p className="eyebrow">TIẾP TỤC HÀNH TRÌNH</p>
        <h2>Học từng bài. Tiến từng bước.</h2>
        <State query={courses}>
          {courses.data?.length ? (
            <>
              <h3>{courses.data[0].title}</h3>
              <Link className="button" to={"/app/learn/" + courses.data[0].courseId}>
                Mở khóa học →
              </Link>
            </>
          ) : (
            <>
              <p>Bạn chưa có khóa học nào trong danh sách học tập.</p>
              <Link className="button" to="/app/learn">
                Tìm khóa học phù hợp →
              </Link>
            </>
          )}
        </State>
      </div>
      <div className="study-grid">
        <section className="study-card">
          <h2>Lớp học của tôi</h2>
          <State query={classes}>
            {classes.data?.length ? (
              classes.data.slice(0, 3).map((c) => (
                <p key={c.classId}>
                  <Link to={"/app/classes/" + c.classId}>{c.name} →</Link>
                </p>
              ))
            ) : (
              <p>Bạn chưa tham gia lớp nào.</p>
            )}
          </State>
          <Link to="/app/classes">Xem lớp học</Link>
        </section>
        <section className="study-card">
          <h2>Thông báo tháng này</h2>
          <State query={notices}>
            {notices.data?.items.length ? (
              notices.data.items.map((n) => <p key={n.notificationId}>{n.title}</p>)
            ) : (
              <p>Chưa có thông báo trong tháng này.</p>
            )}
          </State>
          <Link to="/app/notifications">Mở thông báo →</Link>
        </section>
      </div>
    </>
  );
}
export function Learn() {
  const own = useStudent<LearningCourse[]>("/me/courses");
  const [text, setText] = useState(""),
    [q, setQ] = useState(""),
    [cursor, setCursor] = useState("");
  const search = useStudent<LearningCourse[]>(
    q ? "/courses/search?" + new URLSearchParams({ q, limit: "12", ...(cursor ? { cursor } : {}) }) : null,
  );
  return (
    <>
      <Heading title="Học tập">Khóa học của bạn và những chủ đề muốn khám phá tiếp.</Heading>
      <section className="study-card">
        <h2>Khóa học của tôi</h2>
        <State query={own}>
          {own.data?.length ? (
            <CourseCards items={own.data} />
          ) : (
            <Empty>Chưa có khóa học. Hãy tìm một chủ đề bên dưới để bắt đầu.</Empty>
          )}
        </State>
      </section>
      <section className="study-card">
        <h2>Khám phá khóa học</h2>
        <form
          className="study-search"
          onSubmit={(e) => {
            e.preventDefault();
            setCursor("");
            setQ(normalizeQuery(text).slice(0, 20));
          }}
        >
          <label>
            Từ khóa
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ví dụ: python"
              minLength={3}
              maxLength={80}
              required
            />
          </label>
          <button className="button" disabled={normalizeQuery(text).length < 3}>
            Tìm kiếm
          </button>
        </form>
        {q && (
          <>
            <State query={search}>
              {search.data?.length ? (
                <CourseCards items={search.data} />
              ) : (
                <Empty>Chưa tìm thấy khóa học phù hợp. Thử một từ khóa khác.</Empty>
              )}
            </State>
            <NextPage
              cursor={search.meta?.pagination?.nextCursor}
              onNext={setCursor}
              onReset={() => {
                setCursor("");
                search.retry();
              }}
            />
          </>
        )}
      </section>
    </>
  );
}
function CourseCards({ items }: { items: LearningCourse[] }) {
  return (
    <div className="study-grid">
      {items.map((c) => (
        <article className="study-course" key={c.courseId}>
          <div className="study-course-art" aria-hidden="true">
            ↗
          </div>
          <h3>{c.title}</h3>
          {c.priceType === "FREE" && <p>Miễn phí</p>}
          <Link to={(c.priceType === "PAID" ? "/app/purchase/" : "/app/learn/") + c.courseId}>
            {c.priceType === "PAID" ? "Đăng ký có phí →" : "Mở khóa học →"}
          </Link>
        </article>
      ))}
    </div>
  );
}
export function CourseLearning() {
  const { courseId = "", lessonId } = useParams();
  const course = useStudent<LearningCourse>("/courses/" + courseId),
    lessons = useStudent<Lesson[]>("/courses/" + courseId + "/lessons"),
    progress = useStudent<Progress>("/courses/" + courseId + "/progress");
  const command = useCommand();
  return (
    <>
      <Link to="/app/learn">← Học tập</Link>
      <Heading title={course.data?.title || "Khóa học của bạn"} />
      <State query={course}>
        {course.data && (
          <>
            <div className="study-grid">
              <section className="study-card">
                <h2>Tiến độ học tập</h2>
                <State query={progress}>{progress.data && <ProgressView value={progress.data} />}</State>
                {!progress.data && course.data.priceType === "FREE" && (
                  <>
                    <button
                      className="button"
                      disabled={command.busy}
                      onClick={async () => {
                        if (await command.run("/courses/" + courseId + "/enrollments", "POST"))
                          progress.retry();
                      }}
                    >
                      Đăng ký học miễn phí
                    </button>
                    <Status command={command} />
                  </>
                )}
                {!progress.data && course.data.priceType === "PAID" && (
                  <Link className="button" to={"/app/purchase/" + courseId}>
                    Đăng ký khóa học có phí →
                  </Link>
                )}
                <Link to="/app/progress">Xem tiến độ</Link>
              </section>
              <section className="study-card">
                <h2>Kiểm tra kiến thức</h2>
                <p>Chọn bài kiểm tra của khóa học khi bạn đã sẵn sàng.</p>
                <Link to={"/app/assessments?course=" + courseId}>Xem bài kiểm tra →</Link>
              </section>
            </div>
            <div className="study-layout">
              <aside className="study-card">
                <details open>
                  <summary>Nội dung khóa học</summary>
                  <State query={lessons}>
                    {lessons.data?.length ? (
                      <ol className="lesson-nav">
                        {lessons.data.map((l) => (
                          <li key={l.lessonId}>
                            <Link
                              aria-current={l.lessonId === lessonId ? "page" : undefined}
                              to={`/app/learn/${courseId}/lessons/${l.lessonId}`}
                            >
                              {l.title}
                            </Link>
                            {l.preview && <small>Học thử</small>}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <Empty>Khóa học chưa có bài học.</Empty>
                    )}
                  </State>
                </details>
              </aside>
              <section className="study-card">
                {lessonId ? (
                  <LessonView
                    key={lessonId}
                    lessonId={lessonId}
                    courseId={courseId}
                    refresh={progress.retry}
                  />
                ) : (
                  <>
                    <h2>Chọn bài học để bắt đầu</h2>
                    <p>Nội dung và quyền truy cập được kiểm tra mỗi khi bạn mở bài.</p>
                    {lessons.data?.[0] && (
                      <Link
                        className="button"
                        to={`/app/learn/${courseId}/lessons/${lessons.data[0].lessonId}`}
                      >
                        Mở bài đầu tiên →
                      </Link>
                    )}
                  </>
                )}
              </section>
            </div>
            <Discussion
              type="COURSE"
              id={courseId}
              canWrite={!!progress.data}
              canReview={!!progress.data && progress.data.percent >= 20}
            />
          </>
        )}
      </State>
    </>
  );
}
function LessonView({
  lessonId,
  courseId,
  refresh,
}: {
  lessonId: string;
  courseId: string;
  refresh: () => void;
}) {
  const lesson = useStudent<Lesson>("/lessons/" + lessonId),
    command = useCommand();
  const [saved, setSaved] = useState<boolean | null>(null);
  const url = safeContentUrl(lesson.data?.contentUrl);
  return (
    <State query={lesson}>
      {lesson.data && lesson.data.courseId !== courseId ? (
        <Empty>Bài học không thuộc khóa học này.</Empty>
      ) : (
        lesson.data && (
          <>
            <p className="eyebrow">BÀI HỌC</p>
            <h2>{lesson.data.title}</h2>
            {url ? (
              <>
                <p>Mở tài liệu bài học để đọc và thực hành theo hướng dẫn.</p>
                <a
                  className="button secondary"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  Mở tài liệu bài học ↗
                </a>
                <p className="muted">Liên kết có thời hạn. Nếu không mở được, hãy tải lại bài học.</p>
                <button className="plain-button" onClick={lesson.retry}>
                  Tải lại liên kết
                </button>
              </>
            ) : (
              <Empty>Bài học chưa có tài liệu đính kèm.</Empty>
            )}
            <div className="study-completion">
              <h3>Ghi nhận việc học</h3>
              <p>Đánh dấu khi bạn đã đọc và thực hành xong bài này.</p>
              <div className="inline-actions">
                {[true, false].map((completed) => (
                  <button
                    className={completed ? "button" : "button secondary"}
                    key={String(completed)}
                    disabled={command.busy}
                    onClick={async () => {
                      const result = await command.run<Progress>(
                        "/lessons/" + lessonId + "/completion",
                        "PUT",
                        { completed },
                      );
                      if (result) {
                        setSaved(completed);
                        refresh();
                      }
                    }}
                  >
                    {completed ? "Đánh dấu đã hoàn thành" : "Đánh dấu chưa hoàn thành"}
                  </button>
                ))}
              </div>
              {saved !== null && (
                <p role="status">
                  {saved ? "Đã lưu hoàn thành bài này." : "Đã lưu bài này chưa hoàn thành."}
                </p>
              )}
              <Status command={command} />
            </div>
          </>
        )
      )}
    </State>
  );
}
export function ProgressPage() {
  const own = useStudent<LearningCourse[]>("/me/courses"),
    [id, setId] = useState("");
  return (
    <>
      <Heading title="Tiến độ của tôi">Theo dõi phần đã hoàn thành và chọn bước học tiếp theo.</Heading>
      <State query={own}>
        {own.data?.length ? (
          <>
            <label>
              Chọn khóa học
              <select value={id} onChange={(e) => setId(e.target.value)}>
                <option value="">Chọn một khóa học</option>
                {own.data.map((c) => (
                  <option key={c.courseId} value={c.courseId}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            {id && <CourseProgress key={id} id={id} />}
          </>
        ) : (
          <Empty>
            Chưa có khóa học để theo dõi. <Link to="/app/learn">Khám phá khóa học →</Link>
          </Empty>
        )}
      </State>
    </>
  );
}
function CourseProgress({ id }: { id: string }) {
  const query = useStudent<Progress>("/courses/" + id + "/progress");
  return (
    <section className="study-card">
      <State query={query}>{query.data && <ProgressView value={query.data} />}</State>
      <Link className="button" to={"/app/learn/" + id}>
        Tiếp tục học →
      </Link>
    </section>
  );
}
