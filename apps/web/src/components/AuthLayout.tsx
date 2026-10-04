import { useUiText } from "../lib/i18n";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Logo } from "./Logo";
import { Picture } from "./ui";
import { ThemeToggle } from "./Preferences";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Icon } from "./Icon";
export function AuthLayout() {
  const uiText = useUiText();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const heading = document.querySelector<HTMLElement>("main h1");
    heading?.setAttribute("tabindex", "-1");
    if (window.history.state?.idx > 0) heading?.focus({ preventScroll: true });
  }, [pathname]);
  const isRegister = pathname.includes("register");
  const register = isRegister;
  const isForgot = pathname.includes("forgot-password");
  const isLogin = !isRegister && !isForgot;
  const showModeNav = ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth"].some(
    (p) => pathname === p || pathname.startsWith("/auth/register/"),
  );

  return (
    <div className="auth-environment">
      <header className="auth-brandbar">
        <Logo />
        <div>
          <LanguageSwitcher />
          <ThemeToggle />
          <Link to="/">{uiText("← Về trang chủ")}</Link>
        </div>
      </header>
      <div className="auth-composition">
        <main id="main" tabIndex={-1} className="auth-main">
          {showModeNav && (
            <div className="auth-mode-container" aria-label={uiText("Chuyển chế độ xác thực")}>
              <nav className="auth-mode-nav" data-mode={isRegister ? "register" : "login"}>
                <div
                  className="auth-mode-slider"
                  style={{
                    transform: isRegister ? "translateX(calc(100% + 4px))" : "translateX(0)",
                  }}
                />
                <Link
                  to="/auth/login"
                  className={`auth-mode-pill ${isLogin ? "active" : ""}`}
                  aria-current={isLogin ? "page" : undefined}
                >
                  <span className="pill-icon" aria-hidden="true">
                    <Icon name="key" size={14} />
                  </span>
                  <span>{uiText("Đăng nhập")}</span>
                </Link>
                <Link
                  to="/auth/register"
                  className={`auth-mode-pill ${isRegister ? "active" : ""}`}
                  aria-current={isRegister ? "page" : undefined}
                >
                  <span className="pill-icon" aria-hidden="true">
                    <Icon name="sparkles" size={14} />
                  </span>
                  <span>{uiText("Đăng ký")}</span>
                </Link>
              </nav>
            </div>
          )}
          <div key={pathname} className="auth-route-panel">
            <Outlet />
          </div>
          <div className="auth-legal">
            <Link to="/legal/privacy">{uiText("Quyền riêng tư")}</Link>
            <span>·</span>
            <Link to="/legal/terms">{uiText("Điều khoản")}</Link>
          </div>
        </main>
        <aside className="auth-universe" aria-label={uiText("AI đồng hành trong hành trình học tập")}>
          <div className="auth-universe-copy" key={register ? "register" : "login"}>
            <p className="eyebrow">{uiText("KHỞI ĐẦU NHỎ. KHẢ NĂNG LỚN.")}</p>
            <h2>
              {register
                ? uiText("Một bước bắt đầu.\nNhiều điều để khám phá.")
                : uiText("Tri thức kết nối.\nBạn tiếp tục tiến xa.")}
            </h2>
            <p>
              {uiText("Học theo nhịp của bạn. Dạy bằng thế mạnh của bạn. AI hỗ trợ những bước chuẩn bị.")}
            </p>
          </div>
          <div className="auth-art">
            <Picture
              name={register ? "study" : "coding"}
              alt={
                register
                  ? uiText("Cùng học tập và chia sẻ tri thức")
                  : uiText("Góc học tập để bắt đầu một ý tưởng mới")
              }
            />
            <span className="auth-orbit orbit-one" />
            <span className="auth-orbit orbit-two" />
            <span className="floating-note note-document">{uiText("↗ Tài liệu của bạn")}</span>
            <span className="floating-note note-quiz">{uiText("✓ Bản nháp để giảng viên duyệt")}</span>
          </div>
          <p className="auth-universe-caption">{uiText("AI hỗ trợ. Con người quyết định.")}</p>
        </aside>
      </div>
    </div>
  );
}
