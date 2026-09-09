import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useSession, roleLabel } from "../auth/session";
import { Logo } from "./Logo";
import { Dialog } from "./ui";
import { Avatar, ThemeToggle } from "./Preferences";

export function SiteHeader() {
  const auth = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const p = auth.profile;
  useEffect(() => {
    setMenu(false);
    setMobile(false);
  }, [location.pathname]);
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await auth.logout();
      setMenu(false);
      navigate("/auth/result", {
        replace: true,
        state: {
          success: true,
          title: "Đăng xuất thành công",
          message: "Phiên đăng nhập đã kết thúc.",
          to: "/auth/login",
          label: "Đăng nhập lại",
        },
      });
    } catch {
      setError("Chưa thể đăng xuất. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }
  const links = (
    <>
      <NavLink to="/courses">Khóa học</NavLink>
      {p ? (
        <>
          <Link className="notification-shortcut" to="/app/notifications" aria-label="Mở thông báo">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
            </svg>{" "}
            Thông báo
          </Link>
          <NavLink to="/app">
            {p.role === "ADMIN" ? "Quản trị" : p.role === "LECTURER" ? "Giảng dạy" : "Học tập"}
          </NavLink>
        </>
      ) : (
        <NavLink to="/lecturers">Dành cho giảng viên</NavLink>
      )}
      <NavLink to="/ai-learning">Học cùng AI</NavLink>
      <NavLink to="/help">Trợ giúp</NavLink>
    </>
  );
  return (
    <>
      <a className="skip-link" href="#main">
        Đến nội dung chính
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Logo />
          <nav className="site-navigation" aria-label="Điều hướng chính">
            {links}
          </nav>
          <div className="site-tools">
            <ThemeToggle />
            {p ? (
              <div
                className="user-menu"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setMenu(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setMenu(false);
                    e.currentTarget.querySelector<HTMLButtonElement>("button")?.focus();
                  }
                }}
              >
                <button
                  type="button"
                  className="user-menu-trigger"
                  aria-expanded={menu}
                  aria-controls="account-menu"
                  onClick={() => setMenu(!menu)}
                >
                  <Avatar />
                  <span>{p.displayName}</span>
                  <span className="chevron" aria-hidden="true">
                    ⌄
                  </span>
                </button>
                {menu && (
                  <div className="user-menu-panel" id="account-menu">
                    <strong>{p.displayName}</strong>
                    <small>{roleLabel(p)}</small>
                    <Link to="/app">Tổng quan tài khoản</Link>
                    <Link to="/app/account">Hồ sơ và ảnh đại diện</Link>
                    <Link to="/courses">Khám phá khóa học</Link>
                    <button disabled={busy} onClick={() => void logout()}>
                      {busy ? "Đang đăng xuất…" : "Đăng xuất"}
                    </button>
                    {error && <p role="alert">{error}</p>}
                  </div>
                )}
              </div>
            ) : auth.state === "BOOTSTRAPPING" ? (
              <span className="session-loading" aria-label="Đang kiểm tra tài khoản" />
            ) : (
              <div className="guest-actions">
                <Link to="/auth/login">Đăng nhập</Link>
                <Link className="button small" to="/auth/register">
                  Bắt đầu học
                </Link>
              </div>
            )}
            <button
              className="site-menu-toggle"
              aria-label="Mở điều hướng"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <Dialog open={mobile} onClose={() => setMobile(false)} title="Điều hướng">
        <nav className="mobile-nav">
          {links}
          {p ? <Link to="/app/account">Hồ sơ của tôi</Link> : <Link to="/auth/login">Đăng nhập</Link>}
        </nav>
      </Dialog>
    </>
  );
}
