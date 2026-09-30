import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Outlet, useParams, useSearchParams } from "react-router-dom";
import { sessionRequest, useSession } from "../auth/session";
import { adminError, adminRequest } from "./api";
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
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="zap" size={20} />
            </span>
            <span className="kpi-tag accent">Vận hành</span>
          </div>
          <div className="kpi-value">99.99%</div>
          <div className="kpi-label">SLA Vận hành & Liveness</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="shield" size={20} />
            </span>
            <span className="kpi-tag">Kiểm duyệt</span>
          </div>
          <div className="kpi-value">Sẵn sàng</div>
          <div className="kpi-label">Hàng đợi kiểm duyệt & báo cáo</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="graduation" size={20} />
            </span>
            <span className="kpi-tag accent">Giảng viên</span>
          </div>
          <div className="kpi-value">Xác minh</div>
          <div className="kpi-label">Thẩm định danh tính giảng viên</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="checkCircle" size={20} />
            </span>
            <span className="kpi-tag accent">Tuân thủ</span>
          </div>
          <div className="kpi-value">Đạt chuẩn</div>
          <div className="kpi-label">Bảo mật dữ liệu & Phân quyền</div>
        </div>
      </div>

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
            Cơ cấu 1.292 tài khoản, tỷ lệ hoàn thành khóa học và ma trận 6 cấp độ nhận thức Bloom.
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

interface CourseDocument {
  name: string;
  type: string;
  size: string;
  desc: string;
}

interface CourseReviewItem {
  id: string;
  author: string;
  rating: number;
  date: string;
  comment: string;
}

interface CourseCommentItem {
  id: string;
  author: string;
  date: string;
  content: string;
}

interface GovernanceCourse {
  courseId: string;
  title: string;
  categoryName: string;
  categoryId: string;
  lecturerName: string;
  lecturerId: string;
  rating: number;
  reviewCount: number;
  lessonsCount: number;
  quizzesCount: number;
  totalHours: string;
  studentsCount: number;
  price: string;
  priceType: "FREE" | "PAID";
  state: "PUBLISHED" | "DRAFT" | "ARCHIVED" | "LOCKED";
  nextLesson: string;
  updatedAt: string;
  documents: CourseDocument[];
  reviews: CourseReviewItem[];
  comments: CourseCommentItem[];
}

