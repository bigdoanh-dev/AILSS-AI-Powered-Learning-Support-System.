import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useSession } from "../auth/session";
import { SiteHeader } from "./SiteHeader";
import { Logo } from "./Logo";
import { useLanguage } from "../lib/i18n";

export const groups: Record<string, [string, string][]> = {
  "Khám phá": [
    ["/courses", "Khóa học"],
    ["/students", "Dành cho học viên"],
    ["/lecturers", "Dành cho giảng viên"],
    ["/ai-learning", "Học cùng AI"],
  ],
  AILSS: [
    ["/about", "Về chúng tôi"],
    ["/features", "Tính năng"],
    ["/research", "Nghiên cứu"],
    ["/media", "Thư viện hình ảnh"],
  ],
  "Hỗ trợ": [
    ["/help", "Trung tâm trợ giúp"],
    ["/faq", "Câu hỏi thường gặp"],
    ["/contact", "Liên hệ"],
    ["/security", "Bảo mật"],
  ],
  "Thông tin sử dụng": [
    ["/legal/privacy", "Quyền riêng tư"],
    ["/legal/terms", "Điều khoản"],
    ["/legal/cookies", "Cookie"],
    ["/accessibility", "Khả năng tiếp cận"],
  ],
};

export function Layout() {
  const { t } = useLanguage();
  const { profile } = useSession();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);
  return (
    <>
      <SiteHeader />
      {profile && (
        <div className="return-to-learning">
          <div className="container">
            <Link to="/app">
              {t("nav.returnTo", "← Trở lại")}{" "}
              {profile.role === "ADMIN"
                ? t("tab.overview", "tổng quan quản trị")
                : profile.role === "LECTURER"
                  ? t("tab.overview", "không gian giảng dạy")
                  : t("tab.overview", "không gian học tập")}
            </Link>
            <span>
              {t("nav.loggedInAs", "Đăng nhập với tên")} {profile.displayName}
            </span>
          </div>
        </div>
      )}
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="commercial-footer">
        <div className="container">
          <div className="footer-intro">
            <Logo />
            <p>
              {t("footer.motto", "Kết nối tri thức, con người và công nghệ. Học một điều mới, mỗi ngày.")}
            </p>
          </div>
          <div className="footer-links">
            {Object.entries(groups).map(([name, links]) => (
              <div key={name}>
                <h2>{t(name)}</h2>
                {links.map(([to, label]) => (
                  <Link key={to} to={to}>
                    {t(label)}
                  </Link>
                ))}
              </div>
            ))}
          </div>
          <div className="footer-bottom">
            <span>© 2026 AILSS · Nguyễn Viết Doanh</span>
            <span>{t("footer.tagline", "AI hỗ trợ. Con người quyết định.")}</span>
          </div>
        </div>
      </footer>
    </>
  );
}
