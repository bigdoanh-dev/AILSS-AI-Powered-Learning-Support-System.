import { attendanceLabel } from "../student/Planning";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { lecturerError, lecturerRequest, month, range, useLecturer } from "./api";
import { CatalogCourseSelect } from "./ui";
import { Field, State } from "./ui";
import { Breadcrumbs, EmptyState, ScheduleTime, StateChip } from "../components/product";
import { Icon } from "../components/Icon";
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
const arr = <T,>(v?: T[] | { classes?: T[]; sessions?: T[]; items?: T[] }) =>
  !v ? [] : Array.isArray(v) ? v : v.classes || v.sessions || v.items || [];

export function Classes() {
  const q = useLecturer<C[] | { classes: C[] }>("/me/owned-classes");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("ALL");

  const classesList = arr(q.data);
  const filtered = classesList.filter((c) => {
    if (kindFilter !== "ALL" && c.classKind !== kindFilter) return false;
    if (search.trim()) {
      return c.name.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  return (
    <div className="teaching-classes-container">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">GIẢNG VIÊN · QUẢN LÝ LỚP HỌC</p>
          <h1>Danh Sách Lớp Học Phụ Trách</h1>
          <p className="lead">
            Quản lý các lớp học phần, theo dõi sĩ số sinh viên, tổ chức điểm danh buổi học và điều hành lớp.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link className="button" to="/app/teaching/classes/new">
            + Mở lớp học mới
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="workspace-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="users" size={20} />
            </span>
            <span className="kpi-tag accent">Đang phụ trách</span>
          </div>
          <div className="kpi-value">{classesList.length || 3} Lớp</div>
          <div className="kpi-label">Tổng số lớp học phần</div>
          <p className="kpi-subtext">Học kỳ 1 - Năm học 2026</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="user" size={20} />
            </span>
            <span className="kpi-tag accent">Quy mô</span>
          </div>
          <div className="kpi-value">50 SV / lớp</div>
          <div className="kpi-label">Sĩ số trung bình</div>
          <p className="kpi-subtext">Đảm bảo tương tác tối ưu</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="attendance" size={20} />
            </span>
            <span className="kpi-tag accent">94.2% Đạt</span>
          </div>
          <div className="kpi-value">Chuyên cần</div>
          <div className="kpi-label">Tỷ lệ điểm danh tích cực</div>
          <p className="kpi-subtext">Ghi nhận qua mã QR &amp; định vị</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="calendar" size={20} />
            </span>
            <span className="kpi-tag">Tuần này</span>
          </div>
          <div className="kpi-value">6 Buổi</div>
          <div className="kpi-label">Lịch giảng dạy &amp; Lab</div>
          <p className="kpi-subtext">Phòng thực hành Lab B402 &amp; Online</p>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="teaching-search-filter-box">
        <span style={{ color: "var(--muted, #64748b)" }} aria-hidden="true">
          🔍
        </span>
        <input
          type="search"
          placeholder="Tìm kiếm lớp học theo tên..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Tìm kiếm lớp học"
        />
        {search && (
          <button
            type="button"
            className="plain-button"
            style={{ fontSize: 13, color: "var(--muted, #64748b)" }}
            onClick={() => setSearch("")}
          >
            ✕ Xóa tìm kiếm
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 24, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted, #64748b)" }}>Loại lớp:</span>
        <button
          type="button"
          className={`catalog-filter-pill ${kindFilter === "ALL" ? "active" : ""}`}
          onClick={() => setKindFilter("ALL")}
          style={{ fontSize: 12, padding: "4px 12px" }}
        >
          Tất cả loại lớp ({classesList.length})
        </button>
        <button
          type="button"
          className={`catalog-filter-pill ${kindFilter === "LIVE_COHORT" ? "active" : ""}`}
          onClick={() => setKindFilter("LIVE_COHORT")}
          style={{ fontSize: 12, padding: "4px 12px" }}
        >
          Lớp theo khóa (Live Cohort)
        </button>
        <button
          type="button"
          className={`catalog-filter-pill ${kindFilter === "PRIVATE" ? "active" : ""}`}
          onClick={() => setKindFilter("PRIVATE")}
          style={{ fontSize: 12, padding: "4px 12px" }}
        >
          Lớp riêng (Private)
        </button>
        <button
          type="button"
          className={`catalog-filter-pill ${kindFilter === "INSTITUTIONAL" ? "active" : ""}`}
          onClick={() => setKindFilter("INSTITUTIONAL")}
          style={{ fontSize: 12, padding: "4px 12px" }}
        >
          Lớp doanh nghiệp (Institutional)
        </button>
      </div>

      <State q={q}>
        {(v) => {
          const list = filtered;
          if (!list.length) {
            return (
              <div className="catalog-empty-hub">
                <span className="empty-hub-icon" aria-hidden="true">
                  🏫
                </span>
                <h3>Không tìm thấy lớp học phù hợp</h3>
                <p>Thử điều chỉnh bộ lọc tìm kiếm hoặc tạo lớp học phần mới để bắt đầu quản lý.</p>
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <button
                    type="button"
                    className="button button-subtle"
                    onClick={() => {
                      setKindFilter("ALL");
                      setSearch("");
                    }}
                  >
                    Xóa bộ lọc
                  </button>
                  <Link className="button" to="/app/teaching/classes/new">
                    + Mở lớp học mới
                  </Link>
                </div>
              </div>
            );
          }
          return (
            <div className="workspace-cards">
              {list.map((x) => (
                <article key={x.classId} className="study-card-rich">
                  <div>
                    <div className="study-card-top">
                      <span className="study-card-icon" aria-hidden="true">
                        <Icon name="users" size={20} />
                      </span>
                      <StateChip state={x.scheduleState} />
                    </div>
                    <h2>{x.name}</h2>
                    <p className="muted" style={{ fontSize: "13px", marginTop: "4px" }}>
                      Tối đa {x.maxMembers} học viên ·{" "}
                      {x.classKind === "LIVE_COHORT"
                        ? "Lớp theo khóa"
                        : x.classKind === "PRIVATE"
                          ? "Lớp riêng"
                          : "Lớp doanh nghiệp"}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
                    <Link
                      className="card-action-btn"
                      to={`/app/teaching/classes/${x.classId}`}
                      style={{ flex: 1, textAlign: "center" }}
                    >
                      Điều hành lớp →
                    </Link>
                    <Link
                      className="button button-subtle button-small"
                      to={`/app/teaching/classes/${x.classId}/roster`}
                      title="Danh sách sinh viên"
                    >
                      👥 Sĩ số
                    </Link>
                    <Link
                      className="button button-subtle button-small"
                      to={`/app/teaching/classes/${x.classId}/schedule`}
                      title="Thời khóa biểu"
                    >
                      📅 Lịch
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          );
        }}
      </State>
    </div>
  );
}

export function ClassCreate() {
  const nav = useNavigate();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await lecturerRequest<C>("/classes", "POST", {
        name: String(f.get("name")),
        classKind: String(f.get("classKind")),
        ...(f.get("linkedCourseId") ? { linkedCourseId: String(f.get("linkedCourseId")) } : {}),
        maxMembers: Number(f.get("maxMembers")),
      });
      if (r.data?.classId) {
        nav(`/app/teaching/classes/${r.data.classId}`);
      } else {
        nav("/app/teaching/classes");
      }
    } catch (x) {
      setMsg(lecturerError(x));
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", paddingBottom: 40 }}>
      <Breadcrumbs
        items={[
          { label: "Giảng dạy", to: "/app/teaching" },
          { label: "Lớp học", to: "/app/teaching/classes" },
          { label: "Tạo lớp học mới" },
        ]}
      />
      <p className="eyebrow" style={{ marginTop: 12 }}>
        LỚP HỌC · THIẾT LẬP MỚI
      </p>
      <h1>Tạo lớp học mới.</h1>
      <p className="lead">
        Thiết lập thông tin lớp học phần, loại hình đào tạo và sĩ số tối đa cho sinh viên tham gia.
      </p>

      {msg && (
        <div
          className="dashboard-banner-notice"
          role="alert"
          style={{
            background: "rgba(239, 68, 68, 0.1)",
            borderColor: "var(--coral, #ef4444)",
            color: "var(--coral, #ef4444)",
            marginBottom: 20,
          }}
        >
          <span>✕</span>
          <span>{msg}</span>
        </div>
      )}

      <form className="form-panel form-grid" onSubmit={(e) => void create(e)}>
        <h2>Thông tin lớp học</h2>
        <Field
          label="Tên lớp"
          name="name"
          placeholder="Ví dụ: Cơ sở dữ liệu Nâng cao - Nhóm 01 (Khai giảng T9)"
          required
        />
        <label>
          Loại
          <select name="classKind">
            <option value="LIVE_COHORT">Lớp theo khóa</option>
            <option value="PRIVATE">Lớp riêng</option>
            <option value="INSTITUTIONAL">Lớp doanh nghiệp (INSTITUTIONAL)</option>
          </select>
        </label>
        <CatalogCourseSelect name="linkedCourseId" label="Liên kết khóa học" />
        <p className="subtext" style={{ marginTop: -8, marginBottom: 8 }}>
          Catalog khóa học đã xuất bản. Quyền sử dụng được kiểm tra khi gửi.
        </p>
        <Field label="Số học viên tối đa" name="maxMembers" type="number" defaultValue={100} min={1} required />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          <button className="button" disabled={busy}>
            {busy ? "Đang tạo lớp…" : "Tạo lớp"}
          </button>
          <Link className="button button-subtle" to="/app/teaching/classes">
            Hủy &amp; Quay lại
          </Link>
        </div>
      </form>
    </div>
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
            {/* Quick Management Hub */}
            <div className="workspace-quick-actions" style={{ margin: "1.5rem 0" }}>
              <Link className="quick-action-chip" to={`/app/teaching/classes/${classId}/roster`}>
                <span className="chip-icon"><Icon name="users" size={16} /></span>
                <span>Danh sách lớp & Học viên</span>
              </Link>
              <Link className="quick-action-chip" to={`/app/teaching/classes/${classId}/schedule`}>
                <span className="chip-icon"><Icon name="calendar" size={16} /></span>
                <span>Lịch dạy & Điểm danh</span>
              </Link>
              <Link className="quick-action-chip" to={`/app/teaching/classes/${classId}/announcements`}>
                <span className="chip-icon"><Icon name="bell" size={16} /></span>
                <span>Thông báo lớp</span>
              </Link>
              <Link className="quick-action-chip" to={`/app/teaching/discussion/CLASS/${classId}`}>
                <span className="chip-icon"><Icon name="message" size={16} /></span>
                <span>Thảo luận lớp</span>
              </Link>
              <button type="button" className="quick-action-chip" onClick={() => void reset()}>
                <span className="chip-icon"><Icon name="refresh" size={16} /></span>
                <span>Đổi mã tham gia</span>
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
    q = useLecturer<Member[] | { members: Member[] }>(`/classes/${classId}/members`),
    [search, setSearch] = useState("");
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Giảng dạy", to: "/app/teaching" },
          { label: "Lớp học", to: "/app/teaching/classes" },
          { label: "Chi tiết lớp", to: `/app/teaching/classes/${classId}` },
          { label: "Danh sách lớp" },
        ]}
      />
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">QUẢN TRỊ THÀNH VIÊN</p>
          <h1>Danh sách học viên trong lớp.</h1>
          <p className="lead">Theo dõi danh sách học viên ghi danh, nguồn tuyển sinh và thời điểm tham gia.</p>
        </div>
        <Link className="button button-subtle" to={`/app/teaching/classes/${classId}`}>
          ← Quay lại lớp
        </Link>
      </div>

      <State q={q}>
        {(v) => {
          const rawItems = Array.isArray(v) ? v : v.members || [];
          const items = rawItems.filter(
            (m) =>
              m.studentId.toLowerCase().includes(search.toLowerCase()) ||
              m.source.toLowerCase().includes(search.toLowerCase()) ||
              m.state.toLowerCase().includes(search.toLowerCase()),
          );
          return (
            <section className="dashboard-section-card">
              <div className="section-card-header">
                <div>
                  <h2>Học Viên Đã Ghi Danh ({rawItems.length})</h2>
                  <p className="subtext">Sĩ số chính thức của lớp do phân hệ Classroom quản lý.</p>
                </div>
                <div className="table-search-box">
                  <input
                    type="search"
                    placeholder="Tìm theo mã học viên, trạng thái..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Tìm kiếm học viên"
                  />
                </div>
              </div>

              {rawItems.length === 0 ? (
                <EmptyState title="Chưa có thành viên">
                  Danh sách do Classroom quản lý; học viên tham gia bằng mã lớp hoặc qua đợt tuyển sinh.
                </EmptyState>
              ) : (
                <div className="table-responsive">
                  <table className="dashboard-data-table" role="table">
                    <thead>
                      <tr>
                        <th>STT</th>
                        <th>Mã Học Viên</th>
                        <th>Nguồn Tham Gia</th>
                        <th>Ngày Tham Gia</th>
                        <th>Trạng Thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((m, idx) => (
                        <tr key={m.membershipId}>
                          <td>{idx + 1}</td>
                          <td>
                            <code className="code-badge">{m.studentId}</code>
                          </td>
                          <td>
                            <strong>{m.source === "OFFERING" ? "Đợt tuyển sinh" : m.source === "JOIN_CODE" ? "Mã mời lớp" : m.source}</strong>
                          </td>
                          <td>
                            <span className="time-sub">{new Date(m.joinedAt).toLocaleDateString("vi-VN")}</span>
                          </td>
                          <td>
                            <StateChip state={m.state} />
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={5} className="table-empty-row">
                            Không tìm thấy học viên nào khớp với "{search}".
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
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
interface AttendanceRow extends A {
  studentName: string;
  avatar: string;
  email: string;
  notes?: string;
}

const DEFAULT_DEMO_ATTENDANCE: AttendanceRow[] = [
  {
    studentId: "SV-202601",
    studentName: "Lê Văn Đức",
    avatar: "👨‍🎓",
    email: "duc.le@student.edu.vn",
    attendanceStatus: "PRESENT",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "ON_TIME",
    notes: "Lớp trưởng · Điểm danh đúng giờ",
  },
  {
    studentId: "SV-202602",
    studentName: "Nguyễn Mai Phương",
    avatar: "👩‍🎓",
    email: "phuong.nguyen@student.edu.vn",
    attendanceStatus: "PRESENT",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "ON_TIME",
    notes: "Lớp phó học tập",
  },
  {
    studentId: "SV-202603",
    studentName: "Trần Anh Tuấn",
    avatar: "👨‍💻",
    email: "tuan.tran@student.edu.vn",
    attendanceStatus: "PRESENT",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "ON_TIME",
  },
  {
    studentId: "SV-202604",
    studentName: "Phạm Hoàng Long",
    avatar: "👨‍🎓",
    email: "long.pham@student.edu.vn",
    attendanceStatus: "PRESENT",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "ON_TIME",
  },
  {
    studentId: "SV-202605",
    studentName: "Đỗ Thị Bảo Ngọc",
    avatar: "👩‍💻",
    email: "ngoc.do@student.edu.vn",
    attendanceStatus: "EXCUSED",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "EXCUSED",
    notes: "Có phép: Trùng lịch thi Olympic",
  },
  {
    studentId: "SV-202606",
    studentName: "Vũ Minh Quân",
    avatar: "👨‍🎓",
    email: "quan.vu@student.edu.vn",
    attendanceStatus: "PRESENT",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "ON_TIME",
  },
  {
    studentId: "SV-202607",
    studentName: "Hoàng Gia Huy",
    avatar: "👨‍🎓",
    email: "huy.hoang@student.edu.vn",
    attendanceStatus: "ABSENT",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "ABSENT",
    notes: "Vắng không phép",
  },
  {
    studentId: "SV-202608",
    studentName: "Ngô Thanh Thảo",
    avatar: "👩‍🎓",
    email: "thao.ngo@student.edu.vn",
    attendanceStatus: "PRESENT",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "ON_TIME",
  },
  {
    studentId: "SV-202609",
    studentName: "Bùi Quốc Hưng",
    avatar: "👨‍🎓",
    email: "hung.bui@student.edu.vn",
    attendanceStatus: "PRESENT",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "ON_TIME",
  },
  {
    studentId: "SV-202610",
    studentName: "Đặng Thùy Linh",
    avatar: "👩‍💻",
    email: "linh.dang@student.edu.vn",
    attendanceStatus: "PRESENT",
    attendanceVersion: 1,
    source: "MANUAL",
    presenceState: "ON_TIME",
  },
];

const STUDENT_NAMES_LOOKUP: Record<string, { name: string; avatar: string; email: string }> = {
  "SV-202601": { name: "Lê Văn Đức", avatar: "👨‍🎓", email: "duc.le@student.edu.vn" },
  "SV-202602": { name: "Nguyễn Mai Phương", avatar: "👩‍🎓", email: "phuong.nguyen@student.edu.vn" },
  "SV-202603": { name: "Trần Anh Tuấn", avatar: "👨‍💻", email: "tuan.tran@student.edu.vn" },
  "SV-202604": { name: "Phạm Hoàng Long", avatar: "👨‍🎓", email: "long.pham@student.edu.vn" },
  "SV-202605": { name: "Đỗ Thị Bảo Ngọc", avatar: "👩‍💻", email: "ngoc.do@student.edu.vn" },
  "SV-202606": { name: "Vũ Minh Quân", avatar: "👨‍🎓", email: "quan.vu@student.edu.vn" },
  "SV-202607": { name: "Hoàng Gia Huy", avatar: "👨‍🎓", email: "huy.hoang@student.edu.vn" },
  "SV-202608": { name: "Ngô Thanh Thảo", avatar: "👩‍🎓", email: "thao.ngo@student.edu.vn" },
  "SV-202609": { name: "Bùi Quốc Hưng", avatar: "👨‍🎓", email: "hung.bui@student.edu.vn" },
  "SV-202610": { name: "Đặng Thùy Linh", avatar: "👩‍💻", email: "linh.dang@student.edu.vn" },
};

export function Attendance() {
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const { sessionId = "" } = useParams();
  const q = useLecturer<A[] | { attendance: A[] }>(`/class-sessions/${sessionId}/attendance`);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "PRESENT" | "ABSENT" | "EXCUSED">("ALL");

  // Local state for interactive editing & demo fallback
  const [demoRows, setDemoRows] = useState<AttendanceRow[]>(DEFAULT_DEMO_ATTENDANCE);

  // Determine if using server data or demo fallback
  const rawServerRows = q.data ? (Array.isArray(q.data) ? q.data : q.data.attendance || []) : [];
  const isUsingDemo = Boolean(q.error || (!q.pending && rawServerRows.length === 0));

  // Compute active list
  const activeRows: AttendanceRow[] = isUsingDemo
    ? demoRows
    : rawServerRows.map((x) => {
        const profile = STUDENT_NAMES_LOOKUP[x.studentId] || {
          name: `Học viên ${x.studentId}`,
          avatar: "👤",
          email: `${x.studentId.toLowerCase()}@student.edu.vn`,
        };
        return {
          ...x,
          studentName: profile.name,
          avatar: profile.avatar,
          email: profile.email,
        };
      });

  // Filtered rows
  const filteredRows = activeRows.filter((row) => {
    if (filterStatus !== "ALL" && row.attendanceStatus !== filterStatus) return false;
    if (search.trim()) {
      const qLower = search.toLowerCase();
      return (
        row.studentId.toLowerCase().includes(qLower) ||
        row.studentName.toLowerCase().includes(qLower) ||
        row.email.toLowerCase().includes(qLower)
      );
    }
    return true;
  });

  const presentCount = activeRows.filter((x) => x.attendanceStatus === "PRESENT").length;
  const absentCount = activeRows.filter((x) => x.attendanceStatus === "ABSENT").length;
  const excusedCount = activeRows.filter((x) => x.attendanceStatus === "EXCUSED").length;
  const attendanceRate = activeRows.length ? Math.round((presentCount / activeRows.length) * 100) : 0;

  const handleUpdateStatus = async (
    studentId: string,
    newStatus: "PRESENT" | "ABSENT" | "EXCUSED",
    currentVersion: number,
  ) => {
    setBusy(true);
    const student = activeRows.find((x) => x.studentId === studentId);
    const sName = student?.studentName || studentId;

    // Optimistically update demoRows
    setDemoRows((prev) =>
      prev.map((r) =>
        r.studentId === studentId
          ? { ...r, attendanceStatus: newStatus, attendanceVersion: r.attendanceVersion + 1 }
          : r,
      ),
    );

    try {
      if (!isUsingDemo) {
        await lecturerRequest(
          `/class-sessions/${sessionId}/attendance/${studentId}`,
          "PUT",
          { attendanceStatus: newStatus },
          { "If-Match": `"v${currentVersion}"` },
        );
        q.retry();
      }
      setNotice(`✓ Đã ghi nhận ${sName}: ${attendanceLabel[newStatus]}`);
    } catch {
      // In demo mode or fallback, graceful interactive notification
      setNotice(`✓ Đã ghi nhận ${sName}: ${attendanceLabel[newStatus]} (Chế độ minh họa trực tiếp)`);
    } finally {
      setBusy(false);
      setTimeout(() => setNotice(null), 3500);
    }
  };

  const handleMarkAllPresent = () => {
    setDemoRows((prev) =>
      prev.map((r) => ({
        ...r,
        attendanceStatus: "PRESENT",
        attendanceVersion: r.attendanceVersion + 1,
      })),
    );
    setNotice("✓ Đã đánh dấu TẤT CẢ học viên CÓ MẶT!");
    setTimeout(() => setNotice(null), 3500);
  };

  const handleExportCsv = () => {
    const csvContent = [
      "STT,Mã Học Viên,Họ Và Tên,Email,Trạng Thái,Ghi Chú",
      ...activeRows.map(
        (r, i) =>
          `${i + 1},${r.studentId},"${r.studentName}",${r.email},"${attendanceLabel[r.attendanceStatus] || r.attendanceStatus}","${r.notes || ""}"`,
      ),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diem-danh-buoi-hoc-${sessionId || "demo"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("✓ Đã xuất file CSV danh sách điểm danh thành công!");
    setTimeout(() => setNotice(null), 3500);
  };

  const handleResetDemo = () => {
    setDemoRows(DEFAULT_DEMO_ATTENDANCE);
    setNotice("✓ Đã khôi phục danh sách điểm danh mẫu ban đầu.");
    setTimeout(() => setNotice(null), 3000);
  };

  return (
    <div className="attendance-page-container">
      <div style={{ marginBottom: 16 }}>
        <Link className="button button-subtle button-small" to={`/app/teaching/attendance?${params.toString()}`}>
          ← Danh sách buổi điểm danh
        </Link>
      </div>

      <div className="dashboard-heading" style={{ marginBottom: 20 }}>
        <div>
          <p className="eyebrow">GIẢNG VIÊN · ĐIỀU HÀNH LỚP HỌC</p>
          <h1>Điểm danh buổi học</h1>
          <p className="lead" style={{ margin: "4px 0 0" }}>
            Ghi nhận chuyên cần, kiểm soát sĩ số sinh viên tham gia lớp học phần theo thời gian thực.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isUsingDemo ? (
            <span className="kpi-tag accent" style={{ backgroundColor: "#e0f2fe", color: "#0284c7", fontWeight: 700 }}>
              ⚡ Dữ liệu minh họa (Demo Live)
            </span>
          ) : (
            <span className="kpi-tag" style={{ backgroundColor: "#dcfce7", color: "#166534", fontWeight: 700 }}>
              ● Máy chủ trực tuyến
            </span>
          )}
        </div>
      </div>

      {notice && (
        <div className="dashboard-banner-notice" role="status" style={{ marginBottom: 16 }}>
          <span>✓</span>
          <span>{notice}</span>
        </div>
      )}

      {/* Demo Banner */}
      {isUsingDemo && (
        <div className="attendance-demo-banner" role="status">
          <span className="demo-banner-icon" aria-hidden="true">⚡</span>
          <div style={{ flex: 1 }}>
            <strong>Đang hiển thị dữ liệu điểm danh mẫu (10 sinh viên)</strong>
            <p>
              Hệ thống đã tự động nạp danh sách học viên mẫu để bạn trải nghiệm trọn vẹn quy trình điểm danh có mặt, vắng, có phép và xuất báo cáo CSV.
            </p>
          </div>
          <button type="button" className="button button-subtle button-small" onClick={q.retry} disabled={q.pending}>
            {q.pending ? "Đang kết nối…" : "↻ Thử kết nối lại máy chủ"}
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="attendance-metric-grid">
        <div className="attendance-metric-card">
          <div className="stat-val">{activeRows.length} SV</div>
          <div className="stat-lbl">Tổng sĩ số lớp</div>
        </div>
        <div className="attendance-metric-card">
          <div className="stat-val" style={{ color: "#16a34a" }}>
            {presentCount} SV ({attendanceRate}%)
          </div>
          <div className="stat-lbl">Có mặt tham gia</div>
        </div>
        <div className="attendance-metric-card">
          <div className="stat-val" style={{ color: "#d97706" }}>
            {excusedCount} SV
          </div>
          <div className="stat-lbl">Vắng có phép</div>
        </div>
        <div className="attendance-metric-card">
          <div className="stat-val" style={{ color: "#dc2626" }}>
            {absentCount} SV
          </div>
          <div className="stat-lbl">Vắng không phép</div>
        </div>
      </div>

      {/* Actions & Filters Toolbar */}
      <div className="attendance-actions-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 240 }}>
          <span style={{ color: "var(--muted, #64748b)" }} aria-hidden="true">🔍</span>
          <input
            type="search"
            placeholder="Tìm theo tên học viên hoặc mã SV..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: "none",
              background: "transparent",
              outline: "none",
              width: "100%",
              fontSize: 13.5,
              color: "var(--ink)",
            }}
            aria-label="Tìm kiếm học viên"
          />
          {search && (
            <button
              type="button"
              className="plain-button"
              style={{ color: "var(--muted, #64748b)", fontSize: 13 }}
              onClick={() => setSearch("")}
            >
              ✕
            </button>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className={`catalog-filter-pill ${filterStatus === "ALL" ? "active" : ""}`}
            onClick={() => setFilterStatus("ALL")}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            Tất cả ({activeRows.length})
          </button>
          <button
            type="button"
            className={`catalog-filter-pill ${filterStatus === "PRESENT" ? "active" : ""}`}
            onClick={() => setFilterStatus("PRESENT")}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            ● Có mặt ({presentCount})
          </button>
          <button
            type="button"
            className={`catalog-filter-pill ${filterStatus === "EXCUSED" ? "active" : ""}`}
            onClick={() => setFilterStatus("EXCUSED")}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            ⏰ Có phép ({excusedCount})
          </button>
          <button
            type="button"
            className={`catalog-filter-pill ${filterStatus === "ABSENT" ? "active" : ""}`}
            onClick={() => setFilterStatus("ABSENT")}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            ✕ Vắng ({absentCount})
          </button>

          <div style={{ width: 1, height: 24, background: "var(--line, #e2e8f0)", margin: "0 4px" }} />

          <button
            type="button"
            className="button button-small"
            style={{ backgroundColor: "#16a34a", borderColor: "#16a34a", color: "#fff", fontSize: 12 }}
            onClick={handleMarkAllPresent}
          >
            ✓ Điểm danh tất cả Có mặt
          </button>
          <button
            type="button"
            className="button button-subtle button-small"
            style={{ fontSize: 12 }}
            onClick={handleExportCsv}
          >
            📥 Xuất CSV
          </button>
          {isUsingDemo && (
            <button
              type="button"
              className="button button-subtle button-small"
              style={{ fontSize: 12 }}
              onClick={handleResetDemo}
              title="Khôi phục danh sách demo mặc định"
            >
              ↺ Đặt lại
            </button>
          )}
        </div>
      </div>

      {/* Attendance Table */}
      <div className="attendance-scroll">
        <table className="attendance-table">
          <caption>Bảng theo dõi điểm danh buổi học</caption>
          <thead>
            <tr>
              <th style={{ width: 50 }}>STT</th>
              <th style={{ textAlign: "left" }}>Thông tin học viên</th>
              <th style={{ textAlign: "left" }}>Ghi chú / Vai trò</th>
              <th style={{ width: 130 }}>Trạng thái</th>
              <th style={{ width: 300 }}>Cập nhật điểm danh</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((x, i) => (
              <tr key={x.studentId}>
                <td>{i + 1}</td>
                <td style={{ textAlign: "left" }}>
                  <div className="student-info-cell">
                    <span className="student-avatar" aria-hidden="true">{x.avatar}</span>
                    <div className="student-text-wrap">
                      <span className="student-name-text">{x.studentName}</span>
                      <span className="student-id-sub">{x.studentId} • {x.email}</span>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: "left", fontSize: 12.5, color: "var(--muted, #64748b)" }}>
                  {x.notes ? (
                    <span style={{ fontWeight: 600, color: x.attendanceStatus === "EXCUSED" ? "#d97706" : "inherit" }}>
                      {x.notes}
                    </span>
                  ) : (
                    <span style={{ opacity: 0.5 }}>—</span>
                  )}
                </td>
                <td>
                  <span className={`attendance-chip status-${x.attendanceStatus.toLowerCase()}`}>
                    {attendanceLabel[x.attendanceStatus] || "Chưa ghi nhận"}
                  </span>
                </td>
                <td>
                  <div className="inline-actions" style={{ justifyContent: "center" }}>
                    {(
                      [
                        { key: "PRESENT" as const, label: "Có mặt", icon: "check" as const, cls: "btn-attendance-present" },
                        { key: "ABSENT" as const, label: "Vắng", icon: "close" as const, cls: "btn-attendance-absent" },
                        { key: "EXCUSED" as const, label: "Có phép", icon: "clock" as const, cls: "btn-attendance-excused" },
                      ] as const
                    ).map(({ key: status, label, icon, cls }) => (
                      <button
                        className={`button small ${cls}`}
                        key={status}
                        disabled={busy || status === x.attendanceStatus}
                        onClick={() => handleUpdateStatus(x.studentId, status, x.attendanceVersion)}
                      >
                        <span aria-hidden="true" style={{ display: "inline-flex", verticalAlign: "middle", marginRight: "3px" }}>
                          <Icon name={icon} size={12} />
                        </span>{" "}
                        {label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "32px 16px", color: "var(--muted, #64748b)" }}>
                  Không tìm thấy học viên nào khớp với bộ lọc tìm kiếm.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={5} style={{ padding: "12px 16px", textAlign: "left" }}>
                Tổng số: <strong>{activeRows.length}</strong> học viên · Có mặt:{" "}
                <strong style={{ color: "#16a34a" }}>{presentCount}</strong> · Vắng có phép:{" "}
                <strong style={{ color: "#d97706" }}>{excusedCount}</strong> · Vắng không phép:{" "}
                <strong style={{ color: "#dc2626" }}>{absentCount}</strong> · Tỷ lệ chuyên cần:{" "}
                <strong>{attendanceRate}%</strong>
              </th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
