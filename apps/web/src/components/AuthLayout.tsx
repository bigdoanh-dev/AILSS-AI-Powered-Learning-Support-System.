import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { Picture } from "./ui";
import { ThemeToggle } from "./Preferences";
export function AuthLayout() {
  const { pathname } = useLocation();
  const visual = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const heading = document.querySelector<HTMLElement>("main h1");
    heading?.setAttribute("tabindex", "-1");
    if (window.history.state?.idx > 0) heading?.focus({ preventScroll: true });
  }, [pathname]);
  useEffect(() => {
    const element = visual.current!;
    const fine = matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)");
    const move = (e: PointerEvent) => {
      if (!fine.matches) return;
      const r = element.getBoundingClientRect();
      element.style.setProperty("--light-x", `${((e.clientX - r.left) / r.width) * 100}%`);
      element.style.setProperty("--light-y", `${((e.clientY - r.top) / r.height) * 100}%`);
    };
    element.addEventListener("pointermove", move, { passive: true });
    const observer = new IntersectionObserver(([e]) =>
      element.classList.toggle("visual-paused", !e.isIntersecting),
    );
    observer.observe(element);
    const pause = () => element.classList.toggle("visual-hidden", document.hidden);
    document.addEventListener("visibilitychange", pause);
    return () => {
      element.removeEventListener("pointermove", move);
      observer.disconnect();
      document.removeEventListener("visibilitychange", pause);
    };
  }, []);
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
          <ThemeToggle />
          <Link to="/">← Về trang chủ</Link>
        </div>
      </header>
      <div className="auth-composition">
        <main id="main" tabIndex={-1} className="auth-main">
          {showModeNav && (
            <div className="auth-mode-container" aria-label="Chuyển chế độ xác thực">
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
                  <span className="pill-icon" aria-hidden="true">🔑</span>
                  <span>Đăng nhập</span>
                </Link>
                <Link
                  to="/auth/register"
                  className={`auth-mode-pill ${isRegister ? "active" : ""}`}
                  aria-current={isRegister ? "page" : undefined}
                >
                  <span className="pill-icon" aria-hidden="true">✨</span>
                  <span>Đăng ký</span>
                </Link>
              </nav>
            </div>
          )}
          <div key={pathname} className="auth-route-panel">
            <Outlet />
          </div>
          <div className="auth-legal">
            <Link to="/legal/privacy">Quyền riêng tư</Link>
            <span>·</span>
            <Link to="/legal/terms">Điều khoản</Link>
          </div>
        </main>
        <aside
          ref={visual}
          className={`auth-universe ${paused ? "user-paused" : ""}`}
          aria-label="AI đồng hành trong hành trình học tập"
        >
          <div className="auth-universe-copy" key={register ? "register" : "login"}>
            <p className="eyebrow">KHỞI ĐẦU NHỎ. KHẢ NĂNG LỚN.</p>
            <h2>
              {register
                ? "Một bước bắt đầu.\nNhiều điều để khám phá."
                : "Tri thức kết nối.\nBạn tiếp tục tiến xa."}
            </h2>
            <p>Học theo nhịp của bạn. Dạy bằng thế mạnh của bạn. AI hỗ trợ những bước chuẩn bị.</p>
          </div>
          <div className="auth-art">
            <Picture
              name={register ? "study" : "coding"}
              alt={register ? "Cùng học tập và chia sẻ tri thức" : "Góc học tập để bắt đầu một ý tưởng mới"}
            />
            <span className="auth-orbit orbit-one" />
            <span className="auth-orbit orbit-two" />
            <span className="floating-note note-document">↗ Tài liệu của bạn</span>
            <span className="floating-note note-quiz">✓ Bản nháp để giảng viên duyệt</span>
          </div>
          <p className="auth-universe-caption">AI hỗ trợ. Con người quyết định.</p>
          <button className="auth-motion-toggle" aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? "Bật chuyển động" : "Tạm dừng chuyển động"}
          </button>
        </aside>
      </div>
    </div>
  );
}
