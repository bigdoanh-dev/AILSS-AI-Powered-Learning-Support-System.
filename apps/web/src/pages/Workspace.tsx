import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSession, roleLabel } from "../auth/session";
import { SiteHeader } from "../components/SiteHeader";
import { Avatar, useAvatar } from "../components/Preferences";
import { sessionRequest } from "../auth/session";

import { errorMessage } from "../lib/api";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Icon, type IconName } from "../components/Icon";
import { useLanguage } from "../lib/i18n";
import { LecturerProfileEditor } from "../lecturer/ProfileEditor";
const StudentHome = lazy(() => import("../student/Learning").then((m) => ({ default: m.StudentHome })));
const AdminHome = lazy(() => import("../admin/Admin").then((m) => ({ default: m.AdminHome })));
const TeachingHome = lazy(() => import("../lecturer/Teaching").then((m) => ({ default: m.TeachingHome })));

interface TabItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

function WorkspaceTabBar({ tabs }: { tabs: TabItem[] }) {
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 6);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 6);
  }, []);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const active = navRef.current?.querySelector("a.active") as HTMLElement | null;
      if (active && navRef.current) {
        active.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        checkScroll();
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [location.pathname, checkScroll]);

  const handleScroll = (direction: "left" | "right") => {
    if (!navRef.current) return;
    const distance = direction === "left" ? -260 : 260;
    navRef.current.scrollBy({ left: distance, behavior: "smooth" });
  };

  const { t } = useLanguage();
  return (
    <div className="workspace-tabs">
      <div className="workspace-tabs-container">
        {canScrollLeft && (
          <>
            <div className="workspace-tabs-mask-left" aria-hidden="true" />
            <button
              type="button"
              className="workspace-tabs-scroll-btn left"
              onClick={() => handleScroll("left")}
              aria-label={t("action.scrollLeft", "Cuộn sang trái")}
              title={t("action.scrollLeft", "Cuộn sang trái")}
            >
              <Icon name="chevronLeft" size={14} />
            </button>
          </>
        )}

        <nav ref={navRef} aria-label={t("tab.overview", "Không gian làm việc")}>
          {tabs.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end}>
              <span className="tab-icon" aria-hidden="true">
                <Icon name={tab.icon} size={15} />
              </span>
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </nav>

        {canScrollRight && (
          <>
            <div className="workspace-tabs-mask-right" aria-hidden="true" />
            <button
              type="button"
              className="workspace-tabs-scroll-btn right"
              onClick={() => handleScroll("right")}
              aria-label={t("action.scrollRight", "Cuộn sang phải")}
              title={t("action.scrollRight", "Cuộn sang phải")}
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
export function AppShell() {
  const { t } = useLanguage();
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
  if (auth.state === "BOOTSTRAPPING")
    return <p role="status">{t("status.loadingSession", "Đang tải phiên…")}</p>;
  if (auth.state === "UNAVAILABLE" || !auth.profile)
    return (
      <>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="workspace-unavailable">
          <p role="alert">
            {t("status.serviceUnavailable", "Dịch vụ hiện không khả dụng. Vui lòng thử lại sau.")}
          </p>
          {auth.bootstrap && (
            <button className="button" onClick={() => void auth.bootstrap()}>
              {t("action.retry", "Thử lại")}
            </button>
          )}
        </main>
      </>
    );
  const role = auth.profile.role;
  const tabs: { to: string; label: string; icon: IconName; end?: boolean }[] =
    role === "ADMIN"
      ? [
          { to: "/app", label: t("tab.overview", "Tổng quan"), icon: "home", end: true },
          { to: "/app/admin/revenue", label: t("tab.revenue", "Doanh thu"), icon: "card" },
          { to: "/app/admin/stats", label: t("tab.stats", "Thống kê & AI"), icon: "chart" },
          { to: "/app/admin/ai", label: "AI quản trị", icon: "ai" },
          { to: "/app/admin/logs", label: t("tab.logs", "Nhật ký Logs"), icon: "quiz" },
          { to: "/app/admin/users", label: t("tab.users", "Người dùng"), icon: "users" },
          {
            to: "/app/admin/lecturer-applications",
            label: t("tab.lecturers", "Giảng viên"),
            icon: "graduation",
          },
          { to: "/app/admin/courses", label: t("tab.courses", "Khóa học"), icon: "book" },
          { to: "/app/admin/moderation", label: t("tab.moderation", "Kiểm duyệt"), icon: "shield" },
          { to: "/app/admin/settings", label: t("tab.settings", "Cài đặt"), icon: "settings" },
        ]
      : role === "LECTURER"
        ? [
            { to: "/app", label: t("tab.overview", "Tổng quan"), icon: "home", end: true },
            { to: "/app/teaching", label: t("tab.courses", "Khóa học"), icon: "book", end: true },
            { to: "/app/teaching/classes", label: t("tab.classes", "Lớp học"), icon: "users" },
            { to: "/app/teaching/schedule", label: t("tab.teachingSchedule", "Lịch dạy"), icon: "calendar" },
            { to: "/app/teaching/attendance", label: t("tab.attendance", "Điểm danh"), icon: "checkCircle" },
            { to: "/app/teaching/offerings", label: t("tab.offerings", "Đợt mở bán"), icon: "target" },
            { to: "/app/teaching/revenue", label: "Doanh thu", icon: "card" },
            { to: "/app/teaching/assessments", label: t("tab.assessments", "Bài kiểm tra"), icon: "quiz" },
            { to: "/app/teaching/grades", label: t("tab.grades", "Bảng điểm"), icon: "trophy" },
            { to: "/app/teaching/ai", label: t("tab.aiStudio", "Trợ lý AI"), icon: "sparkles" },
          ]
        : [
            { to: "/app", label: t("tab.overview", "Tổng quan"), icon: "home", end: true },
            { to: "/app/learn", label: t("tab.courses", "Khóa học"), icon: "book" },
            { to: "/app/classes", label: t("tab.classes", "Lớp học"), icon: "class" },
            { to: "/app/schedule", label: t("tab.schedule", "Lịch học"), icon: "calendar" },
            { to: "/app/attendance", label: t("tab.attendance", "Điểm danh"), icon: "checkCircle" },
            { to: "/app/assessments", label: t("tab.assessments", "Bài kiểm tra"), icon: "quiz" },
            { to: "/app/progress", label: t("tab.progress", "Tiến độ"), icon: "trending" },
            { to: "/app/ai-tutor", label: t("tab.aiTutor", "Gia sư AI"), icon: "ai" },
          ];
  return (
    <div className="learning-site">
      <SiteHeader />
      <WorkspaceTabBar tabs={tabs} />
      <main id="main" tabIndex={-1} className="workspace-content">
        <ErrorBoundary key={`${auth.profile.userId}:${auth.profile.role}`}>
          <Suspense fallback={<p role="status">{t("status.loadingSession", "Đang mở nội dung…")}</p>}>
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
          style={{
            cursor: "pointer",
            background: "none",
            border: "none",
            font: "inherit",
            color: "var(--muted)",
          }}
        >
          {t("action.replayIntro", "🎬 Xem lại giới thiệu")}
        </button>
        <Link to="/help">{t("nav.needHelp", "Cần hỗ trợ?")}</Link>
        <Link to={role === "STUDENT" ? "/app/learn" : "/courses"}>
          {t("nav.exploreCourses", "Khám phá khóa học")}
        </Link>
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
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newPasswordVal, setNewPasswordVal] = useState("");
  const [copied, setCopied] = useState(false);
  const nameAttempt = useRef({ value: "", key: "" });
  const passwordAttempt = useRef({ digest: "", key: "" });

  const copyUserId = useCallback(() => {
    if (!p?.userId) return;
    void navigator.clipboard.writeText(p.userId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [p?.userId]);

  // Calculate password strength score (0 to 4)
  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return { score: 0, text: "Chưa nhập", class: "" };
    if (pwd.length < 8) return { score: 1, text: "Quá ngắn (tối thiểu 12 ký tự)", class: "weak" };
    let score = 0;
    if (pwd.length >= 12) score += 1;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1;
    if (/\d/.test(pwd)) score += 1;
    if (/[^a-zA-Z0-9]/.test(pwd)) score += 1;

    if (score <= 1) return { score: 1, text: "Yếu", class: "weak" };
    if (score === 2) return { score: 2, text: "Trung bình", class: "medium" };
    if (score === 3) return { score: 3, text: "Mạnh", class: "strong" };
    return { score: 4, text: "Rất an toàn", class: "very-strong" };
  };

  const strength = getPasswordStrength(newPasswordVal);

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

  // Role-specific presentation config
  const role = p.role;
  const roleConfig =
    role === "ADMIN"
      ? {
          roleClass: "role-admin",
          badgeClass: "badge-admin",
          roleTitle: "Quản trị viên hệ thống",
          badgeIcon: "shield" as IconName,
          tagline:
            "Trung tâm kiểm soát & an ninh hệ thống — Quản lý toàn bộ tài khoản người dùng, phân quyền truy cập, kiểm duyệt và điều phối hạ tầng AILSS.",
          shortcutsTitle: "Lối tắt quản trị hệ thống",
          shortcuts: [
            {
              to: "/app/admin/users",
              label: "Quản lý người dùng",
              desc: "Tài khoản & vai trò",
              icon: "users" as IconName,
            },
            {
              to: "/app/admin/moderation",
              label: "Kiểm duyệt nội dung",
              desc: "Khóa học & đánh giá",
              icon: "shield" as IconName,
            },
            {
              to: "/app/admin/stats",
              label: "Thống kê & Báo cáo",
              desc: "Chỉ số vận hành hệ thống",
              icon: "chart" as IconName,
            },
            {
              to: "/app/admin/logs",
              label: "Nhật ký Logs",
              desc: "Kiểm toán & sự kiện bảo mật",
              icon: "quiz" as IconName,
            },
          ],
        }
      : role === "LECTURER"
        ? {
            roleClass: "role-lecturer",
            badgeClass: "badge-lecturer",
            roleTitle: "Giảng viên AILSS",
            badgeIcon: "graduation" as IconName,
            tagline:
              "Không gian giảng dạy & nghiên cứu học thuật — Quản lý khóa học, tổ chức lớp trực tuyến, điểm danh học viên và theo dõi báo cáo thù lao.",
            shortcutsTitle: "Lối tắt giảng dạy & học liệu",
            shortcuts: [
              {
                to: "/app/teaching",
                label: "Khóa học của tôi",
                desc: "Soạn bài giảng & học liệu",
                icon: "book" as IconName,
              },
              {
                to: "/app/teaching/classes",
                label: "Lớp giảng dạy",
                desc: "Điểm danh & quản lý lớp",
                icon: "users" as IconName,
              },
              {
                to: "/app/teaching/revenue",
                label: "Doanh thu & Thù lao",
                desc: "Báo cáo doanh số & đối soát",
                icon: "card" as IconName,
              },
              {
                to: "/app/teaching/ai",
                label: "Trợ lý AI giáo trình",
                desc: "Tạo đề thi & tài liệu mẫu",
                icon: "sparkles" as IconName,
              },
            ],
          }
        : {
            roleClass: "role-student",
            badgeClass: "badge-student",
            roleTitle: "Học viên AILSS",
            badgeIcon: "book" as IconName,
            tagline:
              "Không gian học tập cá nhân — Quản lý hồ sơ, bảo vệ tài khoản và đồng bộ tiến độ học tập trên toàn hệ thống học thông minh AILSS.",
            shortcutsTitle: "Lối tắt học tập của bạn",
            shortcuts: [
              {
                to: "/app/learn",
                label: "Khóa học đang học",
                desc: "Tiếp tục bài giảng của bạn",
                icon: "book" as IconName,
              },
              {
                to: "/app/classes",
                label: "Lớp học trực tuyến",
                desc: "Tham gia lớp & điểm danh",
                icon: "class" as IconName,
              },
              {
                to: "/app/schedule",
                label: "Thời khóa biểu",
                desc: "Lịch học & sự kiện tuần này",
                icon: "calendar" as IconName,
              },
              {
                to: "/app/ai-tutor",
                label: "Gia sư AI 24/7",
                desc: "Hỏi đáp & luyện thi thông minh",
                icon: "ai" as IconName,
              },
            ],
          };

  return (
    <div className={`account-page ${roleConfig.roleClass}`}>
      {/* Page Header */}
      <header className="account-header">
        <div className="account-eyebrow">
          <Icon name="shield" size={13} />
          <span>Tài khoản & bảo mật</span>
        </div>
        <h1>Hồ sơ & bảo mật tài khoản</h1>
        <p className="account-lead">Thông tin chính thức, nhận diện và thiết lập bảo vệ danh tính của bạn.</p>
      </header>

      {message && (
        <div className="account-status-alert" role="status">
          <Icon name="info" size={16} />
          <span>{message}</span>
        </div>
      )}

      {/* Hero Identity Banner */}
      <section className={`account-hero ${roleConfig.roleClass}`} aria-label="Thông tin nhận diện hồ sơ">
        <div className="account-hero-content">
          <div className="account-avatar-wrapper">
            <div className="account-avatar-frame">
              <Avatar large />
              <span className="account-online-dot" title="Tài khoản đang hoạt động" />
            </div>
            <div className="account-avatar-actions">
              <label className="account-upload-btn" title="Tải ảnh mới từ máy tính">
                <Icon name="upload" size={13} />
                <span>{busy ? "Đang lưu…" : "Tải ảnh mới"}</span>
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
                <button
                  type="button"
                  className="account-delete-avatar-btn"
                  disabled={busy}
                  onClick={() => void removeAvatar()}
                  title="Xóa ảnh đại diện hiện tại"
                >
                  <Icon name="trash" size={13} />
                  <span>Xóa</span>
                </button>
              )}
            </div>
            <span className="account-avatar-hint">PNG, JPEG hoặc WebP · Tối đa 8 MB</span>
          </div>

          <div className="account-hero-details">
            <div className="account-hero-name-row">
              <h2 className="account-hero-name">{p.displayName}</h2>
              <span className={`account-role-badge ${roleConfig.badgeClass}`}>
                <Icon name={roleConfig.badgeIcon} size={13} />
                <span>{roleConfig.roleTitle}</span>
              </span>
              {role === "LECTURER" && (
                <span className={`account-verification-pill ${p.lecturerVerified ? "verified" : "pending"}`}>
                  <Icon name={p.lecturerVerified ? "checkCircle" : "clock"} size={11} />
                  <span>{p.lecturerVerified ? "Đã xác thực" : "Chờ xác thực"}</span>
                </span>
              )}
            </div>
            <p className="account-hero-tagline">{roleConfig.tagline}</p>

            <div className="account-hero-ribbon">
              <div className="account-ribbon-item">
                <Icon name="mail" size={14} />
                <span>
                  Email: <strong>{p.emailMasked}</strong>
                </span>
              </div>
              <div className="account-ribbon-item">
                <Icon name="checkCircle" size={14} style={{ color: "#10b981" }} />
                <span>
                  Trạng thái: <strong style={{ color: "#10b981" }}>Đang hoạt động</strong>
                </span>
              </div>
              <div className="account-ribbon-item">
                <span>Mã ID:</span>
                <button
                  type="button"
                  className="account-copy-chip"
                  onClick={copyUserId}
                  title="Bấm để sao chép mã tài khoản"
                >
                  <Icon
                    name={copied ? "check" : "copy"}
                    size={12}
                    style={{ color: copied ? "#10b981" : "inherit" }}
                  />
                  <span>{copied ? "Đã sao chép!" : p.userId.slice(0, 13) + "..."}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Navigation Shortcuts */}
      <section className="account-shortcuts-section" aria-label="Lối tắt theo vai trò">
        <h3 className="account-shortcuts-title">
          <Icon name="zap" size={14} style={{ color: "var(--blue)" }} />
          <span>{roleConfig.shortcutsTitle}</span>
        </h3>
        <div className="account-shortcuts-grid">
          {roleConfig.shortcuts.map((sc) => (
            <Link key={sc.to} to={sc.to} className="account-shortcut-card">
              <div className="account-shortcut-icon">
                <Icon name={sc.icon} size={18} />
              </div>
              <div className="account-shortcut-info">
                <span className="account-shortcut-label">{sc.label}</span>
                <span className="account-shortcut-desc">{sc.desc}</span>
              </div>
              <Icon name="chevronRight" size={14} style={{ color: "var(--muted)", opacity: 0.6 }} />
            </Link>
          ))}
        </div>
      </section>

      {/* Two Column Grid: Personal Info & Security */}
      <div className="account-cards-grid">
        {/* Left Column: Personal Info Form */}
        <section className="account-card" aria-labelledby="heading-personal-info">
          <div className="account-card-header">
            <div className="account-card-header-left">
              <div className="account-card-icon-badge">
                <Icon name="user" size={18} />
              </div>
              <div>
                <h2 id="heading-personal-info">Thông tin tài khoản</h2>
                <p>Chi tiết nhận diện và vai trò của bạn</p>
              </div>
            </div>
            <span className="account-pill-tag">Hồ sơ</span>
          </div>

          <div className="account-facts-list">
            <div className="account-fact-row">
              <span className="account-fact-label">
                <Icon name="mail" size={14} />
                <span>Email tài khoản</span>
              </span>
              <span className="account-fact-value">{p.emailMasked}</span>
            </div>
            <div className="account-fact-row">
              <span className="account-fact-label">
                <Icon name="graduation" size={14} />
                <span>Vai trò</span>
              </span>
              <span className="account-fact-value">{roleLabel(p)}</span>
            </div>
            <div className="account-fact-row">
              <span className="account-fact-label">
                <Icon name="shield" size={14} />
                <span>Trạng thái hoạt động</span>
              </span>
              <span className="account-fact-value account-status-active">
                {p.status === "ACTIVE" ? "Đang hoạt động" : p.status}
              </span>
            </div>
            <div className="account-fact-row">
              <span className="account-fact-label">
                <Icon name="key" size={14} />
                <span>Mã định danh (UUID)</span>
              </span>
              <button
                type="button"
                className="account-copy-chip"
                onClick={copyUserId}
                title="Bấm để sao chép toàn bộ mã tài khoản"
              >
                <Icon
                  name={copied ? "check" : "copy"}
                  size={12}
                  style={{ color: copied ? "#10b981" : "inherit" }}
                />
                <span>{copied ? "Đã sao chép" : p.userId}</span>
              </button>
            </div>
          </div>

          <form className="account-form" onSubmit={(e) => void save(e)}>
            <div className="account-form-group">
              <label className="account-form-label" htmlFor="input-displayName">
                <span>Họ và tên hiển thị</span>
                <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: "normal" }}>2–100 ký tự</span>
              </label>
              <div className="account-input-box">
                <span className="account-input-icon">
                  <Icon name="user" size={16} />
                </span>
                <input
                  id="input-displayName"
                  key={p.displayName}
                  name="displayName"
                  defaultValue={p.displayName}
                  autoComplete="name"
                  minLength={2}
                  maxLength={100}
                  required
                  placeholder="Nhập họ và tên của bạn"
                />
              </div>
              <p className="account-form-hint">
                Tên hiển thị công khai trên bài giảng, chứng chỉ, bài kiểm tra và giao tiếp lớp học.
              </p>
            </div>

            <button type="submit" className="account-submit-btn" disabled={busy}>
              <Icon name="check" size={15} />
              <span>{busy ? "Đang xử lý…" : "Lưu tên hiển thị"}</span>
            </button>
          </form>
        </section>

        {/* Right Column: Password & Security Form */}
        <section className="account-card" aria-labelledby="heading-security-password">
          <div className="account-card-header">
            <div className="account-card-header-left">
              <div className="account-card-icon-badge" style={{ color: "#ef4444" }}>
                <Icon name="lock" size={18} />
              </div>
              <div>
                <h2 id="heading-security-password">Bảo mật & Mật khẩu</h2>
                <p>Cập nhật mật khẩu để bảo vệ tài khoản</p>
              </div>
            </div>
            <span className="account-pill-tag">Bảo vệ</span>
          </div>

          <div className="account-security-notice">
            <Icon name="shield" size={16} className="notice-icon" />
            <div>
              <strong>Xác thực an toàn:</strong> Sau khi đổi mật khẩu thành công, toàn bộ phiên đăng nhập cũ
              sẽ được đăng xuất an toàn. Bạn sẽ cần đăng nhập lại với mật khẩu mới.
            </div>
          </div>

          <form className="account-form" onSubmit={(e) => void save(e, true)}>
            <div className="account-form-group">
              <label className="account-form-label" htmlFor="input-currentPassword">
                <span>Mật khẩu hiện tại</span>
              </label>
              <div className="account-input-box">
                <span className="account-input-icon">
                  <Icon name="lock" size={16} />
                </span>
                <input
                  id="input-currentPassword"
                  name="currentPassword"
                  type={showCurrent ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  placeholder="Nhập mật khẩu hiện tại"
                />
                <button
                  type="button"
                  className="account-password-toggle"
                  onClick={() => setShowCurrent(!showCurrent)}
                  aria-label={showCurrent ? "Ẩn mật khẩu hiện tại" : "Hiện mật khẩu hiện tại"}
                  title={showCurrent ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                >
                  <Icon name={showCurrent ? "eye" : "lock"} size={15} />
                </button>
              </div>
            </div>

            <div className="account-form-group">
              <label className="account-form-label" htmlFor="input-newPassword">
                <span>Mật khẩu mới</span>
                <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: "normal" }}>
                  Tối thiểu 12 ký tự
                </span>
              </label>
              <div className="account-input-box">
                <span className="account-input-icon">
                  <Icon name="key" size={16} />
                </span>
                <input
                  id="input-newPassword"
                  name="newPassword"
                  type={showNew ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={128}
                  placeholder="Nhập ít nhất 12 ký tự"
                  value={newPasswordVal}
                  onChange={(e) => setNewPasswordVal(e.target.value)}
                />
                <button
                  type="button"
                  className="account-password-toggle"
                  onClick={() => setShowNew(!showNew)}
                  aria-label={showNew ? "Ẩn mật khẩu mới" : "Hiện mật khẩu mới"}
                  title={showNew ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                >
                  <Icon name={showNew ? "eye" : "lock"} size={15} />
                </button>
              </div>

              {/* Password Strength Meter */}
              {newPasswordVal && (
                <div className={`account-pwd-strength ${strength.class}`}>
                  <div className="account-pwd-strength-bar">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="account-pwd-strength-text">
                    <span>
                      Độ mạnh: <strong>{strength.text}</strong>
                    </span>
                    <span>{newPasswordVal.length}/12 ký tự</span>
                  </div>
                </div>
              )}

              <p className="account-form-hint">
                Mật khẩu từ 12–128 ký tự. Nên kết hợp chữ hoa, chữ thường, số và ký tự đặc biệt để an toàn tối
                đa.
              </p>
            </div>

            <button
              type="submit"
              className="account-submit-btn"
              disabled={busy || (newPasswordVal.length > 0 && newPasswordVal.length < 12)}
            >
              <Icon name="shield" size={15} />
              <span>{busy ? "Đang xử lý…" : "Đổi mật khẩu ngay"}</span>
            </button>
          </form>
        </section>
      </div>

      {/* Lecturer-Specific Profile Editor (Public Bio & Payout Configuration) */}
      {p.role === "LECTURER" && p.lecturerVerified && (
        <div className="account-lecturer-profile-wrap">
          <LecturerProfileEditor lecturerId={p.userId} />
        </div>
      )}
    </div>
  );
}