const SYSTEM_COURSES: GovernanceCourse[] = [
  {
    courseId: "10000000-0000-4000-8000-000000000001",
    title: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa SQL",
    categoryName: "Cơ sở dữ liệu",
    categoryId: "10000000-0000-4000-8000-000000000001",
    lecturerName: "TS. Nguyễn Minh Trí",
    lecturerId: "lec-01",
    rating: 4.8,
    reviewCount: 142,
    lessonsCount: 25,
    quizzesCount: 4,
    totalHours: "21.5h",
    studentsCount: 1250,
    price: "490.000 ₫",
    priceType: "PAID",
    state: "PUBLISHED",
    nextLesson: "Bài 5 - Kỹ thuật Sharding & Replication trong CSDL Phân tán",
    updatedAt: "Hôm nay 15:30",
    documents: [
      {
        name: "Giao-trinh-CSDL-Nang-Cao-2026.pdf",
        type: "PDF",
        size: "6.8 MB",
        desc: "Giáo trình hoàn chỉnh 12 chương tối ưu hóa câu truy vấn",
      },
      {
        name: "Slide-Bai-giang-Sharding-Replication.pptx",
        type: "PPTX",
        size: "14.2 MB",
        desc: "Slide bài giảng chuyên đề kiến trúc phân tán",
      },
      {
        name: "De-cuong-thuc-hanh-va-Database-dump.zip",
        type: "ZIP",
        size: "22.5 MB",
        desc: "Tệp dữ liệu mẫu 500.000 bản ghi phục vụ đo lường chỉ mục EXPLAIN",
      },
      {
        name: "Tong-hop-cheat-sheet-Index-PostgreSQL.pdf",
        type: "PDF",
        size: "2.1 MB",
        desc: "Sổ tay tra cứu nhanh B-Tree, GiST, GIN Index",
      },
    ],
    reviews: [
      {
        id: "rv-1",
        author: "Lê Văn Hùng (Sinh viên)",
        rating: 5,
        date: "15/09/2026",
        comment:
          "Khóa học rất sâu sắc, phần giải thích cơ chế Locking và MVCC của PostgreSQL cực kỳ dễ hiểu!",
      },
      {
        id: "rv-2",
        author: "Phạm Thùy Dương (Sinh viên)",
        rating: 5,
        date: "14/09/2026",
        comment: "Bài tập thực tế, hệ thống chấm điểm tự động phản hồi ngay khi nộp bài.",
      },
      {
        id: "rv-3",
        author: "Trần Bảo Nam (Học viên)",
        rating: 4,
        date: "12/09/2026",
        comment: "Nội dung chất lượng, hy vọng thầy bổ sung thêm chuyên đề về TimeSeries DB.",
      },
    ],
    comments: [
      {
        id: "cm-1",
        author: "Vũ Đình Trọng",
        date: "Hôm qua 18:20",
        content:
          "Thưa thầy, cho em hỏi khi đánh Composite Index thì thứ tự các cột ảnh hưởng thế nào đến index scan ạ?",
      },
      {
        id: "cm-2",
        author: "TS. Nguyễn Minh Trí",
        date: "Hôm qua 19:05",
        content:
          "Chào em, quy tắc Leftmost Prefix quyết định: cột lọc có tính chọn lọc cao nhất (high cardinality) nên đặt trước.",
      },
    ],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000002",
    title: "Lập trình Web & Trợ lý AI Fullstack",
    categoryName: "Lập trình Web",
    categoryId: "10000000-0000-4000-8000-000000000002",
    lecturerName: "ThS. Hoàng Quốc Bảo",
    lecturerId: "lec-02",
    rating: 4.9,
    reviewCount: 210,
    lessonsCount: 28,
    quizzesCount: 4,
    totalHours: "34.0h",
    studentsCount: 1890,
    price: "590.000 ₫",
    priceType: "PAID",
    state: "PUBLISHED",
    nextLesson: "Bài 4 - Tích hợp Vector Database & LLM với LangChain",
    updatedAt: "Hôm qua 20:15",
    documents: [
      {
        name: "Fullstack-AI-Assistant-Curriculum.pdf",
        type: "PDF",
        size: "5.4 MB",
        desc: "Lộ trình đào tạo React 19, FastAPI và tích hợp mô hình ngôn ngữ",
      },
      {
        name: "Source-code-Frontend-Backend-Boilerplate.zip",
        type: "ZIP",
        size: "31.8 MB",
        desc: "Khung dự án chuẩn Production tích hợp xác thực JWT và streaming SSR",
      },
      {
        name: "Kien-truc-RAG-Vector-Embeddings.pdf",
        type: "PDF",
        size: "4.1 MB",
        desc: "Sơ đồ kiến trúc Pipeline truy xuất tri thức bổ trợ (RAG)",
      },
    ],
    reviews: [
      {
        id: "rv-4",
        author: "Đỗ Thành Long (Kỹ sư phần mềm)",
        rating: 5,
        date: "16/09/2026",
        comment: "Rất thực chiến! Sau khóa học mình đã tự deploy được Chatbot AI nội bộ cho doanh nghiệp.",
      },
      {
        id: "rv-5",
        author: "Nguyễn Thị Ngọc",
        rating: 5,
        date: "13/09/2026",
        comment: "Giảng viên hỗ trợ nhiệt tình, giải đáp bug nhanh chóng trong cộng đồng.",
      },
    ],
    comments: [
      {
        id: "cm-3",
        author: "Hoàng Tuấn Anh",
        date: "Hôm nay 09:12",
        content: "Có bạn nào gặp lỗi CORS khi kết nối backend FastAPI với Vite dev server không ạ?",
      },
    ],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000003",
    title: "DevOps CI/CD Pipeline & Kubernetes Thực chiến",
    categoryName: "DevOps & Testing",
    categoryId: "10000000-0000-4000-8000-000000000003",
    lecturerName: "Kỹ sư Đặng Hải Nam",
    lecturerId: "lec-03",
    rating: 4.6,
    reviewCount: 96,
    lessonsCount: 20,
    quizzesCount: 4,
    totalHours: "18.0h",
    studentsCount: 840,
    price: "450.000 ₫",
    priceType: "PAID",
    state: "PUBLISHED",
    nextLesson: "Bài 6 - Thiết lập Automated Pipeline với GitHub Actions & ArgoCD",
    updatedAt: "14/09/2026",
    documents: [
      {
        name: "Giao-trinh-DevOps-Kubernetes.pdf",
        type: "PDF",
        size: "8.2 MB",
        desc: "Tài liệu thực hành Containerization và Orchestration",
      },
      {
        name: "Kubernetes-Manifests-Va-Helm-Charts.zip",
        type: "ZIP",
        size: "12.0 MB",
        desc: "Tập hợp file YAML mẫu triển khai Microservices lên Kube cluster",
      },
    ],
    reviews: [
      {
        id: "rv-6",
        author: "Lê Quang Khải",
        rating: 5,
        date: "11/09/2026",
        comment: "Giải thích tường tận về Ingress Controller và Rolling Update không gián đoạn dịch vụ.",
      },
      {
        id: "rv-7",
        author: "Ngô Nhật Minh",
        rating: 4,
        date: "09/09/2026",
        comment: "Khóa học hay, đề nghị cập nhật thêm bài giảng về Istio Service Mesh.",
      },
    ],
    comments: [],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000004",
    title: "Kỹ thuật Prompt Engineering & Tinh chỉnh LLM Cơ bản",
    categoryName: "Trí tuệ nhân tạo",
    categoryId: "10000000-0000-4000-8000-000000000004",
    lecturerName: "ThS. Đỗ Tuấn Kiệt",
    lecturerId: "lec-04",
    rating: 3.6, // < 4.0 -> LOW RATING (RED)
    reviewCount: 58,
    lessonsCount: 15,
    quizzesCount: 3,
    totalHours: "12.5h",
    studentsCount: 320,
    price: "350.000 ₫",
    priceType: "PAID",
    state: "PUBLISHED",
    nextLesson: "Bài 3 - Kỹ thuật Few-Shot & Chain-of-Thought trong giải toán",
    updatedAt: "10/09/2026",
    documents: [
      {
        name: "Prompt-Engineering-Cheatsheet-2026.pdf",
        type: "PDF",
        size: "3.2 MB",
        desc: "Bảng tổng hợp mẫu câu lệnh gợi ý cho các tác vụ NLP",
      },
    ],
    reviews: [
      {
        id: "rv-8",
        author: "Trần Đức Thắng (Sinh viên)",
        rating: 3,
        date: "08/09/2026",
        comment: "Nội dung hơi sơ sài, nhiều ví dụ còn chung chung chưa đi sâu vào Fine-tuning mô hình.",
      },
      {
        id: "rv-9",
        author: "Bùi Mai Phương (Học viên)",
        rating: 4,
        date: "06/09/2026",
        comment: "Bài giảng âm thanh có một số đoạn bị rè, mong thầy cô lọc âm tốt hơn.",
      },
      {
        id: "rv-10",
        author: "Vũ Huy Hoàng",
        rating: 3,
        date: "05/09/2026",
        comment: "Cần cập nhật các kỹ thuật mới của các mô hình năm 2026.",
      },
    ],
    comments: [
      {
        id: "cm-4",
        author: "Trần Đức Thắng",
        date: "08/09/2026",
        content: "Thầy cho em xin tài liệu tham khảo thêm về LoRA và QLoRA được không ạ?",
      },
    ],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000005",
    title: "Nhập môn Kiểm thử Phần mềm & Automation Test",
    categoryName: "DevOps & Testing",
    categoryId: "10000000-0000-4000-8000-000000000005",
    lecturerName: "ThS. Lê Thị Ánh Tuyết",
    lecturerId: "lec-05",
    rating: 3.4, // < 4.0 -> LOW RATING (RED)
    reviewCount: 42,
    lessonsCount: 14,
    quizzesCount: 2,
    totalHours: "9.5h",
    studentsCount: 190,
    price: "0 ₫",
    priceType: "FREE",
    state: "DRAFT",
    nextLesson: "Bài 2 - Viết kịch bản kiểm thử tự động với Playwright & Vitest",
    updatedAt: "05/09/2026",
    documents: [
      {
        name: "Giao-trinh-Kiem-thu-Phan-mem-Co-ban.pdf",
        type: "PDF",
        size: "4.1 MB",
        desc: "Khái niệm hộp đen, hộp trắng và quy trình kiểm thử",
      },
    ],
    reviews: [
      {
        id: "rv-11",
        author: "Đoàn Nhật Quang",
        rating: 3,
        date: "04/09/2026",
        comment: "Nội dung cơ bản, mong sớm có phần thực hành Playwright nâng cao.",
      },
      {
        id: "rv-12",
        author: "Phạm Hải Đăng",
        rating: 3,
        date: "02/09/2026",
        comment: "Cần bổ sung thêm bài kiểm tra trắc nghiệm cuối chương.",
      },
    ],
    comments: [],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000006",
    title: "Python: Lập trình từ Nền tảng tới Hướng đối tượng",
    categoryName: "Lập trình Web",
    categoryId: "10000000-0000-4000-8000-000000000006",
    lecturerName: "ThS. Doanh Nguyễn",
    lecturerId: "lec-06",
    rating: 4.8,
    reviewCount: 318,
    lessonsCount: 32,
    quizzesCount: 6,
    totalHours: "28.0h",
    studentsCount: 2450,
    price: "0 ₫",
    priceType: "FREE",
    state: "PUBLISHED",
    nextLesson: "Bài 8 - Thiết kế Mô hình Lớp (OOP) và Xử lý ngoại lệ chuẩn",
    updatedAt: "Hôm nay 11:20",
    documents: [
      {
        name: "Giao-trinh-Python-Toan-dien-Doanh-Nguyen.pdf",
        type: "PDF",
        size: "9.5 MB",
        desc: "Bộ giáo trình Python nhập môn chuẩn đại học",
      },
      {
        name: "Slide-Bai-giang-OOP-Python.pptx",
        type: "PPTX",
        size: "16.8 MB",
        desc: "Bài giảng lập trình hướng đối tượng có minh họa trực quan",
      },
      {
        name: "Ngan-hang-100-bai-tap-code-Python.zip",
        type: "ZIP",
        size: "8.4 MB",
        desc: "Bộ bài tập kèm testcase chấm điểm tự động",
      },
    ],
    reviews: [
      {
        id: "rv-13",
        author: "Nguyễn Minh Châu (Học viên)",
        rating: 5,
        date: "16/09/2026",
        comment: "Thầy dạy cực kỳ dễ hiểu và truyền cảm hứng! Bài tập gắn liền với thực tế.",
      },
      {
        id: "rv-14",
        author: "Lê Hoàng Yến",
        rating: 5,
        date: "15/09/2026",
        comment: "Khóa học miễn phí nhưng chất lượng còn vượt trội hơn nhiều khóa trả phí khác.",
      },
    ],
    comments: [
      {
        id: "cm-5",
        author: "Phạm Hùng Cường",
        date: "Hôm qua 14:10",
        content: "Em cảm ơn thầy vì bài giảng OOP rất rõ ràng, nhất là phần Đa kế thừa và MRO!",
      },
    ],
  },
];

