import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { Logo } from "./Logo";
import { Dialog, Arrow } from "./ui";
export const groups: Record<string, [string, string][]> = {
  Platform: [
    ["/courses", "Khóa học"],
    ["/classroom", "Lớp học"],
    ["/assessment", "Đánh giá"],
    ["/progress", "Tiến độ"],
    ["/notifications", "Thông báo"],
    ["/features", "Tất cả tính năng"],
  ],
  Solutions: [
    ["/students", "Dành cho sinh viên"],
    ["/lecturers", "Dành cho giảng viên"],
    ["/how-it-works", "Cách hoạt động"],
  ],
  AI: [
    ["/ai-learning", "AI Learning"],
    ["/ai-quiz", "Tạo quiz & duyệt"],
  ],
  Resources: [
    ["/help", "Trung tâm trợ giúp"],
    ["/faq", "Câu hỏi thường gặp"],
    ["/media", "Thư viện hình ảnh"],
  ],
  Research: [
    ["/research", "Nghiên cứu"],
    ["/architecture", "Kiến trúc"],
    ["/roadmap", "Lộ trình"],
  ],
  Company: [
    ["/about", "Về AILSS"],
    ["/security", "Bảo mật"],
    ["/contact", "Liên hệ"],
  ],
  Legal: [
    ["/legal/privacy", "Quyền riêng tư"],
    ["/legal/terms", "Điều khoản"],
    ["/legal/cookies", "Cookie"],
    ["/accessibility", "Khả năng tiếp cận"],
  ],
};
export function Layout() {
  const [mobile, setMobile] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const location = useLocation();
  useEffect(() => {
    setMobile(false);
    setMenu(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  return (
    <>
      <a className="skip-link" href="#main">
        Bỏ qua đến nội dung
      </a>
      <header
        className="header"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setMenu(null);
            (e.currentTarget.querySelector('[aria-expanded="true"]') as HTMLElement)?.focus();
          }
        }}
      >
        <div className="header-inner">
          <Logo />
          <nav className="desktop-nav" aria-label="Điều hướng chính">
            {["Platform", "Solutions"].map((name) => (
              <div
                className="nav-dropdown"
                key={name}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setMenu(null);
                }}
              >
                <button
                  aria-expanded={menu === name}
                  aria-controls={`menu-${name}`}
                  onClick={() => setMenu(menu === name ? null : name)}
                >
                  {name}
                  <span aria-hidden="true">⌄</span>
                </button>
                {menu === name && (
                  <div id={`menu-${name}`} className="mega-menu">
                    {groups[name].map(([to, label]) => (
                      <Link key={to} to={to}>
                        {label}
                        <Arrow />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <Link to="/courses">Courses</Link>
            <Link to="/ai-learning">AI</Link>
            <Link to="/research">Research</Link>
            <Link to="/about">About</Link>
            <Link to="/contact">Contact</Link>
          </nav>
          <div className="header-actions">
            <Link className="login-link" to="/auth/login">
              Login
            </Link>
            <Link className="button small" to="/auth/register">
              Get started
              <Arrow />
            </Link>
            <button
              className="mobile-toggle icon-button"
              onClick={() => setMobile(true)}
              aria-label="Mở điều hướng"
              aria-expanded={mobile}
            >
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
          </div>
        </div>
      </header>
      <Dialog open={mobile} onClose={() => setMobile(false)} title="Điều hướng AILSS">
        <nav className="mobile-nav" aria-label="Điều hướng di động">
          {Object.entries(groups)
            .filter(([name]) => name !== "Legal")
            .map(([name, links]) => (
              <details key={name} open={name === "Platform"}>
                <summary>{name}</summary>
                {links.map(([to, label]) => (
                  <Link key={to} to={to}>
                    {label}
                  </Link>
                ))}
              </details>
            ))}
          <Link className="button" to="/auth/login">
            Đăng nhập
          </Link>
        </nav>
      </Dialog>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="footer">
        <div className="container">
          <div className="footer-top">
            <div>
              <Logo />
              <p>
                Kết nối tri thức, con người và công nghệ.
                <br />
                Một nền tảng cho hành trình dạy và học.
              </p>
            </div>
            <Link className="text-link" to="/auth/register">
              Bắt đầu cùng AILSS
              <Arrow />
            </Link>
          </div>
          <div className="footer-grid">
            {Object.entries(groups)
              .filter(([name]) => name !== "AI")
              .map(([name, links]) => (
                <div key={name}>
                  <h2>{name}</h2>
                  {links.map(([to, label]) => (
                    <Link key={to} to={to}>
                      {label}
                    </Link>
                  ))}
                </div>
              ))}
          </div>
          <div className="footer-bottom">
            <span>© 2026 NVD · AILSS</span>
            <span>AI hỗ trợ. Con người quyết định.</span>
            <Link to="/accessibility">Thiết kế cho mọi người</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
