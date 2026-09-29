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
        <ErrorBoundary>
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
      {p.role === "LECTURER" && p.lecturerVerified && <LecturerProfileEditor lecturerId={p.userId} />}
    </>
  );
}
