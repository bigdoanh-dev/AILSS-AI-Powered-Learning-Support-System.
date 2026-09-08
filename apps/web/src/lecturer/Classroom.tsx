import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { lecturerError, lecturerRequest, month, range, useLecturer } from "./api";
import { Field, State } from "./ui";
import { Breadcrumbs, EmptyState, ScheduleTime, StateChip } from "../components/product";
type C = {
  classId: string;
  name: string;
  classKind: string;
  state: string;
  scheduleState: string;
  linkedCourseId?: string;
  maxMembers: number;
};
type S = {
  sessionId: string;
  title: string;
  startAt: string;
  endAt: string;
  mode: string;
  status: string;
  recordVersion: number;
  timezone?: string;
};
type A = {
  studentId: string;
  attendanceStatus: string;
  attendanceVersion: number;
  source: string;
  presenceState: string;
};
type Member = { studentId: string; state: string; source: string; joinedAt: string; membershipId: string };
type Notice = { announcementId: string; title: string; body: string; createdAt: string };
const arr = <T,>(v: T[] | { classes?: T[]; sessions?: T[]; items?: T[] }) =>
  Array.isArray(v) ? v : v.classes || v.sessions || v.items || [];
export function Classes() {
  const q = useLecturer<C[] | { classes: C[] }>("/me/owned-classes"),
    [msg, setMsg] = useState("");
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await lecturerRequest("/classes", "POST", {
        name: String(f.get("name")),
        classKind: String(f.get("classKind")),
        ...(f.get("linkedCourseId") ? { linkedCourseId: String(f.get("linkedCourseId")) } : {}),
        maxMembers: Number(f.get("maxMembers")),
      });
      q.retry();
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <p className="eyebrow">CLASSROOM</p>
      <h1>Lớp phụ trách.</h1>
      <State q={q}>
        {(v) => (
          <div className="workspace-cards">
            {arr(v).map((x) => (
              <article key={x.classId}>
                <StateChip state={x.scheduleState} />
                <h2>{x.name}</h2>
                <Link to={`/app/teaching/classes/${x.classId}`}>Điều hành lớp →</Link>
              </article>
            ))}
          </div>
        )}
      </State>
      <form className="form-panel form-grid" onSubmit={(e) => void create(e)}>
        <h2>Tạo lớp</h2>
        <Field label="Tên lớp" name="name" required />
        <label>
          Loại
          <select name="classKind">
            <option>LIVE_COHORT</option>
            <option>PRIVATE</option>
            <option>INSTITUTIONAL</option>
          </select>
        </label>
        <Field label="Course ID liên kết" name="linkedCourseId" />
        <Field label="Số học viên tối đa" name="maxMembers" type="number" defaultValue={100} />
        <button className="button">Tạo lớp</button>
        <p role="status">{msg}</p>
      </form>
    </>
  );
}
export function ClassDetail() {
  const { classId = "" } = useParams(),
    q = useLecturer<C>(`/classes/${classId}`),
    [msg, setMsg] = useState(""),
    [joinCode, setJoinCode] = useState("");
  async function reset() {
    try {
      if (!window.confirm("Đổi mã tham gia sẽ làm mã cũ mất hiệu lực. Tiếp tục?")) return;
      const r = await lecturerRequest<{ joinCode: string }>(
        `/classes/${classId}/join-code/reset`,
        "POST",
        {},
      );
      setJoinCode(r.data.joinCode);
      setMsg("Đã tạo mã tham gia mới. Mã cũ không còn hiệu lực.");
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <State q={q}>
        {(x) => (
          <>
            <p className="eyebrow">
              {x.state} · {x.scheduleState}
            </p>
            <Breadcrumbs
              items={[
                { label: "Giảng dạy", to: "/app/teaching" },
                { label: "Lớp học", to: "/app/teaching/classes" },
                { label: x.name },
              ]}
            />
            <h1>{x.name}</h1>
            <p>
              {x.classKind} · tối đa {x.maxMembers} học viên
            </p>
            <form
              className="form-panel form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                try {
                  await lecturerRequest(`/classes/${classId}`, "PATCH", {
                    name: String(f.get("name")),
                    maxMembers: Number(f.get("maxMembers")),
                  });
                  setMsg("Đã lưu lớp.");
                  q.retry();
                } catch (error) {
                  setMsg(lecturerError(error));
                }
              }}
            >
              <Field label="Tên lớp" name="name" defaultValue={x.name} required />
              <Field
                label="Số học viên tối đa"
                name="maxMembers"
                type="number"
                defaultValue={x.maxMembers}
                required
              />
              <button className="button">Lưu lớp</button>
            </form>
            <div className="inline-actions">
              <Link className="button" to={`/app/teaching/classes/${classId}/schedule`}>
                Lịch dạy
              </Link>
              <Link to={`/app/teaching/classes/${classId}/roster`}>Danh sách lớp</Link>
              <Link to={`/app/teaching/classes/${classId}/announcements`}>Thông báo</Link>
              <Link to={`/app/teaching/discussion/CLASS/${classId}`}>Thảo luận</Link>
              <button className="button secondary" onClick={() => void reset()}>
                Đổi mã tham gia
              </button>
            </div>
            {joinCode && (
              <section className="form-panel" aria-live="polite">
                <h2>Mã tham gia mới</h2>
                <p>
                  <code>{joinCode}</code>
                </p>
                <button
                  className="button secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(joinCode);
                    setMsg("Đã sao chép mã tham gia.");
                  }}
                >
                  Sao chép mã
                </button>
                <p>Chỉ chia sẻ mã này với người cần tham gia lớp. Trang công khai không chứa mã.</p>
              </section>
            )}
          </>
        )}
      </State>
      <p role="status">{msg}</p>
    </>
  );
}
export function ClassRoster() {
  const { classId = "" } = useParams(),
    q = useLecturer<Member[] | { members: Member[] }>(`/classes/${classId}/members`);
  return (
    <>
      <h1>Danh sách lớp.</h1>
      <State q={q}>
        {(v) => {
          const items = Array.isArray(v) ? v : v.members || [];
          return items.length ? (
            <div className="workspace-cards">
              {items.map((m) => (
                <article key={m.membershipId}>
                  <StateChip state={m.state} />
                  <h2>Học viên {m.studentId}</h2>
                  <p>
                    Nguồn tham gia: {m.source} · {new Date(m.joinedAt).toLocaleDateString("vi-VN")}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="Chưa có thành viên">
              Danh sách do Classroom quản lý; tên và ảnh không được suy đoán từ Identity.
            </EmptyState>
          );
        }}
      </State>
    </>
  );
}
export function Announcements() {
  const { classId = "" } = useParams(),
    q = useLecturer<Notice[]>(`/classes/${classId}/announcements?month=${month()}-01`),
    [msg, setMsg] = useState("");
  return (
    <>
      <h1>Thông báo lớp.</h1>
      <State q={q}>
        {(v) =>
          v.length ? (
            <div className="workspace-cards">
              {v.map((n) => (
                <article key={n.announcementId}>
                  <h2>{n.title}</h2>
                  <p>{n.body}</p>
                  <time dateTime={n.createdAt}>{new Date(n.createdAt).toLocaleString("vi-VN")}</time>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="Chưa có thông báo">Thông báo mới sẽ xuất hiện tại đây.</EmptyState>
          )
        }
      </State>
      <form
        className="form-panel form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await lecturerRequest(`/classes/${classId}/announcements`, "POST", {
              title: String(f.get("title")),
              body: String(f.get("body")),
            });
            q.retry();
            setMsg("Đã gửi thông báo trong ứng dụng tới các thành viên đang hoạt động của lớp.");
          } catch (x) {
            setMsg(lecturerError(x));
          }
        }}
      >
        <Field label="Tiêu đề" name="title" required />
        <label>
          Nội dung
          <textarea name="body" required rows={5} />
        </label>
        <button className="button">Đăng thông báo</button>
        <p role="status">{msg}</p>
      </form>
    </>
  );
}
export function Schedule() {
  const { classId = "" } = useParams(),
    q = useLecturer<S[] | { sessions: S[] }>(`/classes/${classId}/sessions?${range()}`),
    [msg, setMsg] = useState("");
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      mode = String(f.get("mode"));
    try {
      await lecturerRequest(`/classes/${classId}/sessions`, "POST", {
        title: String(f.get("title")),
        startAt: new Date(String(f.get("startAt"))).toISOString(),
        endAt: new Date(String(f.get("endAt"))).toISOString(),
        timezone: String(f.get("timezone")),
        mode,
        ...(mode === "ONLINE"
          ? { meetingProvider: "CUSTOM", meetingUrl: String(f.get("place")) }
          : { location: String(f.get("place")) }),
      });
      q.retry();
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <p className="eyebrow">SCHEDULE</p>
      <h1>Lịch dạy.</h1>
      <State q={q}>
        {(v) => (
          <div className="workspace-cards">
            {arr(v).map((x) => (
              <article key={x.sessionId}>
                <StateChip state={x.status} />
                <h2>{x.title}</h2>
                <p>
                  <ScheduleTime start={x.startAt} end={x.endAt} timezone={x.timezone || "Asia/Ho_Chi_Minh"} />
                </p>
                <Link to={`/app/teaching/sessions/${x.sessionId}`}>Mở session →</Link>
              </article>
            ))}
          </div>
        )}
      </State>
      <form className="form-panel form-grid" onSubmit={(e) => void create(e)}>
        <h2>Thêm session</h2>
        <Field label="Tiêu đề" name="title" required />
        <Field label="Bắt đầu" name="startAt" type="datetime-local" required />
        <Field label="Kết thúc" name="endAt" type="datetime-local" required />
        <label>
          Hình thức
          <select name="mode">
            <option>OFFLINE</option>
            <option>ONLINE</option>
          </select>
        </label>
        <Field label="Địa điểm hoặc meeting URL" name="place" required />
        <Field label="Múi giờ IANA" name="timezone" defaultValue="Asia/Ho_Chi_Minh" required />
        <button className="button">Tạo session</button>
        <button
          className="button secondary"
          type="button"
          onClick={async () => {
            try {
              await lecturerRequest(`/classes/${classId}/schedule/publish`, "POST", {});
              setMsg("Đã xuất bản lịch.");
              q.retry();
            } catch (x) {
              setMsg(lecturerError(x));
            }
          }}
        >
          Xuất bản lịch
        </button>
        <p role="status">{msg}</p>
      </form>
    </>
  );
}
export function SessionDetail() {
  const { sessionId = "" } = useParams(),
    q = useLecturer<S>(`/class-sessions/${sessionId}`);
  return (
    <State q={q}>
      {(x) => (
        <>
          <p className="eyebrow">{x.status}</p>
          <h1>{x.title}</h1>
          <p>
            {new Date(x.startAt).toLocaleString("vi-VN")} — {new Date(x.endAt).toLocaleString("vi-VN")}
          </p>
          <Link className="button" to={`/app/teaching/sessions/${sessionId}/attendance`}>
            Điểm danh
          </Link>
        </>
      )}
    </State>
  );
}
export function Attendance() {
  const { sessionId = "" } = useParams(),
    q = useLecturer<A[] | { attendance: A[] }>(`/class-sessions/${sessionId}/attendance`),
    [msg, setMsg] = useState("");
  return (
    <>
      <h1>Điểm danh.</h1>
      <State q={q}>
        {(v) => (
          <div className="workspace-cards">
            {(Array.isArray(v) ? v : v.attendance || []).map((x) => (
              <article key={x.studentId}>
                <h2>{x.studentId}</h2>
                <p>
                  {x.attendanceStatus} · {x.source}
                </p>
                <div className="inline-actions">
                  {["PRESENT", "ABSENT", "EXCUSED"].map((s) => (
                    <button
                      className="button secondary"
                      key={s}
                      onClick={async () => {
                        try {
                          await lecturerRequest(
                            `/class-sessions/${sessionId}/attendance/${x.studentId}`,
                            "PUT",
                            { attendanceStatus: s },
                            { "If-Match": `"v${x.attendanceVersion}"` },
                          );
                          q.retry();
                        } catch (y) {
                          setMsg(lecturerError(y));
                          q.retry();
                        }
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </State>
      <p role="status">{msg}</p>
    </>
  );
}
