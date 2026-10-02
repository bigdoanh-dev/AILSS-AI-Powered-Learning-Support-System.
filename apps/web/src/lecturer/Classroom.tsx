import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  photoDataUrl?: string;
  coverDataUrl?: string;
};
type S = {
  sessionId: string;
  classId?: string;
  title: string;
  startAt: string;
  endAt: string;
  mode: string;
  status: string;
  recordVersion: number;
  timezone?: string;
  location?: string;
  meetingProvider?: string;
  meetingUrl?: string;
};
type A = {
  studentId: string;
  attendanceStatus: string;
  attendanceVersion: number;
  source: string;
  presenceState: string;
};
type Member = {
  studentId: string;
  state: string;
  source: string;
  joinedAt: string;
  membershipId: string;
  displayName: string;
  emailMasked: string;
  createdAt: string;
};
export function isNewStudent(createdAt: string, now = Date.now()) {
  const joined = Date.parse(createdAt);
  return Number.isFinite(joined) && joined <= now && now - joined < 21 * 24 * 60 * 60 * 1000;
}
type Notice = { announcementId: string; title: string; body: string; createdAt: string };
const arr = <T,>(v?: T[] | { classes?: T[]; sessions?: T[]; items?: T[] }) =>
  !v ? [] : Array.isArray(v) ? v : v.classes || v.sessions || v.items || [];

export function Classes() {
  const q = useLecturer<C[] | { classes: C[] }>("/me/owned-classes");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("ALL");
  const [showCreateModal, setShowCreateModal] = useState(false);

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
          <button className="button" type="button" onClick={() => setShowCreateModal(true)}>
            + Mở lớp học mới
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <article className="kpi-card">
          <h2>Lớp phụ trách</h2>
          <p className="kpi-value">{q.pending || q.error ? "—" : classesList.length}</p>
        </article>
        <article className="kpi-card">
          <h2>Điểm danh và lịch học</h2>
          <p>Mở từng lớp để xem lịch và dữ liệu điểm danh thực tế.</p>
        </article>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="teaching-search-filter-box">
        <span style={{ color: "var(--muted, #64748b)", display: "inline-flex" }} aria-hidden="true">
          <Icon name="search" size={16} />
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
        {() => {
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
                  <button className="button" type="button" onClick={() => setShowCreateModal(true)}>
                    + Mở lớp học mới
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div className="workspace-cards">
              {list.map((x) => (
                <article key={x.classId} className="study-card-rich">
                  {x.coverDataUrl && (
                    <img
                      src={x.coverDataUrl}
                      alt="Ảnh bìa lớp"
                      style={{
                        width: "100%",
                        height: 130,
                        objectFit: "cover",
                        borderRadius: 12,
                        marginBottom: 12,
                      }}
                    />
                  )}
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
                  <div
                    className="class-card-actions-bar"
                    style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}
                  >
                    <Link
                      className="button button-small"
                      to={`/app/teaching/classes/${x.classId}`}
                      style={{
                        width: "100%",
                        textAlign: "center",
                        justifyContent: "center",
                        textDecoration: "none",
                        fontSize: 13,
                        fontWeight: 700,
                        padding: "8px 12px",
                        borderRadius: 8,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        boxSizing: "border-box",
                      }}
                    >
                      <span>Điều hành lớp</span>
                      <Icon name="chevronRight" size={14} />
                    </Link>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <Link
                        className="button button-subtle button-small"
                        to={`/app/teaching/classes/${x.classId}/roster`}
                        title="Danh sách sinh viên và sĩ số"
                        style={{
                          textAlign: "center",
                          justifyContent: "center",
                          textDecoration: "none",
                          fontSize: 12,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 8px",
                          borderRadius: 8,
                          boxSizing: "border-box",
                        }}
                      >
                        <Icon name="users" size={13} />
                        <span>Sĩ số</span>
                      </Link>
                      <Link
                        className="button button-subtle button-small"
                        to={`/app/teaching/classes/${x.classId}/schedule`}
                        title="Thời khóa biểu và lịch học"
                        style={{
                          textAlign: "center",
                          justifyContent: "center",
                          textDecoration: "none",
                          fontSize: 12,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 8px",
                          borderRadius: 8,
                          boxSizing: "border-box",
                        }}
                      >
                        <Icon name="calendar" size={13} />
                        <span>Lịch học</span>
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          );
        }}
      </State>
      <ClassCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          q.retry();
        }}
      />
    </div>
  );
}

