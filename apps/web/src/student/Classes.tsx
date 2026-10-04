import { useUiText, useLanguage } from "../lib/i18n";
import { OperationResult } from "../components/OperationResult";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useStudent,
  useCommand,
  monthNow,
  rangeForMonth,
  dateLabel,
  safeContentUrl,
  type ClassItem,
  type SessionItem,
} from "./api";
import { Heading, State, Empty, Status } from "./ui";
import Discussion from "./Discussion";
import { ScheduleTime, StateChip } from "../components/product";
import { Icon } from "../components/Icon";
import { CourseArtwork } from "../components/CourseArtwork";
import { useClassAssignedQuizzes } from "./overview";

function formatDeadline(isoDate: string | undefined, uiText: ReturnType<typeof useUiText>, locale: string) {
  if (!isoDate) return uiText("Không có hạn nộp");
  try {
    const d = new Date(isoDate);
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow =
      d.getDate() === tomorrow.getDate() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getFullYear() === tomorrow.getFullYear();
    const timeStr = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
    if (isToday) return uiText("Hôm nay, {0}", [timeStr]);
    if (isTomorrow) return uiText("Ngày mai, {0}", [timeStr]);
    return dateLabel(isoDate, undefined, locale);
  } catch {
    return dateLabel(isoDate, undefined, locale);
  }
}

function formatDueLabel(isoDate?: string) {
  if (!isoDate) return "sắp tới";
  try {
    const d = new Date(isoDate);
    const now = new Date();
    if (
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    ) {
      return "hôm nay";
    }
    return "sắp tới";
  } catch {
    return "sắp tới";
  }
}

