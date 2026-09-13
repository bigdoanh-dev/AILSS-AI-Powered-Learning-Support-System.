import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSession, roleLabel } from "../auth/session";
import { SiteHeader } from "../components/SiteHeader";
import { Avatar, useAvatar } from "../components/Preferences";
import { sessionRequest } from "../auth/session";

import { errorMessage } from "../lib/api";
import { ErrorBoundary } from "../components/ErrorBoundary";
const StudentHome = lazy(() => import("../student/Learning").then((m) => ({ default: m.StudentHome })));
const AdminHome = lazy(() => import("../admin/Admin").then((m) => ({ default: m.AdminHome })));
const TeachingHome = lazy(() => import("../lecturer/Teaching").then((m) => ({ default: m.TeachingHome })));
export function AppShell() {
  const auth = useSession();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  if (auth.state === "UNAUTHENTICATED")
    return (
      <Navigate
        to={`/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  if (!auth.profile)
    return (
      <>
        <SiteHeader />
        <main id="main" className="workspace-content">
          <h1>Đang mở tài khoản</h1>
          <p role="status">{auth.message || "Đang xác minh phiên đăng nhập…"}</p>
          {auth.state === "UNAVAILABLE" && (
            <button className="button" onClick={() => void auth.bootstrap()}>
              Thử lại
            </button>
          )}
        </main>
      </>
    );
  const role = auth.profile.role;
  const tabs: [to: string, label: string, icon: string][] =
    role === "ADMIN"
      ? [
          ["/app", "Tổng quan", "⚡"],
          ["/app/admin/users", "Người dùng", "👥"],
          ["/app/admin/lecturer-applications", "Giảng viên", "🎓"],
          ["/app/admin/courses", "Khóa học", "📚"],
          ["/app/admin/moderation", "Kiểm duyệt", "🛡️"],
          ["/app/notifications", "Thông báo", "🔔"],
        ]
      : role === "LECTURER"
        ? [
            ["/app", "Tổng quan", "⚡"],
            ["/app/teaching", "Khóa học của tôi", "📚"],
            ["/app/teaching/classes", "Lớp phụ trách", "👥"],
            ["/app/teaching/schedule", "Lịch dạy", "📅"],
            ["/app/teaching/attendance", "Điểm danh", "📋"],
            ["/app/teaching/offerings", "Đợt mở bán", "🎯"],
            ["/app/teaching/assessments", "Bài kiểm tra", "📝"],
            ["/app/teaching/ai", "Trợ lý AI", "🤖"],
            ["/app/notifications", "Thông báo", "🔔"],
          ]
        : [
            ["/app", "Tổng quan", "⚡"],
            ["/app/learn", "Khóa học của tôi", "📚"],
            ["/app/classes", "Lớp học", "🏛️"],
            ["/app/schedule", "Lịch học", "📅"],
            ["/app/attendance", "Điểm danh", "✅"],
            ["/app/assessments", "Bài kiểm tra", "📝"],
            ["/app/progress", "Tiến độ", "📈"],
            ["/app/notifications", "Thông báo", "🔔"],
          ];
  return (
    <div className="learning-site">
      <SiteHeader />
      <div className="workspace-tabs">
        <nav aria-label="Không gian cá nhân">
          {tabs.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === "/app" || to === "/app/teaching"}>
              <span className="tab-icon" aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}

          <NavLink to="/app/account">
            <span className="tab-icon" aria-hidden="true">👤</span>
            <span>Hồ sơ</span>
          </NavLink>
        </nav>
      </div>
      <main id="main" tabIndex={-1} className="workspace-content">
        <ErrorBoundary>
          <Suspense fallback={<p role="status">Đang mở nội dung…</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer className="workspace-footer">
        <span>© 2026 AILSS · Nguyễn Viết Doanh</span>
        <button
          type="button"
          className="plain-button"
          onClick={() => window.dispatchEvent(new CustomEvent("ailss-play-intro"))}
          style={{ cursor: "pointer", background: "none", border: "none", font: "inherit", color: "var(--muted)" }}
        >
          🎬 Xem lại giới thiệu
        </button>
        <Link to="/help">Cần hỗ trợ?</Link>
        <Link to="/courses">Khám phá khóa học</Link>
      </footer>
    </div>
  );
}
export function AppHome() {
  const { profile } = useSession();
  if (!profile) return null;
  if (profile.role === "STUDENT") return <StudentHome />;
  if (profile.role === "ADMIN") return <AdminHome />;
  if (profile.lecturerVerified) return <TeachingHome />;
  return (
    <section className="verification-welcome">
      <h1>Chào mừng, {profile.displayName}.</h1>
      <p className="lead">Tài khoản giảng viên của bạn đã được tạo.</p>
      <div className="notice">
        <h2>Đang chờ xác minh</h2>
        <p>
          Quản trị viên sẽ xác minh tài khoản để bạn có thể tạo khóa học và mở lớp. Bạn có thể cập nhật hồ sơ
          và ảnh đại diện ngay bây giờ.
        </p>
      </div>
      <Link className="button" to="/app/account">
        Hoàn thiện hồ sơ
      </Link>
      <Link className="text-link" to="/help">
        Trợ giúp tài khoản
      </Link>
    </section>
  );
}
export function Account() {
  const navigate = useNavigate();
  function result(success: boolean, message: string) {
    navigate("/app/result", {
      state: {
        success,
        title: success ? "Cập nhật thành công" : "Cập nhật chưa thành công",
        message,
        to: "/app/account",
        label: "Về tài khoản",
      },
    });
  }
  const auth = useSession();
  const avatar = useAvatar();
  const p = auth.profile;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const nameAttempt = useRef({ value: "", key: "" });
  const passwordAttempt = useRef({ digest: "", key: "" });
  async function uploadAvatar(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)
        throw new Error("Chọn ảnh PNG, JPEG hoặc WebP không quá 8 MB.");
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 384;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Trình duyệt không thể xử lý ảnh này.");
      const side = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        0,
        0,
        384,
        384,
      );
      bitmap.close();
      await sessionRequest("avatar", "POST", { dataUrl: canvas.toDataURL("image/jpeg", 0.84) });
      avatar.reload();
      result(true, "Đã lưu ảnh đại diện. Ảnh sẽ xuất hiện trên tài khoản của bạn.");
    } catch (e) {
      result(false, e instanceof Error && !("status" in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeAvatar() {
    setBusy(true);
    try {
      await sessionRequest("avatar", "POST", { dataUrl: null });
      avatar.reload();
      result(true, "Đã xóa ảnh đại diện.");
    } catch (e) {
      result(false, errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>, password = false) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      if (password) {
        const body = {
          currentPassword: String(data.get("currentPassword")),
          newPassword: String(data.get("newPassword")),
        };
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body))),
          ),
        ).join(",");
        if (passwordAttempt.current.digest !== digest)
          passwordAttempt.current = { digest, key: crypto.randomUUID() };
        await auth.password(body, passwordAttempt.current.key);
        form.reset();
        navigate("/auth/result", {
          replace: true,
          state: {
            success: true,
            title: "Đổi mật khẩu thành công",
            message: "Vui lòng đăng nhập lại bằng mật khẩu mới.",
            to: "/auth/login",
            label: "Đăng nhập lại",
          },
        });
      } else {
        const value = String(data.get("displayName")).trim();
        if (nameAttempt.current.value !== value) nameAttempt.current = { value, key: crypto.randomUUID() };
        await auth.update(value, nameAttempt.current.key);
        result(true, "Tên hiển thị đã được cập nhật.");
      }
    } catch (error) {
      result(false, errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!p) return null;
  return (
    <>
      <p className="eyebrow">TÀI KHOẢN</p>
      <h1>Hồ sơ & bảo mật.</h1>
      <p className="lead">Thông tin chính thức, do bạn kiểm soát.</p>
      <p role="status">{message}</p>
      <section className="profile-avatar-editor">
        <Avatar large />
        <div>
          <h2>Ảnh đại diện của bạn</h2>
          <p>Chọn ảnh rõ mặt. Ảnh sẽ được cắt vuông và lưu vào tài khoản.</p>
          <div className="inline-actions">
            <label className="button small avatar-upload">
              {busy ? "Đang lưu…" : "Tải ảnh lên"}
              <input
                aria-label="Tải ảnh đại diện"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  void uploadAvatar(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {avatar.url && (
              <button className="plain-button" disabled={busy} onClick={() => void removeAvatar()}>
                Xóa ảnh
              </button>
            )}
          </div>
          <small>PNG, JPEG hoặc WebP · Tối đa 8 MB</small>
        </div>
      </section>
      <div className="account-grid">
        <section className="form-panel">
          <h2>Thông tin cá nhân</h2>
          <dl className="profile-facts">
            <dt>Email</dt>
            <dd>{p.emailMasked}</dd>
            <dt>Vai trò</dt>
            <dd>{roleLabel(p)}</dd>
            <dt>Trạng thái</dt>
            <dd>{p.status === "ACTIVE" ? "Đang hoạt động" : p.status}</dd>
            <dt>Mã tài khoản</dt>
            <dd>{p.userId}</dd>
          </dl>
          <form onSubmit={(e) => void save(e)}>
            <label>
              Họ và tên
              <input
                key={p.displayName}
                name="displayName"
                defaultValue={p.displayName}
                autoComplete="name"
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            <button className="button" disabled={busy}>
              {busy ? "Đang xử lý…" : "Lưu tên hiển thị"}
            </button>
          </form>
        </section>
        <section className="form-panel">
          <h2>Đổi mật khẩu</h2>
          <p>Sau khi đổi mật khẩu thành công, bạn cần đăng nhập lại.</p>
          <form onSubmit={(e) => void save(e, true)}>
            <label>
              Mật khẩu hiện tại
              <input
                name="currentPassword"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              Mật khẩu mới
              <input
                name="newPassword"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <button className="plain-button" type="button" aria-pressed={show} onClick={() => setShow(!show)}>
              {show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            </button>
            <p>
              <small>Dùng 12–128 ký tự. Đây là xác thực lại bằng mật khẩu hiện tại.</small>
            </p>
            <button className="button" disabled={busy}>
              {busy ? "Đang xử lý…" : "Đổi mật khẩu"}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
