import { lazy, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useSession, roleLabel } from "../auth/session";
import { Dialog } from "../components/ui";
import { Logo } from "../components/Logo";
import { errorMessage } from "../lib/api";
const StudentHome = lazy(() => import("../student/Learning").then((m) => ({ default: m.StudentHome })));
export function AppShell() {
  const auth = useSession();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [account, setAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDrawer(false);
    setAccount(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [location.pathname]);
  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await auth.logout();
    } catch {
      /* authority presents the failure */
    } finally {
      setBusy(false);
      setAccount(false);
    }
  }
  if (auth.state === "UNAUTHENTICATED")
    return <Navigate to={`/auth/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  if (auth.state !== "AUTHENTICATED" || !auth.profile)
    return (
      <main id="main" tabIndex={-1} className="session-state container">
        <Logo />
        <p className="eyebrow">AILSS · PHIÊN TÀI KHOẢN</p>
        <h1>{auth.state === "UNAVAILABLE" ? "Chưa thể xác minh phiên." : "Đang xác minh phiên…"}</h1>
        <p role="status">{auth.message || "Đang kết nối an toàn đến tài khoản của bạn."}</p>
        {auth.state === "UNAVAILABLE" && (
          <div className="inline-actions">
            <button className="button" onClick={() => void auth.bootstrap()}>
              Thử lại
            </button>
            <button className="button secondary" disabled={busy} onClick={() => void logout()}>
              Thử đăng xuất
            </button>
            <Link to="/auth/login">Đăng nhập lại</Link>
          </div>
        )}
        <Link to="/">Về trang công khai</Link>
      </main>
    );
  const navigation = (
    <nav className="workspace-nav" aria-label="Không gian cá nhân">
      <NavLink to="/app" end>
        Tổng quan tài khoản
      </NavLink>
      {auth.profile?.role === "ADMIN" && (
        <>
          <NavLink to="/app/admin" end>
            Trung tâm quản trị
          </NavLink>
          <NavLink to="/app/admin/users">Người dùng</NavLink>
          <NavLink to="/app/admin/lecturer-applications">Yêu cầu Giảng viên</NavLink>
          <NavLink to="/app/admin/courses">Khóa học</NavLink>
          <NavLink to="/app/admin/moderation">Kiểm duyệt nội dung</NavLink>
        </>
      )}
      {auth.profile.role === "STUDENT" && (
        <>
          <NavLink to="/app/learn">Học tập</NavLink>
          <NavLink to="/app/classes">Lớp học</NavLink>
          <NavLink to="/app/assessments">Bài kiểm tra</NavLink>
          <NavLink to="/app/progress">Tiến độ</NavLink>
          <NavLink to="/app/notifications">Thông báo</NavLink>
        </>
      )}
      {auth.profile.role === "LECTURER" && (
        <>
          <NavLink to="/app/teaching">Giảng dạy</NavLink>
          {auth.profile.lecturerVerified && (
            <>
              <NavLink to="/app/teaching/classes">Lớp phụ trách</NavLink>
              <NavLink to="/app/teaching/offerings">Offering</NavLink>
              <NavLink to="/app/teaching/assessments">Đánh giá</NavLink>
              <NavLink to="/app/teaching/ai">AI Studio</NavLink>
            </>
          )}
        </>
      )}
      <NavLink to="/app/account">Hồ sơ & bảo mật</NavLink>
      <Link to="/courses">Khám phá khóa học ↗</Link>
      <Link to="/help">Trung tâm trợ giúp ↗</Link>
    </nav>
  );
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Bỏ qua đến nội dung
      </a>
      <aside className="workspace-sidebar">
        <Logo /> <p className="eyebrow">KHÔNG GIAN CÁ NHÂN</p>
        {navigation}
        <div className="workspace-note">
          <span className="status-dot" /> Phiên được bảo vệ<p>{roleLabel(auth.profile)}</p>
          <Link to="/">← Trang công khai</Link>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="workspace-header">
          <button
            className="plain-button drawer-toggle"
            onClick={() => setDrawer(true)}
            aria-label="Mở điều hướng"
          >
            ☰
          </button>
          <span>
            Không gian cá nhân /{" "}
            <strong>
              {(
                {
                  account: "Hồ sơ & bảo mật",
                  learn: "Học tập",
                  classes: "Lớp học",
                  assessments: "Bài kiểm tra",
                  attempts: "Lần làm bài",
                  progress: "Tiến độ",
                  notifications: "Thông báo",
                  teaching: "Giảng dạy",
                  admin: "Quản trị",
                } as Record<string, string>
              )[location.pathname.split("/")[2]] || "Tổng quan"}
            </strong>
          </span>
          <button
            aria-label="Tài khoản"
            className="account-trigger"
            onClick={() => setAccount(true)}
            aria-haspopup="dialog"
          >
            <span className="avatar" aria-hidden="true">
              {auth.profile.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span>Tài khoản</span>
          </button>
        </header>
        <main id="main" tabIndex={-1} className="workspace-content" key={location.pathname}>
          <Outlet />
        </main>
      </div>
      <Dialog
        className="workspace-drawer"
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Điều hướng tài khoản"
      >
        {navigation}
      </Dialog>
      <Dialog open={account} onClose={() => setAccount(false)} title="Tài khoản của bạn">
        <h2>{auth.profile.displayName}</h2>
        <p>{roleLabel(auth.profile)}</p>
        <div className="workspace-nav">
          <Link to="/app/account" onClick={() => setAccount(false)}>
            Hồ sơ & bảo mật
          </Link>
          <Link to="/">Trang công khai</Link>
          <button className="button" disabled={busy} onClick={() => void logout()}>
            {busy ? "Đang đăng xuất…" : "Đăng xuất"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
export function AppHome() {
  const { profile } = useSession();
  if (!profile) return null;
  if (profile.role === "STUDENT") return <StudentHome />;
  if (profile.role === "ADMIN") return <Navigate to="/app/admin" replace />;
  return (
    <>
      <p className="eyebrow">AILSS · HỌC CÓ ĐỊNH HƯỚNG</p>
      <h1>Xin chào, {profile.displayName}.</h1>
      <p className="lead">Một nơi để quản lý danh tính và bắt đầu hành trình học tập.</p>
      <div className="workspace-welcome">
        <div>
          <span className="badge">{roleLabel(profile)}</span>
          <h2>Tài khoản của bạn đã sẵn sàng.</h2>
          <p>Thông tin dưới đây được xác minh từ hệ thống tài khoản.</p>
          <Link className="button" to="/app/account">
            Xem hồ sơ & bảo mật →
          </Link>
        </div>
        <div className="account-orbit" aria-hidden="true">
          <span>NVD</span>
          <i />
          <i />
        </div>
      </div>
      <div className="workspace-cards">
        <article>
          <p className="eyebrow">DANH TÍNH</p>
          <h2>{roleLabel(profile)}</h2>
          <p>Trạng thái: {profile.status === "ACTIVE" ? "Đang hoạt động" : profile.status}</p>
          {profile.role === "LECTURER" && !profile.lecturerVerified && (
            <p>Tài khoản chưa được xác minh giảng viên. Liên hệ đơn vị quản trị để được hướng dẫn.</p>
          )}
        </article>
        <article>
          <p className="eyebrow">KHÁM PHÁ</p>
          <h2>Bắt đầu từ một khóa học.</h2>
          <p>Tìm nội dung công khai phù hợp với điều bạn muốn học.</p>
          <Link to="/courses">Mở danh mục khóa học →</Link>
        </article>
        <article>
          <p className="eyebrow">BẢO MẬT</p>
          <h2>Kiểm soát tài khoản.</h2>
          <p>Xem hồ sơ, cập nhật tên và thay đổi mật khẩu của bạn.</p>
          <Link to="/app/account">Quản lý tài khoản →</Link>
        </article>
      </div>
    </>
  );
}
export function Account() {
  const auth = useSession();
  const p = auth.profile;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const nameAttempt = useRef({ value: "", key: "" });
  const passwordAttempt = useRef({ digest: "", key: "" });
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
      } else {
        const value = String(data.get("displayName")).trim();
        if (nameAttempt.current.value !== value) nameAttempt.current = { value, key: crypto.randomUUID() };
        await auth.update(value, nameAttempt.current.key);
        setMessage("Đã cập nhật tên từ hồ sơ chính thức.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
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