export function Classes() {
  const uiText = useUiText();
  const { locale } = useLanguage();
  const query = useStudent<ClassItem[]>("/me/classes"),
    [code, setCode] = useState(""),
    [showJoinForm, setShowJoinForm] = useState(false),
    navigate = useNavigate();
  const classQuizzesQuery = useClassAssignedQuizzes();
  const command = useCommand();

  const classQuizzes = classQuizzesQuery.data ?? [];
  const sortedClassQuizzes = [...classQuizzes].sort((a, b) => {
    if (!a.closesAt) return 1;
    if (!b.closesAt) return -1;
    return new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime();
  });

  if (command.outcome === "failure")
    return (
      <OperationResult
        success={false}
        title={uiText("Chưa thể tham gia lớp")}
        onComplete={command.clear}
        action={
          <button className="button" onClick={command.clear}>
            {uiText("Kiểm tra lại mã lớp")}
          </button>
        }
      >
        <p>{uiText(command.message)}</p>
      </OperationResult>
    );
  return (
    <>
      <Heading title={uiText("Lớp học của tôi")}>
        {uiText("Theo dõi lịch học, bài tập trên lớp và kết nối với giảng viên.")}
      </Heading>

      {/* Sắp đến hạn / Việc cần phải làm - CHỈ BÀI TẬP THUỘC LỚP HỌC */}
      <section className="class-todo-card animate-fade-in" aria-label={uiText("Bài tập lớp học sắp đến hạn")}>
        <div className="class-todo-header">
          <div className="class-todo-header-left">
            <div className="class-todo-icon-wrap">
              <Icon name="quiz" size={22} />
            </div>
            <div>
              <h2>{uiText("Sắp đến hạn")}</h2>
              <p className="subtext">
                {uiText("Việc cần làm và bài tập được giao trực tiếp trong các lớp học bạn đang tham gia.")}
              </p>
            </div>
          </div>
          <Link
            to="/app/assessments"
            className="class-todo-view-all-link"
            title={uiText("Xem tất cả bài tập")}
          >
            <span>{uiText("Xem việc cần làm")}</span>
            <Icon name="chevronRight" size={14} />
          </Link>
        </div>

        {classQuizzesQuery.pending ? (
          <div className="class-todo-loading" role="status">
            <Icon name="refresh" size={18} className="spin-animation" />
            <span>{uiText("Đang kiểm tra danh sách bài tập lớp học…")}</span>
          </div>
        ) : sortedClassQuizzes.length > 0 ? (
          <div className="class-todo-list">
            {sortedClassQuizzes.slice(0, 5).map((q) => {
              const deadlineText = formatDeadline(q.closesAt, uiText, locale);
              const isUrgent =
                q.closesAt &&
                new Date(q.closesAt).getTime() - Date.now() < 24 * 3600 * 1000 &&
                new Date(q.closesAt).getTime() > Date.now();
              return (
                <div key={q.quizId} className={`class-todo-item ${isUrgent ? "is-urgent" : ""}`}>
                  <div className="class-todo-item-main">
                    <div className="class-todo-doc-icon" aria-hidden="true">
                      <Icon name="quiz" size={20} />
                    </div>
                    <div className="class-todo-info">
                      <Link to={`/app/assessments/${q.quizId}`} className="class-todo-title">
                        {q.title}
                      </Link>
                      <div className="class-todo-meta">
                        <span className="class-todo-label">{uiText("Lớp học:")}</span>
                        <Link to={`/app/classes/${q.targetId}`} className="class-todo-class-link">
                          {q.targetTitle}
                        </Link>
                        {q.questionCount ? (
                          <>
                            <span className="class-todo-dot">•</span>
                            <span className="class-todo-count">
                              {q.questionCount} {uiText(" câu hỏi")}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="class-todo-item-right">
                    <div className="class-todo-due-col">
                      <span className="class-todo-due-caption">{uiText("Hạn nộp")}</span>
                      <span className={`class-todo-due-date ${isUrgent ? "urgent-text" : ""}`}>
                        {deadlineText}
                      </span>
                    </div>
                    <Link
                      to={`/app/assessments/${q.quizId}`}
                      className="button button-small class-todo-action-btn"
                    >
                      {uiText("Làm bài →")}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="class-todo-empty">
            <div className="class-todo-empty-icon">
              <Icon name="checkCircle" size={26} />
            </div>
            <div>
              <strong>{uiText("Không có bài tập nào cần nộp")}</strong>
              <p>
                {uiText("Hiện không có bài kiểm tra hoặc bài tập nào sắp đến hạn trong các lớp học của bạn.")}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Class Section Header with "+ Thêm lớp học" button */}
      <div className="class-hub-header">
        <div>
          <p className="eyebrow">{uiText("DANH SÁCH LỚP")}</p>
          <h2>{uiText("Lớp học")}</h2>
        </div>
        <button
          type="button"
          className="button button-small class-join-toggle-btn"
          onClick={() => setShowJoinForm((v) => !v)}
        >
          <Icon name={showJoinForm ? "checkCircle" : "plus"} size={14} />
          <span>{showJoinForm ? uiText("Ẩn khung tham gia") : uiText("+ Thêm lớp học")}</span>
        </button>
      </div>

      {/* Join Class Form (Accessible or expanded via + Thêm lớp học) */}
      {(showJoinForm || !query.data?.length) && (
        <section className="study-card class-join-card animate-fade-in">
          <div className="class-join-header">
            <div className="class-join-icon">
              <Icon name="class" size={20} />
            </div>
            <div>
              <h3>{uiText("Tham gia lớp học mới")}</h3>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: "13px" }}>
                {uiText("Nhập mã tham gia 6 ký tự do giảng viên cung cấp để tự động ghi danh vào lớp học.")}
              </p>
            </div>
          </div>
          <form
            className="study-search"
            style={{ marginTop: "14px" }}
            onSubmit={async (e) => {
              e.preventDefault();
              const joined = await command.run<{ classId: string }>("/classes/join", "POST", {
                code: code.trim().toUpperCase(),
              });
              if (joined) {
                setCode("");
                query.retry();
                navigate("/app/result", {
                  state: {
                    success: true,
                    title: uiText("Tham gia lớp thành công"),
                    message: "Bạn đã được thêm vào lớp. Lịch học và thông báo đã sẵn sàng.",
                    to: "/app/classes/" + joined.classId,
                    label: uiText("Vào lớp học"),
                  },
                });
              }
            }}
          >
            <label>
              {uiText("Mã tham gia")}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="VD: K26A2B"
                required
                minLength={6}
                maxLength={32}
                autoComplete="off"
              />
            </label>
            <button className="button" disabled={command.busy}>
              {uiText("Tham gia lớp →")}
            </button>
          </form>
          <Status command={command} />
        </section>
      )}

      {/* Classes Grid */}
      <State query={query}>
        {query.data?.length ? (
          <div className="study-grid">
            {query.data.map((c) => {
              const classPendingQuizzes = classQuizzes.filter((q) => q.targetId === c.classId);
              const firstDueQuiz = classPendingQuizzes[0];
              return (
                <article
                  className="study-card study-card-rich learning-card class-learning-card"
                  key={c.classId}
                >
                  <div className="learning-card-media">
                    <CourseArtwork title={c.name} />
                    <span className="learning-card-type">
                      <Icon name="class" size={14} /> {uiText(" Lớp học")}
                    </span>
                  </div>
                  <div className="learning-card-content">
                    <div className="learning-card-heading-row">
                      <span className="course-category-chip">{uiText("Lớp theo lịch")}</span>
                      <StateChip state={c.state} />
                    </div>
                    <h2>{c.name}</h2>
                    <p className="learning-card-meta">
                      <Icon name="calendar" size={14} /> {uiText(" Lịch học trực tiếp")}
                      <span>•</span>
                      <Icon name="attendance" size={14} /> {uiText(" Có điểm danh")}
                    </p>

                    {/* Due Assignment Snippet (if class has active tasks) */}
                    {firstDueQuiz ? (
                      <div className="class-card-due-snippet">
                        <div className="due-snippet-header">
                          <Icon name="alert" size={13} />
                          <span className="due-snippet-label">
                            {uiText("Đến hạn ")}
                            {uiText(formatDueLabel(firstDueQuiz.closesAt))}
                          </span>
                        </div>
                        <Link
                          to={`/app/assessments/${firstDueQuiz.quizId}`}
                          className="due-snippet-title"
                          title={firstDueQuiz.title}
                        >
                          {firstDueQuiz.title}
                        </Link>
                      </div>
                    ) : (
                      <ul className="course-benefits" aria-label={uiText("Tiện ích lớp học")}>
                        <li>{uiText("✓ Thảo luận cùng giảng viên")}</li>
                        <li>{uiText("✓ Bài tập & tài liệu lớp")}</li>
                        <li>{uiText("✓ Theo dõi chuyên cần")}</li>
                      </ul>
                    )}

                    <div className="course-card-divider" />
                    <div className="course-card-actions">
                      <Link className="learning-card-button secondary" to="/app/schedule">
                        <Icon name="calendar" size={15} /> {uiText(" Xem lịch")}
                      </Link>
                      <Link className="learning-card-button primary" to={"/app/classes/" + c.classId}>
                        <Icon name="class" size={15} /> {uiText(" Vào lớp học")}
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty>{uiText("Bạn chưa có lớp học. Nhập mã được giảng viên cung cấp để tham gia.")}</Empty>
        )}
      </State>
      <div className="inline-actions" style={{ marginTop: "24px" }}>
        <Link className="button secondary" to="/app/schedule">
          {uiText("📅 Xem lịch học")}
        </Link>
        <Link className="button secondary" to="/app/attendance">
          {uiText("📋 Bảng điểm danh")}
        </Link>
      </div>
    </>
  );
}
export function ClassDetail() {
  const uiText = useUiText();
  const { classId = "" } = useParams();
  const query = useStudent<ClassItem>(`/classes/${classId}`);
  const [month, setMonth] = useState(monthNow());
  return (
    <div className="class-detail-page-container">
      <div style={{ marginBottom: 12 }}>
        <Link className="button button-subtle button-small" to="/app/classes">
          {uiText("← Lớp học của tôi")}
        </Link>
      </div>

      <State query={query}>
        {query.data && (
          <>
            {/* Hero Class Card */}
            <div className="class-hero-card">
              <div className="class-hero-accent-stripe" />
              <div className="class-hero-body">
                <div className="class-hero-icon-box">
                  <Icon name="class" size={28} />
                </div>
                <div className="class-hero-content">
                  <div className="class-badge-row">
                    <span className="badge">{uiText("Lớp học trực tiếp")}</span>
                    <span className="green-badge-pill">{uiText("● Đang hoạt động")}</span>
                    <span className="class-meta-chip">
                      <Icon name="users" size={13} />
                      <span>{query.data.scheduleState || "Lịch học định kỳ"}</span>
                    </span>
                  </div>
                  <h1 className="class-hero-title">{query.data.name}</h1>
                  <p className="class-hero-desc">
                    {uiText(
                      "Không gian học tập tương tác, cập nhật lịch trình các buổi học, thông báo từ giảng viên và bài kiểm tra định kỳ.",
                    )}
                  </p>
                </div>
              </div>

              {/* Class Quick Actions */}
              <div className="class-hero-actions-bar">
                {query.data.linkedCourseId && (
                  <Link className="button" to={`/app/learn/${query.data.linkedCourseId}`}>
                    <Icon name="book" size={15} />
                    <span>{uiText("Xem giáo trình khóa học →")}</span>
                  </Link>
                )}
                <Link className="button button-subtle" to={`/app/assessments?target=CLASS/${classId}`}>
                  <Icon name="quiz" size={15} />
                  <span>{uiText("Bài kiểm tra của lớp")}</span>
                </Link>
              </div>
            </div>

            {/* Month Filter Toolbar */}
            <div className="class-month-toolbar">
              <div className="class-month-label">
                <Icon name="calendar" size={16} />
                <span>{uiText("Chọn tháng học:")}</span>
              </div>
              <input
                className="class-month-input"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                aria-label={uiText("Tháng học")}
              />
            </div>

            <ClassContent id={classId} month={month} />

            <div className="dashboard-section-card" style={{ marginTop: 24 }}>
              <div className="section-card-header">
                <div>
                  <p className="eyebrow">{uiText("TRAO ĐỔI & HỎI ĐÁP")}</p>
                  <h2>{uiText("Thảo luận lớp học")}</h2>
                </div>
                <span className="kpi-tag">{uiText("Cộng đồng lớp")}</span>
              </div>
              <Discussion type="CLASS" id={classId} canWrite />
            </div>
          </>
        )}
      </State>
    </div>
  );
}

function ClassContent({ id, month }: { id: string; month: string }) {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const q = useStudent<SessionItem[]>(
    "/classes/" + id + "/sessions?" + new URLSearchParams(rangeForMonth(month)),
  );
  const a = useStudent<{ announcementId: string; title: string; body: string; createdAt: string }[]>(
    "/classes/" + id + "/announcements?month=" + month + "-01",
  );
  return (
    <>
      <section className="dashboard-section-card" style={{ marginTop: 20 }}>
        <div className="section-card-header">
          <div>
            <p className="eyebrow">{uiText("LỊCH TRÌNH")}</p>
            <h2>{uiText("Các buổi học trong tháng")}</h2>
          </div>
          <span className="kpi-tag accent">
            {q.data?.length ?? 0} {uiText(" buổi học")}
          </span>
        </div>
        <State query={q}>
          {q.data?.length ? (
            <Sessions items={q.data} />
          ) : (
            <div className="class-empty-notice-box">
              <div className="class-empty-icon-circle">
                <Icon name="calendar" size={26} />
              </div>
              <h3>{uiText("Chưa có buổi học trong tháng này")}</h3>
              <p>
                {uiText(
                  "Giảng viên sẽ sớm công bố lịch trình chi tiết và link tham gia buổi học trực tuyến.",
                )}
              </p>
            </div>
          )}
        </State>
      </section>

      <section className="dashboard-section-card" style={{ marginTop: 20 }}>
        <div className="section-card-header">
          <div>
            <p className="eyebrow">{uiText("BẢNG TIN")}</p>
            <h2>{uiText("Thông báo của lớp")}</h2>
          </div>
          <span className="kpi-tag">
            {a.data?.length ?? 0} {uiText(" thông báo")}
          </span>
        </div>
        <State query={a}>
          {a.data?.length ? (
            <div className="class-announcements-list">
              {a.data.map((v) => (
                <article key={v.announcementId} className="class-announcement-card">
                  <div className="class-announcement-header">
                    <Icon name="bell" size={16} />
                    <h3>{v.title}</h3>
                    <span className="class-announcement-time">
                      {dateLabel(v.createdAt, undefined, uiLocale)}
                    </span>
                  </div>
                  <p className="study-text">{v.body}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="class-empty-notice-box">
              <div
                className="class-empty-icon-circle"
                style={{ background: "rgba(100, 116, 139, 0.12)", color: "var(--muted)" }}
              >
                <Icon name="bell" size={26} />
              </div>
              <h3>{uiText("Chưa có thông báo trong tháng")}</h3>
              <p>
                {uiText("Các thông tin và dặn dò quan trọng từ giảng viên sẽ được gửi trực tiếp tại đây.")}
              </p>
            </div>
          )}
        </State>
      </section>
    </>
  );
}
function Sessions({ items }: { items: SessionItem[] }) {
  const uiText = useUiText();
  const [selected, setSelected] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
      {items.map((v) => (
        <article className="study-session-card" key={v.sessionId}>
          <div className="study-session-header-row">
            <div>
              <h3 className="study-session-title">{v.title}</h3>
              {v.className && (
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  <Link
                    to={"/app/classes/" + v.classId}
                    style={{ color: "var(--blue, #0284c7)", fontWeight: 600 }}
                  >
                    {v.className}
                  </Link>
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className={`study-session-mode-badge ${v.mode === "ONLINE" ? "online" : "offline"}`}>
                <Icon name={v.mode === "ONLINE" ? "sparkles" : "users"} size={13} />
                {v.mode === "ONLINE" ? uiText("Trực tuyến") : uiText("Trực tiếp")}
              </span>
              {v.location && <span className="study-session-location-tag">📍 {v.location}</span>}
            </div>
          </div>

          <div className="study-session-meta-row">
            <span className="study-session-meta-item">
              <Icon name="clock" size={14} />
              <ScheduleTime start={v.startAt} end={v.endAt} timezone={v.timezone} />
            </span>
            <span className="study-session-meta-item">
              <span>
                {uiText("Múi giờ: ")}
                {v.timezone}
              </span>
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            {v.status === "CANCELLED" ? (
              <span className="kpi-tag" style={{ color: "#ef4444" }}>
                {uiText("Buổi học đã hủy")}
              </span>
            ) : (
              <button
                type="button"
                className={`button button-small ${selected === v.sessionId ? "button-subtle" : ""}`}
                onClick={() => setSelected((prev) => (prev === v.sessionId ? "" : v.sessionId))}
              >
                {selected === v.sessionId
                  ? uiText("Ẩn thông tin tham gia")
                  : uiText("Xem thông tin tham gia →")}
              </button>
            )}
          </div>
          {selected === v.sessionId && (
            <div
              style={{
                marginTop: 10,
                padding: "12px 14px",
                borderRadius: 8,
                background: "var(--surface-subtle, #f8fafc)",
                border: "1px solid var(--line, #e2e8f0)",
              }}
            >
              <SessionAccess key={selected} id={selected} />
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
function SessionAccess({ id }: { id: string }) {
  const uiText = useUiText();
  const q = useStudent<SessionItem>("/class-sessions/" + id);
  const url = safeContentUrl(q.data?.meetingUrl);
  return (
    <State query={q}>
      {q.data && (
        <p>
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              {uiText("Mở phòng học ↗")}
            </a>
          ) : q.data.mode === "OFFLINE" ? (
            q.data.location
          ) : (
            uiText("Liên kết phòng học chưa mở hoặc không còn trong thời gian tham gia.")
          )}
        </p>
      )}
    </State>
  );
}
