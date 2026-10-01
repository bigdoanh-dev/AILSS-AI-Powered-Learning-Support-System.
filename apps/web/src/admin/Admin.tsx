import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Outlet, useParams, useSearchParams } from "react-router-dom";
import { sessionRequest, useSession } from "../auth/session";
import { adminError, adminRequest } from "./api";
import { useAdminData } from "./useAdminData";
import { request, errorMessage, priceLabel, type Course, type Catalog } from "../lib/api";
import { useCourseCategories } from "../lib/course-categories";
import { Icon } from "../components/Icon";

export { default as RevenueDashboard } from "./RevenueDashboard";
export { default as StatsDashboard } from "./StatsDashboard";
export { default as LogsDashboard } from "./LogsDashboard";
export { default as SettingsDashboard } from "./SettingsDashboard";

type Role = "STUDENT" | "LECTURER" | "ADMIN";
type Status = "ACTIVE" | "SUSPENDED";
type User = {
  userId: string;
  displayName: string;
  emailMasked?: string;
  role: Role;
  status: Status;
  lecturerVerified: boolean;
  profileVersion: number;
  createdAt?: string;
  updatedAt: string;
};

export function AdminGuard() {
  const { state, profile } = useSession();
  if (state !== "AUTHENTICATED" && state !== "REFRESHING") return <p role="status">Đang xác minh phiên…</p>;
  return profile?.role === "ADMIN" ? <Outlet /> : <Navigate to="/app" replace />;
}

