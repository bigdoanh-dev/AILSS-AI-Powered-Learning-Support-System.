import { useLanguage } from "../lib/i18n";
import { useUiText } from "../lib/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, Outlet, useParams, useSearchParams } from "react-router-dom";
import { sessionRequest, useSession } from "../auth/session";
import { adminError, adminRequest } from "./api";
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
  providers?: string[];
};

export function AdminGuard() {
  const uiText = useUiText();
  const { state, profile } = useSession();
  if (state !== "AUTHENTICATED" && state !== "REFRESHING")
    return <p role="status">{uiText("Đang xác minh phiên…")}</p>;
  return profile?.role === "ADMIN" ? <Outlet /> : <Navigate to="/app" replace />;
}

export { default as AdminHome } from "./AdminHome";

export function Users() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const [params, setParams] = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "LECTURER" ? "LECTURER" : "STUDENT"),
    [status, setStatus] = useState<Status>("ACTIVE");
  const [cursor, setCursor] = useState(""),
    [items, setItems] = useState<User[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [pending, setPending] = useState(true),
    [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const loadRevision = useRef(0);
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
    const revision = ++loadRevision.current;
    setPending(true);
    setMessage("");
    try {
      const q = new URLSearchParams({
        role,
        status,
        limit: "25",
        ...(cursor ? { cursor } : {}),
        ...(querySearch ? { q: querySearch } : {}),
      });
      const r = await adminRequest<User[]>("/users?" + q);
      if (revision !== loadRevision.current) return;
      setItems(r.data);
      setNext(r.meta?.pagination?.nextCursor || null);
    } catch (e) {
      if (revision === loadRevision.current) setMessage(adminError(e));
    } finally {
      if (revision === loadRevision.current) setPending(false);
    }
  }

  useEffect(() => {
    void load();
  }, [role, status, cursor, querySearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCursor("");
      setQuerySearch(search.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

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

  const filteredItems = items;

  return (
    <>
      <p className="eyebrow">{uiText("ADMIN · QUẢN LÝ NGƯỜI DÙNG")}</p>
      <h1>{uiText("Danh sách tài khoản & phân quyền.")}</h1>
      <p className="lead">
        {uiText(
          "Tra cứu danh sách sinh viên, giảng viên và quản trị viên; kiểm soát trạng thái hoạt động và thẩm định danh tính.",
        )}
      </p>

      {/* Filter Row */}
      <div className="admin-filters">
        <label>
          {uiText("Vai trò")}
          <select
            value={role}
            onChange={(e) => {
              setCursor("");
              setRole(e.target.value as Role);
              setParams({ role: e.target.value });
            }}
          >
            <option value="STUDENT">{uiText("Sinh viên")}</option>
            <option value="LECTURER">{uiText("Giảng viên")}</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <label>
          {uiText("Trạng thái")}
          <select
            value={status}
            onChange={(e) => {
              setCursor("");
              setStatus(e.target.value as Status);
            }}
          >
            <option value="ACTIVE">{uiText("Đang hoạt động")}</option>
            <option value="SUSPENDED">{uiText("Tạm khóa")}</option>
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
            placeholder={uiText("Tìm kiếm theo họ tên, ID, email hoặc phương thức (google, gg)...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={uiText("Tìm kiếm người dùng trong danh sách")}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span className="muted" style={{ fontSize: "13px" }}>
            {uiText("Hiển thị ")}
            <strong>{filteredItems.length}</strong> / {items.length} {uiText(" người dùng")}
          </span>

          <div className="admin-view-toggle" role="group" aria-label={uiText("Chế độ hiển thị")}>
            <button
              type="button"
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
              title={uiText("Dạng bảng danh sách")}
            >
              {uiText("📑 Danh sách")}
            </button>
            <button
              type="button"
              className={viewMode === "grid" ? "active" : ""}
              onClick={() => setViewMode("grid")}
              title={uiText("Dạng thẻ ô lưới")}
            >
              {uiText("🗂️ Ô lưới")}
            </button>
          </div>
        </div>
      </div>

      {pending ? (
        <p role="status">{uiText("Đang tải người dùng…")}</p>
      ) : message ? (
        <div className="study-state" role="alert">
          <p>{uiText(message)}</p>
          <button className="button secondary" onClick={() => void load()}>
            {uiText("Thử lại")}
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="study-state">
          {search
            ? uiText('Không tìm thấy người dùng nào phù hợp với từ khóa "{0}".', [search])
            : uiText("Không có người dùng phù hợp.")}
        </div>
      ) : viewMode === "list" ? (
        /* TABLE LIST VIEW */
        <div className="table-responsive">
          <table className="dashboard-data-table" role="table">
            <thead>
              <tr>
                <th scope="col">{uiText("Người dùng")}</th>
                <th scope="col">{uiText("Email & Phương thức")}</th>
                <th scope="col">{uiText("Vai trò")}</th>
                <th scope="col">{uiText("Trạng thái")}</th>
                <th scope="col">{uiText("Xác minh GV")}</th>
                <th scope="col">{uiText("Cập nhật")}</th>
                <th scope="col" style={{ textAlign: "right" }}>
                  {uiText("Thao tác")}
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
                              {uiText("ID:")}
                              {u.userId.slice(0, 8)}…{u.userId.slice(-4)}
                            </span>
                            <button
                              type="button"
                              className="copy-id-btn"
                              title={uiText("Sao chép toàn bộ ID")}
                              onClick={() => handleCopyId(u.userId)}
                            >
                              📋
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <span className="muted" style={{ fontSize: "13px" }}>
                          {u.emailMasked || "Chưa có email"}
                        </span>
                        <div>
                          {u.providers && u.providers.some((p) => p.toUpperCase() === "GOOGLE") ? (
                            <span
                              className="admin-badge sso-google"
                              title={uiText("Đăng nhập qua Google SSO")}
                            >
                              🌐 Google SSO
                            </span>
                          ) : (
                            <span
                              className="admin-badge sso-password"
                              title={uiText("Đăng nhập tài khoản mật khẩu")}
                            >
                              {uiText("🔑 Mật khẩu")}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`admin-badge role-${roleClass}`}>
                        {u.role === "LECTURER"
                          ? uiText("👨‍🏫 Giảng viên")
                          : u.role === "ADMIN"
                            ? uiText("🛡️ Quản trị")
                            : uiText("🎓 Sinh viên")}
                      </span>
                    </td>
                    <td>
                      <span className={`admin-badge ${u.status === "ACTIVE" ? "active" : "suspended"}`}>
                        {u.status === "ACTIVE" ? uiText("● Hoạt động") : uiText("🔒 Tạm khóa")}
                      </span>
                    </td>
                    <td>
                      {u.role === "LECTURER" ? (
                        <span className={`admin-badge ${u.lecturerVerified ? "verified" : "unverified"}`}>
                          {u.lecturerVerified ? uiText("✓ Đã xác minh") : uiText("⏳ Chưa xác minh")}
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: "12px" }}>
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="time-sub">
                        {u.updatedAt ? new Date(u.updatedAt).toLocaleDateString(uiLocale) : uiText("Hôm nay")}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="button button-subtle button-small"
                          onClick={() => openQuickModal(u)}
                          title={uiText("Đổi trạng thái tài khoản")}
                        >
                          {uiText("Đổi trạng thái")}
                        </button>
                        <Link className="button button-small" to={"/app/admin/users/" + u.userId}>
                          {uiText("Chi tiết →")}
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
                    {u.role === "LECTURER"
                      ? uiText("Giảng viên")
                      : u.role === "ADMIN"
                        ? uiText("Quản trị")
                        : uiText("Sinh viên")}{" "}
                    · {u.status === "ACTIVE" ? uiText("Hoạt động") : uiText("Tạm khóa")}
                  </span>
                  {u.providers && u.providers.some((p) => p.toUpperCase() === "GOOGLE") && (
                    <span className="admin-badge sso-google" style={{ marginLeft: "auto" }}>
                      🌐 Google SSO
                    </span>
                  )}
                </div>
                <h2>{u.displayName}</h2>
                <div className="user-id-code" style={{ marginBottom: "12px" }}>
                  <span>
                    {uiText("ID:")}
                    {u.userId.slice(0, 12)}…
                  </span>
                  <button
                    type="button"
                    className="copy-id-btn"
                    title={uiText("Sao chép toàn bộ ID")}
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
                  {uiText("Đổi trạng thái")}
                </button>
                <Link className="card-action-btn" to={"/app/admin/users/" + u.userId}>
                  {uiText("Xem chi tiết →")}
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
            {uiText("Trang tiếp theo →")}
          </button>
        )}
        <button
          className="plain-button"
          onClick={() => {
            setCursor("");
            void load();
          }}
        >
          {uiText("Tải lại trang đầu")}
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
                  {uiText("THAO TÁC NHANH QUẢN TRỊ")}
                </p>
                <h2 id="quick-status-title">{uiText("Đổi trạng thái người dùng")}</h2>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setQuickUser(null)}
                aria-label={uiText("Đóng cửa sổ")}
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
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                {uiText("ID:")}
                {quickUser.userId}
              </div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                {uiText("Trạng thái hiện tại:")}{" "}
                <strong>
                  {quickUser.status === "ACTIVE" ? uiText("Đang hoạt động") : uiText("Tạm khóa")}
                </strong>
              </div>
            </div>

            <form onSubmit={(e) => void submitQuickStatus(e)}>
              <label style={{ display: "block", marginBottom: "14px" }}>
                {uiText("Trạng thái mới")}
                <select
                  value={quickStatus}
                  onChange={(e) => setQuickStatus(e.target.value as Status)}
                  style={{ width: "100%", marginTop: "6px" }}
                >
                  <option value="ACTIVE">{uiText("Đang hoạt động (ACTIVE)")}</option>
                  <option value="SUSPENDED">{uiText("Tạm khóa tài khoản (SUSPENDED)")}</option>
                </select>
              </label>

              <label style={{ display: "block", marginBottom: "14px" }}>
                {uiText("Lý do thay đổi (tùy chọn)")}
                <input
                  type="text"
                  placeholder={uiText("Ví dụ: Kiểm tra định kỳ, mở lại tài khoản theo yêu cầu...")}
                  value={quickReason}
                  onChange={(e) => setQuickReason(e.target.value)}
                  style={{ width: "100%", marginTop: "6px" }}
                />
              </label>

              <label style={{ display: "block", marginBottom: "18px" }}>
                {uiText("Mật khẩu Quản trị viên hiện tại (Xác thực bảo mật)")}
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder={uiText("Nhập mật khẩu admin...")}
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
                  {uiText("Hủy bỏ")}
                </button>
                <button type="submit" className="button" disabled={quickBusy || !quickPassword}>
                  {quickBusy ? uiText("Đang xử lý…") : uiText("Cập nhật trạng thái")}
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
  const uiText = useUiText();
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
      <Link to="/app/admin/users">{uiText("← Danh sách người dùng")}</Link>
      <p className="eyebrow">{uiText("CHI TIẾT THÀNH VIÊN")}</p>
      <h1>{user?.displayName || "Đang tải người dùng…"}</h1>
      {message && <p role="status">{uiText(message)}</p>}
      {user && (
        <div className="account-grid">
          <section className="study-card">
            <h2>{uiText("Thông tin tài khoản")}</h2>
            <dl className="profile-facts">
              <dt>Email</dt>
              <dd>{user.emailMasked}</dd>
              <dt>{uiText("Phương thức đăng nhập")}</dt>
              <dd>
                {user.providers && user.providers.some((p) => p.toUpperCase() === "GOOGLE") ? (
                  <span className="admin-badge sso-google">🌐 Google SSO (OAuth 2.0)</span>
                ) : (
                  <span className="admin-badge sso-password">{uiText("🔑 Email & Mật khẩu")}</span>
                )}
              </dd>
              <dt>{uiText("Vai trò")}</dt>
              <dd>
                {
                  {
                    STUDENT: uiText("Học viên"),
                    LECTURER: uiText("Giảng viên"),
                    ADMIN: uiText("Quản trị viên"),
                  }[user.role]
                }
              </dd>
              <dt>{uiText("Trạng thái")}</dt>
              <dd>{user.status === "ACTIVE" ? uiText("Đang hoạt động") : uiText("Tạm khóa")}</dd>
              <dt>{uiText("Xác minh GV")}</dt>
              <dd>{user.lecturerVerified ? uiText("Đã xác minh") : uiText("Chưa xác minh")}</dd>
              <dt>{uiText("Phiên bản")}</dt>
              <dd>{user.profileVersion}</dd>
              <dt>{uiText("Mã thành viên")}</dt>
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
              <h2>{uiText("Xác minh giảng viên")}</h2>
              <p>{uiText("Kiểm tra thông tin trước khi mở quyền tạo khóa học và lớp học.")}</p>
              <label>
                {uiText("Mật khẩu quản trị viên")}
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
              <button className="button" disabled={busy}>
                {busy ? uiText("Đang xác minh…") : uiText("Xác minh giảng viên")}
              </button>
            </form>
          )}
          <form className="form-panel" onSubmit={(e) => void submit(e)}>
            <h2>{uiText("Đổi trạng thái tài khoản")}</h2>
            <label>
              {uiText("Trạng thái mới")}
              <select name="status" defaultValue={user.status}>
                <option value="ACTIVE">{uiText("Đang hoạt động")}</option>
                <option value="SUSPENDED">{uiText("Tạm khóa")}</option>
              </select>
            </label>
            <label>
              {uiText("Lý do (không bắt buộc)")}
              <input name="reason" maxLength={200} />
            </label>
            <label>
              {uiText("Mật khẩu quản trị viên hiện tại")}
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <p className="muted">{uiText("Hệ thống xác minh lại mật khẩu riêng cho thao tác này.")}</p>
            <button className="button" disabled={busy}>
              {busy ? uiText("Đang xử lý…") : uiText("Xác nhận đổi trạng thái")}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export function CourseGovernance() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
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
          <p className="eyebrow">{uiText("QUẢN TRỊ NỘI DUNG · HỆ THỐNG KHÓA HỌC")}</p>
          <h1 id="admin-courses-title">{uiText("Quản lý xuất bản khóa học.")}</h1>
          <p className="lead">
            {uiText(
              "Thẩm định chất lượng học liệu và kiểm soát vòng đời xuất bản (Publish/Archive) của toàn bộ khóa học trên hệ thống.",
            )}
          </p>
        </div>
        <div className="dashboard-header-actions">
          <button
            type="button"
            className="button button-subtle"
            onClick={() => setShowGuide(!showGuide)}
            title={uiText("Xem quy trình kiểm duyệt và xuất bản")}
          >
            <Icon name="sparkles" size={15} />
            <span>{showGuide ? uiText("Ẩn hướng dẫn quy trình") : uiText("💡 Xem quy trình vận hành")}</span>
          </button>
          <span className="kpi-tag accent">
            {courses.length} {uiText(" khóa học")}
          </span>
        </div>
      </div>

      {/* Interactive Workflow Architectural Guide */}
      {showGuide && (
        <section
          className="admin-workflow-card animate-fade-in"
          aria-label={uiText("Quy trình vận hành khóa học")}
        >
          <div className="admin-workflow-header">
            <div className="admin-workflow-icon-wrap">
              <Icon name="shield" size={20} />
            </div>
            <div>
              <h3>{uiText("Quy trình Vận hành & Thẩm định Khóa học AILSS")}</h3>
              <p className="subtext">
                {uiText(
                  "Hệ thống tuân thủ kiểm duyệt 3 bước trước khi cho phép học viên ghi danh hoặc thanh toán khóa học.",
                )}
              </p>
            </div>
          </div>
          <div className="admin-workflow-steps">
            <div className="admin-workflow-step">
              <div className="admin-step-badge">{uiText("Bước 1")}</div>
              <div className="admin-step-content">
                <h4>{uiText("Giảng viên đệ trình")}</h4>
                <p>
                  {uiText("Khóa học ở trạng thái ")}
                  <code>{uiText("DRAFT")}</code> {uiText(" (Nháp). Giảng viên gửi mã định danh")}{" "}
                  <code>{uiText("Course ID")}</code> {uiText(" cho Admin để đề xuất xuất bản.")}
                </p>
              </div>
            </div>
            <div className="admin-workflow-arrow" aria-hidden="true">
              →
            </div>
            <div className="admin-workflow-step">
              <div className="admin-step-badge">{uiText("Bước 2")}</div>
              <div className="admin-step-content">
                <h4>{uiText("Admin thẩm định học liệu")}</h4>
                <p>
                  {uiText("Nhấp ")}
                  <strong>{uiText('"Chi tiết công khai"')}</strong>{" "}
                  {uiText(" để kiểm tra đề cương, video học thử, học liệu đính kèm và cấu trúc giá bán.")}
                </p>
              </div>
            </div>
            <div className="admin-workflow-arrow" aria-hidden="true">
              →
            </div>
            <div className="admin-workflow-step">
              <div className="admin-step-badge">{uiText("Bước 3")}</div>
              <div className="admin-step-content">
                <h4>{uiText("Quyết định vòng đời")}</h4>
                <p>
                  <strong style={{ color: "#16a34a" }}>{uiText("Xuất bản (PUBLISH):")}</strong>{" "}
                  {uiText(" Niêm yết công khai trên marketplace.")}
                  <br />
                  <strong style={{ color: "#d97706" }}>{uiText("Lưu trữ (ARCHIVE):")}</strong>{" "}
                  {uiText(" Tạm dừng niêm yết, bảo lưu quyền học viên cũ.")}
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
            <Icon name="layers" size={15} /> {uiText(" Danh mục")}
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
            placeholder={uiText("Tìm theo tên khóa học hoặc mã ID…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="admin-search-input"
            aria-label={uiText("Tìm kiếm khóa học")}
          />
        </div>

        <div className="admin-toolbar-actions">
          <button
            type="button"
            className="button button-subtle"
            onClick={handleManualEntry}
            title={uiText("Dán mã UUID của khóa học do giảng viên cung cấp chưa xuất hiện trên danh mục")}
          >
            <span>{uiText("+ Nhập mã ID từ Giảng viên")}</span>
          </button>
          <button
            type="button"
            className="button secondary admin-reload-btn"
            onClick={() => setRevision((x) => x + 1)}
            disabled={pending}
            title={uiText("Tải lại danh sách")}
          >
            <Icon name="refresh" size={15} />
            <span>{uiText("Tải lại")}</span>
          </button>
        </div>
      </div>

      {/* Course Cards Grid */}
      {pending ? (
        <div className="admin-loading-state" role="status">
          <Icon name="refresh" size={26} className="spin-animation" />
          <p>{uiText("Đang tải danh mục khóa học từ máy chủ…")}</p>
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
                    <span className="status-pill status-success">{uiText("● Đang xuất bản")}</span>
                    <span className="badge">{uiText(priceLabel(c, uiLocale))}</span>
                    {isSelected && (
                      <span className="status-pill status-active-target">{uiText("★ Đang chọn")}</span>
                    )}
                  </div>
                </div>

                <h2 className="admin-course-title">{c.title}</h2>
                <p className="admin-course-price-text">{uiText(priceLabel(c, uiLocale))}</p>

                {/* Monospaced ID Tag with 1-click Copy */}
                <div className="admin-course-id-row">
                  <span className="admin-id-label">{uiText("Mã ID:")}</span>
                  <code className="admin-course-id-tag" title={c.courseId}>
                    {c.courseId}
                  </code>
                  <button
                    type="button"
                    className="admin-id-copy-btn"
                    onClick={() => handleCopyId(c.courseId)}
                    title={uiText("Sao chép mã UUID khóa học")}
                  >
                    <span>{copiedId === c.courseId ? uiText("✓ Đã chép") : uiText("📋 Sao chép")}</span>
                  </button>
                </div>

                <div className="admin-course-actions-bar">
                  <Link
                    to={`/courses/${c.courseId}`}
                    className="button button-small button-subtle admin-public-link"
                    title={uiText("Xem trang khóa học phía học viên")}
                  >
                    <Icon name="eye" size={14} />
                    <span>{uiText("Chi tiết công khai")}</span>
                  </Link>
                  <button
                    type="button"
                    className={`button button-small ${isSelected ? "admin-manage-active-btn" : "secondary"}`}
                    onClick={() => handleSelectCourse(c.courseId)}
                    title={uiText("Đưa khóa học này vào khung xử lý bên dưới")}
                  >
                    <Icon name="settings" size={14} />
                    <span>{isSelected ? uiText("✓ Đang chọn quản lý") : uiText("Chọn quản lý")}</span>
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
              ? uiText('Không tìm thấy khóa học nào phù hợp với từ khóa "{0}".', [search])
              : uiText("Chưa có khóa học công khai trong danh mục này.")}
          </p>
          <button type="button" className="button button-subtle" onClick={handleManualEntry}>
            {uiText("+ Xử lý khóa học mới bằng mã ID")}
          </button>
        </div>
      )}

      {/* Pagination row */}
      {next && (
        <div className="admin-governance-pagination-bar">
          <button className="button" onClick={() => setCursor(next)}>
            <span>{uiText("Trang tiếp theo")}</span>
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      )}

      {/* Docked Active Course Bar when modal is closed */}
      {selectedCourse && !isModalOpen && (
        <div className="admin-active-course-dock animate-fade-in">
          <div className="admin-active-dock-info">
            <span className="badge">{uiText("ĐANG CHỌN")}</span>
            <span className="admin-active-dock-title">{selectedCourse.title}</span>
            <code className="admin-active-dock-id">{selectedCourse.courseId}</code>
          </div>
          <div className="admin-active-dock-actions">
            <button type="button" className="button button-small" onClick={() => setIsModalOpen(true)}>
              <Icon name="settings" size={14} />
              <span>{uiText("Mở bảng quản lý")}</span>
            </button>
            <button
              type="button"
              className="button button-small button-subtle"
              onClick={() => setResourceId("")}
              title={uiText("Bỏ chọn khóa học này")}
            >
              {uiText("✕ Bỏ chọn")}
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
                    {uiText("THAO TÁC QUẢN TRỊ VIÊN")}
                  </p>
                  <h2 id="admin-course-modal-title">{uiText("Phê duyệt & Quản trị Khóa học")}</h2>
                </div>
              </div>
              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={handleCloseModal}
                aria-label={uiText("Đóng cửa sổ")}
                title={uiText("Đóng (Esc)")}
              >
                ✕
              </button>
            </div>

            {selectedCourse ? (
              <div className="admin-selected-course-banner admin-modal-course-banner">
                <div className="admin-selected-badge-group">
                  <span className="badge">{uiText("KHÓA HỌC ĐƯỢC CHỌN")}</span>
                  <span className="status-pill status-success">{uiText("● Đang hoạt động")}</span>
                  <span className="badge">{uiText(priceLabel(selectedCourse, uiLocale))}</span>
                </div>
                <div className="admin-selected-title">{selectedCourse.title}</div>
                <div className="admin-selected-meta">
                  <span>
                    {uiText("Mã UUID: ")}
                    <code>{selectedCourse.courseId}</code>
                  </span>
                </div>
                <div className="admin-selected-actions">
                  <button
                    type="button"
                    className="admin-id-copy-btn"
                    onClick={() => handleCopyId(selectedCourse.courseId)}
                    title={uiText("Sao chép mã UUID khóa học")}
                  >
                    <span>
                      {copiedId === selectedCourse.courseId
                        ? uiText("✓ Đã chép mã")
                        : uiText("📋 Sao chép mã ID")}
                    </span>
                  </button>
                  <Link
                    to={`/courses/${selectedCourse.courseId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="button button-subtle button-small"
                    title={uiText("Xem trang khóa học phía học viên")}
                  >
                    <Icon name="eye" size={13} />
                    <span>{uiText("Chi tiết công khai ↗")}</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="admin-target-course-hint admin-modal-hint">
                <Icon name="alert" size={18} />
                <span>
                  {uiText("Nhập hoặc dán mã định danh (UUID) của khóa học cần quản trị xuất bản bên dưới.")}
                </span>
              </div>
            )}

            <form
              className="form-panel admin-action admin-action-panel-modal"
              onSubmit={(event) => void submit(event)}
              ref={formRef}
            >
              <label>
                {uiText("Mã khóa học")}
                <input
                  required
                  value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                  pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
                  placeholder={uiText("Ví dụ: 10000000-0000-4000-8000-000000000001")}
                  ref={courseInputRef}
                />
              </label>

              <label>
                {uiText("Thao tác")}
                <select value={action} onChange={(e) => setAction(e.target.value as "publish" | "archive")}>
                  <option value="publish">
                    {uiText("Xuất bản (PUBLISH) — Cho phép hiển thị trên Marketplace")}
                  </option>
                  <option value="archive">
                    {uiText("Lưu trữ (ARCHIVE) — Tạm ẩn khỏi sàn, ngừng nhận học viên mới")}
                  </option>
                </select>
              </label>

              <label>
                {uiText("Mật khẩu quản trị viên hiện tại")}
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={uiText("Nhập mật khẩu tài khoản quản trị để xác thực thẩm quyền")}
                />
              </label>

              {message && (
                <div
                  role="status"
                  className={`admin-status-notice ${message.includes("Đã") ? "success" : "error"}`}
                >
                  <Icon name={message.includes("Đã") ? "checkCircle" : "alert"} size={16} />
                  <span>{uiText(message)}</span>
                </div>
              )}

              <div className="admin-modal-action-row">
                <button type="button" className="button secondary" onClick={handleCloseModal}>
                  {uiText("Đóng")}
                </button>
                <button className="button admin-submit-action-btn" disabled={busy}>
                  {busy ? uiText("Đang xử lý…") : uiText("Xác nhận thao tác")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