export function CourseGovernance() {
  const [courses, setCourses] = useState<GovernanceCourse[]>(SYSTEM_COURSES);
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState<string>("ALL");
  const [selectedCourse, setSelectedCourse] = useState<GovernanceCourse | null>(null);
  const [modalTab, setModalTab] = useState<"overview" | "reviews" | "docs" | "gov">("overview");

  // Form states
  const [selectedAction, setSelectedAction] = useState<"publish" | "archive">("publish");
  const [adminPassword, setAdminPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<GovernanceCourse | null>(null);

  const [showCreateInline, setShowCreateInline] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newLecturerName, setNewLecturerName] = useState("TS. Nguyễn Minh Trí");
  const [newCategoryName, setNewCategoryName] = useState("Lập trình");
  const [newPriceType, setNewPriceType] = useState<"FREE" | "PAID">("PAID");
  const [newPrice, setNewPrice] = useState("490.000");
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);

  const slugifyTitle = (text: string) => {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
  };

  const handleCoverFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setCreateError("Vui lòng chọn tệp hình ảnh hợp lệ (PNG, JPG, WEBP, SVG).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCreateError("Kích thước ảnh tối đa là 5MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === "string") {
        setCoverPreview(ev.target.result);
        setCreateError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreateCourse = (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      setCreateError("Vui lòng nhập tên khóa học.");
      return;
    }
    setCreateLoading(true);
    setCreateError(null);
    setCreateMsg(null);

    const slug = newSlug.trim() || slugifyTitle(newTitle);
    const newId = crypto.randomUUID();

    if (coverPreview) {
      try {
        localStorage.setItem(`ailss_course_cover_${newId}`, coverPreview);
        localStorage.setItem(`ailss_course_cover_${slug}`, coverPreview);
      } catch {
        // ignore localStorage quota errors
      }
    }

    const newCourseObj: GovernanceCourse = {
      courseId: newId,
      title: newTitle.trim(),
      categoryName: newCategoryName,
      categoryId: crypto.randomUUID(),
      lecturerName: newLecturerName.trim() || "Ban Đào Tạo AILSS",
      lecturerId: "admin-managed",
      rating: 5.0,
      reviewCount: 0,
      lessonsCount: 1,
      quizzesCount: 0,
      totalHours: "1.0h",
      studentsCount: 0,
      price: newPriceType === "PAID" ? `${newPrice} ₫` : "0 ₫",
      priceType: newPriceType,
      state: "DRAFT",
      nextLesson: "Bài 1 - Giới thiệu môn học & Đề cương chi tiết",
      updatedAt: "Vừa xong",
      documents: [],
      reviews: [],
      comments: [],
    };

    setCourses((prev) => [newCourseObj, ...prev]);
    setCreateMsg("✓ Đã tạo khóa học mới thành công!");
    showToast(`Đã thêm khóa học: ${newCourseObj.title}`);

    setTimeout(() => {
      setNewTitle("");
      setNewSlug("");
      setCoverPreview(null);
      setCreateLoading(false);
      setShowCreateInline(false);
      setCreateMsg(null);
    }, 1200);
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleCopyId = (id: string) => {
    void navigator.clipboard?.writeText(id);
    showToast(`Đã sao chép mã khóa học: ${id.slice(0, 8)}…`);
  };

  async function handleExecuteAction(courseId: string, action: "publish" | "archive", password: string) {
    if (!courseId || !password) return;
    setBusy(true);
    setMessage("");
    try {
      const r = await adminRequest<{ state?: string }>(`/courses/${courseId}/${action}`, "POST", {
        currentPassword: password,
      });
      const successText = `${action === "publish" ? "Đã phê duyệt xuất bản" : "Đã gửi yêu cầu lưu trữ"} khóa học${r.data?.state ? ` · ${r.data.state}` : ""}.`;
      setMessage(successText);
      showToast(successText);
      setAdminPassword("");

      // Update local state if matched
      setCourses((prev) =>
        prev.map((c) =>
          c.courseId === courseId ? { ...c, state: action === "publish" ? "PUBLISHED" : "ARCHIVED" } : c,
        ),
      );
      if (selectedCourse && selectedCourse.courseId === courseId) {
        setSelectedCourse({
          ...selectedCourse,
          state: action === "publish" ? "PUBLISHED" : "ARCHIVED",
        });
      }
    } catch (e) {
      setMessage(adminError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleLockCourse(courseId: string, currentlyLocked: boolean, password: string) {
    if (!courseId || !password) return;
    setBusy(true);
    setMessage("");
    try {
      await adminRequest(`/courses/${courseId}/${currentlyLocked ? "unlock" : "lock"}`, "POST", {
        currentPassword: password,
      });
      const nextState: GovernanceCourse["state"] = currentlyLocked ? "PUBLISHED" : "LOCKED";
      const successText = currentlyLocked ? "Đã mở khóa khóa học." : "Đã khóa khóa học thành công.";
      setMessage(successText);
      showToast(successText);
      setAdminPassword("");
      setCourses((prev) => prev.map((c) => (c.courseId === courseId ? { ...c, state: nextState } : c)));
      if (selectedCourse && selectedCourse.courseId === courseId) {
        setSelectedCourse({ ...selectedCourse, state: nextState });
      }
    } catch (e) {
      setMessage(adminError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCourse(courseId: string, password: string) {
    if (!courseId || !password) return;
    setBusy(true);
    setMessage("");
    try {
      await adminRequest(`/courses/${courseId}`, "DELETE", { currentPassword: password });
      const successText = "Đã xóa vĩnh viễn khóa học khỏi hệ thống.";
      setMessage(successText);
      showToast(successText);
      setAdminPassword("");
      setCourses((prev) => prev.filter((c) => c.courseId !== courseId));
      if (selectedCourse && selectedCourse.courseId === courseId) setSelectedCourse(null);
      setDeleteConfirm(null);
    } catch (e) {
      setMessage(adminError(e));
    } finally {
      setBusy(false);
    }
  }

  // Filtered courses
  const filteredCourses = courses.filter((c) => {
    const matchesSearch =
      !search ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.categoryName.toLowerCase().includes(search.toLowerCase()) ||
      c.lecturerName.toLowerCase().includes(search.toLowerCase()) ||
      c.courseId.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    if (filterState === "PUBLISHED") return c.state === "PUBLISHED";
    if (filterState === "DRAFT") return c.state === "DRAFT";
    if (filterState === "ARCHIVED") return c.state === "ARCHIVED";
    if (filterState === "LOCKED") return c.state === "LOCKED";
    if (filterState === "LOW_RATING") return c.rating < 4.0;
    if (filterState === "HIGH_RATING") return c.rating >= 4.0;

    return true;
  });

  return (
    <div className="admin-dashboard-container" style={{ maxWidth: 1280, margin: "0 auto", width: "100%" }}>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">QUẢN TRỊ HỌC THUẬT &amp; KHÓA HỌC</p>
          <h1>Quản Lý &amp; Kiểm Duyệt Khóa Học Hệ Thống</h1>
          <p className="lead">
            Kiểm soát chất lượng đào tạo, xếp hạng sao, tài liệu bài giảng và phê duyệt xuất bản trên toàn hệ
            sinh thái AILSS.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setShowCreateInline((v) => !v);
              setCreateError(null);
              setCreateMsg(null);
            }}
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <Icon name={showCreateInline ? "close" : "plus"} size={16} />
            <span>{showCreateInline ? "Đóng khung tạo" : "Tạo khóa học mới"}</span>
          </button>
        </div>
      </div>

      {/* Inline Course Authoring Panel for Admin */}
      {showCreateInline && (
        <section className="inline-course-create-card" aria-label="Tạo khóa học mới">
          <div className="inline-create-header">
            <div>
              <h2 className="inline-create-title">
                <Icon name="plus" size={18} style={{ color: "var(--blue)" }} />
                <span>Tạo Khóa Học Mới &amp; Tải Lên Ảnh Bìa (Admin)</span>
              </h2>
              <p className="inline-create-desc">
                Khởi tạo chương trình đào tạo, phân bổ giảng viên phụ trách và thiết lập ảnh bìa nhận diện cho
                khóa học.
              </p>
            </div>
            <button
              type="button"
              className="button button-subtle button-small"
              onClick={() => setShowCreateInline(false)}
              aria-label="Đóng"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Icon name="close" size={14} />
              <span>Đóng</span>
            </button>
          </div>

          <form onSubmit={handleCreateCourse} className="inline-create-form">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {createMsg && (
                <div className="dashboard-banner-notice" role="status" style={{ margin: 0 }}>
                  <span>✓</span>
                  <span>{createMsg}</span>
                </div>
              )}
              {createError && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    backgroundColor: "rgba(220, 38, 38, 0.1)",
                    color: "#dc2626",
                    fontSize: 13,
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Icon name="alert" size={16} />
                  <span>{createError}</span>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink)",
                  }}
                >
                  <span>
                    Tên khóa học <span style={{ color: "#dc2626" }}>*</span>
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="VD: Kiến trúc Hệ thống Phân tán &amp; High Availability..."
                    value={newTitle}
                    onChange={(e) => {
                      const t = e.target.value;
                      setNewTitle(t);
                      if (!newSlug || newSlug === slugifyTitle(newTitle)) {
                        setNewSlug(slugifyTitle(t));
                      }
                    }}
                    style={{
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--line, #cbd5e1)",
                      fontSize: 14,
                      backgroundColor: "var(--surface)",
                      color: "var(--ink)",
                    }}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    <span>
                      Đường dẫn (Slug URL) <span style={{ color: "#dc2626" }}>*</span>
                    </span>
                    <input
                      type="text"
                      required
                      placeholder="VD: kien-truc-he-thong-phan-tan"
                      value={newSlug}
                      onChange={(e) => setNewSlug(e.target.value)}
                      style={{
                        padding: "9px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line, #cbd5e1)",
                        fontSize: 14,
                        backgroundColor: "var(--surface)",
                        color: "var(--ink)",
                      }}
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    <span>Giảng viên phụ trách</span>
                    <input
                      type="text"
                      placeholder="TS. Nguyễn Minh Trí"
                      value={newLecturerName}
                      onChange={(e) => setNewLecturerName(e.target.value)}
                      style={{
                        padding: "9px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line, #cbd5e1)",
                        fontSize: 14,
                        backgroundColor: "var(--surface)",
                        color: "var(--ink)",
                      }}
                    />
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    <span>Chuyên ngành / Danh mục</span>
                    <select
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      style={{
                        padding: "9px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line, #cbd5e1)",
                        fontSize: 14,
                        backgroundColor: "var(--surface)",
                        color: "var(--ink)",
                      }}
                    >
                      <option value="Lập trình">Lập trình</option>
                      <option value="Cơ sở dữ liệu">Cơ sở dữ liệu</option>
                      <option value="Trí tuệ nhân tạo">Trí tuệ nhân tạo</option>
                      <option value="DevOps &amp; Testing">DevOps &amp; Testing</option>
                      <option value="Tiếng Anh &amp; kỹ năng">Tiếng Anh &amp; kỹ năng</option>
                    </select>
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    <span>Hình thức</span>
                    <select
                      value={newPriceType}
                      onChange={(e) => setNewPriceType(e.target.value as "FREE" | "PAID")}
                      style={{
                        padding: "9px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line, #cbd5e1)",
                        fontSize: 14,
                        backgroundColor: "var(--surface)",
                        color: "var(--ink)",
                      }}
                    >
                      <option value="PAID">Có học phí (PAID)</option>
                      <option value="FREE">Miễn phí (FREE)</option>
                    </select>
                  </label>
                </div>

                {newPriceType === "PAID" && (
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    <span>Học phí (VND)</span>
                    <input
                      type="text"
                      value={newPrice}
                      onChange={(e) => setNewPrice(e.target.value)}
                      placeholder="490.000"
                      style={{
                        padding: "9px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line, #cbd5e1)",
                        fontSize: 14,
                        backgroundColor: "var(--surface)",
                        color: "var(--ink)",
                      }}
                    />
                  </label>
                )}
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <button
                  type="submit"
                  className="button"
                  disabled={createLoading}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 20px" }}
                >
                  <Icon name="plus" size={16} />
                  <span>{createLoading ? "Đang tạo khóa học..." : "Khởi tạo khóa học"}</span>
                </button>
                <button
                  type="button"
                  className="button button-subtle"
                  onClick={() => setShowCreateInline(false)}
                >
                  Hủy
                </button>
              </div>
            </div>

            {/* Cover image uploader */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                Ảnh bìa đại diện khóa học (Cover Image)
              </span>
              <div
                className={`inline-cover-dropzone ${isDragOver ? "dragover" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleCoverFile(f);
                }}
                onClick={() => {
                  const input = document.getElementById("admin-course-cover-input") as HTMLInputElement;
                  input?.click();
                }}
              >
                <input
                  id="admin-course-cover-input"
                  type="file"
                  accept="image/png, image/jpeg, image/webp, image/svg+xml"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCoverFile(f);
                  }}
                />

                {coverPreview ? (
                  <div className="inline-cover-preview-wrapper" onClick={(e) => e.stopPropagation()}>
                    <img src={coverPreview} alt="Xem trước ảnh bìa" className="inline-cover-preview-img" />
                    <span className="inline-cover-badge">✓ Đã tải ảnh bìa</span>
                    <div className="inline-cover-overlay-actions">
                      <button
                        type="button"
                        className="button button-subtle button-small"
                        onClick={(e) => {
                          e.stopPropagation();
                          const input = document.getElementById(
                            "admin-course-cover-input",
                          ) as HTMLInputElement;
                          input?.click();
                        }}
                        style={{ fontSize: 11, padding: "4px 8px" }}
                      >
                        <Icon name="upload" size={12} />
                        <span>Đổi ảnh</span>
                      </button>
                      <button
                        type="button"
                        className="button button-subtle button-small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCoverPreview(null);
                        }}
                        style={{ fontSize: 11, padding: "4px 8px", color: "#dc2626" }}
                      >
                        <Icon name="trash" size={12} />
                        <span>Xóa</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        background: "rgba(2, 132, 199, 0.1)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 10,
                        color: "var(--blue)",
                      }}
                    >
                      <Icon name="image" size={24} />
                    </div>
                    <p style={{ fontWeight: 600, fontSize: 13, margin: "0 0 4px", color: "var(--ink)" }}>
                      Tải lên ảnh bìa khóa học
                    </p>
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
                      Kéo thả ảnh vào đây hoặc nhấp để chọn tệp
                    </p>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        marginTop: 8,
                        padding: "2px 8px",
                        background: "var(--card-subtle, #f1f5f9)",
                        borderRadius: 4,
                      }}
                    >
                      PNG, JPG, WEBP (khuyến nghị 16:9)
                    </span>
                  </>
                )}
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
                Ảnh bìa hiển thị trong toàn bộ danh mục khóa học, trang chi tiết và giao diện học tập của học
                viên.
              </p>
            </div>
          </form>
        </section>
      )}

      {/* Toolbar: Search & Filter Pills */}
      <div className="admin-table-toolbar" style={{ width: "100%" }}>
        <div className="admin-search-input-wrap">
          <span className="admin-search-icon" aria-hidden="true">
            <Icon name="search" size={16} />
          </span>
          <input
            type="search"
            placeholder="Tìm kiếm môn học theo tên, mã khóa, giảng viên..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Tìm kiếm khóa học"
          />
        </div>

        <div className="dashboard-filter-group" role="group" aria-label="Bộ lọc khóa học">
          <button
            type="button"
            className={`filter-pill-button ${filterState === "ALL" ? "active" : ""}`}
            onClick={() => setFilterState("ALL")}
          >
            Tất cả ({courses.length})
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterState === "PUBLISHED" ? "active" : ""}`}
            onClick={() => setFilterState("PUBLISHED")}
          >
            Đã xuất bản
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterState === "DRAFT" ? "active" : ""}`}
            onClick={() => setFilterState("DRAFT")}
          >
            Bản nháp
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterState === "HIGH_RATING" ? "active" : ""}`}
            onClick={() => setFilterState("HIGH_RATING")}
            style={{
              color: filterState === "HIGH_RATING" ? "#fff" : "#16a34a",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="star" size={14} />
            <span>Đánh giá tốt (≥ 4.0★)</span>
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterState === "LOW_RATING" ? "active" : ""}`}
            onClick={() => setFilterState("LOW_RATING")}
            style={{
              color: filterState === "LOW_RATING" ? "#fff" : "#dc2626",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="alert" size={14} />
            <span>Đánh giá thấp (&lt; 4.0★)</span>
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterState === "LOCKED" ? "active" : ""}`}
            onClick={() => setFilterState("LOCKED")}
            style={{
              color: filterState === "LOCKED" ? "#fff" : "#d97706",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="lock" size={14} />
            <span>Đã khóa</span>
          </button>
        </div>
      </div>

      {/* Course Cards Grid */}
      <div className="course-gov-grid">
        {filteredCourses.map((c) => {
          const isLow = c.rating < 4.0;
          return (
            <article key={c.courseId} className="course-gov-card">
              {/* Header row: Category Pill + Conditional Rating Pill */}
              <div className="course-card-top-row">
                <span className="course-category-tag">{c.categoryName}</span>

                {/* Rating Rule: < 4.0 -> RED, >= 4.0 -> GREEN */}
                <div
                  className={`course-rating-pill ${isLow ? "low-rating" : "high-rating"}`}
                  title={
                    isLow
                      ? "Điểm đánh giá thấp: Cần cải thiện nội dung hoặc kiểm duyệt"
                      : "Điểm đánh giá tốt: Đạt chuẩn đào tạo AILSS"
                  }
                  style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <Icon name={isLow ? "alert" : "star"} size={13} />
                  <span>{c.rating.toFixed(1)}★</span>
                  <small style={{ fontSize: "10.5px", opacity: 0.9 }}>
                    ({isLow ? "Cần lưu ý" : "Chất lượng"})
                  </small>
                </div>
              </div>

              {/* Course Title */}
              <h3 className="course-gov-title">{c.title}</h3>

              {/* Progress/Score Bar with matching color */}
              <div className="course-stats-bar-track">
                <div
                  className={`course-stats-bar-fill ${isLow ? "low" : "high"}`}
                  style={{ width: `${Math.round((c.rating / 5) * 100)}%` }}
                />
              </div>

              {/* Course Meta Info */}
              <div className="course-meta-pills-row">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="book" size={13} style={{ color: "var(--blue)" }} />
                  <span>
                    Bài học: <strong>{c.lessonsCount}</strong>
                  </span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="assignment" size={13} style={{ color: "var(--teal)" }} />
                  <span>
                    Quiz: <strong>{c.quizzesCount}</strong>
                  </span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="clock" size={13} style={{ color: "var(--amber)" }} />
                  <span>{c.totalHours}</span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="users" size={13} style={{ color: "var(--purple)" }} />
                  <span>{c.studentsCount.toLocaleString()}</span>
                </span>
              </div>

              {/* Topic Box for Curriculum Highlight */}
              <div className="course-darkbox-topic">
                <div
                  className="course-darkbox-label"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Icon name="sparkles" size={13} />
                  <span>NỘI DUNG TRỌNG TÂM · BÀI TIẾP THEO</span>
                </div>
                <div className="course-darkbox-text" title={c.nextLesson}>
                  {c.nextLesson}
                </div>
              </div>

              {/* Card Bottom Row */}
              <div className="course-card-bottom-row">
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink)" }}>
                    {c.lecturerName}
                  </div>
                  <div className="course-updated-text">{c.updatedAt}</div>
                </div>

                <button
                  type="button"
                  className="course-detail-open-btn"
                  onClick={() => {
                    setSelectedCourse(c);
                    setModalTab("overview");
                    setMessage("");
                  }}
                  aria-label={`Xem chi tiết khóa học ${c.title}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <span>Xem chi tiết</span>
                  <Icon name="chevronRight" size={13} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {filteredCourses.length === 0 && (
        <div className="study-state" style={{ marginTop: "24px" }}>
          Không tìm thấy khóa học nào phù hợp với điều kiện tìm kiếm.
        </div>
      )}

      {/* Course Approval Table – list style, similar to lecturer management */}
      <section className="dashboard-section-card" style={{ marginTop: "36px" }}>
        <div className="section-card-header">
          <div>
            <h2>Phê Duyệt & Quản Trị Trạng Thái Khóa Học</h2>
            <p className="subtext">
              Nhấn thao tác trực tiếp trên từng dòng. Xác nhận bằng mật khẩu quản trị.
            </p>
          </div>
          <span className="muted" style={{ fontSize: "13px", whiteSpace: "nowrap" }}>
            {filteredCourses.length} khóa học
          </span>
        </div>

        {/* Inline password bar */}
        <div className="course-approval-pwd-bar">
          <label
            htmlFor="gov-password"
            style={{
              fontSize: "13px",
              color: "var(--ink-muted)",
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Icon name="lock" size={13} />
            <span>Mật khẩu quản trị</span>
          </label>
          <input
            id="gov-password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            placeholder="Nhập mật khẩu để xác nhận thao tác"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            className="course-approval-pwd-input"
          />
          {message && (
            <p role="status" className="course-approval-status">
              {message}
            </p>
          )}
        </div>

        <div className="table-responsive">
          <table className="dashboard-data-table" role="table">
            <thead>
              <tr>
                <th scope="col">Khóa học</th>
                <th scope="col">Danh mục</th>
                <th scope="col">Giảng viên</th>
                <th scope="col">Đánh giá</th>
                <th scope="col">Trạng thái</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredCourses.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-muted)" }}
                  >
                    Không tìm thấy khóa học nào phù hợp.
                  </td>
                </tr>
              ) : (
                filteredCourses.map((c) => {
                  const isLocked = c.state === "LOCKED";
                  const badgeClass =
                    c.state === "PUBLISHED"
                      ? "active"
                      : c.state === "DRAFT"
                        ? "pending"
                        : c.state === "LOCKED"
                          ? "suspended"
                          : "suspended";
                  const badgeLabel =
                    c.state === "PUBLISHED" ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span
                          style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }}
                        />
                        <span>Xuất bản</span>
                      </span>
                    ) : c.state === "DRAFT" ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Icon name="clock" size={12} />
                        <span>Bản nháp</span>
                      </span>
                    ) : c.state === "LOCKED" ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Icon name="lock" size={12} />
                        <span>Đã khóa</span>
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Icon name="archive" size={12} />
                        <span>Lưu trữ</span>
                      </span>
                    );
                  return (
                    <tr key={c.courseId}>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                          <span
                            className="user-name-title"
                            style={{
                              maxWidth: "280px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {c.title}
                          </span>
                          <div className="user-id-code">
                            <span>
                              ID: {c.courseId.slice(0, 8)}…{c.courseId.slice(-4)}
                            </span>
                            <button
                              type="button"
                              className="copy-id-btn"
                              title="Sao chép toàn bộ UUID"
                              onClick={() => handleCopyId(c.courseId)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Icon name="copy" size={12} />
                            </button>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="course-category-tag" style={{ fontSize: "12px" }}>
                          {c.categoryName}
                        </span>
                      </td>
                      <td>
                        <span className="muted" style={{ fontSize: "13px" }}>
                          {c.lecturerName}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`course-rating-pill ${c.rating < 4.0 ? "low-rating" : "high-rating"}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <Icon name={c.rating < 4.0 ? "alert" : "star"} size={12} />
                          <span>{c.rating.toFixed(1)}</span>
                        </span>
                      </td>
                      <td>
                        <span className={`admin-badge ${badgeClass}`}>{badgeLabel}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            gap: "6px",
                            flexWrap: "wrap",
                            justifyContent: "flex-end",
                          }}
                        >
                          {c.state !== "PUBLISHED" && c.state !== "LOCKED" && (
                            <button
                              type="button"
                              className="button button-small"
                              disabled={busy || !adminPassword}
                              title={
                                !adminPassword ? "Nhập mật khẩu quản trị trước" : "Phê duyệt và xuất bản"
                              }
                              onClick={() => void handleExecuteAction(c.courseId, "publish", adminPassword)}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                            >
                              <Icon name="checkCircle" size={13} />
                              <span>Xuất bản</span>
                            </button>
                          )}
                          {c.state !== "ARCHIVED" && c.state !== "LOCKED" && (
                            <button
                              type="button"
                              className="button button-subtle button-small"
                              disabled={busy || !adminPassword}
                              title={!adminPassword ? "Nhập mật khẩu quản trị trước" : "Lưu trữ khóa học"}
                              onClick={() => void handleExecuteAction(c.courseId, "archive", adminPassword)}
                              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                            >
                              <Icon name="archive" size={13} />
                              <span>Lưu trữ</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className={`button button-small ${isLocked ? "" : "button-warning"}`}
                            disabled={busy || !adminPassword}
                            title={
                              !adminPassword
                                ? "Nhập mật khẩu quản trị trước"
                                : isLocked
                                  ? "Mở khóa khóa học"
                                  : "Khóa khóa học (tạm ngừng truy cập)"
                            }
                            onClick={() => void handleLockCourse(c.courseId, isLocked, adminPassword)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              ...(isLocked
                                ? {}
                                : {
                                    background: "var(--color-warning, #d97706)",
                                    color: "#fff",
                                    borderColor: "transparent",
                                  }),
                            }}
                          >
                            <Icon name={isLocked ? "unlock" : "lock"} size={13} />
                            <span>{isLocked ? "Mở khóa" : "Khóa"}</span>
                          </button>
                          <button
                            type="button"
                            className="button button-small button-danger"
                            disabled={busy || !adminPassword}
                            title={!adminPassword ? "Nhập mật khẩu quản trị trước" : "Xóa vĩnh viễn khóa học"}
                            onClick={() => setDeleteConfirm(c)}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              background: "var(--color-danger, #dc2626)",
                              color: "#fff",
                              borderColor: "transparent",
                            }}
                          >
                            <Icon name="trash" size={13} />
                            <span>Xóa</span>
                          </button>
                          <button
                            type="button"
                            className="button button-subtle button-small"
                            onClick={() => setSelectedCourse(c)}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            <span>Chi tiết</span>
                            <Icon name="chevronRight" size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* DELETE CONFIRM DIALOG */}
      {deleteConfirm && (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
        >
          <div className="admin-modal-card" style={{ maxWidth: "480px" }}>
            <div className="admin-modal-header">
              <h2
                id="delete-confirm-title"
                style={{
                  fontSize: "18px",
                  color: "var(--color-danger, #dc2626)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Icon name="trash" size={18} />
                <span>Xác nhận xóa khóa học</span>
              </h2>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setDeleteConfirm(null)}
                aria-label="Đóng"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div style={{ padding: "16px 24px 8px" }}>
              <p style={{ marginBottom: "8px" }}>
                Bạn sắp <strong>xóa vĩnh viễn</strong> khóa học:
              </p>
              <p style={{ fontWeight: 600, fontSize: "15px", marginBottom: "4px" }}>{deleteConfirm.title}</p>
              <p className="muted" style={{ fontSize: "13px", marginBottom: "16px" }}>
                ID: {deleteConfirm.courseId}
              </p>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "flex-start",
                  gap: 8,
                  color: "var(--color-danger, #dc2626)",
                  fontSize: "13px",
                  marginBottom: "20px",
                }}
              >
                <Icon name="alert" size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Hành động này <strong>không thể hoàn tác</strong>. Toàn bộ bài học, bài tập và dữ liệu học
                  viên liên quan sẽ bị xóa.
                </span>
              </div>
              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="button button-subtle"
                  onClick={() => setDeleteConfirm(null)}
                  disabled={busy}
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || !adminPassword}
                  title={!adminPassword ? "Nhập mật khẩu trong thanh phía trên trước" : ""}
                  onClick={() => void handleDeleteCourse(deleteConfirm.courseId, adminPassword)}
                  style={{
                    background: "var(--color-danger, #dc2626)",
                    borderColor: "transparent",
                    color: "#fff",
                  }}
                >
                  {busy ? "Đang xóa…" : "Xác nhận xóa vĩnh viễn"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* COMPREHENSIVE COURSE DETAIL MODAL */}
      {selectedCourse && (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="course-modal-title"
        >
          <div className="admin-modal-card large">
            <div className="admin-modal-header">
              <div style={{ flex: 1, paddingRight: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                  <span className="course-category-tag">{selectedCourse.categoryName}</span>
                  <span
                    className={`admin-badge ${selectedCourse.state === "PUBLISHED" ? "active" : selectedCourse.state === "DRAFT" ? "pending" : "suspended"}`}
                  >
                    {selectedCourse.state === "PUBLISHED" ? (
                      "ĐÃ XUẤT BẢN"
                    ) : selectedCourse.state === "DRAFT" ? (
                      "BẢN NHÁP"
                    ) : selectedCourse.state === "LOCKED" ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Icon name="lock" size={11} />
                        <span>ĐÃ KHÓA</span>
                      </span>
                    ) : (
                      "ĐÃ LƯU TRỮ"
                    )}
                  </span>
                  {/* Rating Badge */}
                  <span
                    className={`course-rating-pill ${selectedCourse.rating < 4.0 ? "low-rating" : "high-rating"}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Icon name={selectedCourse.rating < 4.0 ? "alert" : "star"} size={12} />
                    <span>{selectedCourse.rating.toFixed(1)} / 5</span>
                  </span>
                </div>
                <h2 id="course-modal-title" style={{ fontSize: "21px", lineHeight: "1.3" }}>
                  {selectedCourse.title}
                </h2>
                <div className="user-id-code" style={{ marginTop: "6px" }}>
                  <span>UUID: {selectedCourse.courseId}</span>
                  <button
                    type="button"
                    className="copy-id-btn"
                    title="Sao chép toàn bộ UUID"
                    onClick={() => handleCopyId(selectedCourse.courseId)}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name="copy" size={12} />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setSelectedCourse(null)}
                aria-label="Đóng cửa sổ"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="course-modal-tab-bar" role="tablist">
              <button
                type="button"
                className={`course-tab-btn ${modalTab === "overview" ? "active" : ""}`}
                onClick={() => setModalTab("overview")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="chart" size={14} />
                <span>Tổng quan &amp; Đánh giá</span>
              </button>
              <button
                type="button"
                className={`course-tab-btn ${modalTab === "reviews" ? "active" : ""}`}
                onClick={() => setModalTab("reviews")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="star" size={14} />
                <span>
                  Đánh giá &amp; Bình luận ({selectedCourse.reviews.length + selectedCourse.comments.length})
                </span>
              </button>
              <button
                type="button"
                className={`course-tab-btn ${modalTab === "docs" ? "active" : ""}`}
                onClick={() => setModalTab("docs")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="fileText" size={14} />
                <span>Tài liệu khóa học ({selectedCourse.documents.length})</span>
              </button>
              <button
                type="button"
                className={`course-tab-btn ${modalTab === "gov" ? "active" : ""}`}
                onClick={() => setModalTab("gov")}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="shield" size={14} />
                <span>Thẩm định &amp; Xuất bản</span>
              </button>
            </div>

            {/* TAB 1: OVERVIEW & RATING */}
            {modalTab === "overview" && (
              <div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "14px",
                    marginBottom: "22px",
                  }}
                >
                  <div
                    style={{
                      padding: "14px",
                      background: "var(--surface-soft, rgba(0,0,0,0.03))",
                      borderRadius: "12px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>Giảng viên phụ trách</div>
                    <div style={{ fontWeight: 700, fontSize: "15px", marginTop: "4px", color: "var(--ink)" }}>
                      {selectedCourse.lecturerName}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "14px",
                      background: "var(--surface-soft, rgba(0,0,0,0.03))",
                      borderRadius: "12px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>Học phí</div>
                    <div style={{ fontWeight: 700, fontSize: "15px", marginTop: "4px", color: "#16a34a" }}>
                      {selectedCourse.priceType === "FREE" ? "Miễn phí (FREE)" : selectedCourse.price}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "14px",
                      background: "var(--surface-soft, rgba(0,0,0,0.03))",
                      borderRadius: "12px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>Tổng bài học & Thời lượng</div>
                    <div style={{ fontWeight: 700, fontSize: "15px", marginTop: "4px", color: "var(--ink)" }}>
                      {selectedCourse.lessonsCount} bài · {selectedCourse.totalHours}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "14px",
                      background: "var(--surface-soft, rgba(0,0,0,0.03))",
                      borderRadius: "12px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>Học viên ghi danh</div>
                    <div style={{ fontWeight: 700, fontSize: "15px", marginTop: "4px", color: "var(--ink)" }}>
                      {selectedCourse.studentsCount.toLocaleString()} học viên
                    </div>
                  </div>
                </div>

                {/* Rating Highlight Section */}
                <div
                  style={{
                    padding: "18px",
                    borderRadius: "14px",
                    marginBottom: "20px",
                    border: selectedCourse.rating < 4.0 ? "1.5px solid #dc2626" : "1.5px solid #16a34a",
                    background:
                      selectedCourse.rating < 4.0 ? "rgba(220, 38, 38, 0.06)" : "rgba(22, 163, 74, 0.06)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "16px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: "18px",
                        color: selectedCourse.rating < 4.0 ? "#dc2626" : "#16a34a",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <Icon name={selectedCourse.rating < 4.0 ? "alert" : "checkCircle"} size={18} />
                      <span>
                        {selectedCourse.rating < 4.0
                          ? "Cảnh báo chất lượng: Điểm đánh giá thấp"
                          : "Chất lượng đạt chuẩn đào tạo"}
                      </span>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--ink)" }}>
                      {selectedCourse.rating < 4.0
                        ? `Khóa học đạt ${selectedCourse.rating.toFixed(1)} / 5 sao (< 4.0★). Quản trị viên nên rà soát lại giáo trình bài giảng và phản hồi của học viên trước khi cấp phép.`
                        : `Khóa học đạt ${selectedCourse.rating.toFixed(1)} / 5 sao (≥ 4.0★). Phản hồi từ học viên rất tích cực, đạt tiêu chuẩn chất lượng cao của AILSS.`}
                    </p>
                  </div>
                  <div
                    style={{
                      fontSize: "32px",
                      fontWeight: 800,
                      color: selectedCourse.rating < 4.0 ? "#dc2626" : "#16a34a",
                      padding: "8px 18px",
                      borderRadius: "12px",
                      background: "var(--surface)",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    }}
                  >
                    {selectedCourse.rating.toFixed(1)}★
                  </div>
                </div>

                {/* Dark Topic Box */}
                <div className="course-darkbox-topic" style={{ marginBottom: "20px" }}>
                  <div
                    className="course-darkbox-label"
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Icon name="sparkles" size={13} />
                    <span>NỘI DUNG ĐÀO TẠO TRỌNG TÂM</span>
                  </div>
                  <div className="course-darkbox-text" style={{ whiteSpace: "normal" }}>
                    {selectedCourse.nextLesson}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: REVIEWS & COMMENTS */}
            {modalTab === "reviews" && (
              <div>
                <h3 style={{ fontSize: "16px", marginBottom: "14px" }}>
                  Đánh giá từ học viên ({selectedCourse.reviews.length})
                </h3>
                <div className="course-reviews-container" style={{ marginBottom: "24px" }}>
                  {selectedCourse.reviews.map((r) => (
                    <div key={r.id} className="course-review-item">
                      <div className="course-review-header">
                        <div className="course-review-user">{r.author}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span className="course-review-stars">
                            {"★".repeat(r.rating)}
                            {"☆".repeat(5 - r.rating)}
                          </span>
                          <span className="time-sub">{r.date}</span>
                        </div>
                      </div>
                      <p className="course-review-body">{r.comment}</p>
                    </div>
                  ))}
                  {selectedCourse.reviews.length === 0 && (
                    <p className="muted">Chưa có đánh giá nào cho khóa học này.</p>
                  )}
                </div>

                <h3 style={{ fontSize: "16px", marginBottom: "14px" }}>
                  Thảo luận & Bình luận cộng đồng ({selectedCourse.comments.length})
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {selectedCourse.comments.map((cm) => (
                    <div key={cm.id} className="course-comments-quote">
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <strong>{cm.author}</strong>
                        <span className="time-sub">{cm.date}</span>
                      </div>
                      <div style={{ color: "var(--ink)" }}>{cm.content}</div>
                    </div>
                  ))}
                  {selectedCourse.comments.length === 0 && (
                    <p className="muted">Chưa có chủ đề thảo luận nào.</p>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: DOCUMENTS OF THE COURSE */}
            {modalTab === "docs" && (
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "16px",
                  }}
                >
                  <h3 style={{ fontSize: "16px", margin: 0 }}>
                    Học liệu & Tài liệu đính kèm ({selectedCourse.documents.length})
                  </h3>
                  <span className="muted" style={{ fontSize: "12.5px" }}>
                    Đã qua rà soát an toàn phần mềm độc hại
                  </span>
                </div>

                <div className="course-docs-container">
                  {selectedCourse.documents.map((doc, idx) => (
                    <div key={idx} className="course-doc-card">
                      <div className="course-doc-left">
                        <div
                          className="course-doc-icon"
                          aria-hidden="true"
                          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <Icon
                            name={
                              doc.type === "PDF"
                                ? "fileText"
                                : doc.type === "PPTX"
                                  ? "chart"
                                  : doc.type === "ZIP"
                                    ? "archive"
                                    : "book"
                            }
                            size={18}
                          />
                        </div>
                        <div>
                          <div className="course-doc-title">{doc.name}</div>
                          <div className="course-doc-meta">
                            <span>{doc.desc}</span>
                            <span>•</span>
                            <strong>{doc.size}</strong>
                            <span>•</span>
                            <span>Định dạng {doc.type}</span>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          type="button"
                          className="button button-subtle button-small"
                          onClick={() => showToast(`Đang mở xem trước: ${doc.name}`)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <Icon name="eye" size={13} />
                          <span>Xem trước</span>
                        </button>
                        <button
                          type="button"
                          className="button button-small"
                          onClick={() => showToast(`Bắt đầu tải về: ${doc.name}`)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <Icon name="download" size={13} />
                          <span>Tải xuống</span>
                        </button>
                      </div>
                    </div>
                  ))}

                  {selectedCourse.documents.length === 0 && (
                    <p className="muted">Khóa học này chưa tải lên tài liệu đính kèm.</p>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: GOVERNANCE & PUBLISHING ACTIONS */}
            {modalTab === "gov" && (
              <div>
                <div
                  style={{
                    padding: "16px",
                    background: "var(--surface-soft, rgba(0,0,0,0.03))",
                    borderRadius: "12px",
                    marginBottom: "20px",
                  }}
                >
                  <h3 style={{ fontSize: "16px", margin: "0 0 8px" }}>Thẩm định & Quyết định xuất bản</h3>
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
                    Quản trị viên có thẩm quyền xuất bản khóa học công khai trên danh mục AILSS hoặc chuyển
                    khóa học vào trạng thái lưu trữ. Mọi thao tác đều yêu cầu xác thực mật khẩu bảo mật.
                  </p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleExecuteAction(selectedCourse.courseId, selectedAction, adminPassword);
                  }}
                >
                  <label style={{ display: "block", marginBottom: "14px" }}>
                    Khóa học đang xử lý
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={`${selectedCourse.title} (${selectedCourse.courseId})`}
                      style={{
                        width: "100%",
                        marginTop: "6px",
                        background: "var(--surface-soft, rgba(0,0,0,0.05))",
                      }}
                    />
                  </label>

                  <label style={{ display: "block", marginBottom: "14px" }}>
                    Thao tác thẩm định
                    <select
                      value={selectedAction}
                      onChange={(e) => setSelectedAction(e.target.value as "publish" | "archive")}
                      style={{ width: "100%", marginTop: "6px" }}
                    >
                      <option value="publish">Phê duyệt & Xuất bản công khai (PUBLISH)</option>
                      <option value="archive">Lưu trữ khóa học (ARCHIVE)</option>
                    </select>
                  </label>

                  <label style={{ display: "block", marginBottom: "18px" }}>
                    Mật khẩu quản trị viên hiện tại (Bắt buộc)
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      placeholder="Nhập mật khẩu admin..."
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      style={{ width: "100%", marginTop: "6px" }}
                    />
                  </label>

                  {message && (
                    <div
                      className={message.includes("Đã") ? "dashboard-banner-notice" : "notice error"}
                      role="alert"
                      style={{ marginBottom: "16px" }}
                    >
                      <span>{message}</span>
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setSelectedCourse(null)}
                    >
                      Đóng
                    </button>
                    <button type="submit" className="button" disabled={busy || !adminPassword}>
                      {busy ? "Đang xử lý…" : "Thực thi quyết định"}
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast Notice */}
      {toast && (
        <div className="admin-toast-notice" role="status">
          <span>✓</span>
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