export function AdminHome() {
  const { profile } = useSession();
  const stats = useAdminData<{ students: number; lecturers: number; admins: number; suspended: number }>(
    "/dashboard/stats",
  );
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">BẢNG ĐIỀU KHIỂN QUẢN TRỊ</p>
          <h1>Chào {profile?.displayName}, cùng quản lý AILSS.</h1>
          <p className="lead">Quản lý thành viên, xác minh giảng viên và chăm sóc cộng đồng học tập.</p>
        </div>
        <Link className="button" to="/app/admin/users?role=LECTURER">
          Xác minh giảng viên
        </Link>
      </div>

      <div className="workspace-kpi-grid">
        {[
          { label: "Học viên đang hoạt động", value: stats.data?.students },
          { label: "Giảng viên đang hoạt động", value: stats.data?.lecturers },
          { label: "Quản trị viên đang hoạt động", value: stats.data?.admins },
          { label: "Tài khoản tạm khóa", value: stats.data?.suspended },
        ].map((x) => (
          <div className="kpi-card" key={x.label}>
            <div className="kpi-value">{x.value ?? "—"}</div>
            <div className="kpi-label">{x.label}</div>
          </div>
        ))}
      </div>
      {stats.error && <p role="alert">{stats.error}</p>}
      <div className="workspace-quick-actions" role="toolbar" aria-label="Thao tác quản trị nhanh">
        <Link className="quick-action-chip" to="/app/admin/revenue">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="card" size={16} />
          </span>
          <span>Doanh thu & SePay</span>
        </Link>
        <Link className="quick-action-chip" to="/app/admin/stats">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="chart" size={16} />
          </span>
          <span>Thống kê học tập</span>
        </Link>
        <Link className="quick-action-chip" to="/app/admin/monitoring">
          Prometheus &amp; Grafana
        </Link>
        <Link className="quick-action-chip" to="/app/admin/logs">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="receipt" size={16} />
          </span>
          <span>Nhật ký Logs</span>
        </Link>
        <Link className="quick-action-chip" to="/app/admin/users">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="users" size={16} />
          </span>
          <span>Tra cứu tài khoản</span>
        </Link>
        <Link className="quick-action-chip" to="/app/admin/users?role=LECTURER">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="graduation" size={16} />
          </span>
          <span>Xác minh giảng viên</span>
        </Link>
        <Link className="quick-action-chip" to="/app/admin/courses">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="book" size={16} />
          </span>
          <span>Duyệt khóa học</span>
        </Link>
        <Link className="quick-action-chip" to="/app/admin/moderation">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="shield" size={16} />
          </span>
          <span>Trung tâm kiểm duyệt</span>
        </Link>
        <Link className="quick-action-chip" to="/app/admin/settings">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="settings" size={16} />
          </span>
          <span>Cài đặt hệ thống</span>
        </Link>
      </div>

      <div className="admin-overview">
        <section className="admin-welcome">
          <div>
            <div className="admin-welcome-top">
              <span className="admin-symbol" aria-hidden="true">
                <Icon name="shield" size={32} />
              </span>
              <span className="kpi-tag accent">Hệ thống điều hành</span>
            </div>
            <h2>Một không gian học tập được chăm sóc.</h2>
            <p>
              Theo dõi và giải quyết kịp thời các báo cáo vi phạm, hồ sơ giảng viên chờ duyệt và đảm bảo môi
              trường học tập trực tuyến an toàn, tin cậy.
            </p>
          </div>
          <Link className="button" to="/app/admin/moderation">
            <Icon name="shield" size={16} /> Trung tâm kiểm duyệt nội dung →
          </Link>
        </section>
        <div className="workspace-cards">
          <Card
            title="Doanh thu & SePay"
            icon={<Icon name="card" size={20} />}
            badge="Tài chính"
            actionText="Xem báo cáo doanh thu →"
            to="/app/admin/revenue"
          >
            Báo cáo dòng tiền, đối soát thanh toán tự động SePay Webhook và khóa học có doanh thu cao nhất.
          </Card>
          <Card
            title="Thống kê học tập & AI"
            icon={<Icon name="chart" size={20} />}
            badge="Dữ liệu"
            actionText="Xem phân tích năng lực →"
            to="/app/admin/stats"
          >
            Thống kê tài khoản và các chỉ số học tập đã được tổng hợp từ hệ thống.
          </Card>
          <Card
            title="Nhật ký & Kiểm toán"
            icon={<Icon name="receipt" size={20} />}
            badge="Audit Trail"
            actionText="Tra cứu nhật ký an ninh →"
            to="/app/admin/logs"
          >
            Theo dõi chi tiết sự kiện xác thực, đối soát giao dịch SePay, kiểm duyệt và tác vụ quản trị.
          </Card>
          <Card
            title="Quản lý thành viên"
            icon={<Icon name="users" size={20} />}
            badge="Học viên & GV"
            actionText="Tra cứu tài khoản →"
            to="/app/admin/users"
          >
            Tra cứu thông tin, phân quyền, kiểm tra lịch sử và quản lý trạng thái tài khoản.
          </Card>
          <Card
            title="Xác minh giảng viên"
            icon={<Icon name="graduation" size={20} />}
            badge="Cần duyệt"
            actionText="Thẩm định hồ sơ →"
            to="/app/admin/users?role=LECTURER"
          >
            Thẩm định hồ sơ, bằng cấp chuyên môn của giảng viên đăng ký trực tiếp.
          </Card>
          <Card
            title="Kiểm định khóa học"
            icon={<Icon name="book" size={20} />}
            badge="Nội dung"
            actionText="Kiểm tra giáo trình →"
            to="/app/admin/courses"
          >
            Duyệt xuất bản, kiểm tra bài giảng và bảo vệ chất lượng đào tạo trên hệ thống.
          </Card>
          <Card
            title="Hồ sơ chuyển vai trò"
            icon={<Icon name="assignment" size={20} />}
            badge="Đơn thăng hạng"
            actionText="Xét duyệt yêu cầu →"
            to="/app/admin/lecturer-applications"
          >
            Xử lý nguyện vọng trở thành giảng viên từ tài khoản học viên hiện có.
          </Card>
          <Card
            title="Cài đặt hệ thống"
            icon={<Icon name="settings" size={20} />}
            badge="Bảo mật"
            actionText="Tùy chỉnh hệ thống →"
            to="/app/admin/settings"
          >
            Chính sách bảo mật phiên làm việc (Cold Start), cảnh báo giao dịch và dọn dẹp bộ nhớ đệm cache.
          </Card>
        </div>
      </div>
    </>
  );
}
function Card({
  title,
  to,
  icon,
  badge,
  actionText = "Xem chi tiết →",
  children,
}: {
  title: string;
  to: string;
  icon?: ReactNode;
  badge?: string;
  actionText?: string;
  children: ReactNode;
}) {
  return (
    <article className="governance-card">
      <div>
        <div className="card-top">
          {icon && (
            <span className="card-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          {badge && <span className="kpi-tag accent">{badge}</span>}
        </div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      <Link className="card-action-btn" to={to}>
        {actionText}
      </Link>
    </article>
  );
}

export function Users() {
  const [params, setParams] = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "LECTURER" ? "LECTURER" : "STUDENT"),
    [status, setStatus] = useState<Status>("ACTIVE");
  const [cursor, setCursor] = useState(""),
    [items, setItems] = useState<User[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [pending, setPending] = useState(true),
    [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [toast, setToast] = useState<string | null>(null);

  // Quick status change modal state
  const [quickUser, setQuickUser] = useState<User | null>(null);
  const [quickStatus, setQuickStatus] = useState<Status>("ACTIVE");
  const [quickReason, setQuickReason] = useState("");
  const [quickPassword, setQuickPassword] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickMsg, setQuickMsg] = useState("");

  async function load() {
    setPending(true);
    setMessage("");
    try {
      const q = new URLSearchParams({ role, status, limit: "25", ...(cursor ? { cursor } : {}) });
      const r = await adminRequest<User[]>("/users?" + q);
      setItems(r.data);
      setNext(r.meta?.pagination?.nextCursor || null);
    } catch (e) {
      setMessage(adminError(e));
    } finally {
      setPending(false);
    }
  }

  useEffect(() => {
    void load();
  }, [role, status, cursor]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleCopyId = (id: string) => {
    void navigator.clipboard?.writeText(id);
    showToast(`Đã sao chép User ID: ${id.slice(0, 8)}…`);
  };

  const openQuickModal = (u: User) => {
    setQuickUser(u);
    setQuickStatus(u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE");
    setQuickReason("");
    setQuickPassword("");
    setQuickMsg("");
  };

  const submitQuickStatus = async (e: FormEvent) => {
    e.preventDefault();
    if (!quickUser) return;
    setQuickBusy(true);
    setQuickMsg("");
    try {
      await adminRequest(`/users/${quickUser.userId}/status`, "PATCH", {
        status: quickStatus,
        currentPassword: quickPassword,
        ...(quickReason.trim() ? { reason: quickReason.trim() } : {}),
      });
      showToast(
        `Đã đổi trạng thái tài khoản ${quickUser.displayName} thành ${quickStatus === "ACTIVE" ? "Hoạt động" : "Tạm khóa"}`,
      );
      setQuickUser(null);
      await load();
    } catch (err) {
      setQuickMsg(adminError(err));
    } finally {
      setQuickBusy(false);
    }
  };

  const filteredItems = items.filter((u) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.userId.toLowerCase().includes(q) ||
      (u.emailMasked && u.emailMasked.toLowerCase().includes(q))
    );
  });

  return (
    <>
      <p className="eyebrow">ADMIN · QUẢN LÝ NGƯỜI DÙNG</p>
      <h1>Danh sách tài khoản & phân quyền.</h1>
      <p className="lead">
        Tra cứu danh sách sinh viên, giảng viên và quản trị viên; kiểm soát trạng thái hoạt động và thẩm định
        danh tính.
      </p>

      {/* Filter Row */}
      <div className="admin-filters">
        <label>
          Vai trò
          <select
            value={role}
            onChange={(e) => {
              setCursor("");
              setRole(e.target.value as Role);
              setParams({ role: e.target.value });
            }}
          >
            <option value="STUDENT">Sinh viên</option>
            <option value="LECTURER">Giảng viên</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <label>
          Trạng thái
          <select
            value={status}
            onChange={(e) => {
              setCursor("");
              setStatus(e.target.value as Status);
            }}
          >
            <option value="ACTIVE">Đang hoạt động</option>
            <option value="SUSPENDED">Tạm khóa</option>
          </select>
        </label>
      </div>

      {/* Toolbar: Search & View Toggle */}
      <div className="admin-table-toolbar">
        <div className="admin-search-input-wrap">
          <span className="admin-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            placeholder="Tìm kiếm theo họ tên, ID hoặc email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Tìm kiếm người dùng trong danh sách"
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span className="muted" style={{ fontSize: "13px" }}>
            Hiển thị <strong>{filteredItems.length}</strong> / {items.length} người dùng
          </span>

          <div className="admin-view-toggle" role="group" aria-label="Chế độ hiển thị">
            <button
              type="button"
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
              title="Dạng bảng danh sách"
            >
              📑 Danh sách
            </button>
            <button
              type="button"
              className={viewMode === "grid" ? "active" : ""}
              onClick={() => setViewMode("grid")}
              title="Dạng thẻ ô lưới"
            >
              🗂️ Ô lưới
            </button>
          </div>
        </div>
      </div>

      {pending ? (
        <p role="status">Đang tải người dùng…</p>
      ) : message ? (
        <div className="study-state" role="alert">
          <p>{message}</p>
          <button className="button secondary" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="study-state">
          {search
            ? `Không tìm thấy người dùng nào phù hợp với từ khóa "${search}".`
            : "Không có người dùng phù hợp."}
        </div>
      ) : viewMode === "list" ? (
        /* TABLE LIST VIEW */
        <div className="table-responsive">
          <table className="dashboard-data-table" role="table">
            <thead>
              <tr>
                <th scope="col">Người dùng</th>
                <th scope="col">Email</th>
                <th scope="col">Vai trò</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Xác minh GV</th>
                <th scope="col">Cập nhật</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((u) => {
                const roleClass = u.role.toLowerCase();
                const monogram = u.displayName
                  ? u.displayName
                      .split(" ")
                      .slice(-2)
                      .map((w) => w[0])
                      .join("")
                      .toUpperCase()
                  : "U";
                return (
                  <tr key={u.userId}>
                    <td>
                      <div className="user-avatar-cell">
                        <div className={`user-monogram ${roleClass}`}>{monogram}</div>
                        <div>
                          <div className="user-name-title">{u.displayName}</div>
                          <div className="user-id-code">
                            <span>
                              ID: {u.userId.slice(0, 8)}…{u.userId.slice(-4)}
                            </span>
                            <button
                              type="button"
                              className="copy-id-btn"
                              title="Sao chép toàn bộ ID"
                              onClick={() => handleCopyId(u.userId)}
                            >
                              📋
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="muted" style={{ fontSize: "13px" }}>
                        {u.emailMasked || `${u.displayName.toLowerCase().replace(/\s+/g, "")}@ailss.edu.vn`}
                      </span>
                    </td>
                    <td>
                      <span className={`admin-badge role-${roleClass}`}>
                        {u.role === "LECTURER"
                          ? "👨‍🏫 Giảng viên"
                          : u.role === "ADMIN"
                            ? "🛡️ Quản trị"
                            : "🎓 Sinh viên"}
                      </span>
                    </td>
                    <td>
                      <span className={`admin-badge ${u.status === "ACTIVE" ? "active" : "suspended"}`}>
                        {u.status === "ACTIVE" ? "● Hoạt động" : "🔒 Tạm khóa"}
                      </span>
                    </td>
                    <td>
                      {u.role === "LECTURER" ? (
                        <span className={`admin-badge ${u.lecturerVerified ? "verified" : "unverified"}`}>
                          {u.lecturerVerified ? "✓ Đã xác minh" : "⏳ Chưa xác minh"}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: "12px" }}>
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="time-sub">
                        {u.updatedAt ? new Date(u.updatedAt).toLocaleDateString("vi-VN") : "Hôm nay"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="button button-subtle button-small"
                          onClick={() => openQuickModal(u)}
                          title="Đổi trạng thái tài khoản"
                        >
                          Đổi trạng thái
                        </button>
                        <Link className="button button-small" to={"/app/admin/users/" + u.userId}>
                          Chi tiết →
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* GRID CARDS VIEW */
        <div className="admin-list">
          {filteredItems.map((u) => (
            <article key={u.userId} className="study-card study-card-rich">
              <div>
                <div className="study-card-top">
                  <span className="study-card-icon" aria-hidden="true">
                    <Icon
                      name={u.role === "LECTURER" ? "graduation" : u.role === "ADMIN" ? "shield" : "user"}
                      size={20}
                    />
                  </span>
                  <span className={`badge ${u.status === "ACTIVE" ? "status-success" : "status-pending"}`}>
                    {u.role === "LECTURER" ? "Giảng viên" : u.role === "ADMIN" ? "Quản trị" : "Sinh viên"} ·{" "}
                    {u.status === "ACTIVE" ? "Hoạt động" : "Tạm khóa"}
                  </span>
                </div>
                <h2>{u.displayName}</h2>
                <div className="user-id-code" style={{ marginBottom: "12px" }}>
                  <span>ID: {u.userId.slice(0, 12)}…</span>
                  <button
                    type="button"
                    className="copy-id-btn"
                    title="Sao chép toàn bộ ID"
                    onClick={() => handleCopyId(u.userId)}
                  >
                    📋
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", marginTop: "auto" }}>
                <button
                  type="button"
                  className="button button-subtle button-small"
                  onClick={() => openQuickModal(u)}
                >
                  Đổi trạng thái
                </button>
                <Link className="card-action-btn" to={"/app/admin/users/" + u.userId}>
                  Xem chi tiết →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Pagination Actions */}
      <div className="inline-actions" style={{ marginTop: "24px" }}>
        {next && (
          <button className="button secondary" onClick={() => setCursor(next)}>
            Trang tiếp theo →
          </button>
        )}
        <button
          className="plain-button"
          onClick={() => {
            setCursor("");
            void load();
          }}
        >
          Tải lại trang đầu
        </button>
      </div>

      {/* Quick Status Change Modal */}
      {quickUser && (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-status-title"
        >
          <div className="admin-modal-card">
            <div className="admin-modal-header">
              <div>
                <p className="eyebrow" style={{ margin: 0 }}>
                  THAO TÁC NHANH QUẢN TRỊ
                </p>
                <h2 id="quick-status-title">Đổi trạng thái người dùng</h2>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setQuickUser(null)}
                aria-label="Đóng cửa sổ"
              >
                ✕
              </button>
            </div>

            <div
              style={{
                marginBottom: "18px",
                padding: "12px",
                background: "var(--surface-soft, rgba(0,0,0,0.03))",
                borderRadius: "10px",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: "14.5px", marginBottom: "4px" }}>
                {quickUser.displayName}
              </div>
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>ID: {quickUser.userId}</div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                Trạng thái hiện tại:{" "}
                <strong>{quickUser.status === "ACTIVE" ? "Đang hoạt động" : "Tạm khóa"}</strong>
              </div>
            </div>

            <form onSubmit={(e) => void submitQuickStatus(e)}>
              <label style={{ display: "block", marginBottom: "14px" }}>
                Trạng thái mới
                <select
                  value={quickStatus}
                  onChange={(e) => setQuickStatus(e.target.value as Status)}
                  style={{ width: "100%", marginTop: "6px" }}
                >
                  <option value="ACTIVE">Đang hoạt động (ACTIVE)</option>
                  <option value="SUSPENDED">Tạm khóa tài khoản (SUSPENDED)</option>
                </select>
              </label>

              <label style={{ display: "block", marginBottom: "14px" }}>
                Lý do thay đổi (tùy chọn)
                <input
                  type="text"
                  placeholder="Ví dụ: Kiểm tra định kỳ, mở lại tài khoản theo yêu cầu..."
                  value={quickReason}
                  onChange={(e) => setQuickReason(e.target.value)}
                  style={{ width: "100%", marginTop: "6px" }}
                />
              </label>

              <label style={{ display: "block", marginBottom: "18px" }}>
                Mật khẩu Quản trị viên hiện tại (Xác thực bảo mật)
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Nhập mật khẩu admin..."
                  value={quickPassword}
                  onChange={(e) => setQuickPassword(e.target.value)}
                  style={{ width: "100%", marginTop: "6px" }}
                />
              </label>

              {quickMsg && (
                <div className="notice error" role="alert" style={{ marginBottom: "16px" }}>
                  <p>{quickMsg}</p>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  type="button"
                  className="button secondary"
                  disabled={quickBusy}
                  onClick={() => setQuickUser(null)}
                >
                  Hủy bỏ
                </button>
                <button type="submit" className="button" disabled={quickBusy || !quickPassword}>
                  {quickBusy ? "Đang xử lý…" : "Cập nhật trạng thái"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transient Toast Notification */}
      {toast && (
        <div className="admin-toast-notice" role="status">
          <span>✓</span>
          <span>{toast}</span>
        </div>
      )}
    </>
  );
}

export function UserDetail() {
  const { userId = "" } = useParams();
  const [user, setUser] = useState<User | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setMessage("");
    try {
      setUser((await adminRequest<User>("/users/" + userId)).data);
    } catch (e) {
      setMessage(adminError(e));
    }
  }
  useEffect(() => {
    void load();
  }, [userId]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMessage("");
    const data = new FormData(form);
    try {
      await adminRequest(`/users/${userId}/status`, "PATCH", {
        status: data.get("status"),
        currentPassword: String(data.get("currentPassword")),
        ...(String(data.get("reason")).trim() ? { reason: String(data.get("reason")).trim() } : {}),
      });
      form.reset();
      setMessage("Đã đổi trạng thái người dùng.");
      await load();
    } catch (error) {
      setMessage(adminError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to="/app/admin/users">← Danh sách người dùng</Link>
      <p className="eyebrow">CHI TIẾT THÀNH VIÊN</p>
      <h1>{user?.displayName || "Đang tải người dùng…"}</h1>
      {message && <p role="status">{message}</p>}
      {user && (
        <div className="account-grid">
          <section className="study-card">
            <h2>Thông tin tài khoản</h2>
            <dl className="profile-facts">
              <dt>Email</dt>
              <dd>{user.emailMasked}</dd>
              <dt>Vai trò</dt>
              <dd>{{ STUDENT: "Học viên", LECTURER: "Giảng viên", ADMIN: "Quản trị viên" }[user.role]}</dd>
              <dt>Trạng thái</dt>
              <dd>{user.status === "ACTIVE" ? "Đang hoạt động" : "Tạm khóa"}</dd>
              <dt>Xác minh GV</dt>
              <dd>{user.lecturerVerified ? "Đã xác minh" : "Chưa xác minh"}</dd>
              <dt>Phiên bản</dt>
              <dd>{user.profileVersion}</dd>
              <dt>Mã thành viên</dt>
              <dd>{user.userId}</dd>
            </dl>
          </section>
          {user.role === "LECTURER" && !user.lecturerVerified && (
            <form
              className="form-panel"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                setBusy(true);
                setMessage("");
                try {
                  await sessionRequest(
                    `admin/lecturers/${userId}/verify`,
                    "POST",
                    { currentPassword: String(new FormData(form).get("currentPassword")) },
                    crypto.randomUUID(),
                  );
                  form.reset();
                  await load();
                  setMessage("Đã xác minh giảng viên. Tài khoản có thể bắt đầu giảng dạy.");
                } catch (error) {
                  setMessage(adminError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2>Xác minh giảng viên</h2>
              <p>Kiểm tra thông tin trước khi mở quyền tạo khóa học và lớp học.</p>
              <label>
                Mật khẩu quản trị viên
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
              <button className="button" disabled={busy}>
                {busy ? "Đang xác minh…" : "Xác minh giảng viên"}
              </button>
            </form>
          )}
          <form className="form-panel" onSubmit={(e) => void submit(e)}>
            <h2>Đổi trạng thái tài khoản</h2>
            <label>
              Trạng thái mới
              <select name="status" defaultValue={user.status}>
                <option value="ACTIVE">Đang hoạt động</option>
                <option value="SUSPENDED">Tạm khóa</option>
              </select>
            </label>
            <label>
              Lý do (không bắt buộc)
              <input name="reason" maxLength={200} />
            </label>
            <label>
              Mật khẩu quản trị viên hiện tại
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <p className="muted">Hệ thống xác minh lại mật khẩu riêng cho thao tác này.</p>
            <button className="button" disabled={busy}>
              {busy ? "Đang xử lý…" : "Xác nhận đổi trạng thái"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export function CourseGovernance() {
  const categories = useCourseCategories();
  const [category, setCategory] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [cursor, setCursor] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const [resourceId, setResourceId] = useState("");
  const [action, setAction] = useState<"publish" | "archive">("publish");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [showGuide, setShowGuide] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const courseInputRef = useRef<HTMLInputElement>(null);

  const selectedCategory = category || categories[0]?.id;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isModalOpen) {
        setIsModalOpen(false);
        setMessage("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isModalOpen]);

  useEffect(() => {
    const controller = new AbortController();
    setCourses([]);
    setNext(null);
    if (!selectedCategory) return;
    setPending(true);
    setMessage("");
    void request<Catalog>(
      `/courses?categoryId=${selectedCategory}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setCourses(value.data);
          setNext(value.meta.pagination.nextCursor);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [selectedCategory, cursor, revision]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await adminRequest<{ state?: string }>(`/courses/${resourceId}/${action}`, "POST", {
        currentPassword: password,
      });
      setPassword("");
      setRevision((x) => x + 1);
      const stateStr = res?.data?.state ?? (action === "publish" ? "PUBLISHED" : "ARCHIVED");
      setMessage(
        action === "publish"
          ? `Đã xuất bản khóa học · ${stateStr}`
          : `Đã gửi yêu cầu lưu trữ khóa học · ${stateStr}`,
      );
    } catch (error) {
      setMessage(adminError(error));
    } finally {
      setBusy(false);
    }
  }

  const handleSelectCourse = (courseId: string) => {
    setResourceId(courseId);
    setMessage("");
    setIsModalOpen(true);
  };

  const handleCopyId = (id: string) => {
    void navigator.clipboard?.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleManualEntry = () => {
    setResourceId("");
    setMessage("");
    setIsModalOpen(true);
    setTimeout(() => courseInputRef.current?.focus(), 150);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setMessage("");
  };

  const selectedCourse = courses.find((c) => c.courseId === resourceId);

  const filteredCourses = courses.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.title.toLowerCase().includes(q) || c.courseId.toLowerCase().includes(q);
  });

  return (
    <div className="admin-course-governance animate-fade-in">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">QUẢN TRỊ NỘI DUNG · HỆ THỐNG KHÓA HỌC</p>
          <h1 id="admin-courses-title">Quản lý xuất bản khóa học.</h1>
          <p className="lead">
            Thẩm định chất lượng học liệu và kiểm soát vòng đời xuất bản (Publish/Archive) của toàn bộ khóa
            học trên hệ thống.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <button
            type="button"
            className="button button-subtle"
            onClick={() => setShowGuide(!showGuide)}
            title="Xem quy trình kiểm duyệt và xuất bản"
          >
            <Icon name="sparkles" size={15} />
            <span>{showGuide ? "Ẩn hướng dẫn quy trình" : "💡 Xem quy trình vận hành"}</span>
          </button>
          <span className="kpi-tag accent">{courses.length} khóa học</span>
        </div>
      </div>

      {/* Interactive Workflow Architectural Guide */}
      {showGuide && (
        <section className="admin-workflow-card animate-fade-in" aria-label="Quy trình vận hành khóa học">
          <div className="admin-workflow-header">
            <div className="admin-workflow-icon-wrap">
              <Icon name="shield" size={20} />
            </div>
            <div>
              <h3>Quy trình Vận hành &amp; Thẩm định Khóa học AILSS</h3>
              <p className="subtext">
                Hệ thống tuân thủ kiểm duyệt 3 bước trước khi cho phép học viên ghi danh hoặc thanh toán khóa
                học.
              </p>
            </div>
          </div>
          <div className="admin-workflow-steps">
            <div className="admin-workflow-step">
              <div className="admin-step-badge">Bước 1</div>
              <div className="admin-step-content">
                <h4>Giảng viên đệ trình</h4>
                <p>
                  Khóa học ở trạng thái <code>DRAFT</code> (Nháp). Giảng viên gửi mã định danh{" "}
                  <code>Course ID</code> cho Admin để đề xuất xuất bản.
                </p>
              </div>
            </div>
            <div className="admin-workflow-arrow" aria-hidden="true">
              →
            </div>
            <div className="admin-workflow-step">
              <div className="admin-step-badge">Bước 2</div>
              <div className="admin-step-content">
                <h4>Admin thẩm định học liệu</h4>
                <p>
                  Nhấp <strong>"Chi tiết công khai"</strong> để kiểm tra đề cương, video học thử, học liệu
                  đính kèm và cấu trúc giá bán.
                </p>
              </div>
            </div>
            <div className="admin-workflow-arrow" aria-hidden="true">
              →
            </div>
            <div className="admin-workflow-step">
              <div className="admin-step-badge">Bước 3</div>
              <div className="admin-step-content">
                <h4>Quyết định vòng đời</h4>
                <p>
                  <strong style={{ color: "#16a34a" }}>Xuất bản (PUBLISH):</strong> Niêm yết công khai trên
                  marketplace.
                  <br />
                  <strong style={{ color: "#d97706" }}>Lưu trữ (ARCHIVE):</strong> Tạm dừng niêm yết, bảo lưu
                  quyền học viên cũ.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Filter, Search & Quick Actions Toolbar */}
      <div className="admin-governance-toolbar">
        <label className="admin-filter-label">
          <span className="admin-filter-title">
            <Icon name="layers" size={15} /> Danh mục
          </span>
          <div className="admin-select-wrapper">
            <select
              value={selectedCategory ?? ""}
              onChange={(e) => {
                setCategory(e.target.value);
                setCursor("");
              }}
              className="admin-governance-select"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </label>

        <div className="admin-search-wrapper">
          <input
            type="search"
            placeholder="Tìm theo tên khóa học hoặc mã ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="admin-search-input"
            aria-label="Tìm kiếm khóa học"
          />
        </div>

        <div className="admin-toolbar-actions">
          <button
            type="button"
            className="button button-subtle"
            onClick={handleManualEntry}
            title="Dán mã UUID của khóa học do giảng viên cung cấp chưa xuất hiện trên danh mục"
          >
            <span>+ Nhập mã ID từ Giảng viên</span>
          </button>
          <button
            type="button"
            className="button secondary admin-reload-btn"
            onClick={() => setRevision((x) => x + 1)}
            disabled={pending}
            title="Tải lại danh sách"
          >
            <Icon name="refresh" size={15} />
            <span>Tải lại</span>
          </button>
        </div>
      </div>

      {/* Course Cards Grid */}
      {pending ? (
        <div className="admin-loading-state" role="status">
          <Icon name="refresh" size={26} className="spin-animation" />
          <p>Đang tải danh mục khóa học từ máy chủ…</p>
        </div>
      ) : filteredCourses.length ? (
        <div className="admin-courses-grid">
          {filteredCourses.map((c, i) => {
            const isSelected = resourceId === c.courseId;
            return (
              <article
                className={`study-card admin-course-card ${isSelected ? "is-selected-manage" : ""}`}
                key={c.courseId}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="admin-course-card-top">
                  <div className="admin-course-card-icon">
                    <Icon name="book" size={20} />
                  </div>
                  <div className="admin-course-card-badges">
                    <span className="status-pill status-success">● Đang xuất bản</span>
                    <span className="badge">{priceLabel(c)}</span>
                    {isSelected && <span className="status-pill status-active-target">★ Đang chọn</span>}
                  </div>
                </div>

                <h2 className="admin-course-title">{c.title}</h2>
                <p className="admin-course-price-text">{priceLabel(c)}</p>

                {/* Monospaced ID Tag with 1-click Copy */}
                <div className="admin-course-id-row">
                  <span className="admin-id-label">Mã ID:</span>
                  <code className="admin-course-id-tag" title={c.courseId}>
                    {c.courseId}
                  </code>
                  <button
                    type="button"
                    className="admin-id-copy-btn"
                    onClick={() => handleCopyId(c.courseId)}
                    title="Sao chép mã UUID khóa học"
                  >
                    <span>{copiedId === c.courseId ? "✓ Đã chép" : "📋 Sao chép"}</span>
                  </button>
                </div>

                <div className="admin-course-actions-bar">
                  <Link
                    to={`/courses/${c.courseId}`}
                    className="button button-small button-subtle admin-public-link"
                    title="Xem trang khóa học phía học viên"
                  >
                    <Icon name="eye" size={14} />
                    <span>Chi tiết công khai</span>
                  </Link>
                  <button
                    type="button"
                    className={`button button-small ${isSelected ? "admin-manage-active-btn" : "secondary"}`}
                    onClick={() => handleSelectCourse(c.courseId)}
                    title="Đưa khóa học này vào khung xử lý bên dưới"
                  >
                    <Icon name="settings" size={14} />
                    <span>{isSelected ? "✓ Đang chọn quản lý" : "Chọn quản lý"}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="admin-empty-state-box">
          <Icon name="book" size={32} />
          <p>
            {search.trim()
              ? `Không tìm thấy khóa học nào phù hợp với từ khóa "${search}".`
              : "Chưa có khóa học công khai trong danh mục này."}
          </p>
          <button type="button" className="button button-subtle" onClick={handleManualEntry}>
            + Xử lý khóa học mới bằng mã ID
          </button>
        </div>
      )}

      {/* Pagination row */}
      {next && (
        <div className="admin-governance-pagination-bar">
          <button className="button" onClick={() => setCursor(next)}>
            <span>Trang tiếp theo</span>
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      )}

      {/* Docked Active Course Bar when modal is closed */}
      {selectedCourse && !isModalOpen && (
        <div className="admin-active-course-dock animate-fade-in">
          <div className="admin-active-dock-info">
            <span className="badge">ĐANG CHỌN</span>
            <span className="admin-active-dock-title">{selectedCourse.title}</span>
            <code className="admin-active-dock-id">{selectedCourse.courseId}</code>
          </div>
          <div className="admin-active-dock-actions">
            <button type="button" className="button button-small" onClick={() => setIsModalOpen(true)}>
              <Icon name="settings" size={14} />
              <span>Mở bảng quản lý</span>
            </button>
            <button
              type="button"
              className="button button-small button-subtle"
              onClick={() => setResourceId("")}
              title="Bỏ chọn khóa học này"
            >
              ✕ Bỏ chọn
            </button>
          </div>
        </div>
      )}

      {/* Executive Modal Dialog with Backdrop Blur */}
      {isModalOpen && (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-course-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              handleCloseModal();
            }
          }}
        >
          <div className="admin-modal-card admin-course-modal-card">
            <div className="admin-modal-header">
              <div className="admin-modal-header-text">
                <div className="admin-panel-icon admin-modal-brand-icon">
                  <Icon name="shield" size={20} />
                </div>
                <div>
                  <p className="eyebrow" style={{ margin: 0 }}>
                    THAO TÁC QUẢN TRỊ VIÊN
                  </p>
                  <h2 id="admin-course-modal-title">Phê duyệt &amp; Quản trị Khóa học</h2>
                </div>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={handleCloseModal}
                aria-label="Đóng cửa sổ"
                title="Đóng (Esc)"
              >
                ✕
              </button>
            </div>

            {selectedCourse ? (
              <div className="admin-selected-course-banner admin-modal-course-banner">
                <div className="admin-selected-badge-group">
                  <span className="badge">KHÓA HỌC ĐƯỢC CHỌN</span>
                  <span className="status-pill status-success">● Đang hoạt động</span>
                  <span className="badge">{priceLabel(selectedCourse)}</span>
                </div>
                <div className="admin-selected-title">{selectedCourse.title}</div>
                <div className="admin-selected-meta">
                  <span>
                    Mã UUID: <code>{selectedCourse.courseId}</code>
                  </span>
                </div>
                <div className="admin-selected-actions">
                  <button
                    type="button"
                    className="admin-id-copy-btn"
                    onClick={() => handleCopyId(selectedCourse.courseId)}
                    title="Sao chép mã UUID khóa học"
                  >
                    <span>{copiedId === selectedCourse.courseId ? "✓ Đã chép mã" : "📋 Sao chép mã ID"}</span>
                  </button>
                  <Link
                    to={`/courses/${selectedCourse.courseId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="button button-subtle button-small"
                    title="Xem trang khóa học phía học viên"
                  >
                    <Icon name="eye" size={13} />
                    <span>Chi tiết công khai ↗</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="admin-target-course-hint admin-modal-hint">
                <Icon name="alert" size={18} />
                <span>Nhập hoặc dán mã định danh (UUID) của khóa học cần quản trị xuất bản bên dưới.</span>
              </div>
            )}

            <form
              className="form-panel admin-action admin-action-panel-modal"
              onSubmit={(event) => void submit(event)}
              ref={formRef}
            >
              <label>
                Mã khóa học
                <input
                  required
                  value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                  pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
                  placeholder="Ví dụ: 10000000-0000-4000-8000-000000000001"
                  ref={courseInputRef}
                />
              </label>

              <label>
                Thao tác
                <select value={action} onChange={(e) => setAction(e.target.value as "publish" | "archive")}>
                  <option value="publish">Xuất bản (PUBLISH) — Cho phép hiển thị trên Marketplace</option>
                  <option value="archive">
                    Lưu trữ (ARCHIVE) — Tạm ẩn khỏi sàn, ngừng nhận học viên mới
                  </option>
                </select>
              </label>

              <label>
                Mật khẩu quản trị viên hiện tại
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Nhập mật khẩu tài khoản quản trị để xác thực thẩm quyền"
                />
              </label>

              {message && (
                <div
                  role="status"
                  className={`admin-status-notice ${message.includes("Đã") ? "success" : "error"}`}
                >
                  <Icon name={message.includes("Đã") ? "checkCircle" : "alert"} size={16} />
                  <span>{message}</span>
                </div>
              )}

              <div className="admin-modal-action-row">
                <button type="button" className="button secondary" onClick={handleCloseModal}>
                  Đóng
                </button>
                <button className="button admin-submit-action-btn" disabled={busy}>
                  {busy ? "Đang xử lý…" : "Xác nhận thao tác"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
