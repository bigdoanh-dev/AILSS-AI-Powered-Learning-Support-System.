import { LocalizedFileInput } from "../components/LocalizedFileInput";
import { useLanguage } from "../lib/i18n";
import { useUiText } from "../lib/i18n";
import { readCourseCover } from "../lib/course-cover";
import { useCourseCategories } from "../lib/course-categories";
import { useState, useEffect, useMemo, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { lecturerError, lecturerRequest, useLecturer } from "./api";
import { CourseArtwork } from "../components/CourseArtwork";
import { CatalogCourseSelect, Field, State } from "./ui";
import { Breadcrumbs, EmptyState, StateChip, stateLabel, useUnsavedChanges } from "../components/product";
import { Icon } from "../components/Icon";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { MediaUpload } from "./MediaUpload";
import { RevenueQuote } from "./RevenueQuote";
import { CoursePricingFields } from "./CoursePricingFields";
import { ClassCreateModal } from "./Classroom";
import { monthNow, rangeForMonth } from "../student/api";

type Course = {
  courseId: string;
  coverDataUrl?: string | null;
  description?: string;
  title: string;
  slug: string;
  categoryId: string;
  state?: string;
  publishedAt?: string;
  priceType: string;
  price: string;
  currency: string;
  ownerLecturerId?: string;
  activeStudentCount?: number;
};
type Lesson = {
  lessonId: string;
  courseId: string;
  mediaAssetId?: string;
  title: string;
  sectionTitle: string;
  state: string;
  preview: boolean;
  position: { sectionOrder: number; lessonOrder: number };
};
type Offering = {
  offeringId: string;
  courseId: string;
  title: string;
  offeringType: string;
  state: string;
  price: string;
  currency: string;
  classId?: string;
};
const values = (f: FormData) => Object.fromEntries(f.entries());

export function CourseCreateModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (course: Course) => void;
}) {
  const uiText = useUiText();
  const nav = useNavigate();
  const categoryOptions = useCourseCategories();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [priceType, setPriceType] = useState<"FREE" | "PAID">("FREE");
  const [price, setPrice] = useState("0");
  const [currency, setCurrency] = useState("VND");
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  if (!isOpen) return null;

  const slugifyTitle = (text: string) => {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
  };

  const handleCoverFile = (file: File) => {
    void readCourseCover(file)
      .then(setCoverPreview)
      .catch((err: Error) => setError(err.message));
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slug || slug === slugifyTitle(title)) {
      setSlug(slugifyTitle(val));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Vui lòng nhập tên khóa học.");
      return;
    }
    const finalSlug = slug.trim() || slugifyTitle(title);
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      const payload = {
        coverDataUrl: coverPreview,
        title: title.trim(),
        slug: finalSlug,
        description: description.trim() || undefined,
        categoryName: categoryName.trim() || "Công nghệ thông tin",
        priceType,
        price: priceType === "PAID" ? price : "0",
        currency,
      };
      const res = await lecturerRequest<Course>("/courses", "POST", payload);
      setMsg("✓ Khởi tạo bản nháp khóa học thành công!");
      setLoading(false);
      setTimeout(() => {
        onClose();
        if (onCreated) {
          onCreated(res.data);
        } else if (res.data?.courseId) {
          nav(`/app/teaching/courses/${res.data.courseId}`);
        }
      }, 500);
    } catch (err) {
      setError(lecturerError(err));
      setLoading(false);
    }
  };

  return (
    <div
      className="admin-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="course-create-modal-title"
    >
      <div
        className="admin-modal-card large"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 760, maxHeight: "92vh" }}
      >
        <div className="admin-modal-header">
          <div>
            <p className="eyebrow" style={{ margin: 0, color: "var(--blue, #0284c7)" }}>
              {uiText("COURSE AUTHORING · BIÊN SOẠN MỚI")}
            </p>
            <h2 id="course-create-modal-title" style={{ margin: "4px 0 0" }}>
              {uiText("Tạo Khóa Học Mới")}
            </h2>
            <p className="subtext" style={{ margin: "4px 0 0" }}>
              {uiText(
                "Thiết lập thông tin khóa học, chủ đề đào tạo, hình thức học phí và tải lên ảnh bìa nhận diện.",
              )}
            </p>
          </div>
          <button
            type="button"
            className="admin-modal-close-btn"
            onClick={onClose}
            aria-label={uiText("Đóng")}
          >
            ✕
          </button>
        </div>

        {msg && (
          <div className="dashboard-banner-notice" role="status" style={{ marginBottom: 16 }}>
            <span>✓</span>
            <span>{uiText(msg)}</span>
          </div>
        )}
        {error && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "rgba(220, 38, 38, 0.1)",
              color: "#dc2626",
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 16,
            }}
          >
            ⚠️ {uiText(error)}
          </div>
        )}

        <form onSubmit={handleSubmit} className="form-panel form-grid">
          <label>
            {uiText("Tên khóa học ")}
            <span style={{ color: "#dc2626" }}>*</span>
            <input
              type="text"
              required
              placeholder={uiText("VD: Lập trình Python ứng dụng AI & LLM nâng cao...")}
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
            />
          </label>
          <label>
            {uiText("Đường dẫn tĩnh (Slug) ")}
            <span style={{ color: "#dc2626" }}>*</span>
            <input
              type="text"
              required
              placeholder="vd: lap-trinh-python-ai-llm"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            {uiText("Mô tả tóm tắt khóa học")}
            <textarea
              rows={2}
              maxLength={2000}
              placeholder={uiText("Mô tả mục tiêu, kiến thức trọng tâm và kỹ năng đầu ra của khóa học...")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            {uiText("Chủ đề đào tạo ")}
            <span style={{ color: "#dc2626" }}>*</span>
            <input
              required
              minLength={2}
              maxLength={80}
              placeholder={uiText("Ví dụ: Trí tuệ nhân tạo, Cơ sở dữ liệu...")}
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              list="course-modal-category-suggestions"
            />
            <datalist id="course-modal-category-suggestions">
              {categoryOptions.map((cat) => (
                <option key={cat.id} value={cat.name} />
              ))}
            </datalist>
          </label>
          <label>
            {uiText("Hình thức đào tạo")}
            <select
              value={priceType}
              onChange={(e) => {
                const pt = e.target.value as "FREE" | "PAID";
                setPriceType(pt);
                if (pt === "FREE") setPrice("0");
              }}
            >
              <option value="FREE">{uiText("Miễn phí (Cộng đồng)")}</option>
              <option value="PAID">{uiText("Có học phí (Thương mại)")}</option>
            </select>
          </label>

          {priceType === "PAID" && (
            <>
              <label>
                {uiText("Học phí (VND)")}
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="VD: 390000"
                  required
                />
              </label>
              <label>
                {uiText("Tiền tệ")}
                <input type="text" value={currency} onChange={(e) => setCurrency(e.target.value)} required />
              </label>
            </>
          )}

          {/* Cover image upload box */}
          <div style={{ gridColumn: "1 / -1" }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink)",
                display: "block",
                marginBottom: 6,
              }}
            >
              {uiText("Hình ảnh bìa đại diện khóa học (Cover Image)")}
            </span>
            <div
              className={`inline-cover-dropzone ${isDragOver ? "dragover" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleCoverFile(f);
              }}
              onClick={() => {
                const el = document.getElementById("course-modal-cover-input") as HTMLInputElement;
                el?.click();
              }}
            >
              <input
                id="course-modal-cover-input"
                type="file"
                accept="image/png, image/jpeg, image/webp"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCoverFile(f);
                }}
              />
              {coverPreview ? (
                <div className="inline-cover-preview-wrapper" onClick={(e) => e.stopPropagation()}>
                  <img
                    src={coverPreview}
                    alt={uiText("Xem trước ảnh bìa")}
                    className="inline-cover-preview-img"
                  />
                  <span className="inline-cover-badge">{uiText("✓ Đã tải ảnh bìa")}</span>
                  <div className="inline-cover-overlay-actions">
                    <button
                      type="button"
                      className="button button-subtle button-small"
                      onClick={(e) => {
                        e.stopPropagation();
                        const el = document.getElementById("course-modal-cover-input") as HTMLInputElement;
                        el?.click();
                      }}
                      style={{ fontSize: 11, padding: "4px 8px" }}
                    >
                      <Icon name="upload" size={12} />
                      <span>{uiText("Đổi ảnh")}</span>
                    </button>
                    <button
                      type="button"
                      className="button button-subtle button-small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCoverPreview(null);
                      }}
                      style={{ fontSize: 11, padding: "4px 8px", color: "#dc2626" }}
                    >
                      <Icon name="trash" size={12} />
                      <span>{uiText("Xóa")}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: "rgba(2, 132, 199, 0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 8,
                      color: "var(--blue)",
                    }}
                  >
                    <Icon name="image" size={24} />
                  </div>
                  <p style={{ fontWeight: 600, fontSize: 13, margin: "0 0 4px", color: "var(--ink)" }}>
                    {uiText("Kéo thả ảnh bìa hoặc nhấp để chọn tệp")}
                  </p>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    {uiText("PNG, JPG, WEBP (khuyến nghị tỉ lệ 16:9)")}
                  </span>
                </>
              )}
            </div>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <RevenueQuote price={price} currency={currency} paid={priceType === "PAID"} />
          </div>

          <div
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              gap: 12,
              justifyContent: "flex-end",
              marginTop: 12,
            }}
          >
            <button type="button" className="button button-subtle" onClick={onClose} disabled={loading}>
              {uiText("Hủy bỏ")}
            </button>
            <button type="submit" className="button" disabled={loading}>
              {loading ? uiText("Đang tạo bản nháp…") : uiText("+ Khởi tạo khóa học")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatCoursePrice(c: Course, locale: string) {
  if (c.priceType === "FREE" || Number(c.price || 0) === 0) return "Miễn phí";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: c.currency || "VND",
      maximumFractionDigits: 0,
    }).format(Number(c.price));
  } catch {
    return `${c.price} ${c.currency || "VND"}`;
  }
}

interface HomeSession {
  sessionId: string;
  classId: string;
  className: string;
  title: string;
  startAt: string;
  endAt: string;
  mode: string;
  location?: string;
  meetingUrl?: string;
  meetingProvider?: string;
  status?: string;
}

export function TeachingHome() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const courses = useLecturer<Course[] | { items: Course[] }>("/me/owned-courses");
  const classes = useLecturer<
    | {
        classId: string;
        name: string;
        scheduleState?: string;
        state?: string;
        maxMembers?: number;
        classKind?: string;
      }[]
    | {
        classes: {
          classId: string;
          name: string;
          scheduleState?: string;
          state?: string;
          maxMembers?: number;
          classKind?: string;
        }[];
      }
  >("/me/owned-classes");
  const offerings = useLecturer<Offering[] | { items: Offering[] }>("/me/owned-offerings");

  const courseList = Array.isArray(courses.data) ? courses.data : courses.data?.items || [];
  const classList = Array.isArray(classes.data) ? classes.data : classes.data?.classes || [];
  const offeringList = Array.isArray(offerings.data) ? offerings.data : offerings.data?.items || [];

  const [showCourseModal, setShowCourseModal] = useState(false);
  const [showClassModal, setShowClassModal] = useState(false);

  const [activeLeadTab, setActiveLeadTab] = useState<"courses" | "classes">("courses");
  const [coursePage, setCoursePage] = useState(1);
  const [classPage, setClassPage] = useState(1);
  const pageSize = 3;

  const publishedCoursesCount = useMemo(
    () => courseList.filter((c) => c.state === "PUBLISHED" || c.state === "ACTIVE").length,
    [courseList],
  );
  const draftCoursesCount = useMemo(() => courseList.filter((c) => c.state === "DRAFT").length, [courseList]);
  const publishedSchedulesCount = useMemo(
    () => classList.filter((cl) => cl.scheduleState === "PUBLISHED").length,
    [classList],
  );
  const activeClassesCount = useMemo(
    () => classList.filter((cl) => cl.state === "ACTIVE" || !cl.state).length,
    [classList],
  );
  const openOfferingsCount = useMemo(
    () =>
      offeringList.filter((o) => o.state === "OPEN" || o.state === "PUBLISHED" || o.state === "ACTIVE")
        .length,
    [offeringList],
  );

  const totalCoursePages = Math.max(1, Math.ceil(courseList.length / pageSize));
  const paginatedCourses = courseList.slice((coursePage - 1) * pageSize, coursePage * pageSize);

  const totalClassPages = Math.max(1, Math.ceil(classList.length / pageSize));
  const paginatedClasses = classList.slice((classPage - 1) * pageSize, classPage * pageSize);

  // Real Sessions in current month
  const [sessions, setSessions] = useState<HomeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    if (!classList.length) {
      setSessions([]);
      return;
    }
    const controller = new AbortController();
    setSessionsLoading(true);

    const curMonth = monthNow();
    const { from, to } = rangeForMonth(curMonth);
    const targetClasses = classList.slice(0, 10);

    Promise.allSettled(
      targetClasses.map((c) =>
        lecturerRequest<HomeSession[] | { sessions?: HomeSession[]; data?: HomeSession[] }>(
          `/classes/${c.classId}/sessions?from=${from}&to=${to}`,
          "GET",
          undefined,
          {},
          controller.signal,
        ).then((res) => {
          const raw = res.data;
          const items: HomeSession[] = Array.isArray(raw) ? raw : raw?.sessions || raw?.data || [];
          return items.map((item) => ({
            ...item,
            classId: c.classId,
            className: c.name,
          }));
        }),
      ),
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        const all: HomeSession[] = [];
        for (const r of results) {
          if (r.status === "fulfilled") {
            all.push(...r.value);
          }
        }
        all.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
        setSessions(all);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSessionsLoading(false);
      });

    return () => controller.abort();
  }, [classList]);

  const currentMonthLabel = useMemo(() => {
    const d = new Date();
    return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
  }, []);

  function formatSessionTime(startAt: string, endAt: string) {
    try {
      const s = new Date(startAt);
      const e = new Date(endAt);
      const timeStr = `${s.toLocaleTimeString(uiLocale, { hour: "2-digit", minute: "2-digit" })} - ${e.toLocaleTimeString(uiLocale, { hour: "2-digit", minute: "2-digit" })}`;
      const dateStr = s.toLocaleDateString(uiLocale, { weekday: "short", day: "2-digit", month: "2-digit" });
      return `${timeStr} • ${dateStr}`;
    } catch {
      return startAt;
    }
  }

  return (
    <div className="teaching-home-container animate-fade-in">
      {/* Top Banner: Teaching Center */}
      <div className="lecturer-copilot-banner">
        <div className="copilot-banner-title">
          <span className="pro-icon-box blue lg" aria-hidden="true">
            <Icon name="graduation" size={22} />
          </span>
          <div>
            <p className="eyebrow" style={{ margin: 0, color: "var(--blue, #0284c7)" }}>
              {uiText("TRUNG TÂM ĐIỀU HÀNH GIẢNG DẠY · AILSS LECTURER")}
            </p>
            <h1 style={{ margin: "4px 0 2px", fontSize: "1.45rem", color: "var(--ink)" }}>
              {uiText("Tổng Quan Giảng Dạy & Điều Hành Lớp Học Phần")}
            </h1>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
              {uiText(
                "Quản lý khóa học trực tuyến, theo dõi lịch giảng dạy, điểm danh sinh viên và đối soát kết quả đào tạo.",
              )}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="button"
            onClick={() => setShowCourseModal(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="plus" size={15} />
            <span>{uiText("Soạn khóa học")}</span>
          </button>
          <button
            type="button"
            className="button button-subtle"
            onClick={() => setShowClassModal(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="users" size={15} />
            <span>{uiText("Mở lớp học")}</span>
          </button>
          <Link className="button button-subtle" to="/app/teaching/reports">
            {uiText("Báo cáo sư phạm")}
          </Link>
          <Link className="button button-subtle" to="/app/teaching/revenue">
            {uiText("Doanh thu")}
          </Link>
        </div>
      </div>

      {/* 1. Real KPI Cards */}
      <section aria-label={uiText("Chỉ số hiệu suất sư phạm trọng yếu")}>
        <div className="workspace-kpi-grid">
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="pro-icon-box blue" aria-hidden="true">
                <Icon name="book" size={18} />
              </span>
              <span className="kpi-tag accent">
                {courseList.length} {uiText(" khóa học")}
              </span>
            </div>
            <div className="kpi-value">
              {publishedCoursesCount} {uiText(" khóa")}
            </div>
            <div className="kpi-label">{uiText("Khóa học đã xuất bản")}</div>
            <p className="kpi-subtext">
              {draftCoursesCount > 0
                ? uiText("{0} khóa đang soạn bản nháp", [draftCoursesCount])
                : uiText("Tất cả khóa học đều đang hoạt động")}
            </p>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="pro-icon-box green" aria-hidden="true">
                <Icon name="graduation" size={18} />
              </span>
              <span className="kpi-tag accent">
                {classList.length} {uiText(" lớp phụ trách")}
              </span>
            </div>
            <div className="kpi-value">
              {publishedSchedulesCount} {uiText(" lớp")}
            </div>
            <div className="kpi-label">{uiText("Lớp đã xuất bản thời khóa biểu")}</div>
            <p className="kpi-subtext">
              {activeClassesCount} {uiText(" lớp đang hoạt động đào tạo")}
            </p>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="pro-icon-box purple" aria-hidden="true">
                <Icon name="calendar" size={18} />
              </span>
              <span className="kpi-tag accent">{currentMonthLabel}</span>
            </div>
            <div className="kpi-value">
              {sessionsLoading ? "..." : uiText("{0} ca dạy", [sessions.length])}
            </div>
            <div className="kpi-label">{uiText("Ca dạy trong tháng hiện tại")}</div>
            <p className="kpi-subtext">{uiText("Lịch đào tạo trực tiếp & trực tuyến")}</p>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="pro-icon-box amber" aria-hidden="true">
                <Icon name="target" size={18} />
              </span>
              <span className="kpi-tag accent">
                {offeringList.length} {uiText(" đợt mở")}
              </span>
            </div>
            <div className="kpi-value">
              {openOfferingsCount} {uiText(" đợt")}
            </div>
            <div className="kpi-label">{uiText("Đợt mở đăng ký tuyển sinh")}</div>
            <p className="kpi-subtext">{uiText("Quản lý tiếp nhận học viên & đối soát học phí")}</p>
          </div>
        </div>
      </section>

      {/* Quick Action Toolbar */}
      <div className="workspace-quick-actions" role="toolbar" aria-label={uiText("Thao tác giảng dạy nhanh")}>
        <Link className="quick-action-chip" to="/app/teaching/schedule">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="calendar" size={16} />
          </span>
          <span>{uiText("Lịch giảng dạy")}</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/attendance">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="checkCircle" size={16} />
          </span>
          <span>{uiText("Điểm danh học viên")}</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/grades">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="trophy" size={16} />
          </span>
          <span>{uiText("Bảng điểm học viên")}</span>
        </Link>
        <button
          type="button"
          className="quick-action-chip"
          onClick={() => setShowCourseModal(true)}
          style={{ background: "transparent", border: "none", cursor: "pointer", font: "inherit" }}
        >
          <span className="chip-icon" aria-hidden="true">
            <Icon name="plus" size={16} />
          </span>
          <span>{uiText("Soạn khóa học mới")}</span>
        </button>
        <button
          type="button"
          className="quick-action-chip"
          onClick={() => setShowClassModal(true)}
          style={{ background: "transparent", border: "none", cursor: "pointer", font: "inherit" }}
        >
          <span className="chip-icon" aria-hidden="true">
            <Icon name="users" size={16} />
          </span>
          <span>{uiText("Mở lớp học mới")}</span>
        </button>
        <Link className="quick-action-chip" to="/app/teaching/assessments">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="quiz" size={16} />
          </span>
          <span>{uiText("Ngân hàng đề thi & Quiz")}</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/offerings">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="target" size={16} />
          </span>
          <span>{uiText("Đợt mở đăng ký")}</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/revenue">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="card" size={16} />
          </span>
          <span>{uiText("Doanh thu & Đối soát")}</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/reports">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="chart" size={16} />
          </span>
          <span>{uiText("Báo cáo & Thống kê")}</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/ai">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="sparkles" size={16} />
          </span>
          <span>{uiText("AI Studio")}</span>
        </Link>
      </div>

      {/* Real Schedule Section */}
      <section className="dashboard-section-card animate-fade-in" style={{ marginTop: 24 }}>
        <div className="section-card-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span className="kpi-tag accent">
                <Icon name="clock" size={12} style={{ marginRight: 4 }} />
                {currentMonthLabel}
              </span>
              <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>
                {sessions.length} {uiText(" ca dạy được ghi nhận")}
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: "1.15rem", display: "flex", alignItems: "center", gap: 8 }}>
              <span className="pro-icon-box blue sm">
                <Icon name="calendar" size={14} />
              </span>
              <span>{uiText("Lịch Giảng Dạy & Ca Dạy Thực Tế")}</span>
            </h2>
            <p className="subtext">
              {uiText(
                "Các buổi học phần sắp tới theo thời khóa biểu đã xuất bản của các lớp học do bạn trực tiếp giảng dạy.",
              )}
            </p>
          </div>
          <Link className="button button-small" to="/app/teaching/schedule">
            {uiText("Xem toàn bộ lịch dạy →")}
          </Link>
        </div>

        {sessionsLoading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            {uiText("Đang tải lịch giảng dạy...")}
          </div>
        ) : sessions.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "32px 16px",
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              marginTop: 16,
            }}
          >
            <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
              {uiText("Chưa có buổi học nào được lên lịch cho các lớp học phần trong tháng này.")}
            </p>
            <Link className="button button-small" to="/app/teaching/schedule">
              {uiText("Lên lịch giảng dạy ngay")}
            </Link>
          </div>
        ) : (
          <div className="teaching-schedule-grid" style={{ marginTop: 16 }}>
            {sessions.slice(0, 4).map((session) => {
              const isPast = Date.parse(session.endAt) < Date.now();
              const isToday = new Date(session.startAt).toDateString() === new Date().toDateString();
              return (
                <div className="teaching-schedule-card" key={session.sessionId}>
                  <div className="teaching-schedule-header">
                    <span className="kpi-tag accent">
                      {formatSessionTime(session.startAt, session.endAt)}
                    </span>
                    <span className={`schedule-status-badge ${isToday ? "live" : "upcoming"}`}>
                      {isToday ? uiText("● Hôm nay") : isPast ? uiText("Đã diễn ra") : uiText("Sắp tới")}
                    </span>
                  </div>
                  <h3 className="teaching-schedule-title">{session.title}</h3>
                  <p className="teaching-schedule-info">
                    <span>
                      {uiText("Lớp: ")}
                      <strong>{session.className}</strong>
                    </span>
                    <span>•</span>
                    <span>
                      {session.mode === "ONLINE"
                        ? uiText("Trực tuyến: {0}", [session.meetingProvider || "Google Meet"])
                        : uiText("Phòng: {0}", [session.location || "Trực tiếp"])}
                    </span>
                  </p>
                  <div className="teaching-schedule-actions">
                    <Link
                      className="button button-small"
                      to={`/app/teaching/attendance?class=${session.classId}`}
                    >
                      {uiText("✓ Điểm danh ngay")}
                    </Link>
                    <Link
                      className="button button-subtle button-small"
                      to={`/app/teaching/classes/${session.classId}`}
                    >
                      {uiText("Mở lớp học →")}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Leading Courses & Classes with Image Artworks, Descriptions and Rich Metrics */}
      <section className="dashboard-section-card animate-fade-in" style={{ marginTop: 24 }}>
        <div className="section-card-header" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <button
                type="button"
                className={`filter-pill-button ${activeLeadTab === "courses" ? "active" : ""}`}
                onClick={() => setActiveLeadTab("courses")}
                style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="book" size={14} />
                <span>
                  {uiText("Khóa học phụ trách (")}
                  {courseList.length})
                </span>
              </button>
              <button
                type="button"
                className={`filter-pill-button ${activeLeadTab === "classes" ? "active" : ""}`}
                onClick={() => setActiveLeadTab("classes")}
                style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="users" size={14} />
                <span>
                  {uiText("Lớp học phần (")}
                  {classList.length})
                </span>
              </button>
            </div>
            <p className="subtext" style={{ margin: 0 }}>
              {activeLeadTab === "courses"
                ? uiText(
                    "Chương trình đào tạo trọng điểm: hình ảnh bài giảng, đề cương chi tiết và nội dung xuất bản.",
                  )
                : uiText(
                    "Các lớp học phần trực tiếp có sĩ số sinh viên và thời khóa biểu giảng dạy tích cực.",
                  )}
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {activeLeadTab === "courses" ? (
              <>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => setShowCourseModal(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Icon name="plus" size={13} />
                  <span>{uiText("Soạn khóa học mới")}</span>
                </button>
                <Link className="button button-subtle button-small" to="/app/teaching/courses">
                  {uiText("Xem tất cả (")}
                  {courseList.length}) →
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => setShowClassModal(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Icon name="plus" size={13} />
                  <span>{uiText("Mở lớp học mới")}</span>
                </button>
                <Link className="button button-subtle button-small" to="/app/teaching/classes">
                  {uiText("Xem tất cả (")}
                  {classList.length}) →
                </Link>
              </>
            )}
          </div>
        </div>

        {activeLeadTab === "courses" ? (
          <div>
            {courseList.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "36px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  marginTop: 16,
                }}
              >
                <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
                  {uiText(
                    "Bạn chưa tạo khóa học nào. Hãy khởi tạo khóa học đầu tiên để bắt đầu xây dựng bài giảng!",
                  )}
                </p>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => setShowCourseModal(true)}
                >
                  {uiText("+ Soạn khóa học mới")}
                </button>
              </div>
            ) : (
              <div className="workspace-cards" style={{ marginTop: 16 }}>
                {paginatedCourses.map((c, i) => {
                  const isPublished = c.state === "PUBLISHED" || c.state === "ACTIVE";
                  return (
                    <article
                      className="teaching-home-rich-card"
                      key={c.courseId}
                      style={{ animationDelay: `${i * 40}ms` }}
                    >
                      <div style={{ position: "relative" }}>
                        <CourseArtwork
                          imageUrl={c.coverDataUrl ?? undefined}
                          title={c.title}
                          categoryId={c.categoryId}
                          courseId={c.courseId}
                        />
                        <div
                          style={{
                            position: "absolute",
                            top: 10,
                            left: 10,
                            display: "flex",
                            gap: 6,
                            zIndex: 2,
                          }}
                        >
                          <span
                            className="badge"
                            style={{
                              background: "rgba(2, 132, 199, 0.92)",
                              color: "#ffffff",
                              backdropFilter: "blur(4px)",
                              fontWeight: 600,
                            }}
                          >
                            {uiText("Khóa ")}
                            {(coursePage - 1) * pageSize + i + 1}
                          </span>
                        </div>
                        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}>
                          <span
                            className="badge"
                            style={{
                              background: "rgba(15, 23, 42, 0.75)",
                              color: "#ffffff",
                              backdropFilter: "blur(4px)",
                            }}
                          >
                            {uiText(formatCoursePrice(c, uiLocale))}
                          </span>
                        </div>
                      </div>

                      <div className="teaching-home-rich-card-body">
                        <div className="teaching-home-rich-card-meta">
                          <StateChip
                            state={c.state === "HIDDEN" ? "HIDDEN" : isPublished ? "PUBLISHED" : "DRAFT"}
                          />
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>
                            {uiText("Mã: ")}
                            <code>{c.slug}</code>
                          </span>
                        </div>

                        <h3 className="teaching-home-rich-card-title">
                          <Link to={`/app/teaching/courses/${c.courseId}`}>{c.title}</Link>
                        </h3>

                        <p className="teaching-home-rich-card-desc">
                          {c.description || "Chương trình đào tạo chuyên sâu kết hợp lý thuyết và thực hành."}
                        </p>

                        <div className="teaching-home-rich-card-actions">
                          <Link
                            className="button button-small"
                            to={`/app/teaching/courses/${c.courseId}`}
                            style={{
                              justifyContent: "center",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontWeight: 600,
                            }}
                          >
                            <Icon name="assignment" size={14} />
                            <span>{uiText("Soạn bài giảng")}</span>
                          </Link>
                          <Link
                            className="button button-subtle button-small"
                            to={`/app/teaching/courses/${c.courseId}/roster`}
                            title={uiText("Danh sách học viên")}
                            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                          >
                            <Icon name="users" size={13} />
                            <span>{uiText("Học viên")}</span>
                          </Link>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {totalCoursePages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: "1px solid var(--line, #e2e8f0)",
                  fontSize: 13,
                  color: "var(--muted)",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  {uiText("Hiển thị")}{" "}
                  <strong>
                    {(coursePage - 1) * pageSize + 1} - {Math.min(coursePage * pageSize, courseList.length)}
                  </strong>{" "}
                  {uiText("trong tổng số ")}
                  <strong>{courseList.length}</strong> {uiText(" khóa học")}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    className="button button-subtle button-small"
                    onClick={() => setCoursePage((p) => Math.max(1, p - 1))}
                    disabled={coursePage === 1}
                  >
                    {uiText("‹ Trang trước")}
                  </button>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                    Trang {coursePage} / {totalCoursePages}
                  </span>
                  <button
                    type="button"
                    className="button button-subtle button-small"
                    onClick={() => setCoursePage((p) => Math.min(totalCoursePages, p + 1))}
                    disabled={coursePage === totalCoursePages}
                  >
                    Trang sau ›
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            {classList.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "36px 16px",
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  marginTop: 16,
                }}
              >
                <p style={{ margin: "0 0 12px", color: "var(--muted)", fontSize: 13 }}>
                  {uiText(
                    "Bạn chưa có lớp học phần nào. Hãy mở lớp học mới để xếp lịch giảng dạy và tiếp nhận học viên!",
                  )}
                </p>
                <button type="button" className="button button-small" onClick={() => setShowClassModal(true)}>
                  {uiText("+ Mở lớp học mới")}
                </button>
              </div>
            ) : (
              <div className="workspace-cards" style={{ marginTop: 16 }}>
                {paginatedClasses.map((cl, i) => (
                  <article
                    className="teaching-home-rich-card"
                    key={cl.classId}
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <div
                      style={{
                        padding: "16px 16px 12px",
                        background:
                          "linear-gradient(135deg, rgba(2, 132, 199, 0.07) 0%, rgba(124, 58, 237, 0.07) 100%)",
                        borderBottom: "1px solid var(--line)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="pro-icon-box green sm">
                            <Icon name="users" size={13} />
                          </span>
                          <span
                            className="badge"
                            style={{
                              background: "rgba(16, 185, 129, 0.12)",
                              color: "#059669",
                              fontWeight: 600,
                            }}
                          >
                            {uiText("Lớp ")}
                            {(classPage - 1) * pageSize + i + 1}
                          </span>
                        </div>
                        <span className="green-badge-pill">
                          {cl.scheduleState === "PUBLISHED"
                            ? uiText("● Đã xuất bản TKB")
                            : uiText("Bản nháp TKB")}
                        </span>
                      </div>
                      <h3 style={{ margin: "10px 0 0", fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
                        <Link
                          to={`/app/teaching/classes/${cl.classId}`}
                          style={{ color: "inherit", textDecoration: "none" }}
                        >
                          {cl.name}
                        </Link>
                      </h3>
                    </div>

                    <div className="teaching-home-rich-card-body">
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>
                        {uiText("Hình thức:")}{" "}
                        <strong>
                          {cl.classKind === "LIVE_COHORT"
                            ? uiText("Khóa trực tuyến (Cohort)")
                            : uiText("Lớp học phần trực tiếp")}
                        </strong>
                        {cl.maxMembers ? uiText(" • Tối đa: {0} SV", [cl.maxMembers]) : ""}
                      </div>

                      <div className="teaching-home-rich-card-actions">
                        <Link
                          className="button button-small"
                          to={`/app/teaching/attendance?class=${cl.classId}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                          }}
                        >
                          <Icon name="check" size={14} />
                          <span>{uiText("Điểm danh")}</span>
                        </Link>
                        <Link
                          className="button button-subtle button-small"
                          to={`/app/teaching/classes/${cl.classId}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          <span>{uiText("Chi tiết lớp")}</span>
                          <Icon name="chevronRight" size={13} />
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {totalClassPages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: "1px solid var(--line, #e2e8f0)",
                  fontSize: 13,
                  color: "var(--muted)",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  {uiText("Hiển thị")}{" "}
                  <strong>
                    {(classPage - 1) * pageSize + 1} - {Math.min(classPage * pageSize, classList.length)}
                  </strong>{" "}
                  {uiText("trong tổng số ")}
                  <strong>{classList.length}</strong> {uiText(" lớp học")}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    className="button button-subtle button-small"
                    onClick={() => setClassPage((p) => Math.max(1, p - 1))}
                    disabled={classPage === 1}
                  >
                    {uiText("‹ Trang trước")}
                  </button>
                  <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                    Trang {classPage} / {totalClassPages}
                  </span>
                  <button
                    type="button"
                    className="button button-subtle button-small"
                    onClick={() => setClassPage((p) => Math.min(totalClassPages, p + 1))}
                    disabled={classPage === totalClassPages}
                  >
                    Trang sau ›
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Quick Navigation to Teaching Modules */}
      <section className="dashboard-section-card animate-fade-in" style={{ marginTop: 24 }}>
        <div className="section-card-header">
          <div>
            <h2 style={{ margin: 0, fontSize: "1.15rem", display: "flex", alignItems: "center", gap: 8 }}>
              <span className="pro-icon-box blue sm">
                <Icon name="layers" size={14} />
              </span>
              <span>{uiText("Công Cụ Điều Hành & Quản Lý Học Vụ")}</span>
            </h2>
            <p className="subtext">
              {uiText(
                "Truy cập nhanh các phân hệ nghiệp vụ phục vụ công tác giảng dạy, chấm bài và đối soát học phần.",
              )}
            </p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
            marginTop: 14,
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="pro-icon-box green sm">
                <Icon name="trophy" size={14} />
              </span>
              <h3 style={{ margin: 0, fontSize: 15, color: "var(--ink)" }}>{uiText("Sổ Điểm & Chấm Bài")}</h3>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45, marginBottom: 14 }}>
              {uiText(
                "Theo dõi kết quả làm bài trắc nghiệm, bài tập thực hành, chấm điểm tự luận và phản hồi nhận xét trực tiếp cho sinh viên.",
              )}
            </p>
            <Link
              className="button button-small"
              to="/app/teaching/grades"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span>{uiText("Vào sổ điểm học viên")}</span>
              <Icon name="chevronRight" size={13} />
            </Link>
          </div>

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="pro-icon-box purple sm">
                <Icon name="quiz" size={14} />
              </span>
              <h3 style={{ margin: 0, fontSize: 15, color: "var(--ink)" }}>
                {uiText("Ngân Hàng Đề Thi & Quiz")}
              </h3>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45, marginBottom: 14 }}>
              {uiText(
                "Soạn thảo câu hỏi trắc nghiệm, cấu hình thời gian làm bài, giới hạn số lần nộp và xuất bản đề kiểm tra cho từng lớp học phần.",
              )}
            </p>
            <Link
              className="button button-small"
              to="/app/teaching/assessments"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span>{uiText("Quản lý đề kiểm tra")}</span>
              <Icon name="chevronRight" size={13} />
            </Link>
          </div>

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span className="pro-icon-box blue sm">
                <Icon name="chart" size={14} />
              </span>
              <h3 style={{ margin: 0, fontSize: 15, color: "var(--ink)" }}>
                {uiText("Báo Cáo Sư Phạm & Đối Soát")}
              </h3>
            </div>
            <p style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45, marginBottom: 14 }}>
              {uiText(
                "Phân tích tổng hợp tỷ lệ chuyên cần, phổ điểm học phần theo khoảng điểm và xuất dữ liệu báo cáo giảng dạy định dạng CSV.",
              )}
            </p>
            <Link
              className="button button-small"
              to="/app/teaching/reports"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span>{uiText("Xem báo cáo chi tiết")}</span>
              <Icon name="chevronRight" size={13} />
            </Link>
          </div>
        </div>
      </section>

      {/* Creation modals */}
      <CourseCreateModal
        isOpen={showCourseModal}
        onClose={() => setShowCourseModal(false)}
        onCreated={() => {
          courses.retry();
        }}
      />
      <ClassCreateModal
        isOpen={showClassModal}
        onClose={() => setShowClassModal(false)}
        onCreated={() => {
          classes.retry();
        }}
      />
    </div>
  );
}

export function TeachingCourses() {
  const uiText = useUiText();
  const nav = useNavigate();
  const categories = useCourseCategories();
  const [selectedCat, setSelectedCat] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PUBLISHED" | "DRAFT" | "HIDDEN">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const courses = useLecturer<Course[] | { items: Course[] }>("/me/owned-courses");
  const coursesList = Array.isArray(courses.data) ? courses.data : courses.data?.items || [];

  const filteredCourses = coursesList.filter((c) => {
    if (selectedCat !== "all" && c.categoryId !== selectedCat) return false;
    const isPublished = c.state === "PUBLISHED" || c.state === "ACTIVE";
    if (statusFilter === "PUBLISHED" && !isPublished) return false;
    if (statusFilter === "DRAFT" && c.state !== "DRAFT" && c.state !== "IN_REVIEW") return false;
    if (statusFilter === "HIDDEN" && c.state !== "HIDDEN") return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return c.title.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="teaching-courses-container">
      {/* Studio Header Banner */}
      <div className="curriculum-studio-header">
        <div className="curriculum-studio-info">
          <div className="curriculum-studio-badge">
            <span aria-hidden="true">
              <Icon name="book" size={15} />
            </span>
            <span>{uiText("STUDIO BIÊN SOẠN & ĐÀO TẠO")}</span>
          </div>
          <h1 className="curriculum-studio-title">{uiText("Danh Mục Khóa Học & Giáo Trình Giảng Dạy")}</h1>
          <p className="curriculum-studio-desc">
            {uiText(
              "Không gian chuyên sâu quản lý đề cương bài giảng, học liệu số và điều hành học viên theo từng chuyên ngành đào tạo.",
            )}
          </p>
        </div>
        <div className="curriculum-studio-actions">
          <button
            type="button"
            className="curriculum-create-btn"
            onClick={() => setShowCreateModal(true)}
            style={{
              textDecoration: "none",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span className="create-btn-icon" aria-hidden="true">
              <Icon name="plus" size={16} />
            </span>
            <span>{uiText("Soạn khóa học mới")}</span>
          </button>
        </div>
      </div>

      <div className="curriculum-stat-strip">
        <div className="curriculum-stat-item">
          <div className="curriculum-stat-content">
            <div className="curriculum-stat-value">
              {courses.pending || courses.error ? "—" : coursesList.length} {uiText(" khóa")}
            </div>
            <div className="curriculum-stat-label">{uiText("Khóa học phụ trách")}</div>
            <div className="curriculum-stat-sub">
              {coursesList.filter((c) => c.state === "PUBLISHED").length} {uiText(" đã xuất bản ·")}{" "}
              {coursesList.filter((c) => c.state === "DRAFT").length} {uiText(" bản nháp")}
            </div>
          </div>
        </div>
        <div className="curriculum-stat-item">
          <div className="curriculum-stat-content">
            <div className="curriculum-stat-label">{uiText("Học liệu và học viên")}</div>
            <div className="curriculum-stat-sub">{uiText("Xem dữ liệu thực tế trong từng khóa học.")}</div>
          </div>
        </div>
        <div className="curriculum-stat-item">
          <div className="curriculum-stat-content">
            <Link to="/app/teaching/revenue">{uiText("Xem báo cáo doanh thu")}</Link>
            <div className="curriculum-stat-sub">{uiText("Doanh thu từ các giao dịch thanh toán.")}</div>
          </div>
        </div>
      </div>

      {/* Integrated Search & Filters Toolbar */}
      <div className="curriculum-toolbar-card">
        <div className="curriculum-search-row">
          <div className="curriculum-search-input-wrap">
            <span style={{ color: "var(--muted, #64748b)", display: "inline-flex" }} aria-hidden="true">
              <Icon name="search" size={16} />
            </span>
            <input
              type="search"
              placeholder={uiText("Tìm kiếm theo tên khóa học hoặc mã slug...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={uiText("Tìm kiếm khóa học")}
            />
            {searchQuery && (
              <button
                type="button"
                className="curriculum-clear-btn"
                onClick={() => setSearchQuery("")}
                aria-label={uiText("Xóa tìm kiếm")}
              >
                ✕
              </button>
            )}
          </div>

          <div className="curriculum-status-filters" role="group" aria-label={uiText("Bộ lọc trạng thái")}>
            <button
              type="button"
              className={`curriculum-status-chip ${statusFilter === "ALL" ? "active" : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              {uiText("Tất cả (")}
              {coursesList.length})
            </button>
            <button
              type="button"
              className={`curriculum-status-chip ${statusFilter === "PUBLISHED" ? "active" : ""}`}
              onClick={() => setStatusFilter("PUBLISHED")}
            >
              {uiText("● Đã xuất bản")}
            </button>
            <button
              type="button"
              className={`curriculum-status-chip ${statusFilter === "DRAFT" ? "active" : ""}`}
              onClick={() => setStatusFilter("DRAFT")}
            >
              {uiText("○ Bản nháp")}
            </button>
            <button
              type="button"
              className={`curriculum-status-chip ${statusFilter === "HIDDEN" ? "active" : ""}`}
              onClick={() => setStatusFilter("HIDDEN")}
            >
              {uiText("Không công khai")}
            </button>
          </div>
        </div>

        {/* Category Pills */}
        <div className="curriculum-category-row" role="tablist" aria-label={uiText("Lọc theo danh mục")}>
          <button
            type="button"
            className={`curriculum-cat-pill ${selectedCat === "all" ? "active" : ""}`}
            onClick={() => setSelectedCat("all")}
          >
            {uiText("Tất cả chuyên ngành (")}
            {coursesList.length})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`curriculum-cat-pill ${selectedCat === cat.id ? "active" : ""}`}
              onClick={() => setSelectedCat(cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Course List Grid */}
      <State q={courses}>
        {() =>
          filteredCourses.length ? (
            <div className="workspace-cards">
              {filteredCourses.map((c) => {
                const isPublished = c.state === "PUBLISHED";
                return (
                  <article key={c.courseId} className="teaching-course-card">
                    <CourseArtwork
                      imageUrl={c.coverDataUrl ?? undefined}
                      title={c.title}
                      categoryId={c.categoryId}
                      courseId={c.courseId}
                    />
                    <div className="teaching-course-meta-row">
                      <StateChip
                        state={c.state === "HIDDEN" ? "HIDDEN" : isPublished ? "PUBLISHED" : "DRAFT"}
                      />
                      <span className="kpi-tag accent" style={{ fontSize: 11 }}>
                        {uiText("Xem đánh giá trong khóa học")}
                      </span>
                    </div>
                    <h3 className="teaching-course-title">{c.title}</h3>
                    <p className="teaching-course-desc">
                      {uiText("Mã khóa: ")}
                      <code>{c.slug}</code> {uiText(" • Học phần lý thuyết & thực hành nâng cao.")}
                    </p>

                    <div className="teaching-course-metrics">
                      <span className="teaching-course-metric-item">
                        <Icon name="book" size={13} style={{ color: "var(--blue)" }} />
                        <span>{uiText("Xem học liệu")}</span>
                      </span>
                      <span className="teaching-course-metric-item">
                        <Icon name="users" size={13} style={{ color: "var(--teal)" }} />
                        <span>{uiText("Xem học viên")}</span>
                      </span>
                      <span className="teaching-course-metric-item">
                        <Icon name="clock" size={13} style={{ color: "var(--amber)" }} />
                        <span>{uiText("Xem thời lượng")}</span>
                      </span>
                    </div>

                    <div className="teaching-course-actions">
                      <Link
                        className="button small"
                        to={`/app/teaching/courses/${c.courseId}`}
                        style={{
                          width: "100%",
                          textAlign: "center",
                          justifyContent: "center",
                          whiteSpace: "nowrap",
                          fontWeight: 600,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          textDecoration: "none",
                          color: "#ffffff",
                          backgroundColor: "var(--blue, #0284c7)",
                        }}
                      >
                        <Icon name="assignment" size={14} style={{ color: "#ffffff" }} />
                        <span style={{ color: "#ffffff" }}>{uiText("Soạn bài giảng")}</span>
                      </Link>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%" }}>
                        <Link
                          className="button button-subtle button-small"
                          to={`/app/teaching/courses/${c.courseId}/roster`}
                          title={uiText("Danh sách học viên")}
                          style={{
                            textAlign: "center",
                            justifyContent: "center",
                            whiteSpace: "nowrap",
                            fontSize: 12,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            textDecoration: "none",
                          }}
                        >
                          <Icon name="users" size={13} />
                          <span>{uiText("Học viên")}</span>
                        </Link>
                        <Link
                          className="button button-subtle button-small"
                          to={`/app/teaching/courses/${c.courseId}?tab=settings`}
                          title={uiText("Cài đặt khóa học")}
                          style={{
                            textAlign: "center",
                            justifyContent: "center",
                            whiteSpace: "nowrap",
                            fontSize: 12,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 5,
                            textDecoration: "none",
                          }}
                        >
                          <Icon name="settings" size={13} />
                          <span>{uiText("Cài đặt")}</span>
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="catalog-empty-hub">
              <span className="empty-hub-icon" aria-hidden="true" style={{ color: "var(--muted, #64748b)" }}>
                <Icon name="book" size={32} />
              </span>
              <h3>{uiText("Không tìm thấy khóa học nào phù hợp")}</h3>
              <p>
                {uiText(
                  "Thử điều chỉnh bộ lọc hoặc từ khóa tìm kiếm của bạn, hoặc tạo mới khóa học giáo trình ngay.",
                )}
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  type="button"
                  className="button button-subtle"
                  onClick={() => {
                    setSelectedCat("all");
                    setStatusFilter("ALL");
                    setSearchQuery("");
                  }}
                >
                  {uiText("Xóa bộ lọc")}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setShowCreateModal(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  {uiText("+ Soạn khóa học mới")}
                </button>
              </div>
            </div>
          )
        }
      </State>

      {/* AI Assistant & Publishing Guidance */}
      <div className="teaching-guidance-grid">
        <div className="teaching-guidance-card">
          <div className="teaching-guidance-header">
            <span className="teaching-guidance-icon ai" aria-hidden="true">
              <Icon name="sparkles" size={22} />
            </span>
            <div>
              <h3>{uiText("Trợ Lý Biên Soạn AI (AILSS Co-pilot)")}</h3>
              <span className="kpi-tag accent">Bloom Taxonomy v2</span>
            </div>
          </div>
          <p>
            {uiText(
              "Tăng tốc độ soạn giáo án bằng cách tự động sinh khung đề cương 6 cấp độ nhận thức Bloom, đề xuất bài tập trắc nghiệm và kịch bản thực hành đa phương tiện.",
            )}
          </p>
          <div style={{ marginTop: "auto", paddingTop: 10 }}>
            <Link
              className="button button-subtle button-small"
              to="/app/teaching/ai-studio"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span>{uiText("Mở AI Studio Trợ Giảng")}</span>
              <Icon name="chevronRight" size={14} />
            </Link>
          </div>
        </div>

        <div className="teaching-guidance-card">
          <div className="teaching-guidance-header">
            <span className="teaching-guidance-icon standards" aria-hidden="true">
              <Icon name="assignment" size={22} />
            </span>
            <div>
              <h3>{uiText("Tiêu Chuẩn Xuất Bản Khóa Học AILSS")}</h3>
              <span className="kpi-tag">{uiText("Quy chuẩn đào tạo")}</span>
            </div>
          </div>
          <p>
            {uiText(
              "Để đảm bảo trải nghiệm học tập tốt nhất, mỗi khóa học cần đáp ứng các tiêu chí sau trước khi công khai:",
            )}
          </p>
          <ul className="checklist-items">
            <li className="checklist-item">
              <span className="check-icon" aria-hidden="true">
                <Icon name="checkCircle" size={16} />
              </span>
              <span>{uiText("Đề cương chi tiết có tối thiểu 5 bài học và mục tiêu rõ ràng")}</span>
            </li>
            <li className="checklist-item">
              <span className="check-icon" aria-hidden="true">
                <Icon name="checkCircle" size={16} />
              </span>
              <span>{uiText("Video bài giảng chất lượng cao HD với phụ đề / tóm tắt")}</span>
            </li>
            <li className="checklist-item">
              <span className="check-icon" aria-hidden="true">
                <Icon name="checkCircle" size={16} />
              </span>
              <span>{uiText("Có ít nhất 1 bài kiểm tra trắc nghiệm hoặc bài tập Lab thực hành")}</span>
            </li>
            <li className="checklist-item">
              <span className="check-icon" aria-hidden="true">
                <Icon name="checkCircle" size={16} />
              </span>
              <span>{uiText("Bộ tài liệu đính kèm và mã nguồn mẫu được kiểm thử hoạt động")}</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Course Creation Modal */}
      <CourseCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={(newCourse) => {
          courses.retry();
          if (newCourse?.courseId) {
            nav(`/app/teaching/courses/${newCourse.courseId}`);
          }
        }}
      />
    </div>
  );
}
export function CourseCreate() {
  const uiText = useUiText();
  const nav = useNavigate(),
    [msg, setMsg] = useState(""),
    [coverPreview, setCoverPreview] = useState<string | null>(null);

  const handleCoverFile = (file: File) => {
    void readCourseCover(file)
      .then(setCoverPreview)
      .catch((error: Error) => setMsg(error.message));
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const v = values(new FormData(e.currentTarget));
      const r = await lecturerRequest<Course>("/courses", "POST", { ...v, coverDataUrl: coverPreview });

      nav(`/app/teaching/courses/${r.data.courseId}`);
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <p className="eyebrow">COURSE AUTHORING</p>
      <h1>{uiText("Tạo khóa học.")}</h1>
      <form className="form-panel form-grid" onSubmit={(e) => void submit(e)}>
        <Field label={uiText("Tên khóa học")} name="title" required />
        <label>
          {uiText("Mô tả")}
          <textarea name="description" maxLength={2000} />
        </label>
        <Field label={uiText("Đường dẫn khóa học")} name="slug" required />
        <label>
          {uiText("Chủ đề")}
          <input
            name="categoryName"
            required
            minLength={2}
            maxLength={80}
            placeholder={uiText("Ví dụ: Thiết kế đồ họa")}
          />
        </label>
        <CoursePricingFields />

        {/* Cover image upload */}
        <label style={{ gridColumn: "1 / -1" }}>
          {uiText("Hình ảnh bìa khóa học")}
          <LocalizedFileInput
            type="file"
            accept="image/png, image/jpeg, image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleCoverFile(f);
            }}
            style={{ marginTop: 6 }}
          />
          {coverPreview && (
            <div
              style={{
                marginTop: 10,
                maxWidth: 360,
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid var(--line)",
              }}
            >
              <img
                src={coverPreview}
                alt={uiText("Xem trước bìa")}
                style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }}
              />
            </div>
          )}
        </label>

        <button className="button">{uiText("Tạo bản nháp")}</button>
        <p role="status">{uiText(msg)}</p>
      </form>
    </>
  );
}
export function CourseDetail() {
  const uiText = useUiText();
  const categoryOptions = useCourseCategories();
  const [searchParams] = useSearchParams();
  const { courseId: id = "" } = useParams(),
    q = useLecturer<Course>(`/me/courses/${id}`),
    lessons = useLecturer<Lesson[] | { lessons: Lesson[] }>(`/courses/${id}/lessons`),
    offerings = useLecturer<Offering[] | { items: Offering[] }>(`/courses/${id}/offerings?limit=50`),
    reviews = useLecturer<{ items: unknown[]; ratingSummary?: { average: number; reviewCount: number } }>(
      `/courses/${id}/reviews?limit=50`,
    ),
    classes = useLecturer<
      | { classes?: { classId: string; name: string; linkedCourseId?: string }[] }
      | { classId: string; name: string; linkedCourseId?: string }[]
    >("/me/owned-classes"),
    [activeTab, setActiveTab] = useState<
      "curriculum" | "offerings" | "classes" | "releases" | "edit" | "settings"
    >(searchParams.get("tab") === "settings" ? "settings" : "curriculum"),
    [msg, setMsg] = useState(""),
    [retireMode, setRetireMode] = useState<"LOCK" | "DELETE" | null>(null),
    [retireConfirmation, setRetireConfirmation] = useState(""),
    [retiring, setRetiring] = useState(false),
    [dirty, setDirty] = useState(false),
    [releasesList] = useState<
      {
        version: number;
        semver: string;
        status: string;
        releaseNotes: string;
        publishedAt: string;
        lessonsCount: number;
      }[]
    >([]),
    [selectedDiffReleases, setSelectedDiffReleases] = useState<{ v1: string; v2: string } | null>(null),
    [publishError, setPublishError] = useState(""),
    [newReleaseForm, setNewReleaseForm] = useState({
      semver: "",
      status: "RELEASE_CANDIDATE" as "DRAFT" | "RELEASE_CANDIDATE" | "LIVE",
      releaseNotes: "",
      expectedVersion: 0,
    });
  useUnsavedChanges(dirty, "Bạn có thay đổi khóa học chưa lưu. Rời trang và bỏ các thay đổi này?");

  const handlePublishRelease = (e: FormEvent) => {
    e.preventDefault();
    setPublishError(
      "Lịch sử phiên bản chưa được hỗ trợ. Dùng thao tác xuất bản khóa học để lưu trạng thái trên hệ thống.",
    );
  };

  const lessonList: Lesson[] = Array.isArray(lessons.data)
    ? lessons.data
    : (lessons.data as { lessons?: Lesson[] })?.lessons || [];
  const offeringList: Offering[] = Array.isArray(offerings.data)
    ? offerings.data
    : (offerings.data as { items?: Offering[] })?.items || [];
  const classList = (
    Array.isArray(classes.data)
      ? classes.data
      : (classes.data as { classes?: { classId: string; name: string; linkedCourseId?: string }[] })
          ?.classes || []
  ).filter((x) => x.linkedCourseId === id);

  const reviewSummary = reviews.data?.ratingSummary;
  const ratingAvg =
    reviewSummary?.reviewCount && reviewSummary.average !== undefined
      ? reviewSummary.average.toFixed(1)
      : "Chưa có đánh giá";
  const reviewCount =
    reviewSummary?.reviewCount ?? (Array.isArray(reviews.data?.items) ? reviews.data.items.length : 0);

  async function command(path: string, body?: unknown) {
    try {
      await lecturerRequest(path, body ? "PATCH" : "POST", body);
      setMsg("✓ Đã lưu thay đổi thành công.");
      if (body) setDirty(false);
      q.retry();
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }

  async function retireCourse() {
    if (!retireMode || retireConfirmation !== q.data?.title) return;
    setRetiring(true);
    try {
      const result = await lecturerRequest<Course>(`/courses/${id}/retire`, "POST", { mode: retireMode });
      setMsg(
        result.data.state === "DELETED"
          ? "✓ Đã xóa bản nháp khóa học."
          : "✓ Khóa học đã ẩn khỏi công khai; học viên hiện tại tiếp tục học bình thường.",
      );
      setRetireMode(null);
      setRetireConfirmation("");
      q.retry();
    } catch (error) {
      setMsg(lecturerError(error));
    } finally {
      setRetiring(false);
    }
  }

  return (
    <div className="course-studio-container">
      <State q={q}>
        {(c) => (
          <>
            <Breadcrumbs
              items={[
                { label: uiText("Giảng dạy"), to: "/app/teaching" },
                { label: uiText("Khóa học") },
                { label: c.title },
              ]}
            />

            {/* Studio Hero Card */}
            <div className="dashboard-heading" style={{ marginTop: "0.5rem", marginBottom: "1.25rem" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <StateChip state={c.state} />
                  <span className="kpi-tag">
                    {c.priceType === "FREE" ? uiText("Miễn phí") : `${c.price} ${c.currency}`}
                  </span>
                  <span className="badge">{c.slug}</span>
                </div>
                <h1 style={{ margin: "0.25rem 0" }}>{c.title}</h1>
                <p className="lead" style={{ margin: 0 }}>
                  {uiText(
                    "Quản trị chương trình đào tạo, biên soạn bài giảng đa phương tiện và phát hành gói tuyển sinh.",
                  )}
                </p>
              </div>
              <div
                className="dashboard-header-actions"
                style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
              >
                <Link className="button" to={`/app/teaching/discussion/COURSE/${id}`}>
                  {uiText("⭐ Đánh giá & Thảo luận (")}
                  {reviewCount})
                </Link>
                <Link className="button button-subtle" to={`/app/teaching/courses/${id}/roster`}>
                  {uiText("👥 Học viên")}
                </Link>
                {c.state === "DRAFT" && (
                  <button
                    className="button button-subtle"
                    onClick={() => void command(`/courses/${id}/submit-review`)}
                  >
                    <Icon name="zap" size={15} /> {uiText(" Nộp duyệt")}
                  </button>
                )}
              </div>
            </div>

            {/* KPI Overview Grid */}
            <div className="workspace-kpi-grid" style={{ marginBottom: "1.5rem" }}>
              <div
                className="kpi-card"
                onClick={() => setActiveTab("curriculum")}
                style={{ cursor: "pointer" }}
              >
                <div className="kpi-header">
                  <span className="kpi-icon" aria-hidden="true">
                    <Icon name="book" size={20} />
                  </span>
                  <span className="kpi-tag accent">{uiText("Giáo trình")}</span>
                </div>
                <div className="kpi-value">
                  {lessons.pending ? "…" : uiText("{0} bài", [lessonList.length])}
                </div>
                <div className="kpi-label">{uiText("Bài học & video")}</div>
              </div>
              <div
                className="kpi-card"
                onClick={() => setActiveTab("offerings")}
                style={{ cursor: "pointer" }}
              >
                <div className="kpi-header">
                  <span className="kpi-icon" aria-hidden="true">
                    <Icon name="target" size={20} />
                  </span>
                  <span className="kpi-tag">{uiText("Tuyển sinh")}</span>
                </div>
                <div className="kpi-value">
                  {offerings.pending ? "…" : uiText("{0} đợt", [offeringList.length])}
                </div>
                <div className="kpi-label">{uiText("Đợt mở đăng ký")}</div>
              </div>
              <div className="kpi-card" onClick={() => setActiveTab("classes")} style={{ cursor: "pointer" }}>
                <div className="kpi-header">
                  <span className="kpi-icon" aria-hidden="true">
                    <Icon name="users" size={20} />
                  </span>
                  <span className="kpi-tag accent">{uiText("Lớp học")}</span>
                </div>
                <div className="kpi-value">
                  {classes.pending ? "…" : uiText("{0} lớp", [classList.length])}
                </div>
                <div className="kpi-label">{uiText("Lớp học trực tiếp")}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-icon" aria-hidden="true">
                    <Icon name="starFilled" size={20} />
                  </span>
                  <span className="kpi-tag accent">{ratingAvg} ★</span>
                </div>
                <div className="kpi-value">
                  {reviewCount} {uiText(" lượt")}
                </div>
                <div className="kpi-label">{uiText("Đánh giá từ học viên")}</div>
              </div>
            </div>

            {/* Segmented Tab Navigation */}
            <div className="module-segmented-bar" role="tablist" style={{ marginBottom: "1.5rem" }}>
              <button
                className={`segmented-tab ${activeTab === "curriculum" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "curriculum"}
                onClick={() => setActiveTab("curriculum")}
              >
                <Icon name="book" size={15} /> {uiText(" Giáo trình & Bài học (")}
                {lessonList.length})
              </button>
              <button
                className={`segmented-tab ${activeTab === "offerings" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "offerings"}
                onClick={() => setActiveTab("offerings")}
              >
                <Icon name="target" size={15} /> {uiText(" Đợt tuyển sinh (")}
                {offeringList.length})
              </button>
              <button
                className={`segmented-tab ${activeTab === "classes" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "classes"}
                onClick={() => setActiveTab("classes")}
              >
                <Icon name="users" size={15} /> {uiText(" Lớp học liên kết (")}
                {classList.length})
              </button>
              <button
                className={`segmented-tab ${activeTab === "releases" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "releases"}
                onClick={() => setActiveTab("releases")}
              >
                <Icon name="tag" size={15} /> {uiText(" Bản phát hành (")}
                {releasesList.length})
              </button>
              <button
                className={`segmented-tab ${activeTab === "edit" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "edit"}
                onClick={() => setActiveTab("edit")}
              >
                <Icon name="settings" size={15} /> {uiText(" Chỉnh sửa khóa học")}
              </button>
              <button
                className={`segmented-tab ${activeTab === "settings" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "settings"}
                onClick={() => setActiveTab("settings")}
              >
                <Icon name="settings" size={15} /> {uiText(" Cài đặt")}
              </button>
            </div>

            {/* TAB 1: CURRICULUM & LESSONS */}
            {activeTab === "curriculum" && (
              <section className="dashboard-section-card">
                <div className="section-card-header">
                  <div>
                    <h2>{uiText("Danh Sách Bài Giảng Trong Khóa Học")}</h2>
                    <p className="subtext">
                      {uiText("Quản lý cấu trúc bài giảng, video học liệu và cho phép xem thử (preview).")}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Link className="button" to={`/app/teaching/courses/${id}/lessons`}>
                      <Icon name="plus" size={15} /> {uiText(" Soạn bài học mới")}
                    </Link>
                    <Link className="button button-subtle" to={`/app/teaching/assessments?course=${id}`}>
                      <Icon name="quiz" size={15} /> {uiText(" Bài kiểm tra AI")}
                    </Link>
                  </div>
                </div>

                <State q={lessons}>
                  {() =>
                    lessonList.length ? (
                      <div className="workspace-cards" style={{ marginTop: "1rem" }}>
                        {lessonList.map((x, idx) => (
                          <article
                            key={x.lessonId}
                            className="home-activity-card"
                            style={{ padding: "1.25rem" }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: "0.5rem",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <span className="kpi-tag accent">
                                  {uiText("Bài ")}
                                  {String(idx + 1).padStart(2, "0")}
                                </span>
                                <span className="badge">{x.state}</span>
                                {x.preview && (
                                  <span className="green-badge-pill">
                                    <Icon name="eye" size={13} /> {uiText(" Xem trước")}
                                  </span>
                                )}
                              </div>
                              <small style={{ color: "var(--muted, #64748b)" }}>
                                {uiText("Chương: ")}
                                {x.sectionTitle}
                              </small>
                            </div>
                            <h3 style={{ margin: "0.25rem 0 0.5rem 0", fontSize: "1.1rem" }}>{x.title}</h3>
                            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                              <Link
                                className="button button-subtle button-small"
                                to={`/app/teaching/lessons/${x.lessonId}`}
                              >
                                {uiText("Sửa bài học →")}
                              </Link>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title={uiText("Chưa có bài giảng nào")}
                        action={
                          <Link className="button" to={`/app/teaching/courses/${id}/lessons`}>
                            <Icon name="plus" size={15} /> {uiText(" Thêm bài học đầu tiên")}
                          </Link>
                        }
                      >
                        {uiText(
                          "Khóa học cần ít nhất một bài học để sẵn sàng mở tuyển sinh và nộp kiểm duyệt.",
                        )}
                      </EmptyState>
                    )
                  }
                </State>
              </section>
            )}

            {/* TAB 2: OFFERINGS */}
            {activeTab === "offerings" && (
              <section className="dashboard-section-card">
                <div className="section-card-header">
                  <div>
                    <h2>{uiText("Các Đợt Mở Bán & Tuyển Sinh")}</h2>
                    <p className="subtext">
                      {uiText("Cấu hình giá bán, hình thức đào tạo và thời gian tuyển sinh.")}
                    </p>
                  </div>
                  <Link className="button" to="/app/teaching/offerings">
                    <Icon name="plus" size={15} /> {uiText(" Tạo đợt mở đăng ký")}
                  </Link>
                </div>
                <State q={offerings}>
                  {() =>
                    offeringList.length ? (
                      <div className="workspace-cards" style={{ marginTop: "1rem" }}>
                        {offeringList.map((o) => (
                          <article
                            key={o.offeringId}
                            className="home-activity-card"
                            style={{ padding: "1.25rem" }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: "0.5rem",
                              }}
                            >
                              <StateChip state={o.state} />
                              <span className="amount-highlight">
                                {o.price ? `${o.price} ${o.currency}` : uiText("Miễn phí")}
                              </span>
                            </div>
                            <h3 style={{ margin: "0.25rem 0" }}>{o.title}</h3>
                            <p style={{ color: "var(--muted, #64748b)", fontSize: "0.875rem" }}>
                              {uiText("Hình thức: ")}
                              {uiText(stateLabel(o.offeringType))}
                            </p>
                            <div style={{ marginTop: "0.75rem" }}>
                              <Link
                                className="card-action-btn"
                                to={`/app/teaching/offerings/${o.offeringId}`}
                              >
                                {uiText("Quản lý đợt tuyển sinh →")}
                              </Link>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title={uiText("Chưa có đợt mở đăng ký")}
                        action={
                          <Link className="button" to="/app/teaching/offerings">
                            <Icon name="plus" size={15} /> {uiText(" Tạo đợt mở đăng ký")}
                          </Link>
                        }
                      >
                        {uiText(
                          "Khóa học chưa tự động mở quyền đăng ký. Hãy tạo đợt mở bán khi nội dung đủ điều kiện.",
                        )}
                      </EmptyState>
                    )
                  }
                </State>
              </section>
            )}

            {/* TAB 3: CLASSES */}
            {activeTab === "classes" && (
              <section className="dashboard-section-card">
                <div className="section-card-header">
                  <div>
                    <h2>{uiText("Lớp Học Trực Tuyến Liên Kết")}</h2>
                    <p className="subtext">{uiText("Các lớp học đang áp dụng giáo trình khóa học này.")}</p>
                  </div>
                  <Link className="button" to="/app/teaching/classes">
                    <Icon name="plus" size={15} /> {uiText(" Tạo lớp mới")}
                  </Link>
                </div>
                <State q={classes}>
                  {() =>
                    classList.length ? (
                      <div className="workspace-cards" style={{ marginTop: "1rem" }}>
                        {classList.map((x) => (
                          <article
                            key={x.classId}
                            className="home-activity-card"
                            style={{ padding: "1.25rem" }}
                          >
                            <h3 style={{ margin: "0 0 0.5rem 0" }}>{x.name}</h3>
                            <Link
                              className="button button-subtle button-small"
                              to={`/app/teaching/classes/${x.classId}`}
                            >
                              {uiText("Vào không gian lớp →")}
                            </Link>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title={uiText("Chưa có lớp liên kết")}
                        action={
                          <Link className="button" to="/app/teaching/classes">
                            <Icon name="plus" size={15} /> {uiText(" Tạo lớp")}
                          </Link>
                        }
                      >
                        {uiText("Chỉ hiển thị lớp có liên kết tới khóa học này do Classroom quản lý.")}
                      </EmptyState>
                    )
                  }
                </State>
              </section>
            )}

            {/* TAB: RELEASES & VERSIONING */}
            {activeTab === "releases" && (
              <section className="dashboard-section-card">
                <div className="section-card-header">
                  <div>
                    <h2>{uiText("Quản Lý Phiên Bản Khóa Học & Bản Phát Hành (Course Versioning)")}</h2>
                    <p className="subtext">
                      {uiText(
                        "Quản lý vòng đời phát hành (Draft → RC → Live), ngăn xung đột đồng thời bằng CAS Guard và so sánh khác biệt nội dung (Diff).",
                      )}
                    </p>
                  </div>
                </div>

                {publishError && (
                  <div
                    className="dashboard-banner-notice"
                    role="alert"
                    style={{
                      backgroundColor: "#FEF2F2",
                      borderColor: "#FCA5A5",
                      color: "#991B1B",
                      marginBottom: "1rem",
                    }}
                  >
                    <strong>{uiText("Lỗi xung đột đồng thời:")}</strong> {uiText(publishError)}
                  </div>
                )}

                {/* Release List Table */}
                <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
                  <table className="admin-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>{uiText("Phiên bản")}</th>
                        <th>{uiText("Trạng thái")}</th>
                        <th>{uiText("Số bài giảng")}</th>
                        <th>{uiText("Thời gian phát hành")}</th>
                        <th>{uiText("Ghi chú phát hành")}</th>
                        <th>{uiText("Thao tác")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {releasesList.map((rel) => (
                        <tr key={rel.version}>
                          <td>
                            <strong>{rel.semver}</strong> (v{rel.version})
                          </td>
                          <td>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: 11,
                                fontWeight: 700,
                                backgroundColor:
                                  rel.status === "LIVE"
                                    ? "#DCFCE7"
                                    : rel.status === "RELEASE_CANDIDATE"
                                      ? "#FEF3C7"
                                      : "#F1F5F9",
                                color:
                                  rel.status === "LIVE"
                                    ? "#15803D"
                                    : rel.status === "RELEASE_CANDIDATE"
                                      ? "#B45309"
                                      : "#475569",
                              }}
                            >
                              {rel.status}
                            </span>
                          </td>
                          <td>
                            {rel.lessonsCount} {uiText(" bài")}
                          </td>
                          <td>{rel.publishedAt}</td>
                          <td style={{ maxWidth: 260, fontSize: 12.5, color: "var(--muted, #64748b)" }}>
                            {rel.releaseNotes}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="button button-subtle button-small"
                              onClick={() =>
                                setSelectedDiffReleases({
                                  v1: rel.semver,
                                  v2: releasesList[0]?.semver || rel.semver,
                                })
                              }
                            >
                              {uiText("So sánh (Diff)")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Publish New Release Form with CAS guard */}
                <div
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    backgroundColor: "var(--surface-subtle, #F8FAFC)",
                    border: "1px solid var(--border, #E2E8F0)",
                  }}
                >
                  <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 10px 0" }}>
                    {uiText("Phát Hành Bản Mới (Optimistic Concurrency CAS Guard)")}
                  </h3>
                  <form
                    onSubmit={handlePublishRelease}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
                        {uiText("Phiên bản Semver")}
                      </label>
                      <input
                        type="text"
                        value={newReleaseForm.semver}
                        onChange={(e) => setNewReleaseForm({ ...newReleaseForm, semver: e.target.value })}
                        placeholder="v2.1.0"
                        required
                        style={{
                          width: "100%",
                          padding: 6,
                          borderRadius: 4,
                          border: "1px solid var(--border, #CBD5E1)",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
                        {uiText("Trạng thái phát hành")}
                      </label>
                      <select
                        value={newReleaseForm.status}
                        onChange={(e) =>
                          setNewReleaseForm({
                            ...newReleaseForm,
                            status: e.target.value as "DRAFT" | "RELEASE_CANDIDATE" | "LIVE",
                          })
                        }
                        style={{
                          width: "100%",
                          padding: 6,
                          borderRadius: 4,
                          border: "1px solid var(--border, #CBD5E1)",
                        }}
                      >
                        <option value="RELEASE_CANDIDATE">RELEASE_CANDIDATE</option>
                        <option value="LIVE">{uiText("LIVE (Phát hành chính thức)")}</option>
                        <option value="DRAFT">{uiText("DRAFT")}</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
                        Expected CAS Version
                      </label>
                      <input
                        type="number"
                        value={newReleaseForm.expectedVersion}
                        onChange={(e) =>
                          setNewReleaseForm({
                            ...newReleaseForm,
                            expectedVersion: parseInt(e.target.value, 10) || 0,
                          })
                        }
                        required
                        style={{
                          width: "100%",
                          padding: 6,
                          borderRadius: 4,
                          border: "1px solid var(--border, #CBD5E1)",
                        }}
                      />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
                        {uiText("Ghi chú phát hành (Release Notes)")}
                      </label>
                      <textarea
                        rows={2}
                        value={newReleaseForm.releaseNotes}
                        onChange={(e) =>
                          setNewReleaseForm({ ...newReleaseForm, releaseNotes: e.target.value })
                        }
                        placeholder={uiText("Ghi chú tóm tắt bài giảng mới hoặc cập nhật giáo trình...")}
                        style={{
                          width: "100%",
                          padding: 6,
                          borderRadius: 4,
                          border: "1px solid var(--border, #CBD5E1)",
                        }}
                      />
                    </div>
                    <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
                      <button type="submit" className="button">
                        <Icon name="check" size={15} /> {uiText(" Xác nhận phát hành (CAS Guard)")}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Diff Comparison Modal */}
                {selectedDiffReleases && (
                  <div
                    className="admin-modal-backdrop"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="release-diff-modal-title"
                  >
                    <div className="admin-modal-card" style={{ maxWidth: 540 }}>
                      <div className="section-card-header">
                        <div>
                          <span className="kpi-tag accent">Release Diff</span>
                          <h2 id="release-diff-modal-title" style={{ fontSize: "1.2rem", marginTop: 4 }}>
                            {uiText("So Sánh Giữa ")}
                            {selectedDiffReleases.v1} {uiText(" và ")}
                            {selectedDiffReleases.v2}
                          </h2>
                        </div>
                        <button
                          type="button"
                          className="button button-subtle"
                          onClick={() => setSelectedDiffReleases(null)}
                          aria-label={uiText("Đóng")}
                        >
                          ✕
                        </button>
                      </div>
                      <div style={{ padding: "14px 0", display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ fontSize: 13, color: "var(--muted, #475569)" }}>
                          {uiText("Phân tích khác biệt cây học liệu và mục tiêu kiểm tra:")}
                        </div>
                        <ul
                          style={{
                            fontSize: 12.5,
                            color: "var(--muted, #475569)",
                            paddingLeft: 18,
                            margin: 0,
                            lineHeight: 1.6,
                          }}
                        >
                          <li>
                            <strong>{uiText("[+ Thêm mới]")}</strong>{" "}
                            {uiText(" Bài học Sharding & Replication Cassandra.")}
                          </li>
                          <li>
                            <strong>{uiText("[~ Cập nhật]")}</strong>{" "}
                            {uiText(" Sửa đổi tiêu chuẩn kiểm tra trắc nghiệm Bloom 4-5.")}
                          </li>
                          <li>
                            <strong>{uiText("[Giữ nguyên]")}</strong> {lessonList.length}{" "}
                            {uiText(" bài giảng kế thừa.")}
                          </li>
                        </ul>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                          <button
                            type="button"
                            className="button"
                            onClick={() => setSelectedDiffReleases(null)}
                          >
                            {uiText("Đóng")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeTab === "settings" && (
              <section className="dashboard-section-card">
                <div className="section-card-header">
                  <div>
                    <h2>{uiText("Khóa hoặc xóa khóa học")}</h2>
                    <p className="subtext">
                      {uiText("Trạng thái hiện tại: ")}
                      {uiText(stateLabel(c.state))} · {c.activeStudentCount ?? 0}{" "}
                      {uiText(" học viên đang có quyền học")}
                    </p>
                  </div>
                </div>
                <p>
                  {uiText(
                    "Khóa học đã xuất bản sẽ được ẩn khỏi danh mục và ngừng nhận học viên mới. Học viên đã đăng ký vẫn xem bài học, làm bài và giữ tiến độ. Dữ liệu lớp học, đơn hàng và thanh toán được giữ lại.",
                  )}
                </p>
                {!["DELETED", "ARCHIVED"].includes(c.state ?? "") &&
                  (c.state !== "HIDDEN" || !c.publishedAt) && (
                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "1rem" }}>
                      {c.state !== "HIDDEN" && (
                        <button
                          className="button button-subtle"
                          type="button"
                          onClick={() => {
                            setRetireMode("LOCK");
                            setRetireConfirmation("");
                          }}
                        >
                          {uiText("Yêu cầu khóa học")}
                        </button>
                      )}
                      <button
                        className="button button-subtle"
                        type="button"
                        onClick={() => {
                          setRetireMode("DELETE");
                          setRetireConfirmation("");
                        }}
                      >
                        {uiText("Yêu cầu xóa khóa học")}
                      </button>
                    </div>
                  )}
                {retireMode && (
                  <div className="form-panel" style={{ marginTop: "1rem" }}>
                    <p>
                      {retireMode === "DELETE" && c.state !== "PUBLISHED"
                        ? uiText("Bản nháp sẽ được xóa mềm.")
                        : uiText("Khóa học sẽ được ẩn an toàn để bảo toàn quyền học của học viên cũ.")}{" "}
                      {uiText("Nhập chính xác tên khóa học để xác nhận:")}
                    </p>
                    <input
                      aria-label={uiText("Nhập tên khóa học để xác nhận")}
                      value={retireConfirmation}
                      onChange={(event) => setRetireConfirmation(event.target.value)}
                      placeholder={c.title}
                    />
                    <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                      <button
                        className="button"
                        type="button"
                        disabled={retiring || retireConfirmation !== c.title}
                        onClick={() => void retireCourse()}
                      >
                        {retiring ? uiText("Đang xử lý…") : uiText("Xác nhận yêu cầu")}
                      </button>
                      <button
                        className="button button-subtle"
                        type="button"
                        onClick={() => setRetireMode(null)}
                      >
                        {uiText("Hủy")}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* TAB 4: EDIT FORM */}
            {activeTab === "edit" && (
              <section className="dashboard-section-card">
                <div className="section-card-header">
                  <div>
                    <h2>{uiText("Chỉnh Sửa Thông Tin Khóa Học")}</h2>
                    <p className="subtext">
                      {uiText("Cập nhật tiêu đề, danh mục, hình thức đào tạo và học phí niêm yết.")}
                    </p>
                  </div>
                </div>

                <form
                  className="form-panel form-grid"
                  onChange={() => setDirty(true)}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = values(new FormData(e.currentTarget));
                    void command(`/courses/${id}`, v);
                  }}
                  style={{ background: "transparent", border: "none", padding: 0 }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: "1.25rem",
                    }}
                  >
                    <Field label={uiText("Tên khóa học")} name="title" defaultValue={c.title} required />
                    <label>
                      {uiText("Mô tả")}
                      <textarea name="description" defaultValue={c.description ?? ""} maxLength={2000} />
                    </label>
                    <Field
                      label={uiText("Đường dẫn khóa học (Slug)")}
                      name="slug"
                      defaultValue={c.slug}
                      required
                    />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: "1.25rem",
                      marginTop: "1rem",
                    }}
                  >
                    <label>
                      {uiText("Chủ đề đào tạo")}
                      <input
                        key={c.categoryId + categoryOptions.length}
                        name="categoryName"
                        defaultValue={categoryOptions.find((x) => x.id === c.categoryId)?.name ?? ""}
                        required
                        minLength={2}
                        maxLength={80}
                        placeholder={uiText("Nhập danh mục đào tạo")}
                      />
                    </label>
                  </div>
                  <CoursePricingFields
                    key={`${c.courseId}:${c.priceType}:${c.price}:${c.currency}`}
                    initialPriceType={c.priceType}
                    initialPrice={c.price}
                    initialCurrency={c.currency}
                  />

                  <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end" }}>
                    <button className="button" type="submit">
                      <Icon name="check" size={15} /> {uiText(" Lưu thay đổi khóa học")}
                    </button>
                  </div>
                </form>
              </section>
            )}
          </>
        )}
      </State>
      {msg && (
        <div className="dashboard-banner-notice" role="status" style={{ marginTop: "1rem" }}>
          <span>{uiText(msg)}</span>
        </div>
      )}
    </div>
  );
}
export function Lessons() {
  const uiText = useUiText();
  const { courseId = "" } = useParams(),
    q = useLecturer<Lesson[] | { lessons: Lesson[] }>(`/courses/${courseId}/lessons`),
    [msg, setMsg] = useState("");
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = values(new FormData(e.currentTarget));
    try {
      await lecturerRequest(`/courses/${courseId}/lessons`, "POST", {
        title: v.title,
        sectionTitle: v.sectionTitle,
        position: { sectionOrder: Number(v.sectionOrder), lessonOrder: Number(v.lessonOrder) },
        preview: v.preview === "on",
      });
      q.retry();
      e.currentTarget.reset();
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <p className="eyebrow">LESSON AUTHORING</p>
      <h1>{uiText("Bài học.")}</h1>
      <State q={q}>
        {(v) => (
          <div className="workspace-cards">
            {(Array.isArray(v) ? v : v.lessons || []).map((x) => (
              <article key={x.lessonId}>
                <span className="badge">{x.state}</span>
                <h2>{x.title}</h2>
                <p>{x.sectionTitle}</p>
                <Link to={`/app/teaching/lessons/${x.lessonId}`}>{uiText("Sửa bài học →")}</Link>
              </article>
            ))}
          </div>
        )}
      </State>
      <form className="form-panel form-grid" onSubmit={(e) => void create(e)}>
        <h2>{uiText("Thêm bài học")}</h2>
        <Field label={uiText("Tiêu đề")} name="title" required />
        <Field label={uiText("Chương")} name="sectionTitle" required />
        <Field label={uiText("Thứ tự chương")} name="sectionOrder" type="number" defaultValue={1} required />
        <Field label={uiText("Thứ tự bài")} name="lessonOrder" type="number" defaultValue={1} required />
        <label>
          <input name="preview" type="checkbox" /> {uiText(" Cho phép xem trước")}
        </label>
        <button className="button">{uiText("Tạo bài học")}</button>
        <p role="status">{uiText(msg)}</p>
      </form>
    </>
  );
}
export function LessonDetail() {
  const uiText = useUiText();
  const { lessonId = "" } = useParams(),
    q = useLecturer<Lesson>(`/lessons/${lessonId}`),
    [msg, setMsg] = useState("");
  return (
    <div className="lesson-studio-container">
      <State q={q}>
        {(x) => (
          <>
            <div className="lesson-hero-header">
              <div className="lesson-hero-nav">
                <Link className="lesson-breadcrumb" to={`/app/teaching/courses/${x.courseId}`}>
                  <Icon name="chevronLeft" size={14} /> {uiText(" Quay lại danh mục bài học khóa học")}
                </Link>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`badge ${x.state === "PUBLISHED" ? "success" : "warning"}`}>
                    {x.state === "PUBLISHED" ? uiText("ĐÃ XUẤT BẢN") : uiText("BẢN SOẠN THẢO")}
                  </span>
                  {x.preview ? (
                    <span className="green-badge-pill">
                      <Icon name="eye" size={13} /> {uiText(" Học viên được xem trước")}
                    </span>
                  ) : (
                    <span className="kpi-tag">{uiText("Nội dung có khóa")}</span>
                  )}
                </div>
              </div>

              <div className="lesson-hero-title-area">
                <p className="eyebrow" style={{ color: "#0284c7", fontWeight: 700, margin: 0 }}>
                  {uiText("AILSS LESSON STUDIO • SOẠN THẢO BÀI GIẢNG")}
                </p>
                <div className="lesson-hero-title-row">
                  <h1 className="lesson-hero-title">{x.title}</h1>
                </div>
                <div className="lesson-meta-chips">
                  <span className="lesson-meta-chip">
                    {uiText("📁 Chương: ")}
                    <strong>{x.sectionTitle || "Chưa phân chương"}</strong>
                  </span>
                  <span className="lesson-meta-chip">
                    {uiText("🔢 Vị trí: Chương #")}
                    {x.position?.sectionOrder || 1} {uiText(" • Bài #")}
                    {x.position?.lessonOrder || 1}
                  </span>
                  <span className="lesson-meta-chip">
                    🆔 ID: <code>{lessonId}</code>
                  </span>
                </div>
              </div>
            </div>

            <div className="lesson-studio-grid">
              {/* Left Column: Video Media Upload & Cloud Processing */}
              <div>
                <MediaUpload
                  key={lessonId}
                  courseId={x.courseId}
                  lessonId={lessonId}
                  preview={x.preview}
                  mediaAssetId={x.mediaAssetId}
                />
              </div>

              {/* Right Column: Lesson Metadata & Configuration */}
              <div className="lesson-card">
                <div className="lesson-card-header">
                  <div className="lesson-card-header-main">
                    <div
                      className="lesson-icon-circle"
                      style={{ background: "rgba(124, 58, 237, 0.1)", color: "#7c3aed" }}
                    >
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 20h9"></path>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                      </svg>
                    </div>
                    <div>
                      <h2 className="lesson-card-title">{uiText("Cấu hình bài học")}</h2>
                      <p className="lesson-card-subtitle">
                        {uiText("Tên bài giảng, định danh phân chương và thứ tự hiển thị.")}
                      </p>
                    </div>
                  </div>
                </div>

                <form
                  className="form-panel form-grid"
                  style={{ background: "transparent", border: "none", padding: 0, margin: 0 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const v = values(new FormData(e.currentTarget));
                    try {
                      await lecturerRequest(`/lessons/${lessonId}`, "PATCH", {
                        title: v.title,
                        sectionTitle: v.sectionTitle,
                        position: {
                          sectionOrder: Number(v.sectionOrder),
                          lessonOrder: Number(v.lessonOrder),
                        },
                        preview: v.preview === "on",
                      });
                      setMsg("Đã lưu bài học.");
                      q.retry();
                    } catch (y) {
                      setMsg(lecturerError(y));
                    }
                  }}
                >
                  <Field label={uiText("Tiêu đề")} name="title" defaultValue={x.title} required />
                  <Field
                    label={uiText("Chương")}
                    name="sectionTitle"
                    defaultValue={x.sectionTitle}
                    required
                  />

                  <div className="lesson-form-row">
                    <Field
                      label={uiText("Thứ tự chương")}
                      name="sectionOrder"
                      type="number"
                      defaultValue={x.position?.sectionOrder || 1}
                      required
                    />
                    <Field
                      label={uiText("Thứ tự bài")}
                      name="lessonOrder"
                      type="number"
                      defaultValue={x.position?.lessonOrder || 1}
                      required
                    />
                  </div>

                  <label className="preview-toggle-card">
                    <input name="preview" type="checkbox" defaultChecked={x.preview} />
                    <div className="preview-toggle-text">
                      <span className="preview-toggle-label">{uiText("Xem trước (Học thử miễn phí)")}</span>
                      <span className="preview-toggle-sub">
                        {uiText("Cho phép học viên chưa mua khóa học có thể xem trước nội dung bài học này")}
                      </span>
                    </div>
                  </label>

                  <div className="lesson-save-bar">
                    <span style={{ fontSize: 13, color: "var(--muted, #64748b)" }}>
                      {uiText("Cập nhật sẽ áp dụng ngay vào cây học liệu khóa học.")}
                    </span>
                    <button
                      className="button"
                      style={{
                        minWidth: 140,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      {uiText("Lưu bài học")}
                    </button>
                  </div>
                </form>

                {msg ? (
                  <div className="dashboard-banner-notice" role="status" style={{ margin: 0 }}>
                    <span>{uiText(msg)}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </State>
    </div>
  );
}
interface CourseRosterMember {
  studentId: string;
  studentName?: string;
  email?: string;
  enrollmentId?: string;
  enrolledAt: string;
  progressPercent?: number;
  state: string;
}

export function CourseRoster() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { courseId = "" } = useParams();
  const q = useLecturer<CourseRosterMember[] | { items: CourseRosterMember[] }>(
    `/courses/${courseId}/roster`,
  );
  const [search, setSearch] = useState("");
  const rows = (Array.isArray(q.data) ? q.data : q.data?.items) ?? [];
  const filtered = rows.filter((r) =>
    [r.studentId, r.studentName, r.email].some((v) =>
      v?.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi")),
    ),
  );
  function exportCsv() {
    const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const content = [
      ["Mã học viên", "Họ tên", "Email", "Ngày ghi danh", "Tiến độ (%)", "Trạng thái"].map((source) =>
        uiText(source),
      ),
      ...filtered.map((row) => [
        row.studentId,
        row.studentName,
        row.email,
        row.enrolledAt,
        row.progressPercent,
        row.state,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `roster-${courseId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: uiText("Khóa học"), to: "/app/teaching/courses" },
          { label: uiText("Học viên khóa học") },
        ]}
      />
      <h1>{uiText("Học viên khóa học")}</h1>
      <p>
        {uiText("Danh sách ghi danh từ hệ thống. Hồ sơ hoặc tiến độ chưa được cung cấp sẽ hiển thị dấu —.")}
      </p>
      <label>
        {uiText("Tìm học viên")}
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <button className="button" disabled={q.pending || !!q.error || !filtered.length} onClick={exportCsv}>
        {uiText("Xuất danh sách CSV")}
      </button>
      <State q={q}>
        {() =>
          rows.length ? (
            <div className="attendance-scroll">
              <p>
                {rows.length} {uiText(" học viên ghi danh")}
              </p>
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>{uiText("Học viên")}</th>
                    <th>Email</th>
                    <th>{uiText("Ngày ghi danh")}</th>
                    <th>{uiText("Tiến độ")}</th>
                    <th>{uiText("Trạng thái")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.studentId}>
                      <td>{row.studentName || row.studentId}</td>
                      <td>{row.email || "—"}</td>
                      <td>{row.enrolledAt ? new Date(row.enrolledAt).toLocaleDateString(uiLocale) : "—"}</td>
                      <td>{row.progressPercent === undefined ? "—" : `${row.progressPercent}%`}</td>
                      <td>{row.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && <p>{uiText("Không có học viên phù hợp.")}</p>}
            </div>
          ) : (
            <p>{uiText("Chưa có học viên ghi danh khóa học này.")}</p>
          )
        }
      </State>
      <Link className="button secondary" to="/app/teaching/grades">
        {uiText("Bảng điểm học viên")}
      </Link>
    </>
  );
}
export function Offerings() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const q = useLecturer<Offering[] | { items: Offering[] }>("/me/owned-offerings");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  const offeringsList = Array.isArray(q.data) ? q.data : q.data?.items || [];
  const filtered = offeringsList.filter((x) => {
    if (typeFilter !== "ALL" && x.offeringType !== typeFilter) return false;
    if (search.trim()) {
      return x.title.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  return (
    <div className="teaching-offerings-container">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">{uiText("GIẢNG VIÊN · TUYỂN SINH & DOANH THU")}</p>
          <h1>{uiText("Đợt Mở Bán Của Bạn (Offerings)")}</h1>
          <p className="lead">
            {uiText(
              "Quản lý đợt mở bán, phân quyền truy cập học tập và cấu hình mức học phí theo từng khóa học.",
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link className="button" to="/app/teaching/offerings/new" style={{ textDecoration: "none" }}>
            <Icon name="plus" size={16} />
            <span>{uiText("Tạo đợt mở bán mới")}</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="workspace-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="target" size={20} />
            </span>
            <span className="kpi-tag accent">{uiText("Đang quản lý")}</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={offeringsList.length} suffix={uiText(" Đợt")} />
          </div>
          <div className="kpi-label">{uiText("Tổng số đợt mở bán")}</div>
          <p className="kpi-subtext">{uiText("Học kỳ 1 - 2026")}</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="card" size={20} />
            </span>
            <span className="kpi-tag accent">{uiText("Doanh thu")}</span>
          </div>
          <div className="kpi-value">—</div>
          <div className="kpi-label">{uiText("Dòng tiền đối soát")}</div>
          <p className="kpi-subtext">{uiText("Chờ projection thanh toán và hoàn tiền")}</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="users" size={20} />
            </span>
            <span className="kpi-tag accent">{uiText("Tuyển sinh")}</span>
          </div>
          <div className="kpi-value">—</div>
          <div className="kpi-label">{uiText("Đã thanh toán & kích hoạt")}</div>
          <p className="kpi-subtext">{uiText("Chờ dữ liệu tuyển sinh có thẩm quyền")}</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="sparkles" size={20} />
            </span>
            <span className="kpi-tag">{uiText("Trực tuyến")}</span>
          </div>
          <div className="kpi-value">{uiText("Hoạt động")}</div>
          <div className="kpi-label">{uiText("Trạng thái cổng tuyển sinh")}</div>
          <p className="kpi-subtext">{uiText("Sẵn sàng nhận học viên mới")}</p>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="teaching-search-filter-box">
        <span style={{ color: "var(--muted, #64748b)", display: "inline-flex" }} aria-hidden="true">
          <Icon name="search" size={16} />
        </span>
        <input
          type="search"
          placeholder={uiText("Tìm kiếm đợt mở bán theo tên...")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={uiText("Tìm kiếm đợt mở bán")}
        />
        {search && (
          <button
            type="button"
            className="plain-button"
            style={{ fontSize: 13, color: "var(--muted, #64748b)" }}
            onClick={() => setSearch("")}
          >
            {uiText("✕ Xóa tìm kiếm")}
          </button>
        )}
      </div>

      {/* Filters and View Switcher */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted, #64748b)" }}>
            {uiText("Hình thức:")}
          </span>
          <button
            type="button"
            className={`catalog-filter-pill ${typeFilter === "ALL" ? "active" : ""}`}
            onClick={() => setTypeFilter("ALL")}
            style={{ fontSize: 12, padding: "5px 12px", textDecoration: "none" }}
          >
            {uiText("Tất cả (")}
            {offeringsList.length})
          </button>
          <button
            type="button"
            className={`catalog-filter-pill ${typeFilter === "SELF_PACED" ? "active" : ""}`}
            onClick={() => setTypeFilter("SELF_PACED")}
            style={{ fontSize: 12, padding: "5px 12px", textDecoration: "none" }}
          >
            {uiText("Tự học theo tiến độ (Self-paced)")}
          </button>
          <button
            type="button"
            className={`catalog-filter-pill ${typeFilter === "LIVE_COHORT" ? "active" : ""}`}
            onClick={() => setTypeFilter("LIVE_COHORT")}
            style={{ fontSize: 12, padding: "5px 12px", textDecoration: "none" }}
          >
            {uiText("Học theo lớp trực tiếp (Live Cohort)")}
          </button>
        </div>

        {/* View Mode Toggle: List vs Grid */}
        <div
          role="group"
          aria-label={uiText("Chế độ hiển thị")}
          style={{
            display: "inline-flex",
            background: "var(--surface-soft, #f1f5f9)",
            border: "1px solid var(--line, #e2e8f0)",
            borderRadius: 10,
            padding: 3,
            gap: 2,
          }}
        >
          <button
            type="button"
            onClick={() => setViewMode("list")}
            title={uiText("Dạng danh sách (List View)")}
            style={{
              border: "none",
              background: viewMode === "list" ? "var(--surface, #ffffff)" : "transparent",
              color: viewMode === "list" ? "var(--blue, #0284c7)" : "var(--muted, #64748b)",
              fontWeight: viewMode === "list" ? 700 : 500,
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 12,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: viewMode === "list" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            <span>☰</span>
            <span>{uiText("Danh sách")}</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            title={uiText("Dạng lưới thẻ (Grid View)")}
            style={{
              border: "none",
              background: viewMode === "grid" ? "var(--surface, #ffffff)" : "transparent",
              color: viewMode === "grid" ? "var(--blue, #0284c7)" : "var(--muted, #64748b)",
              fontWeight: viewMode === "grid" ? 700 : 500,
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 12,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: viewMode === "grid" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            <span>☷</span>
            <span>{uiText("Dạng lưới")}</span>
          </button>
        </div>
      </div>

      <State q={q}>
        {() => {
          const list = filtered;
          if (!list.length) {
            return (
              <div className="catalog-empty-hub">
                <span
                  className="empty-hub-icon"
                  aria-hidden="true"
                  style={{ color: "var(--muted, #64748b)" }}
                >
                  <Icon name="target" size={32} />
                </span>
                <h3>{uiText("Không tìm thấy đợt mở bán phù hợp")}</h3>
                <p>
                  {uiText(
                    "Thử điều chỉnh bộ lọc hoặc tạo mới đợt mở bán để bắt đầu nhận ghi danh từ học viên.",
                  )}
                </p>
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <button
                    type="button"
                    className="button button-subtle"
                    onClick={() => {
                      setTypeFilter("ALL");
                      setSearch("");
                    }}
                  >
                    {uiText("Xóa bộ lọc")}
                  </button>
                  <Link
                    className="button"
                    to="/app/teaching/offerings/new"
                    style={{ textDecoration: "none" }}
                  >
                    {uiText("+ Tạo đợt mở bán mới")}
                  </Link>
                </div>
              </div>
            );
          }

          if (viewMode === "list") {
            return (
              <div
                className="table-responsive"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 16,
                  overflow: "hidden",
                  boxShadow: "var(--shadow)",
                }}
              >
                <table className="dashboard-data-table" role="table">
                  <thead>
                    <tr>
                      <th style={{ width: 50, textAlign: "center" }}>STT</th>
                      <th style={{ textAlign: "left" }}>{uiText("Tên đợt mở bán")}</th>
                      <th style={{ width: 220, textAlign: "left" }}>{uiText("Hình thức")}</th>
                      <th style={{ width: 170, textAlign: "left" }}>{uiText("Mức học phí")}</th>
                      <th style={{ width: 130, textAlign: "center" }}>{uiText("Trạng thái")}</th>
                      <th style={{ width: 190, textAlign: "right" }}>{uiText("Thao tác")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((x, idx) => {
                      const isSelfPaced = x.offeringType === "SELF_PACED";
                      const isFree = Number(x.price) === 0;
                      return (
                        <tr key={x.offeringId} className="clickable-log-row">
                          <td style={{ textAlign: "center", color: "var(--muted)", fontWeight: 600 }}>
                            {idx + 1}
                          </td>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <span
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 10,
                                  background: "rgba(2, 132, 199, 0.1)",
                                  color: "var(--blue, #0284c7)",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                                aria-hidden="true"
                              >
                                <Icon name="target" size={18} />
                              </span>
                              <div>
                                <div style={{ fontWeight: 700, color: "var(--ink)", fontSize: 14 }}>
                                  {x.title}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                                  {uiText("Mã đợt: ")}
                                  <code style={{ fontSize: 11 }}>{x.offeringId.slice(0, 14)}</code>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span
                              className="kpi-tag"
                              style={{
                                backgroundColor: isSelfPaced
                                  ? "rgba(2, 132, 199, 0.1)"
                                  : "rgba(124, 58, 237, 0.1)",
                                color: isSelfPaced ? "#0284c7" : "#7c3aed",
                                fontWeight: 600,
                                fontSize: 12,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Icon name={isSelfPaced ? "book" : "users"} size={12} />
                              <span>
                                {isSelfPaced
                                  ? uiText("Tự học (Self-paced)")
                                  : uiText("Lớp học (Live Cohort)")}
                              </span>
                            </span>
                          </td>
                          <td>
                            {isFree ? (
                              <span style={{ fontWeight: 700, color: "#16a34a", fontSize: 13.5 }}>
                                {uiText("Miễn phí (0 ₫)")}
                              </span>
                            ) : (
                              <span style={{ fontWeight: 700, color: "var(--ink)", fontSize: 14 }}>
                                {Number(x.price).toLocaleString(uiLocale)}{" "}
                                <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
                                  {x.currency}
                                </span>
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <StateChip state={x.state} />
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <Link
                              className="button button-small"
                              to={`/app/teaching/offerings/${x.offeringId}`}
                              style={{ textDecoration: "none", whiteSpace: "nowrap" }}
                            >
                              {uiText("Mở chi tiết đợt bán →")}
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }

          return (
            <div className="workspace-cards">
              {list.map((x) => (
                <article key={x.offeringId} className="study-card-rich">
                  <div>
                    <div className="study-card-top">
                      <span className="study-card-icon" aria-hidden="true">
                        <Icon name="target" size={20} />
                      </span>
                      <StateChip state={x.state} />
                    </div>
                    <h2>{x.title}</h2>
                    <p className="muted" style={{ fontSize: "13px", marginTop: "4px" }}>
                      {x.offeringType === "SELF_PACED"
                        ? uiText("Tự học theo tiến độ")
                        : uiText("Học theo lớp")}{" "}
                      ·{" "}
                      <strong style={{ color: "var(--blue, #0284c7)" }}>
                        {Number(x.price).toLocaleString(uiLocale)} {x.currency}
                      </strong>
                    </p>
                  </div>
                  <Link
                    className="button button-small"
                    to={`/app/teaching/offerings/${x.offeringId}`}
                    style={{ textDecoration: "none", textAlign: "center", marginTop: 14 }}
                  >
                    {uiText("Mở chi tiết đợt bán →")}
                  </Link>
                </article>
              ))}
            </div>
          );
        }}
      </State>
    </div>
  );
}

export function OfferingCreate() {
  const uiText = useUiText();
  const nav = useNavigate();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", paddingBottom: 40 }}>
      <Breadcrumbs
        items={[
          { label: uiText("Giảng dạy"), to: "/app/teaching" },
          { label: uiText("Đợt mở bán"), to: "/app/teaching/offerings" },
          { label: uiText("Tạo đợt mở bán mới") },
        ]}
      />
      <p className="eyebrow" style={{ marginTop: 12 }}>
        {uiText("TUYỂN SINH & DOANH THU · TẠO MỚI")}
      </p>
      <h1>{uiText("Tạo đợt mở bán mới.")}</h1>
      <p className="lead">
        {uiText(
          "Cấu hình đợt tuyển sinh, thiết lập học phí và liên kết khóa học hoặc lớp học phần để cấp quyền học viên.",
        )}
      </p>

      {msg && (
        <div
          className="dashboard-banner-notice"
          role="alert"
          style={{
            background: "rgba(239, 68, 68, 0.1)",
            borderColor: "var(--coral, #ef4444)",
            color: "var(--coral, #ef4444)",
            marginBottom: 20,
          }}
        >
          <span>✕</span>
          <span>{uiText(msg)}</span>
        </div>
      )}

      <form
        className="form-panel form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg("");
          const v = values(new FormData(e.currentTarget));
          try {
            const r = await lecturerRequest<Offering>(`/courses/${v.courseId}/offerings`, "POST", {
              offeringType: v.offeringType,
              ...(v.classId ? { classId: v.classId } : {}),
              title: v.title,
              price: v.price,
              currency: v.currency,
            });
            if (r.data?.offeringId) {
              nav(`/app/teaching/offerings/${r.data.offeringId}`);
            } else {
              nav("/app/teaching/offerings");
            }
          } catch (x) {
            setMsg(lecturerError(x));
            setBusy(false);
          }
        }}
      >
        <h2>{uiText("Thông tin đợt mở bán")}</h2>
        <CatalogCourseSelect label={uiText("Khóa học áp dụng")} name="courseId" required />
        <p className="subtext" style={{ marginTop: -8, marginBottom: 8 }}>
          {uiText("Catalog khóa học đã xuất bản. Quyền sử dụng được kiểm tra khi gửi.")}
        </p>
        <label>
          {uiText("Hình thức đào tạo")}
          <select name="offeringType">
            <option value="SELF_PACED">{uiText("Tự học theo tiến độ (Self-paced)")}</option>
            <option value="LIVE_COHORT">{uiText("Học theo lớp trực tiếp (Live Cohort)")}</option>
          </select>
        </label>
        <Field
          label={uiText("Mã lớp liên kết (khi học theo lớp)")}
          name="classId"
          placeholder={uiText("Mã lớp học phần nếu có")}
        />
        <Field
          label={uiText("Tên đợt mở bán")}
          name="title"
          placeholder={uiText("Ví dụ: Đợt tuyển sinh Khóa 2026 - Nhóm 1")}
          required
        />
        <Field label={uiText("Học phí")} name="price" type="number" defaultValue="0" min={0} required />
        <Field label={uiText("Tiền tệ")} name="currency" defaultValue="VND" required />
        <RevenueQuote />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          <button className="button" disabled={busy}>
            {busy ? uiText("Đang tạo…") : uiText("Tạo đợt mở bán")}
          </button>
          <Link className="button button-subtle" to="/app/teaching/offerings">
            {uiText("Hủy & Quay lại")}
          </Link>
        </div>
      </form>
    </div>
  );
}
export function OfferingDetail() {
  const uiText = useUiText();
  const { offeringId = "" } = useParams(),
    q = useLecturer<Offering>(`/offerings/${offeringId}`),
    [msg, setMsg] = useState("");
  return (
    <>
      <State q={q}>
        {(x) => (
          <>
            <p className="eyebrow">{x.state}</p>
            <h1>{x.title}</h1>
            <p>
              {x.offeringType} · {x.price} {x.currency}
            </p>
            <p>
              {x.state === "DRAFT"
                ? uiText("Đợt mở đăng ký đang ở bản nháp.")
                : x.state === "PUBLISHED"
                  ? uiText(
                      "Học viên có thể nhận quyền truy cập theo quy tắc và thời gian của đợt mở đăng ký.",
                    )
                  : uiText("Đợt mở đăng ký đã đóng.")}
            </p>
            {x.offeringType === "LIVE_COHORT" &&
              (x.classId ? (
                <Link to={`/app/teaching/classes/${x.classId}`}>{uiText("Mở lớp gắn với đợt này →")}</Link>
              ) : (
                <p>
                  {uiText("Cần chọn một lớp có lịch đã xuất bản. ")}
                  <Link to="/app/teaching/classes">{uiText("Tạo lớp →")}</Link>
                </p>
              ))}
            <form
              className="form-panel form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                try {
                  await lecturerRequest(`/offerings/${offeringId}`, "PATCH", {
                    title: String(f.get("title")),
                    price: String(f.get("price")),
                    currency: String(f.get("currency")),
                  });
                  setMsg("Đã lưu offering.");
                  q.retry();
                } catch (error) {
                  setMsg(lecturerError(error));
                }
              }}
            >
              <Field label={uiText("Tên offering")} name="title" defaultValue={x.title} required />
              <Field label={uiText("Giá")} name="price" defaultValue={x.price} required />
              <Field label={uiText("Tiền tệ")} name="currency" defaultValue={x.currency} required />
              <RevenueQuote initialPrice={x.price} initialCurrency={x.currency} />
              <button className="button">{uiText("Lưu offering")}</button>
            </form>
            <button
              className="button"
              onClick={async () => {
                try {
                  if (!window.confirm(uiText("Mở đăng ký offering này theo điều kiện hiện tại?"))) return;
                  await lecturerRequest(`/offerings/${offeringId}/publish`, "POST", {});
                  setMsg("Đã xuất bản offering.");
                  q.retry();
                } catch (y) {
                  setMsg(lecturerError(y));
                }
              }}
            >
              {uiText("Xuất bản offering")}
            </button>
          </>
        )}
      </State>
      <p role="status">{uiText(msg)}</p>
    </>
  );
}

export { LecturerProfilePage } from "./ProfileEditor";