export function ClassCreateModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (data: C & { joinCode?: string }) => void;
}) {
  const nav = useNavigate();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

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
      setBusy(false);
      onClose();
      if (onCreated) {
        onCreated(r.data as C & { joinCode?: string });
      } else if (r.data?.classId) {
        nav(`/app/teaching/classes/${r.data.classId}`, {
          state: { joinCode: (r.data as C & { joinCode?: string }).joinCode },
        });
      }
    } catch (x) {
      setMsg(lecturerError(x));
      setBusy(false);
    }
  }

  return (
    <div
      className="admin-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="class-create-modal-title"
    >
      <div className="admin-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="admin-modal-header">
          <div>
            <p className="eyebrow" style={{ margin: 0, color: "var(--blue, #0284c7)" }}>
              LỚP HỌC · THIẾT LẬP MỚI
            </p>
            <h2 id="class-create-modal-title" style={{ margin: "4px 0 0" }}>
              Tạo Lớp Học Mới
            </h2>
            <p className="subtext" style={{ margin: "4px 0 0" }}>
              Thiết lập lớp học phần, loại hình đào tạo và sĩ số tối đa.
            </p>
          </div>
          <button type="button" className="admin-modal-close-btn" onClick={onClose} aria-label="Đóng">
            ✕
          </button>
        </div>

        {msg && (
          <div
            className="dashboard-banner-notice"
            role="alert"
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              borderColor: "var(--coral, #ef4444)",
              color: "var(--coral, #ef4444)",
              marginBottom: 16,
            }}
          >
            <span>✕</span>
            <span>{msg}</span>
          </div>
        )}

        <form className="form-panel form-grid" onSubmit={(e) => void create(e)}>
          <Field
            label="Tên lớp"
            name="name"
            placeholder="Ví dụ: Cơ sở dữ liệu Nâng cao - Nhóm 01 (Khai giảng T9)"
            required
          />
          <label>
            Loại hình đào tạo
            <select name="classKind" defaultValue="INSTITUTIONAL">
              <option value="INSTITUTIONAL">Lớp trường học / tổ chức (tham gia bằng mã)</option>
              <option value="LIVE_COHORT">Lớp theo khóa / thanh toán</option>
              <option value="PRIVATE">Lớp riêng</option>
            </select>
          </label>
          <CatalogCourseSelect name="linkedCourseId" label="Liên kết khóa học" />
          <p className="subtext" style={{ marginTop: -8, marginBottom: 8 }}>
            Tùy chọn. Có thể tạo lớp độc lập với khóa học; nếu liên kết, chọn khóa học đã xuất bản.
          </p>
          <Field
            label="Số học viên tối đa"
            name="maxMembers"
            type="number"
            defaultValue={100}
            min={1}
            required
          />
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              justifyContent: "flex-end",
              marginTop: 16,
            }}
          >
            <button type="button" className="button button-subtle" onClick={onClose} disabled={busy}>
              Hủy &amp; Quay lại
            </button>
            <button className="button" disabled={busy}>
              {busy ? "Đang tạo lớp…" : "+ Tạo lớp học"}
            </button>
          </div>
        </form>
      </div>
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
        nav(`/app/teaching/classes/${r.data.classId}`, {
          state: { joinCode: (r.data as C & { joinCode?: string }).joinCode },
        });
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
            <option value="INSTITUTIONAL">Lớp trường học / tổ chức (tham gia bằng mã)</option>
            <option value="LIVE_COHORT">Lớp theo khóa / thanh toán</option>
            <option value="PRIVATE">Lớp riêng</option>
          </select>
        </label>
        <CatalogCourseSelect name="linkedCourseId" label="Liên kết khóa học" />
        <p className="subtext" style={{ marginTop: -8, marginBottom: 8 }}>
          Tùy chọn. Có thể tạo lớp độc lập với khóa học; nếu liên kết, chọn khóa học đã xuất bản.
        </p>
        <Field
          label="Số học viên tối đa"
          name="maxMembers"
          type="number"
          defaultValue={100}
          min={1}
          required
        />
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
  const location = useLocation();
  const navigate = useNavigate();
  const { classId = "" } = useParams(),
    q = useLecturer<C>(`/classes/${classId}`),
    [msg, setMsg] = useState(""),
    [imageBusy, setImageBusy] = useState(false),
    [joinCode, setJoinCode] = useState(
      () => (location.state as { joinCode?: string } | null)?.joinCode ?? "",
    );
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
  async function uploadImage(kind: "photoDataUrl" | "coverDataUrl", file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) {
      setMsg("Chọn ảnh PNG, JPEG hoặc WebP không quá 20 MB.");
      return;
    }
    setImageBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      let dataUrl = "";
      try {
        for (const width of [1200, 960, 720, 560]) {
          const ratio = Math.min(1, width / bitmap.width);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
          canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
          canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const candidate = canvas.toDataURL("image/jpeg", 0.65);
          if (Math.floor(((candidate.length - candidate.indexOf(",") - 1) * 3) / 4) <= 256 * 1024) {
            dataUrl = candidate;
            break;
          }
        }
      } finally {
        bitmap.close();
      }
      if (!dataUrl) throw new Error("IMAGE_TOO_LARGE");
      await lecturerRequest(`/classes/${classId}`, "PATCH", { [kind]: dataUrl });
      setMsg("Đã lưu ảnh lớp.");
      q.retry();
    } catch (error) {
      setMsg(
        error instanceof Error && error.message === "IMAGE_TOO_LARGE"
          ? "Ảnh quá lớn sau khi nén. Hãy chọn ảnh khác."
          : lecturerError(error),
      );
    } finally {
      setImageBusy(false);
    }
  }
  async function deleteClass() {
    if (
      !window.confirm(
        "Xóa lớp này? Chỉ lớp nháp chưa có học viên, buổi học hoặc khóa học liên kết mới có thể xóa.",
      )
    )
      return;
    try {
      await lecturerRequest(`/classes/${classId}`, "DELETE");
      navigate("/app/teaching/classes", { replace: true });
    } catch (error) {
      setMsg(lecturerError(error));
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
            {x.coverDataUrl && (
              <img
                src={x.coverDataUrl}
                alt="Ảnh bìa lớp"
                style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 16 }}
              />
            )}
            {x.photoDataUrl && (
              <img
                src={x.photoDataUrl}
                alt="Ảnh lớp"
                style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 16, marginTop: 12 }}
              />
            )}
            <p>
              {x.classKind} · tối đa {x.maxMembers} học viên
            </p>
            <div className="form-panel" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <label>
                Ảnh lớp{" "}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={imageBusy}
                  onChange={(e) => void uploadImage("photoDataUrl", e.currentTarget.files?.[0])}
                />
              </label>
              <label>
                Ảnh bìa{" "}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={imageBusy}
                  onChange={(e) => void uploadImage("coverDataUrl", e.currentTarget.files?.[0])}
                />
              </label>
              <span className="subtext">Ảnh được tự thu nhỏ trước khi lưu.</span>
            </div>
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
            <button type="button" className="button button-subtle" onClick={() => void deleteClass()}>
              Xóa lớp
            </button>
            {/* Quick Management Hub */}
            <div className="workspace-quick-actions" style={{ margin: "1.5rem 0" }}>
              <Link className="quick-action-chip" to={`/app/teaching/classes/${classId}/roster`}>
                <span className="chip-icon">
                  <Icon name="users" size={16} />
                </span>
                <span>Danh sách lớp & Học viên</span>
              </Link>
              <Link className="quick-action-chip" to={`/app/teaching/classes/${classId}/schedule`}>
                <span className="chip-icon">
                  <Icon name="calendar" size={16} />
                </span>
                <span>Lịch dạy & Điểm danh</span>
              </Link>
              <Link className="quick-action-chip" to={`/app/teaching/classes/${classId}/announcements`}>
                <span className="chip-icon">
                  <Icon name="bell" size={16} />
                </span>
                <span>Thông báo lớp</span>
              </Link>
              <Link className="quick-action-chip" to={`/app/teaching/discussion/CLASS/${classId}`}>
                <span className="chip-icon">
                  <Icon name="message" size={16} />
                </span>
                <span>Thảo luận lớp</span>
              </Link>
              <button type="button" className="quick-action-chip" onClick={() => void reset()}>
                <span className="chip-icon">
                  <Icon name="refresh" size={16} />
                </span>
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
    detail = useLecturer<C>(`/classes/${classId}`),
    [search, setSearch] = useState(""),
    [message, setMessage] = useState(""),
    [busyId, setBusyId] = useState(""),
    [warningStudentId, setWarningStudentId] = useState(""),
    [warningReason, setWarningReason] = useState("");
  async function warn(member: Member) {
    if (warningReason.trim().length < 5 || warningReason.trim().length > 500) {
      setMessage("Nội dung cảnh báo cần từ 5 đến 500 ký tự.");
      return;
    }
    setBusyId(member.studentId);
    try {
      await lecturerRequest(`/classes/${classId}/members/${member.studentId}/warnings`, "POST", {
        reason: warningReason.trim(),
      });
      setMessage(`Đã gửi cảnh báo đến ${member.displayName}.`);
      setWarningStudentId("");
      setWarningReason("");
    } catch (error) {
      setMessage(lecturerError(error));
    } finally {
      setBusyId("");
    }
  }
  async function remove(member: Member) {
    if (!window.confirm(`Xóa ${member.displayName} khỏi lớp? Học viên sẽ mất quyền truy cập lớp.`)) return;
    setBusyId(member.studentId);
    try {
      await lecturerRequest(`/classes/${classId}/members/${member.studentId}`, "DELETE", {});
      setMessage(`Đã xóa ${member.displayName} khỏi lớp.`);
      q.retry();
    } catch (error) {
      setMessage(lecturerError(error));
    } finally {
      setBusyId("");
    }
  }
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
          <p className="lead">Theo dõi hồ sơ học viên, ngày đăng ký tài khoản và thời điểm tham gia lớp.</p>
        </div>
        <Link className="button button-subtle" to={`/app/teaching/classes/${classId}`}>
          ← Quay lại lớp
        </Link>
      </div>
      <p role="status">{message}</p>
      <p className="subtext">Màu xanh: tài khoản đăng ký trong 21 ngày. Màu trung tính: học viên cũ.</p>

      <State q={q}>
        {(v) => {
          const rawItems = Array.isArray(v) ? v : v.members || [];
          const items = rawItems.filter(
            (m) =>
              m.studentId.toLowerCase().includes(search.toLowerCase()) ||
              m.displayName.toLowerCase().includes(search.toLowerCase()) ||
              m.emailMasked.toLowerCase().includes(search.toLowerCase()) ||
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
                    placeholder="Tìm theo tên, email, mã học viên..."
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
                        <th>Học viên</th>
                        <th>Ngày đăng ký</th>
                        <th>Nguồn Tham Gia</th>
                        <th>Ngày Tham Gia</th>
                        <th>Trạng Thái</th>
                        <th>Quản lý</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((m, idx) => (
                        <tr
                          key={m.membershipId}
                          style={{ background: isNewStudent(m.createdAt) ? "#ECFDF5" : "#F8FAFC" }}
                        >
                          <td>{idx + 1}</td>
                          <td>
                            <strong>{m.displayName}</strong>{" "}
                            <span style={{ color: isNewStudent(m.createdAt) ? "#047857" : "#475569" }}>
                              {isNewStudent(m.createdAt) ? "Mới" : "Cũ"}
                            </span>
                            <br />
                            <small>{m.emailMasked}</small>
                            <br />
                            <code className="code-badge">{m.studentId}</code>
                          </td>
                          <td>{new Date(m.createdAt).toLocaleDateString("vi-VN")}</td>
                          <td>
                            <strong>
                              {m.source === "OFFERING"
                                ? "Đợt tuyển sinh"
                                : m.source === "JOIN_CODE"
                                  ? "Mã mời lớp"
                                  : m.source}
                            </strong>
                          </td>
                          <td>
                            <span className="time-sub">
                              {new Date(m.joinedAt).toLocaleDateString("vi-VN")}
                            </span>
                          </td>
                          <td>
                            <StateChip state={m.state} />
                          </td>
                          <td>
                            <button
                              type="button"
                              disabled={!!busyId}
                              onClick={() => {
                                setWarningStudentId(m.studentId);
                                setWarningReason("");
                              }}
                            >
                              Cảnh báo
                            </button>{" "}
                            {warningStudentId === m.studentId && (
                              <div style={{ display: "grid", gap: 6, minWidth: 220, margin: "8px 0" }}>
                                <label>
                                  Nội dung gửi cho {m.displayName}
                                  <textarea
                                    value={warningReason}
                                    onChange={(event) => setWarningReason(event.target.value)}
                                    minLength={5}
                                    maxLength={500}
                                    rows={3}
                                  />
                                </label>
                                <button type="button" disabled={!!busyId} onClick={() => void warn(m)}>
                                  Gửi cảnh báo
                                </button>
                                <button type="button" onClick={() => setWarningStudentId("")}>
                                  Hủy
                                </button>
                              </div>
                            )}
                            <button
                              type="button"
                              disabled={
                                !!busyId ||
                                detail.data?.scheduleState === "PUBLISHED" ||
                                m.source !== "JOIN_CODE"
                              }
                              title="Chỉ xóa học viên tham gia bằng mã khi lịch lớp chưa xuất bản"
                              onClick={() => void remove(m)}
                            >
                              Xóa khỏi lớp
                            </button>
                          </td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={7} className="table-empty-row">
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
  const { sessionId = "" } = useParams();
  const q = useLecturer<S>(`/class-sessions/${sessionId}`);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    startAt: "",
    endAt: "",
    timezone: "Asia/Ho_Chi_Minh",
    location: "",
    meetingProvider: "",
    meetingUrl: "",
  });

  useEffect(() => {
    const value = q.data;
    if (!value) return;
    const inputDate = (iso: string) => {
      const date = new Date(iso);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    };
    setForm({
      title: value.title,
      startAt: inputDate(value.startAt),
      endAt: inputDate(value.endAt),
      timezone: value.timezone || "Asia/Ho_Chi_Minh",
      location: value.location || "",
      meetingProvider: value.meetingProvider || "",
      meetingUrl: value.meetingUrl || "",
    });
  }, [q.data]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!q.data?.classId) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const start = new Date(form.startAt);
      const end = new Date(form.endAt);
      if (
        !form.title.trim() ||
        !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) ||
        end <= start
      )
        throw new Error("Tiêu đề và khoảng thời gian buổi học chưa hợp lệ.");
      await lecturerRequest(`/classes/${q.data.classId}/sessions/${sessionId}`, "PATCH", {
        title: form.title.trim(),
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        timezone: form.timezone.trim() || "Asia/Ho_Chi_Minh",
        ...(q.data.mode === "ONLINE"
          ? { meetingProvider: form.meetingProvider.trim(), meetingUrl: form.meetingUrl.trim() }
          : { location: form.location.trim() }),
      });
      setEditing(false);
      setMessage("Đã lưu thay đổi buổi học.");
      q.retry();
    } catch (value) {
      setError(value instanceof Error ? value.message : lecturerError(value));
    } finally {
      setSaving(false);
    }
  }
  return (
    <State q={q}>
      {(x) => (
        <>
          <Breadcrumbs
            items={[{ label: "Lớp học", to: "/app/teaching/classes" }, { label: "Chi tiết buổi học" }]}
          />
          <p className="eyebrow">{x.status}</p>
          <h1>{x.title}</h1>
          <p>
            {new Date(x.startAt).toLocaleString("vi-VN")} — {new Date(x.endAt).toLocaleString("vi-VN")}
          </p>
          {x.status !== "CANCELLED" && !editing && (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setMessage("");
                setError("");
                setEditing(true);
              }}
            >
              Chỉnh sửa buổi học
            </button>
          )}
          {editing && x.status !== "CANCELLED" && (
            <form className="form-grid" onSubmit={(event) => void save(event)} style={{ margin: "1rem 0" }}>
              <label>
                Tiêu đề
                <input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  required
                />
              </label>
              <label>
                Bắt đầu
                <input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(event) => setForm({ ...form, startAt: event.target.value })}
                  required
                />
              </label>
              <label>
                Kết thúc
                <input
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(event) => setForm({ ...form, endAt: event.target.value })}
                  required
                />
              </label>
              <label>
                Múi giờ
                <input
                  value={form.timezone}
                  onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                  required
                />
              </label>
              {x.mode === "ONLINE" ? (
                <>
                  <label>
                    Nhà cung cấp phòng họp
                    <input
                      value={form.meetingProvider}
                      onChange={(event) => setForm({ ...form, meetingProvider: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    URL phòng họp
                    <input
                      type="url"
                      value={form.meetingUrl}
                      onChange={(event) => setForm({ ...form, meetingUrl: event.target.value })}
                      required
                    />
                  </label>
                </>
              ) : (
                <label>
                  Địa điểm
                  <input
                    value={form.location}
                    onChange={(event) => setForm({ ...form, location: event.target.value })}
                    required
                  />
                </label>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="button" type="submit" disabled={saving}>
                  {saving ? "Đang lưu…" : "Lưu thay đổi"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                >
                  Hủy
                </button>
              </div>
            </form>
          )}
          {message && <p role="status">{message}</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <Link
            className="button"
            to={`/app/teaching/sessions/${sessionId}/attendance${x.classId ? `?class=${x.classId}` : ""}`}
          >
            Điểm danh
          </Link>
        </>
      )}
    </State>
  );
}
export function Attendance() {
  const { sessionId = "" } = useParams();
  const [params] = useSearchParams();
  const query = useLecturer<A[] | { attendance: A[] }>(`/class-sessions/${sessionId}/attendance`);
  const sessionQuery = useLecturer<S>(
    !params.get("class") && sessionId ? `/class-sessions/${sessionId}` : null,
  );
  const classId = params.get("class") || sessionQuery.data?.classId || "";
  const membersQuery = useLecturer<Member[] | { members: Member[] }>(
    classId ? `/classes/${classId}/members` : null,
  );

  const nameMap = new Map<string, string>();
  const membersList =
    (Array.isArray(membersQuery.data) ? membersQuery.data : membersQuery.data?.members) || [];
  for (const m of membersList) {
    if (m.displayName) nameMap.set(m.studentId, m.displayName);
  }

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const rows = (Array.isArray(query.data) ? query.data : query.data?.attendance) ?? [];
  async function update(row: A, status: string) {
    setBusy(true);
    setMessage("");
    try {
      await lecturerRequest(
        `/class-sessions/${sessionId}/attendance/${row.studentId}`,
        "PUT",
        { attendanceStatus: status },
        { "If-Match": `"v${row.attendanceVersion}"` },
      );
      query.retry();
      setMessage("Đã lưu điểm danh.");
    } catch (error) {
      setMessage(lecturerError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Lớp học", to: "/app/teaching/classes" },
          ...(classId ? [{ label: "Chi tiết lớp", to: `/app/teaching/classes/${classId}` }] : []),
          { label: "Buổi học", to: `/app/teaching/sessions/${sessionId}` },
          { label: "Điểm danh" },
        ]}
      />
      <div className="section-header" style={{ marginTop: "1rem" }}>
        <div>
          <h1>Điểm danh buổi học</h1>
          <div
            style={{
              marginTop: "0.5rem",
              padding: "0.75rem 1rem",
              borderRadius: 8,
              background: "var(--surface-muted, #f8fafc)",
              border: "1px solid var(--border)",
            }}
          >
            <strong>
              {sessionQuery.data?.mode === "ONLINE"
                ? "🌐 Buổi học trực tuyến (Online)"
                : "🏫 Buổi học trực tiếp (Offline)"}
            </strong>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.9rem", color: "var(--muted)" }}>
              {sessionQuery.data?.mode === "ONLINE"
                ? "Điểm danh tự động & thủ công: Hệ thống tự động ghi nhận khi học viên tham gia phòng học trực tuyến. Giảng viên có thể điểm danh hoặc ghi đè thủ công (Có mặt / Vắng / Có phép) bất cứ lúc nào."
                : "Điểm danh trực tiếp tại lớp: Giảng viên điểm danh thủ công theo danh sách bằng cách tích chọn Có mặt, Vắng, hoặc Có phép cho từng học viên."}
            </p>
          </div>
        </div>
      </div>
      <label>
        Tìm học viên (tên hoặc ID)
        <input
          placeholder="Nhập tên hoặc mã ID học viên..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {message && <p role="status">{message}</p>}
      <State q={query}>
        {() =>
          rows.length ? (
            <div className="attendance-scroll">
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>Học viên</th>
                    <th>Trạng thái</th>
                    <th>Nguồn ghi nhận</th>
                    <th>Cập nhật thủ công</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => {
                      const name = nameMap.get(r.studentId) || "";
                      return (
                        r.studentId.toLowerCase().includes(search.toLowerCase()) ||
                        name.toLowerCase().includes(search.toLowerCase())
                      );
                    })
                    .map((row) => (
                      <tr key={row.studentId}>
                        <td>
                          <strong>{nameMap.get(row.studentId) || row.studentId}</strong>
                          {nameMap.has(row.studentId) && (
                            <small style={{ display: "block", color: "var(--muted)", fontSize: "11px" }}>
                              {row.studentId}
                            </small>
                          )}
                        </td>
                        <td>
                          {row.attendanceStatus === "PRESENT"
                            ? "Có mặt"
                            : row.attendanceStatus === "EXCUSED"
                              ? "Có phép"
                              : row.attendanceStatus === "ABSENT"
                                ? "Vắng"
                                : "Chưa ghi nhận"}
                        </td>
                        <td>
                          {row.source === "ONLINE_PRESENCE"
                            ? `Tự động (Realtime) · ${row.presenceState === "ONLINE" ? "đang kết nối" : "đã rời phòng"}`
                            : row.source === "MANUAL_OFFLINE"
                              ? "Thủ công · giảng viên"
                              : "Chưa có dữ liệu"}
                        </td>
                        <td>
                          <select
                            aria-label={`Điểm danh ${nameMap.get(row.studentId) || row.studentId}`}
                            value={
                              row.attendanceStatus === "NOT_RECORDED" ? "UNMARKED" : row.attendanceStatus
                            }
                            disabled={busy}
                            onChange={(e) => void update(row, e.target.value)}
                          >
                            <option value="UNMARKED" disabled>
                              Chưa ghi nhận
                            </option>
                            <option value="PRESENT">Có mặt</option>
                            <option value="ABSENT">Vắng</option>
                            <option value="EXCUSED">Có phép</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Chưa có học viên để điểm danh trong buổi học này.</p>
          )
        }
      </State>
    </>
  );
}
