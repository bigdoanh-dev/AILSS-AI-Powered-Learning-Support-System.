import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useSession, roleLabel } from "../auth/session";
import { Logo } from "./Logo";
import { Dialog } from "./ui";
import { Avatar, ThemeToggle } from "./Preferences";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useLanguage } from "../lib/i18n";

export function SiteHeader() {
  const { t } = useLanguage();
  const auth = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiNotice, setAiNotice] = useState<{ jobId: string; state: string }>();
  useEffect(() => {
    let timer = 0;
    const notify = (event: Event) => {
      setAiNotice((event as CustomEvent<{ jobId: string; state: string }>).detail);
      clearTimeout(timer);
      timer = window.setTimeout(() => setAiNotice(undefined), 12000);
    };
    window.addEventListener("ailss-ai-complete", notify);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("ailss-ai-complete", notify);
    };
  }, []);
  const p = auth.profile;
  const coursesPath = p?.role === "STUDENT" ? "/app/learn" : "/courses";
  const aiPath =
    p?.role === "STUDENT"
      ? "/app/ai-tutor"
      : p?.role === "ADMIN"
        ? "/app/admin/ai"
        : p?.role === "LECTURER"
          ? p.lecturerVerified
            ? "/app/teaching/ai"
            : null
          : "/ai-learning";
  const aiLabel =
    p?.role === "STUDENT"
      ? "Gia sư AI"
      : p?.role === "ADMIN"
        ? "AI quản trị"
        : p?.role === "LECTURER"
          ? "Trợ lý soạn bài AI"
          : t("nav.aiLearning", "Học cùng AI");
  useEffect(() => {
    setMenu(false);
    setMobile(false);
  }, [location.pathname]);
  async function logout() {
    setBusy(true);
    setError("");
    navigate("/auth/result", {
      state: {
        success: true,
        title: "Đang đăng xuất…",
        message: "AILSS đang thu hồi phiên hiện tại.",
        to: "/auth/login",
        label: "Đợi hoàn tất",
      },
    });
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
      navigate("/auth/result", {
        replace: true,
        state: {
          success: false,
          title: "Chưa thể đăng xuất",
          message: "Chưa xác nhận được việc thu hồi phiên. Vui lòng thử lại.",
          to: "/app",
          label: "Quay lại tài khoản",
        },
      });
    } finally {
      setBusy(false);
    }
  }
  const links = (
    <>
      {p?.role === "LECTURER" && aiNotice && (
        <aside className="assistant-notice" role="status">
          {aiNotice.state === "AI_DRAFT"
            ? "Bản nháp câu hỏi đã sẵn sàng."
            : "Chưa thể tạo câu hỏi. Xem chi tiết để biết lý do."}
          <Link
            className="button"
            to={`/app/teaching/ai/jobs/${aiNotice.jobId}`}
            onClick={() => setAiNotice(undefined)}
          >
            {t("action.openJob", "Mở công việc")}
          </Link>
        </aside>
      )}
      <NavLink to={coursesPath}>{t("nav.courses", "Khóa học")}</NavLink>
      {p ? (
        <NavLink to="/app">
          {p.role === "ADMIN"
            ? t("nav.admin", "Quản trị")
            : p.role === "LECTURER"
              ? t("nav.teaching", "Giảng dạy")
              : t("nav.classroom", "Học tập")}
        </NavLink>
      ) : (
        <NavLink to="/lecturers">{t("nav.forLecturers", "Dành cho giảng viên")}</NavLink>
      )}
      {aiPath && <NavLink to={aiPath}>{aiLabel}</NavLink>}
      <NavLink to="/help">{t("nav.help", "Trợ giúp")}</NavLink>
    </>
  );
  return (
    <>
      <a className="skip-link" href="#main">
        {t("action.skipToContent", "Đến nội dung chính")}
      </a>
      <header className={`site-header ${location.pathname === "/" ? "home-hero-header" : ""}`}>
        <div className="site-header-inner">
          <Logo />
          <nav className="site-navigation" aria-label={t("nav.mainNav", "Điều hướng chính")}>
            {links}
          </nav>
          <div className="site-tools">
            {p && (
              <NavLink
                to="/app/notifications"
                className={({ isActive }) => `header-notification-btn ${isActive ? "active" : ""}`}
                aria-label={t("nav.notifications", "Thông báo")}
                title={t("nav.notifications", "Thông báo")}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
                </svg>
              </NavLink>
            )}
            <LanguageSwitcher />
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
                  aria-label={`Menu tài khoản: ${p.displayName}`}
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
                    <Link to="/app">{t("nav.accountOverview", "Tổng quan tài khoản")}</Link>
                    <Link to="/app/account">{t("nav.profileAndAvatar", "Hồ sơ và ảnh đại diện")}</Link>
                    <Link to="/app/notifications">{t("nav.personalNotifications", "Thông báo cá nhân")}</Link>
                    <Link to={coursesPath}>{t("nav.exploreCourses", "Khám phá khóa học")}</Link>
                    <button disabled={busy} onClick={() => void logout()}>
                      {busy ? t("nav.loggingOut", "Đang đăng xuất…") : t("nav.logout", "Đăng xuất")}
                    </button>
                    {error && <p role="alert">{error}</p>}
                  </div>
                )}
              </div>
            ) : auth.state === "BOOTSTRAPPING" ? (
              <span className="session-loading" aria-label="Đang kiểm tra tài khoản" />
            ) : (
              <div className="guest-actions">
                <Link to="/auth/login">{t("nav.login", "Đăng nhập")}</Link>
                <Link className="button small" to="/auth/register">
                  {t("nav.getStarted", "Bắt đầu học")}
                </Link>
              </div>
            )}
            <button
              className="site-menu-toggle"
              aria-label={t("nav.navigation", "Mở điều hướng")}
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
      <Dialog open={mobile} onClose={() => setMobile(false)} title={t("nav.navigation", "Điều hướng")}>
        <nav
          className="mobile-nav"
          onClick={(event) => {
            if ((event.target as Element).closest("a")) setMobile(false);
          }}
        >
          {links}
          {p && <NavLink to="/app/notifications">{t("nav.notifications", "Thông báo")}</NavLink>}
          {p ? (
            <Link to="/app/account">{t("nav.profile", "Hồ sơ của tôi")}</Link>
          ) : (
            <Link to="/auth/login">{t("nav.login", "Đăng nhập")}</Link>
          )}
        </nav>
      </Dialog>
      <nav className="web-bottom-dock" aria-label={t("nav.quickNav", "Điều hướng nhanh")}>
        <NavLink
          to={p ? "/app" : "/"}
          end
          className={({ isActive }) => `web-bottom-dock-item ${isActive ? "active" : ""}`}
          aria-label={t("nav.home", "Trang chủ")}
        >
          {({ isActive }) => (
            <>
              <div className="dock-icon-wrapper">
                <svg
                  viewBox="0 0 24 24"
                  fill={isActive ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth={isActive ? "0" : "2"}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {isActive ? (
                    <path d="M10.7 2.3a2 2 0 0 1 2.6 0l7 5.6A2 2 0 0 1 21 9.5V20a2 2 0 0 1-2 2h-4a1 1 0 0 1-1-1v-5a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v5a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V9.5a2 2 0 0 1 .7-1.6l7-5.6Z" />
                  ) : (
                    <>
                      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9 22 9 12 15 12 15 22" />
                    </>
                  )}
                </svg>
              </div>
              <span className="dock-sr-only">{t("nav.home", "Trang chủ")}</span>
            </>
          )}
        </NavLink>
        <NavLink
          to={
            p?.role === "LECTURER"
              ? "/app/teaching"
              : p?.role === "ADMIN"
                ? "/app/admin/ai"
                : p
                  ? "/app/learn"
                  : "/ai-learning"
          }
          className={({ isActive }) => `web-bottom-dock-item ${isActive ? "active" : ""}`}
          aria-label={p?.role === "LECTURER" ? t("nav.teaching", "Giảng dạy") : t("nav.aiLearning", "Học AI")}
        >
          {({ isActive }) => (
            <>
              <div className="dock-icon-wrapper">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polygon points="10 8 16 12 10 16 10 8" fill={isActive ? "currentColor" : "none"} />
                </svg>
              </div>
              <span className="dock-sr-only">
                {p?.role === "LECTURER" ? t("nav.teaching", "Giảng dạy") : t("nav.aiLearning", "Học AI")}
              </span>
            </>
          )}
        </NavLink>
        <NavLink
          to={
            p?.role === "LECTURER"
              ? "/app/teaching/classes"
              : p?.role === "ADMIN"
                ? "/app"
                : p
                  ? "/app/classes"
                  : "/courses"
          }
          className={({ isActive }) => `web-bottom-dock-item ${isActive ? "active" : ""}`}
          aria-label={
            p?.role === "LECTURER"
              ? t("nav.teaching", "Giảng dạy")
              : p?.role === "ADMIN"
                ? t("nav.admin", "Quản trị")
                : p
                  ? t("nav.classroom", "Lớp học")
                  : t("nav.courses", "Khóa học")
          }
        >
          {() => (
            <>
              <div className="dock-icon-wrapper">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <span className="dock-sr-only">
                {p?.role === "LECTURER"
                  ? t("nav.teaching", "Giảng dạy")
                  : p?.role === "ADMIN"
                    ? t("nav.admin", "Quản trị")
                    : p
                      ? t("nav.classroom", "Lớp học")
                      : t("nav.courses", "Khóa học")}
              </span>
            </>
          )}
        </NavLink>
        <NavLink
          to={coursesPath}
          className={({ isActive }) => `web-bottom-dock-item ${isActive ? "active" : ""}`}
          aria-label={t("nav.courses", "Khóa học")}
        >
          {() => (
            <>
              <div className="dock-icon-wrapper">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              </div>
              <span className="dock-sr-only">{t("nav.courses", "Khóa học")}</span>
            </>
          )}
        </NavLink>
        <NavLink
          to={p ? "/app/notifications" : "/help"}
          className={({ isActive }) => `web-bottom-dock-item ${isActive ? "active" : ""}`}
          aria-label={p ? t("nav.notifications", "Thông báo") : t("nav.help", "Trợ giúp")}
        >
          {() => (
            <>
              <div className="dock-icon-wrapper">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
              </div>
              <span className="dock-sr-only">
                {p ? t("nav.notifications", "Thông báo") : t("nav.help", "Trợ giúp")}
              </span>
            </>
          )}
        </NavLink>
        <NavLink
          to={p ? "/app/account" : "/auth/login"}
          className={({ isActive }) => `web-bottom-dock-item ${isActive ? "active" : ""}`}
          aria-label={p ? t("nav.account", "Tài khoản") : t("nav.login", "Đăng nhập")}
        >
          {() => (
            <>
              <div className="dock-icon-wrapper">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="7" r="4" />
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                </svg>
              </div>
              <span className="dock-sr-only">
                {p ? t("nav.account", "Tài khoản") : t("nav.login", "Đăng nhập")}
              </span>
            </>
          )}
        </NavLink>
      </nav>
    </>
  );
}
