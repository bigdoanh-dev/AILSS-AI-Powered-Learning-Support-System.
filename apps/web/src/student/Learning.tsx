import { CourseArtwork } from "../components/CourseArtwork";
import { CourseSearch } from "../pages/Courses";
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
  const first = courses.data?.[0];
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <h1>Chào {profile?.displayName}, hôm nay học gì?</h1>
          <p>Tiếp tục hành trình học tập và khám phá những điều mới mỗi ngày.</p>
        </div>
        <Link className="button secondary small" to="/app/learn">
          Khóa học của tôi
        </Link>
      </div>
      <div className="student-dashboard">
        <div className="dashboard-primary">
          <State query={courses}>
            <article className="continue-course">
              <CourseArtwork title={first?.title || "Cơ sở dữ liệu"} eager />
              <div className="continue-course-content">
                <small>{first ? "Tiếp tục học" : "Bắt đầu hành trình"}</small>
                <h2>{first?.title || "Học từng bài. Tiến từng bước."}</h2>
                <p>
                  {first
                    ? "Bài giảng, học liệu và bài luyện tập của bạn."
                    : "Tìm một khóa học phù hợp để bắt đầu."}
                </p>
                <Link className="button" to={first ? "/app/learn/" + first.courseId : "/courses"}>
                  {first ? "Tiếp tục học" : "Khám phá khóa học"}
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </article>
          </State>
          <section className="discovery-section">
            <h2>Khám phá điều mới</h2>
            <CourseSearch compact />
          </section>
        </div>
        <aside className="dashboard-aside">
          <section>
            <div className="section-title">
              <h2>Lớp học của tôi</h2>
              <Link to="/app/classes">Xem tất cả</Link>
            </div>
            <State query={classes}>
              {classes.data?.length ? (
                classes.data.slice(0, 4).map((c) => (
                  <Link className="upcoming-class" key={c.classId} to={"/app/classes/" + c.classId}>
                    <span className="class-symbol" aria-hidden="true">
                      ▤
                    </span>
                    <span>
                      <strong>{c.name}</strong>
                      <small>Xem lịch và bài học</small>
                    </span>
                    <span aria-hidden="true">›</span>
                  </Link>
                ))
              ) : (
                <p>Chưa có lớp học. Bạn có thể tham gia bằng mã từ giảng viên.</p>
              )}
            </State>
          </section>
          <section>
            <div className="section-title">
              <h2>Cập nhật mới</h2>
              <Link to="/app/notifications">Thông báo</Link>
            </div>
            <State query={notices}>
              {notices.data?.items.length ? (
                notices.data.items.map((n) => (
                  <div className="notification-preview" key={n.notificationId}>
                    <span className="status-dot" />
                    <strong>{n.title}</strong>
                    <p>{n.body}</p>
                  </div>
                ))
              ) : (
                <p>Bạn đã xem hết thông báo. Những cập nhật mới sẽ xuất hiện tại đây.</p>
              )}
            </State>
          </section>
          <Link className="profile-prompt" to="/app/account">
            <span aria-hidden="true">◉</span>
            <div>
              <strong>Hồ sơ của bạn</strong>
              <p>Cập nhật thông tin và ảnh đại diện.</p>
            </div>
            <span aria-hidden="true">›</span>
          </Link>
        </aside>
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
          <CourseArtwork title={c.title} />
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
  const [lessonSearch, setLessonSearch] = useState("");
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
                      <div className="lesson-chapters">
                        <label>
                          Tìm bài trong khóa học
                          <input
                            type="search"
                            value={lessonSearch}
                            onChange={(e) => setLessonSearch(e.target.value)}
                            placeholder="Tên bài hoặc chương"
                          />
                        </label>
                        <small>{lessons.data.length} bài giảng</small>
                        {[...new Set(lessons.data.map((l) => l.sectionTitle || "Bài giảng"))].map(
                          (section, index) => {
                            const group = lessons.data!.filter(
                              (l) =>
                                (l.sectionTitle || "Bài giảng") === section &&
                                (!lessonSearch ||
                                  (l.title + " " + section)
                                    .toLocaleLowerCase("vi")
                                    .includes(lessonSearch.toLocaleLowerCase("vi"))),
                            );
                            if (!group.length) return null;
                            return (
                              <details
                                key={section}
                                open={
                                  !!lessonSearch || index === 0 || group.some((l) => l.lessonId === lessonId)
                                }
                              >
                                <summary>
                                  {section} <small>({group.length})</small>
                                </summary>
                                <ol className="lesson-nav">
                                  {group.map((l) => (
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
                              </details>
                            );
                          },
                        )}
                      </div>
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
                    <p>Mỗi bài học gồm nội dung giảng dạy hoặc tài liệu để bạn thực hành.</p>
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
  const url = safeContentUrl(
    lesson.data?.contentUrl?.startsWith("/web-session/library/")
      ? new URL(lesson.data.contentUrl, window.location.origin).href
      : lesson.data?.contentUrl,
  );
  return (
    <State query={lesson}>
      {lesson.data && lesson.data.courseId !== courseId ? (
        <Empty>Bài học không thuộc khóa học này.</Empty>
      ) : (
        lesson.data && (
          <>
            <p className="eyebrow">BÀI HỌC</p>
            <h2>{lesson.data.title}</h2>
            {lesson.data.externalVideo &&
            /^https:\/\/(drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/preview|www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+)$/.test(
              lesson.data.externalVideo,
            ) ? (
              <div className="lesson-media">
                <iframe
                  className="lesson-document"
                  src={lesson.data.externalVideo}
                  title={lesson.data.title}
                  allow="fullscreen"
                  allowFullScreen
                />
                <p>
                  Video do giảng viên cung cấp. Nếu Google Drive yêu cầu quyền truy cập, mở video và đăng nhập
                  tài khoản được chia sẻ.
                </p>
                <a
                  className="button secondary"
                  href={lesson.data.externalVideo.replace("/preview", "/view")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Mở video gốc
                </a>
              </div>
            ) : url ? (
              <>
                {lesson.data.contentType?.startsWith("video/") ? (
                  <div className="lesson-media">
                    <video controls playsInline preload="metadata" src={url} aria-label={lesson.data.title}>
                      <p>Trình duyệt chưa hỗ trợ phát video. Hãy mở liên kết bài học bên dưới.</p>
                    </video>
                    <p>Dùng nút phát để bắt đầu. Bạn có thể tua và điều chỉnh tốc độ học.</p>
                  </div>
                ) : lesson.data.contentType === "application/pdf" ? (
                  <iframe className="lesson-document" src={url} title={lesson.data.title} />
                ) : (
                  <p>Mở tài liệu bài học để đọc và thực hành theo hướng dẫn.</p>
                )}
                <a
                  className="button secondary"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  Mở bài giảng trong tab mới ↗
                </a>
                <p className="muted">Nếu không mở được nội dung, hãy tải lại bài học.</p>
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
