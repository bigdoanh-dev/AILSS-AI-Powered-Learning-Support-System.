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
import { Breadcrumbs, ScheduleTime, StateChip } from "../components/product";
export function Classes() {
  const query = useStudent<ClassItem[]>("/me/classes"),
    [code, setCode] = useState(""),
    navigate = useNavigate();
  const command = useCommand();
  if (command.outcome === "failure")
    return (
      <OperationResult
        success={false}
        title="Chưa thể tham gia lớp"
        onComplete={command.clear}
        action={
          <button className="button" onClick={command.clear}>
            Kiểm tra lại mã lớp
          </button>
        }
      >
        <p>{command.message}</p>
      </OperationResult>
    );
  return (
    <>
      <Heading title="Lớp học của tôi">Theo dõi lịch học và kết nối với lớp của bạn.</Heading>
      <section className="study-card">
        <h2>Tham gia lớp</h2>
        <form
          className="study-search"
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
                  title: "Tham gia lớp thành công",
                  message: "Bạn đã được thêm vào lớp. Lịch học và thông báo đã sẵn sàng.",
                  to: "/app/classes/" + joined.classId,
                  label: "Vào lớp học",
                },
              });
            }
          }}
        >
          <label>
            Mã tham gia
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              minLength={6}
              maxLength={32}
              autoComplete="off"
            />
          </label>
          <button className="button" disabled={command.busy}>
            Tham gia
          </button>
        </form>
        <Status command={command} />
      </section>
      <State query={query}>
        {query.data?.length ? (
          <div className="study-grid">
            {query.data.map((c) => (
              <article className="study-card" key={c.classId}>
                <StateChip state={c.state} />
                <h2>{c.name}</h2>
                <Link to={"/app/classes/" + c.classId}>Mở lớp học →</Link>
              </article>
            ))}
          </div>
        ) : (
          <Empty>Bạn chưa có lớp học. Nhập mã được giảng viên cung cấp để tham gia.</Empty>
        )}
      </State>
      <div className="inline-actions">
        <Link className="button secondary" to="/app/schedule">
          Lịch học
        </Link>
        <Link className="button secondary" to="/app/attendance">
          Thông tin điểm danh
        </Link>
      </div>
    </>
  );
}
export function ClassDetail() {
  const { classId = "" } = useParams(),
    q = useStudent<ClassItem>("/classes/" + classId),
    [month, setMonth] = useState(monthNow());
  return (
    <>
      <Link to="/app/classes">← Lớp học của tôi</Link>
      <Breadcrumbs
        items={[{ label: "Lớp học", to: "/app/classes" }, { label: q.data?.name || "Đang tải…" }]}
      />
      <Heading title={q.data?.name || "Lớp học"} />
      <State query={q}>
        {q.data && (
          <>
            <section className="study-card">
              <p>{q.data.state === "ACTIVE" ? "Lớp đang hoạt động" : "Lớp đã đóng"}</p>
              {q.data.linkedCourseId && (
                <Link to={"/app/learn/" + q.data.linkedCourseId}>Mở khóa học của lớp →</Link>
              )}
              <p>
                <Link to={"/app/assessments?class=" + classId}>Bài kiểm tra của lớp →</Link>
              </p>
              <label>
                Tháng xem lịch & thông báo (UTC)
                <input
                  type="month"
                  value={month}
                  required
                  onChange={(e) => {
                    if (e.target.value) setMonth(e.target.value);
                  }}
                />
              </label>
            </section>
            <ClassContent key={month} id={classId} month={month} />
            <Discussion type="CLASS" id={classId} canWrite />
          </>
        )}
      </State>
    </>
  );
}
function ClassContent({ id, month }: { id: string; month: string }) {
  const q = useStudent<SessionItem[]>(
    "/classes/" + id + "/sessions?" + new URLSearchParams(rangeForMonth(month)),
  );
  const a = useStudent<{ announcementId: string; title: string; body: string; createdAt: string }[]>(
    "/classes/" + id + "/announcements?month=" + month + "-01",
  );
  return (
    <>
      <section className="study-card">
        <h2>Các buổi học</h2>
        <State query={q}>
          {q.data?.length ? <Sessions items={q.data} /> : <Empty>Chưa có buổi học trong tháng này.</Empty>}
        </State>
      </section>
      <section className="study-card">
        <h2>Thông báo của lớp</h2>
        <State query={a}>
          {a.data?.length ? (
            a.data.map((v) => (
              <article key={v.announcementId}>
                <h3>{v.title}</h3>
                <p className="study-text">{v.body}</p>
                <small>{dateLabel(v.createdAt)} · Asia/Ho_Chi_Minh</small>
              </article>
            ))
          ) : (
            <Empty>Chưa có thông báo trong tháng.</Empty>
          )}
        </State>
      </section>
    </>
  );
}
function Sessions({ items }: { items: SessionItem[] }) {
  const [selected, setSelected] = useState("");
  return (
    <>
      {items.map((v) => (
        <article className="study-session" key={v.sessionId}>
          <h3>{v.title}</h3>
          {v.className && <Link to={"/app/classes/" + v.classId}>{v.className}</Link>}
          <p>
            <ScheduleTime start={v.startAt} end={v.endAt} timezone={v.timezone} />
          </p>
          <p>
            Múi giờ: {v.timezone} · {v.mode === "ONLINE" ? "Trực tuyến" : "Trực tiếp"}
          </p>
          {v.location && <p>{v.location}</p>}
          {v.status === "CANCELLED" ? (
            <p>Buổi học đã hủy.</p>
          ) : (
            <button className="plain-button" onClick={() => setSelected(v.sessionId)}>
              Xem thông tin tham gia
            </button>
          )}
          {selected === v.sessionId && <SessionAccess key={selected} id={selected} />}
        </article>
      ))}
    </>
  );
}
function SessionAccess({ id }: { id: string }) {
  const q = useStudent<SessionItem>("/class-sessions/" + id);
  const url = safeContentUrl(q.data?.meetingUrl);
  return (
    <State query={q}>
      {q.data && (
        <p>
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              Mở phòng học ↗
            </a>
          ) : q.data.mode === "OFFLINE" ? (
            q.data.location
          ) : (
            "Liên kết phòng học chưa mở hoặc không còn trong thời gian tham gia."
          )}
        </p>
      )}
    </State>
  );
}
