import { readCourseCover } from "../lib/course-cover";
import { useCourseCategories } from "../lib/course-categories";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { lecturerError, lecturerRequest, useLecturer } from "./api";
import { CourseArtwork } from "../components/CourseArtwork";
import { CatalogCourseSelect, Field, State } from "./ui";
import { Breadcrumbs, EmptyState, StateChip, stateLabel, useUnsavedChanges } from "../components/product";
import { Icon, type IconName } from "../components/Icon";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { MediaUpload } from "./MediaUpload";
import { RevenueQuote } from "./RevenueQuote";
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

export function TeachingHome() {
  const courses = useLecturer<Course[] | { items: Course[] }>("/me/owned-courses");
  const classes = useLecturer<
    { classId: string; name: string }[] | { classes: { classId: string; name: string }[] }
  >("/me/owned-classes");
  const offerings = useLecturer<Offering[] | { items: Offering[] }>("/me/owned-offerings");
  const courseList = Array.isArray(courses.data) ? courses.data : courses.data?.items;
  const classList = Array.isArray(classes.data) ? classes.data : classes.data?.classes;
  const offeringList = Array.isArray(offerings.data) ? offerings.data : offerings.data?.items;
  return (
    <div className="teaching-home-container animate-fade-in">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">GIẢNG VIÊN · TỔNG QUAN HOẠT ĐỘNG</p>
          <h1>Tổng quan giảng dạy</h1>
          <p className="lead">Khóa học, lớp học và đợt mở đăng ký do bạn phụ trách.</p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button" to="/app/teaching/courses/new">
            + Tạo khóa học
          </Link>
        </div>
      </div>

      <div className="workspace-kpi-grid">
        {[
          { label: "Khóa học của tôi", value: courseList?.length, icon: "📚", sub: "Chương trình biên soạn" },
          { label: "Lớp phụ trách", value: classList?.length, icon: "👥", sub: "Lớp học trực tiếp" },
          { label: "Đợt mở đăng ký", value: offeringList?.length, icon: "🏷️", sub: "Gói học tự do & lớp" },
        ].map((x) => (
          <div className="kpi-card teaching-kpi-card" key={x.label}>
            <div className="kpi-header">
              <span className="kpi-icon">{x.icon}</span>
              <span className="kpi-tag accent">Hoạt động</span>
            </div>
            <div className="kpi-value">{x.value ?? "0"}</div>
            <div className="kpi-label">{x.label}</div>
            <p className="kpi-subtext">{x.sub}</p>
          </div>
        ))}
      </div>

      <div className="workspace-quick-actions">
        {[
          ["/app/teaching/classes/new", "Tạo lớp học", "plus"],
          ["/app/teaching/schedule", "Lịch dạy", "calendar"],
          ["/app/teaching/grades", "Bảng điểm", "trophy"],
          ["/app/teaching/reports", "Báo cáo", "fileText"],
          ["/app/teaching/revenue", "Doanh thu", "dollar"],
          ["/app/teaching/ai", "AI Studio", "sparkles"],
        ].map(([url, label, iconName]) => (
          <Link className="quick-action-chip teaching-action-chip" to={url} key={url}>
            <Icon name={iconName as IconName} size={15} />
            <span>{label}</span>
          </Link>
        ))}
      </div>

      <State q={courses}>
        {() => (
          <section className="dashboard-section-card animate-fade-in" style={{ marginTop: "24px" }}>
            <div className="section-card-header">
              <div>
                <h2>Khóa học của tôi</h2>
                <p className="subtext">Danh sách các khóa học bạn đang giảng dạy và quản lý nội dung.</p>
              </div>
              <Link className="button button-subtle button-small" to="/app/teaching/courses/new">
                + Thêm khóa học
              </Link>
            </div>
            {courseList?.length ? (
              <div className="teaching-home-grid">
                {courseList.map((c, i) => (
                  <article
                    className="teaching-home-card"
                    key={c.courseId}
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <div className="teaching-home-card-top">
                      <div className="teaching-home-card-icon">
                        <Icon name="book" size={20} />
                      </div>
                      <span className="badge">{c.priceType === "FREE" ? "Miễn phí" : "Khóa học"}</span>
                    </div>
                    <h3 className="teaching-home-card-title">
                      <Link to={`/app/teaching/courses/${c.courseId}`}>{c.title}</Link>
                    </h3>
                    <div className="teaching-home-card-actions">
                      <Link className="button button-small" to={`/app/teaching/courses/${c.courseId}`}>
                        <span>Quản lý khóa học</span>
                        <Icon name="chevronRight" size={14} />
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>Bạn chưa tạo khóa học nào.</p>
            )}
          </section>
        )}
      </State>

      <State q={classes}>
        {() => (
          <section className="dashboard-section-card animate-fade-in" style={{ marginTop: "24px" }}>
            <div className="section-card-header">
              <div>
                <h2>Lớp phụ trách</h2>
                <p className="subtext">Lớp học và lịch trình các buổi học tương tác trực tiếp.</p>
              </div>
              <Link className="button button-subtle button-small" to="/app/teaching/classes/new">
                + Thêm lớp học
              </Link>
            </div>
            {classList?.length ? (
              <div className="teaching-home-grid">
                {classList.map((c, i) => (
                  <article
                    className="teaching-home-card"
                    key={c.classId}
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <div className="teaching-home-card-top">
                      <div
                        className="teaching-home-card-icon"
                        style={{ background: "rgba(16, 185, 129, 0.12)", color: "#10b981" }}
                      >
                        <Icon name="users" size={20} />
                      </div>
                      <span className="green-badge-pill">● Đang diễn ra</span>
                    </div>
                    <h3 className="teaching-home-card-title">
                      <Link to={`/app/teaching/classes/${c.classId}`}>{c.name}</Link>
                    </h3>
                    <div className="teaching-home-card-actions">
                      <Link
                        className="button button-small button-subtle"
                        to={`/app/teaching/classes/${c.classId}`}
                      >
                        <span>Chi tiết lớp học</span>
                        <Icon name="chevronRight" size={14} />
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>Bạn chưa tạo lớp học nào.</p>
            )}
          </section>
        )}
      </State>
      {!!offerings.error && <State q={offerings}>{() => null}</State>}
    </div>
  );
}

export function TeachingCourses() {
  const categories = useCourseCategories();
  const [selectedCat, setSelectedCat] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PUBLISHED" | "DRAFT" | "HIDDEN">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [showCreateInline, setShowCreateInline] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newPriceType, setNewPriceType] = useState<"FREE" | "PAID">("FREE");
  const [newPrice, setNewPrice] = useState("0");
  const [newCurrency, setNewCurrency] = useState("VND");
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const courses = useLecturer<Course[] | { items: Course[] }>("/me/owned-courses");
  const coursesList = Array.isArray(courses.data) ? courses.data : courses.data?.items || [];

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
      .catch((error: Error) => setCreateError(error.message));
  };

  const handleCreateCourse = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      setCreateError("Vui lòng nhập tên khóa học.");
      return;
    }
    const slug = newSlug.trim() || slugifyTitle(newTitle);
    setCreateLoading(true);
    setCreateError(null);
    setCreateMsg(null);
    try {
      const payload = {
        coverDataUrl: coverPreview,
        title: newTitle.trim(),
        slug,
        categoryName: newCategoryName.trim(),
        priceType: newPriceType,
        price: newPriceType === "PAID" ? newPrice : "0",
        currency: newCurrency,
      };
      await lecturerRequest<Course>("/courses", "POST", payload);

      setCreateMsg("✓ Khóa học đã được tạo thành công!");
      courses.retry();
      setTimeout(() => {
        setNewTitle("");
        setNewSlug("");
        setCoverPreview(null);
        setNewPriceType("FREE");
        setNewPrice("0");
        setCreateLoading(false);
        setShowCreateInline(false);
        setCreateMsg(null);
      }, 1400);
    } catch (err) {
      setCreateError(lecturerError(err));
      setCreateLoading(false);
    }
  };

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
            <span>STUDIO BIÊN SOẠN &amp; ĐÀO TẠO</span>
          </div>
          <h1 className="curriculum-studio-title">Danh Mục Khóa Học &amp; Giáo Trình Giảng Dạy</h1>
          <p className="curriculum-studio-desc">
            Không gian chuyên sâu quản lý đề cương bài giảng, học liệu số và điều hành học viên theo từng
            chuyên ngành đào tạo.
          </p>
        </div>
        <div className="curriculum-studio-actions">
          <button
            type="button"
            className="curriculum-create-btn"
            onClick={() => {
              setShowCreateInline((v) => !v);
              setCreateError(null);
              setCreateMsg(null);
            }}
            style={{
              textDecoration: "none",
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: showCreateInline ? "var(--muted, #64748b)" : undefined,
            }}
          >
            <span className="create-btn-icon" aria-hidden="true">
              <Icon name={showCreateInline ? "close" : "plus"} size={16} />
            </span>
            <span>{showCreateInline ? "Đóng khung tạo" : "Soạn khóa học mới"}</span>
          </button>
        </div>
      </div>

      <div className="curriculum-stat-strip">
        <div className="curriculum-stat-item">
          <div className="curriculum-stat-content">
            <div className="curriculum-stat-value">
              {courses.pending || courses.error ? "—" : coursesList.length} khóa
            </div>
            <div className="curriculum-stat-label">Khóa học phụ trách</div>
            <div className="curriculum-stat-sub">
              {coursesList.filter((c) => c.state === "PUBLISHED").length} đã xuất bản ·{" "}
              {coursesList.filter((c) => c.state === "DRAFT").length} bản nháp
            </div>
          </div>
        </div>
        <div className="curriculum-stat-item">
          <div className="curriculum-stat-content">
            <div className="curriculum-stat-label">Học liệu và học viên</div>
            <div className="curriculum-stat-sub">Xem dữ liệu thực tế trong từng khóa học.</div>
          </div>
        </div>
        <div className="curriculum-stat-item">
          <div className="curriculum-stat-content">
            <Link to="/app/teaching/revenue">Xem báo cáo doanh thu</Link>
            <div className="curriculum-stat-sub">Doanh thu từ các giao dịch thanh toán.</div>
          </div>
        </div>
      </div>

      {/* Inline Course Authoring Panel */}
      {showCreateInline && (
        <section className="inline-course-create-card" aria-label="Tạo khóa học mới">
          <div className="inline-create-header">
            <div>
              <h2 className="inline-create-title">
                <Icon name="plus" size={18} style={{ color: "var(--blue)" }} />
                <span>Tạo Khóa Học Mới &amp; Tải Lên Ảnh Bìa</span>
              </h2>
              <p className="inline-create-desc">
                Nhập thông tin cơ bản, chọn ảnh bìa nhận diện và khởi tạo bản nháp khóa học ngay trên trang
                này.
              </p>
            </div>
            <button
              type="button"
              className="button button-subtle button-small"
              onClick={() => setShowCreateInline(false)}
              aria-label="Đóng"
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Icon name="close" size={14} />
              <span>Đóng</span>
            </button>
          </div>

          <form onSubmit={handleCreateCourse} className="inline-create-form">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {createMsg && (
                <div className="dashboard-banner-notice" role="status" style={{ margin: 0 }}>
                  <span>✓</span>
                  <span>{createMsg}</span>
                </div>
              )}
              {createError && (
                <div
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    backgroundColor: "rgba(220, 38, 38, 0.1)",
                    color: "#dc2626",
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                >
                  ⚠️ {createError}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink)",
                  }}
                >
                  <span>
                    Tên khóa học <span style={{ color: "#dc2626" }}>*</span>
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="VD: Lập trình Python ứng dụng AI &amp; LLM nâng cao..."
                    value={newTitle}
                    onChange={(e) => {
                      const t = e.target.value;
                      setNewTitle(t);
                      if (!newSlug || newSlug === slugifyTitle(newTitle)) {
                        setNewSlug(slugifyTitle(t));
                      }
                    }}
                    style={{
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--line, #cbd5e1)",
                      fontSize: 14,
                      backgroundColor: "var(--surface, #ffffff)",
                      color: "var(--ink, #0f172a)",
                    }}
                  />
                </label>

                <label
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink)",
                  }}
                >
                  <span>
                    Đường dẫn (Slug URL) <span style={{ color: "#dc2626" }}>*</span>
                  </span>
                  <input
                    type="text"
                    required
                    placeholder="VD: lap-trinh-python-ung-dung-ai"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    style={{
                      padding: "9px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--line, #cbd5e1)",
                      fontSize: 14,
                      backgroundColor: "var(--surface, #ffffff)",
                      color: "var(--ink, #0f172a)",
                    }}
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    <span>Chủ đề / Chuyên ngành</span>
                    <input
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      required
                      minLength={2}
                      maxLength={80}
                      placeholder="Nhập danh mục đào tạo"
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    <span>Hình thức</span>
                    <select
                      value={newPriceType}
                      onChange={(e) => setNewPriceType(e.target.value as "FREE" | "PAID")}
                      style={{
                        padding: "9px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--line, #cbd5e1)",
                        fontSize: 14,
                        backgroundColor: "var(--surface, #ffffff)",
                        color: "var(--ink, #0f172a)",
                      }}
                    >
                      <option value="FREE">Miễn phí (FREE)</option>
                      <option value="PAID">Có học phí (PAID)</option>
                    </select>
                  </label>
                </div>

                {newPriceType === "PAID" && (
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                    <label
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink)",
                      }}
                    >
                      <span>Học phí</span>
                      <input
                        type="text"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        placeholder="590000"
                        style={{
                          padding: "9px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--line, #cbd5e1)",
                          fontSize: 14,
                          backgroundColor: "var(--surface, #ffffff)",
                          color: "var(--ink, #0f172a)",
                        }}
                      />
                    </label>
                    <label
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--ink)",
                      }}
                    >
                      <span>Tiền tệ</span>
                      <input
                        type="text"
                        value={newCurrency}
                        onChange={(e) => setNewCurrency(e.target.value)}
                        style={{
                          padding: "9px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--line, #cbd5e1)",
                          fontSize: 14,
                          backgroundColor: "var(--surface, #ffffff)",
                          color: "var(--ink, #0f172a)",
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <button
                  type="submit"
                  className="button"
                  disabled={createLoading}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 20px" }}
                >
                  <Icon name="plus" size={16} />
                  <span>{createLoading ? "Đang tạo bản nháp..." : "Tạo bản nháp khóa học"}</span>
                </button>
                <button
                  type="button"
                  className="button button-subtle"
                  onClick={() => setShowCreateInline(false)}
                >
                  Hủy
                </button>
              </div>
            </div>

            {/* Cover image uploader */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                Hình ảnh bìa khóa học (Cover Image)
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
                  const input = document.getElementById("course-cover-input") as HTMLInputElement;
                  input?.click();
                }}
              >
                <input
                  id="course-cover-input"
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
                    <img src={coverPreview} alt="Xem trước ảnh bìa" className="inline-cover-preview-img" />
                    <span className="inline-cover-badge">✓ Đã tải ảnh bìa</span>
                    <div className="inline-cover-overlay-actions">
                      <button
                        type="button"
                        className="button button-subtle button-small"
                        onClick={(e) => {
                          e.stopPropagation();
                          const input = document.getElementById("course-cover-input") as HTMLInputElement;
                          input?.click();
                        }}
                        style={{ fontSize: 11, padding: "4px 8px" }}
                      >
                        <Icon name="upload" size={12} />
                        <span>Đổi ảnh</span>
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
                        <span>Xóa</span>
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
                        marginBottom: 10,
                        color: "var(--blue)",
                      }}
                    >
                      <Icon name="image" size={24} />
                    </div>
                    <p style={{ fontWeight: 600, fontSize: 13, margin: "0 0 4px", color: "var(--ink)" }}>
                      Tải lên ảnh bìa đại diện
                    </p>
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
                      Kéo thả ảnh vào đây hoặc nhấp để chọn tệp
                    </p>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        marginTop: 8,
                        padding: "2px 8px",
                        background: "var(--card-subtle, #f1f5f9)",
                        borderRadius: 4,
                      }}
                    >
                      PNG, JPG, WEBP (khuyến nghị 16:9)
                    </span>
                  </>
                )}
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 0" }}>
                Ảnh bìa sẽ được hiển thị trên danh thiếp khóa học và đồng bộ trên giao diện học viên.
              </p>
            </div>
          </form>
        </section>
      )}

      {/* Integrated Search & Filters Toolbar */}
      <div className="curriculum-toolbar-card">
        <div className="curriculum-search-row">
          <div className="curriculum-search-input-wrap">
            <span style={{ color: "var(--muted, #64748b)", display: "inline-flex" }} aria-hidden="true">
              <Icon name="search" size={16} />
            </span>
            <input
              type="search"
              placeholder="Tìm kiếm theo tên khóa học hoặc mã slug..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Tìm kiếm khóa học"
            />
            {searchQuery && (
              <button
                type="button"
                className="curriculum-clear-btn"
                onClick={() => setSearchQuery("")}
                aria-label="Xóa tìm kiếm"
              >
                ✕
              </button>
            )}
          </div>

          <div className="curriculum-status-filters" role="group" aria-label="Bộ lọc trạng thái">
            <button
              type="button"
              className={`curriculum-status-chip ${statusFilter === "ALL" ? "active" : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              Tất cả ({coursesList.length})
            </button>
            <button
              type="button"
              className={`curriculum-status-chip ${statusFilter === "PUBLISHED" ? "active" : ""}`}
              onClick={() => setStatusFilter("PUBLISHED")}
            >
              ● Đã xuất bản
            </button>
            <button
              type="button"
              className={`curriculum-status-chip ${statusFilter === "DRAFT" ? "active" : ""}`}
              onClick={() => setStatusFilter("DRAFT")}
            >
              ○ Bản nháp
            </button>
            <button
              type="button"
              className={`curriculum-status-chip ${statusFilter === "HIDDEN" ? "active" : ""}`}
              onClick={() => setStatusFilter("HIDDEN")}
            >
              Không công khai
            </button>
          </div>
        </div>

        {/* Category Pills */}
        <div className="curriculum-category-row" role="tablist" aria-label="Lọc theo danh mục">
          <button
            type="button"
            className={`curriculum-cat-pill ${selectedCat === "all" ? "active" : ""}`}
            onClick={() => setSelectedCat("all")}
          >
            Tất cả chuyên ngành ({coursesList.length})
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
                        Xem đánh giá trong khóa học
                      </span>
                    </div>
                    <h3 className="teaching-course-title">{c.title}</h3>
                    <p className="teaching-course-desc">
                      Mã khóa: <code>{c.slug}</code> • Học phần lý thuyết &amp; thực hành nâng cao.
                    </p>

                    <div className="teaching-course-metrics">
                      <span className="teaching-course-metric-item">
                        <Icon name="book" size={13} style={{ color: "var(--blue)" }} />
                        <span>Xem học liệu</span>
                      </span>
                      <span className="teaching-course-metric-item">
                        <Icon name="users" size={13} style={{ color: "var(--teal)" }} />
                        <span>Xem học viên</span>
                      </span>
                      <span className="teaching-course-metric-item">
                        <Icon name="clock" size={13} style={{ color: "var(--amber)" }} />
                        <span>Xem thời lượng</span>
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
                        <span style={{ color: "#ffffff" }}>Soạn bài giảng</span>
                      </Link>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%" }}>
                        <Link
                          className="button button-subtle button-small"
                          to={`/app/teaching/courses/${c.courseId}/roster`}
                          title="Danh sách học viên"
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
                          <span>Học viên</span>
                        </Link>
                        <Link
                          className="button button-subtle button-small"
                          to={`/app/teaching/courses/${c.courseId}?tab=settings`}
                          title="Cài đặt khóa học"
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
                          <span>Cài đặt</span>
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
              <h3>Không tìm thấy khóa học nào phù hợp</h3>
              <p>
                Thử điều chỉnh bộ lọc hoặc từ khóa tìm kiếm của bạn, hoặc tạo mới khóa học giáo trình ngay.
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
                  Xóa bộ lọc
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setShowCreateInline(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  + Soạn khóa học mới
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
              <h3>Trợ Lý Biên Soạn AI (AILSS Co-pilot)</h3>
              <span className="kpi-tag accent">Bloom Taxonomy v2</span>
            </div>
          </div>
          <p>
            Tăng tốc độ soạn giáo án bằng cách tự động sinh khung đề cương 6 cấp độ nhận thức Bloom, đề xuất
            bài tập trắc nghiệm và kịch bản thực hành đa phương tiện.
          </p>
          <div style={{ marginTop: "auto", paddingTop: 10 }}>
            <Link
              className="button button-subtle button-small"
              to="/app/teaching/ai-studio"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span>Mở AI Studio Trợ Giảng</span>
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
              <h3>Tiêu Chuẩn Xuất Bản Khóa Học AILSS</h3>
              <span className="kpi-tag">Quy chuẩn đào tạo</span>
            </div>
          </div>
          <p>
            Để đảm bảo trải nghiệm học tập tốt nhất, mỗi khóa học cần đáp ứng các tiêu chí sau trước khi công
            khai:
          </p>
          <ul className="checklist-items">
            <li className="checklist-item">
              <span className="check-icon" aria-hidden="true">
                <Icon name="checkCircle" size={16} />
              </span>
              <span>Đề cương chi tiết có tối thiểu 5 bài học và mục tiêu rõ ràng</span>
            </li>
            <li className="checklist-item">
              <span className="check-icon" aria-hidden="true">
                <Icon name="checkCircle" size={16} />
              </span>
              <span>Video bài giảng chất lượng cao HD với phụ đề / tóm tắt</span>
            </li>
            <li className="checklist-item">
              <span className="check-icon" aria-hidden="true">
                <Icon name="checkCircle" size={16} />
              </span>
              <span>Có ít nhất 1 bài kiểm tra trắc nghiệm hoặc bài tập Lab thực hành</span>
            </li>
            <li className="checklist-item">
              <span className="check-icon" aria-hidden="true">
                <Icon name="checkCircle" size={16} />
              </span>
              <span>Bộ tài liệu đính kèm và mã nguồn mẫu được kiểm thử hoạt động</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
export function CourseCreate() {
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
      <h1>Tạo khóa học.</h1>
      <form className="form-panel form-grid" onSubmit={(e) => void submit(e)}>
        <Field label="Tên khóa học" name="title" required />
        <label>
          Mô tả
          <textarea name="description" maxLength={2000} />
        </label>
        <Field label="Đường dẫn khóa học" name="slug" required />
        <label>
          Chủ đề
          <input
            name="categoryName"
            required
            minLength={2}
            maxLength={80}
            placeholder="Ví dụ: Thiết kế đồ họa"
          />
        </label>
        <label>
          Hình thức
          <select name="priceType">
            <option value="FREE">Miễn phí</option>
            <option value="PAID">Có học phí</option>
          </select>
        </label>
        <Field label="Giá" name="price" defaultValue="0" required />
        <Field label="Tiền tệ" name="currency" defaultValue="VND" required />

        {/* Cover image upload */}
        <label style={{ gridColumn: "1 / -1" }}>
          Hình ảnh bìa khóa học
          <input
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
                alt="Xem trước bìa"
                style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }}
              />
            </div>
          )}
        </label>

        <RevenueQuote initialPaid={false} />
        <button className="button">Tạo bản nháp</button>
        <p role="status">{msg}</p>
      </form>
    </>
  );
}
export function CourseDetail() {
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
              items={[{ label: "Giảng dạy", to: "/app/teaching" }, { label: "Khóa học" }, { label: c.title }]}
            />

            {/* Studio Hero Card */}
            <div className="dashboard-heading" style={{ marginTop: "0.5rem", marginBottom: "1.25rem" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <StateChip state={c.state} />
                  <span className="kpi-tag">
                    {c.priceType === "FREE" ? "Miễn phí" : `${c.price} ${c.currency}`}
                  </span>
                  <span className="badge">{c.slug}</span>
                </div>
                <h1 style={{ margin: "0.25rem 0" }}>{c.title}</h1>
                <p className="lead" style={{ margin: 0 }}>
                  Quản trị chương trình đào tạo, biên soạn bài giảng đa phương tiện và phát hành gói tuyển
                  sinh.
                </p>
              </div>
              <div
                className="dashboard-header-actions"
                style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
              >
                <Link className="button" to={`/app/teaching/discussion/COURSE/${id}`}>
                  ⭐ Đánh giá & Thảo luận ({reviewCount})
                </Link>
                <Link className="button button-subtle" to={`/app/teaching/courses/${id}/roster`}>
                  👥 Học viên
                </Link>
                {c.state === "DRAFT" && (
                  <button
                    className="button button-subtle"
                    onClick={() => void command(`/courses/${id}/submit-review`)}
                  >
                    <Icon name="zap" size={15} /> Nộp duyệt
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
                  <span className="kpi-tag accent">Giáo trình</span>
                </div>
                <div className="kpi-value">{lessons.pending ? "…" : `${lessonList.length} bài`}</div>
                <div className="kpi-label">Bài học & video</div>
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
                  <span className="kpi-tag">Tuyển sinh</span>
                </div>
                <div className="kpi-value">{offerings.pending ? "…" : `${offeringList.length} đợt`}</div>
                <div className="kpi-label">Đợt mở đăng ký</div>
              </div>
              <div className="kpi-card" onClick={() => setActiveTab("classes")} style={{ cursor: "pointer" }}>
                <div className="kpi-header">
                  <span className="kpi-icon" aria-hidden="true">
                    <Icon name="users" size={20} />
                  </span>
                  <span className="kpi-tag accent">Lớp học</span>
                </div>
                <div className="kpi-value">{classes.pending ? "…" : `${classList.length} lớp`}</div>
                <div className="kpi-label">Lớp học trực tiếp</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-icon" aria-hidden="true">
                    <Icon name="starFilled" size={20} />
                  </span>
                  <span className="kpi-tag accent">{ratingAvg} ★</span>
                </div>
                <div className="kpi-value">{reviewCount} lượt</div>
                <div className="kpi-label">Đánh giá từ học viên</div>
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
                <Icon name="book" size={15} /> Giáo trình & Bài học ({lessonList.length})
              </button>
              <button
                className={`segmented-tab ${activeTab === "offerings" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "offerings"}
                onClick={() => setActiveTab("offerings")}
              >
                <Icon name="target" size={15} /> Đợt tuyển sinh ({offeringList.length})
              </button>
              <button
                className={`segmented-tab ${activeTab === "classes" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "classes"}
                onClick={() => setActiveTab("classes")}
              >
                <Icon name="users" size={15} /> Lớp học liên kết ({classList.length})
              </button>
              <button
                className={`segmented-tab ${activeTab === "releases" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "releases"}
                onClick={() => setActiveTab("releases")}
              >
                <Icon name="tag" size={15} /> Bản phát hành ({releasesList.length})
              </button>
              <button
                className={`segmented-tab ${activeTab === "edit" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "edit"}
                onClick={() => setActiveTab("edit")}
              >
                <Icon name="settings" size={15} /> Chỉnh sửa khóa học
              </button>
              <button
                className={`segmented-tab ${activeTab === "settings" ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === "settings"}
                onClick={() => setActiveTab("settings")}
              >
                <Icon name="settings" size={15} /> Cài đặt
              </button>
            </div>

            {/* TAB 1: CURRICULUM & LESSONS */}
            {activeTab === "curriculum" && (
              <section className="dashboard-section-card">
                <div className="section-card-header">
                  <div>
                    <h2>Danh Sách Bài Giảng Trong Khóa Học</h2>
                    <p className="subtext">
                      Quản lý cấu trúc bài giảng, video học liệu và cho phép xem thử (preview).
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <Link className="button" to={`/app/teaching/courses/${id}/lessons`}>
                      <Icon name="plus" size={15} /> Soạn bài học mới
                    </Link>
                    <Link className="button button-subtle" to={`/app/teaching/assessments?course=${id}`}>
                      <Icon name="quiz" size={15} /> Bài kiểm tra AI
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
                                <span className="kpi-tag accent">Bài {String(idx + 1).padStart(2, "0")}</span>
                                <span className="badge">{x.state}</span>
                                {x.preview && (
                                  <span className="green-badge-pill">
                                    <Icon name="eye" size={13} /> Xem trước
                                  </span>
                                )}
                              </div>
                              <small style={{ color: "var(--muted, #64748b)" }}>
                                Chương: {x.sectionTitle}
                              </small>
                            </div>
                            <h3 style={{ margin: "0.25rem 0 0.5rem 0", fontSize: "1.1rem" }}>{x.title}</h3>
                            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
                              <Link
                                className="button button-subtle button-small"
                                to={`/app/teaching/lessons/${x.lessonId}`}
                              >
                                Sửa bài học →
                              </Link>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title="Chưa có bài giảng nào"
                        action={
                          <Link className="button" to={`/app/teaching/courses/${id}/lessons`}>
                            <Icon name="plus" size={15} /> Thêm bài học đầu tiên
                          </Link>
                        }
                      >
                        Khóa học cần ít nhất một bài học để sẵn sàng mở tuyển sinh và nộp kiểm duyệt.
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
                    <h2>Các Đợt Mở Bán & Tuyển Sinh</h2>
                    <p className="subtext">Cấu hình giá bán, hình thức đào tạo và thời gian tuyển sinh.</p>
                  </div>
                  <Link className="button" to="/app/teaching/offerings">
                    <Icon name="plus" size={15} /> Tạo đợt mở đăng ký
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
                                {o.price ? `${o.price} ${o.currency}` : "Miễn phí"}
                              </span>
                            </div>
                            <h3 style={{ margin: "0.25rem 0" }}>{o.title}</h3>
                            <p style={{ color: "var(--muted, #64748b)", fontSize: "0.875rem" }}>
                              Hình thức: {stateLabel(o.offeringType)}
                            </p>
                            <div style={{ marginTop: "0.75rem" }}>
                              <Link
                                className="card-action-btn"
                                to={`/app/teaching/offerings/${o.offeringId}`}
                              >
                                Quản lý đợt tuyển sinh →
                              </Link>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title="Chưa có đợt mở đăng ký"
                        action={
                          <Link className="button" to="/app/teaching/offerings">
                            <Icon name="plus" size={15} /> Tạo đợt mở đăng ký
                          </Link>
                        }
                      >
                        Khóa học chưa tự động mở quyền đăng ký. Hãy tạo đợt mở bán khi nội dung đủ điều kiện.
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
                    <h2>Lớp Học Trực Tuyến Liên Kết</h2>
                    <p className="subtext">Các lớp học đang áp dụng giáo trình khóa học này.</p>
                  </div>
                  <Link className="button" to="/app/teaching/classes">
                    <Icon name="plus" size={15} /> Tạo lớp mới
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
                              Vào không gian lớp →
                            </Link>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title="Chưa có lớp liên kết"
                        action={
                          <Link className="button" to="/app/teaching/classes">
                            <Icon name="plus" size={15} /> Tạo lớp
                          </Link>
                        }
                      >
                        Chỉ hiển thị lớp có liên kết tới khóa học này do Classroom quản lý.
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
                    <h2>Quản Lý Phiên Bản Khóa Học &amp; Bản Phát Hành (Course Versioning)</h2>
                    <p className="subtext">
                      Quản lý vòng đời phát hành (Draft → RC → Live), ngăn xung đột đồng thời bằng CAS Guard
                      và so sánh khác biệt nội dung (Diff).
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
                    <strong>Lỗi xung đột đồng thời:</strong> {publishError}
                  </div>
                )}

                {/* Release List Table */}
                <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
                  <table className="admin-table" style={{ width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Phiên bản</th>
                        <th>Trạng thái</th>
                        <th>Số bài giảng</th>
                        <th>Thời gian phát hành</th>
                        <th>Ghi chú phát hành</th>
                        <th>Thao tác</th>
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
                          <td>{rel.lessonsCount} bài</td>
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
                              So sánh (Diff)
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
                    Phát Hành Bản Mới (Optimistic Concurrency CAS Guard)
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
                        Phiên bản Semver
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
                        Trạng thái phát hành
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
                        <option value="LIVE">LIVE (Phát hành chính thức)</option>
                        <option value="DRAFT">DRAFT</option>
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
                        Ghi chú phát hành (Release Notes)
                      </label>
                      <textarea
                        rows={2}
                        value={newReleaseForm.releaseNotes}
                        onChange={(e) =>
                          setNewReleaseForm({ ...newReleaseForm, releaseNotes: e.target.value })
                        }
                        placeholder="Ghi chú tóm tắt bài giảng mới hoặc cập nhật giáo trình..."
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
                        <Icon name="check" size={15} /> Xác nhận phát hành (CAS Guard)
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
                            So Sánh Giữa {selectedDiffReleases.v1} và {selectedDiffReleases.v2}
                          </h2>
                        </div>
                        <button
                          type="button"
                          className="button button-subtle"
                          onClick={() => setSelectedDiffReleases(null)}
                          aria-label="Đóng"
                        >
                          ✕
                        </button>
                      </div>
                      <div style={{ padding: "14px 0", display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ fontSize: 13, color: "var(--muted, #475569)" }}>
                          Phân tích khác biệt cây học liệu và mục tiêu kiểm tra:
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
                            <strong>[+ Thêm mới]</strong> Bài học Sharding &amp; Replication Cassandra.
                          </li>
                          <li>
                            <strong>[~ Cập nhật]</strong> Sửa đổi tiêu chuẩn kiểm tra trắc nghiệm Bloom 4-5.
                          </li>
                          <li>
                            <strong>[Giữ nguyên]</strong> {lessonList.length} bài giảng kế thừa.
                          </li>
                        </ul>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                          <button
                            type="button"
                            className="button"
                            onClick={() => setSelectedDiffReleases(null)}
                          >
                            Đóng
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
                    <h2>Khóa hoặc xóa khóa học</h2>
                    <p className="subtext">
                      Trạng thái hiện tại: {stateLabel(c.state)} · {c.activeStudentCount ?? 0} học viên đang
                      có quyền học
                    </p>
                  </div>
                </div>
                <p>
                  Khóa học đã xuất bản sẽ được ẩn khỏi danh mục và ngừng nhận học viên mới. Học viên đã đăng
                  ký vẫn xem bài học, làm bài và giữ tiến độ. Dữ liệu lớp học, đơn hàng và thanh toán được giữ
                  lại.
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
                          Yêu cầu khóa học
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
                        Yêu cầu xóa khóa học
                      </button>
                    </div>
                  )}
                {retireMode && (
                  <div className="form-panel" style={{ marginTop: "1rem" }}>
                    <p>
                      {retireMode === "DELETE" && c.state !== "PUBLISHED"
                        ? "Bản nháp sẽ được xóa mềm."
                        : "Khóa học sẽ được ẩn an toàn để bảo toàn quyền học của học viên cũ."}{" "}
                      Nhập chính xác tên khóa học để xác nhận:
                    </p>
                    <input
                      aria-label="Nhập tên khóa học để xác nhận"
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
                        {retiring ? "Đang xử lý…" : "Xác nhận yêu cầu"}
                      </button>
                      <button
                        className="button button-subtle"
                        type="button"
                        onClick={() => setRetireMode(null)}
                      >
                        Hủy
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
                    <h2>Chỉnh Sửa Thông Tin Khóa Học</h2>
                    <p className="subtext">
                      Cập nhật tiêu đề, danh mục, hình thức đào tạo và học phí niêm yết.
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
                    <Field label="Tên khóa học" name="title" defaultValue={c.title} required />
                    <label>
                      Mô tả
                      <textarea name="description" defaultValue={c.description ?? ""} maxLength={2000} />
                    </label>
                    <Field label="Đường dẫn khóa học (Slug)" name="slug" defaultValue={c.slug} required />
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
                      Chủ đề đào tạo
                      <input
                        key={c.categoryId + categoryOptions.length}
                        name="categoryName"
                        defaultValue={categoryOptions.find((x) => x.id === c.categoryId)?.name ?? ""}
                        required
                        minLength={2}
                        maxLength={80}
                        placeholder="Nhập danh mục đào tạo"
                      />
                    </label>

                    <label>
                      Hình thức học phí
                      <select name="priceType" defaultValue={c.priceType}>
                        <option value="FREE">Miễn phí</option>
                        <option value="PAID">Có học phí</option>
                      </select>
                    </label>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: "1.25rem",
                      marginTop: "1rem",
                    }}
                  >
                    <Field label="Giá niêm yết" name="price" defaultValue={c.price} required />
                    <Field label="Đơn vị tiền tệ" name="currency" defaultValue={c.currency} required />
                  </div>
                  <RevenueQuote
                    initialPrice={c.price}
                    initialCurrency={c.currency}
                    initialPaid={c.priceType === "PAID"}
                  />

                  <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end" }}>
                    <button className="button" type="submit">
                      <Icon name="check" size={15} /> Lưu thay đổi khóa học
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
          <span>{msg}</span>
        </div>
      )}
    </div>
  );
}
export function Lessons() {
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
      <h1>Bài học.</h1>
      <State q={q}>
        {(v) => (
          <div className="workspace-cards">
            {(Array.isArray(v) ? v : v.lessons || []).map((x) => (
              <article key={x.lessonId}>
                <span className="badge">{x.state}</span>
                <h2>{x.title}</h2>
                <p>{x.sectionTitle}</p>
                <Link to={`/app/teaching/lessons/${x.lessonId}`}>Sửa bài học →</Link>
              </article>
            ))}
          </div>
        )}
      </State>
      <form className="form-panel form-grid" onSubmit={(e) => void create(e)}>
        <h2>Thêm bài học</h2>
        <Field label="Tiêu đề" name="title" required />
        <Field label="Chương" name="sectionTitle" required />
        <Field label="Thứ tự chương" name="sectionOrder" type="number" defaultValue={1} required />
        <Field label="Thứ tự bài" name="lessonOrder" type="number" defaultValue={1} required />
        <label>
          <input name="preview" type="checkbox" /> Cho phép xem trước
        </label>
        <button className="button">Tạo bài học</button>
        <p role="status">{msg}</p>
      </form>
    </>
  );
}
export function LessonDetail() {
  const { lessonId = "" } = useParams(),
    q = useLecturer<Lesson>(`/lessons/${lessonId}`),
    [msg, setMsg] = useState("");
  return (
    <>
      <p className="eyebrow">LESSON</p>
      <State q={q}>
        {(x) => (
          <>
            <h1>{x.title}</h1>
            <MediaUpload
              key={lessonId}
              courseId={x.courseId}
              lessonId={lessonId}
              preview={x.preview}
              mediaAssetId={x.mediaAssetId}
            />
            <form
              className="form-panel form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const v = values(new FormData(e.currentTarget));
                try {
                  await lecturerRequest(`/lessons/${lessonId}`, "PATCH", {
                    title: v.title,
                    sectionTitle: v.sectionTitle,
                    position: { sectionOrder: Number(v.sectionOrder), lessonOrder: Number(v.lessonOrder) },
                    preview: v.preview === "on",
                  });
                  setMsg("Đã lưu bài học.");
                  q.retry();
                } catch (y) {
                  setMsg(lecturerError(y));
                }
              }}
            >
              <Field label="Tiêu đề" name="title" defaultValue={x.title} />
              <Field label="Chương" name="sectionTitle" defaultValue={x.sectionTitle} />
              <Field
                label="Thứ tự chương"
                name="sectionOrder"
                type="number"
                defaultValue={x.position?.sectionOrder || 1}
              />
              <Field
                label="Thứ tự bài"
                name="lessonOrder"
                type="number"
                defaultValue={x.position?.lessonOrder || 1}
              />
              <label>
                <input name="preview" type="checkbox" defaultChecked={x.preview} /> Xem trước
              </label>
              <button className="button">Lưu</button>
            </form>
          </>
        )}
      </State>
      <p role="status">{msg}</p>
    </>
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
      ["Mã học viên", "Họ tên", "Email", "Ngày ghi danh", "Tiến độ (%)", "Trạng thái"],
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
        items={[{ label: "Khóa học", to: "/app/teaching/courses" }, { label: "Học viên khóa học" }]}
      />
      <h1>Học viên khóa học</h1>
      <p>Danh sách ghi danh từ hệ thống. Hồ sơ hoặc tiến độ chưa được cung cấp sẽ hiển thị dấu —.</p>
      <label>
        Tìm học viên
        <input value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <button className="button" disabled={q.pending || !!q.error || !filtered.length} onClick={exportCsv}>
        Xuất danh sách CSV
      </button>
      <State q={q}>
        {() =>
          rows.length ? (
            <div className="attendance-scroll">
              <p>{rows.length} học viên ghi danh</p>
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>Học viên</th>
                    <th>Email</th>
                    <th>Ngày ghi danh</th>
                    <th>Tiến độ</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.studentId}>
                      <td>{row.studentName || row.studentId}</td>
                      <td>{row.email || "—"}</td>
                      <td>{row.enrolledAt ? new Date(row.enrolledAt).toLocaleDateString("vi-VN") : "—"}</td>
                      <td>{row.progressPercent === undefined ? "—" : `${row.progressPercent}%`}</td>
                      <td>{row.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && <p>Không có học viên phù hợp.</p>}
            </div>
          ) : (
            <p>Chưa có học viên ghi danh khóa học này.</p>
          )
        }
      </State>
      <Link className="button secondary" to="/app/teaching/grades">
        Bảng điểm học viên
      </Link>
    </>
  );
}
export function Offerings() {
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
          <p className="eyebrow">GIẢNG VIÊN · TUYỂN SINH &amp; DOANH THU</p>
          <h1>Đợt Mở Bán Của Bạn (Offerings)</h1>
          <p className="lead">
            Quản lý đợt mở bán, phân quyền truy cập học tập và cấu hình mức học phí theo từng khóa học.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link className="button" to="/app/teaching/offerings/new" style={{ textDecoration: "none" }}>
            <Icon name="plus" size={16} />
            <span>Tạo đợt mở bán mới</span>
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
            <span className="kpi-tag accent">Đang quản lý</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={offeringsList.length} suffix=" Đợt" />
          </div>
          <div className="kpi-label">Tổng số đợt mở bán</div>
          <p className="kpi-subtext">Học kỳ 1 - 2026</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="card" size={20} />
            </span>
            <span className="kpi-tag accent">Doanh thu</span>
          </div>
          <div className="kpi-value">—</div>
          <div className="kpi-label">Dòng tiền đối soát</div>
          <p className="kpi-subtext">Chờ projection thanh toán và hoàn tiền</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="users" size={20} />
            </span>
            <span className="kpi-tag accent">Tuyển sinh</span>
          </div>
          <div className="kpi-value">—</div>
          <div className="kpi-label">Đã thanh toán &amp; kích hoạt</div>
          <p className="kpi-subtext">Chờ dữ liệu tuyển sinh có thẩm quyền</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="sparkles" size={20} />
            </span>
            <span className="kpi-tag">Trực tuyến</span>
          </div>
          <div className="kpi-value">Hoạt động</div>
          <div className="kpi-label">Trạng thái cổng tuyển sinh</div>
          <p className="kpi-subtext">Sẵn sàng nhận học viên mới</p>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="teaching-search-filter-box">
        <span style={{ color: "var(--muted, #64748b)", display: "inline-flex" }} aria-hidden="true">
          <Icon name="search" size={16} />
        </span>
        <input
          type="search"
          placeholder="Tìm kiếm đợt mở bán theo tên..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Tìm kiếm đợt mở bán"
        />
        {search && (
          <button
            type="button"
            className="plain-button"
            style={{ fontSize: 13, color: "var(--muted, #64748b)" }}
            onClick={() => setSearch("")}
          >
            ✕ Xóa tìm kiếm
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
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted, #64748b)" }}>Hình thức:</span>
          <button
            type="button"
            className={`catalog-filter-pill ${typeFilter === "ALL" ? "active" : ""}`}
            onClick={() => setTypeFilter("ALL")}
            style={{ fontSize: 12, padding: "5px 12px", textDecoration: "none" }}
          >
            Tất cả ({offeringsList.length})
          </button>
          <button
            type="button"
            className={`catalog-filter-pill ${typeFilter === "SELF_PACED" ? "active" : ""}`}
            onClick={() => setTypeFilter("SELF_PACED")}
            style={{ fontSize: 12, padding: "5px 12px", textDecoration: "none" }}
          >
            Tự học theo tiến độ (Self-paced)
          </button>
          <button
            type="button"
            className={`catalog-filter-pill ${typeFilter === "LIVE_COHORT" ? "active" : ""}`}
            onClick={() => setTypeFilter("LIVE_COHORT")}
            style={{ fontSize: 12, padding: "5px 12px", textDecoration: "none" }}
          >
            Học theo lớp trực tiếp (Live Cohort)
          </button>
        </div>

        {/* View Mode Toggle: List vs Grid */}
        <div
          role="group"
          aria-label="Chế độ hiển thị"
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
            title="Dạng danh sách (List View)"
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
            <span>Danh sách</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            title="Dạng lưới thẻ (Grid View)"
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
            <span>Dạng lưới</span>
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
                <h3>Không tìm thấy đợt mở bán phù hợp</h3>
                <p>Thử điều chỉnh bộ lọc hoặc tạo mới đợt mở bán để bắt đầu nhận ghi danh từ học viên.</p>
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <button
                    type="button"
                    className="button button-subtle"
                    onClick={() => {
                      setTypeFilter("ALL");
                      setSearch("");
                    }}
                  >
                    Xóa bộ lọc
                  </button>
                  <Link
                    className="button"
                    to="/app/teaching/offerings/new"
                    style={{ textDecoration: "none" }}
                  >
                    + Tạo đợt mở bán mới
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
                      <th style={{ textAlign: "left" }}>Tên đợt mở bán</th>
                      <th style={{ width: 220, textAlign: "left" }}>Hình thức</th>
                      <th style={{ width: 170, textAlign: "left" }}>Mức học phí</th>
                      <th style={{ width: 130, textAlign: "center" }}>Trạng thái</th>
                      <th style={{ width: 190, textAlign: "right" }}>Thao tác</th>
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
                                  Mã đợt: <code style={{ fontSize: 11 }}>{x.offeringId.slice(0, 14)}</code>
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
                              <span>{isSelfPaced ? "Tự học (Self-paced)" : "Lớp học (Live Cohort)"}</span>
                            </span>
                          </td>
                          <td>
                            {isFree ? (
                              <span style={{ fontWeight: 700, color: "#16a34a", fontSize: 13.5 }}>
                                Miễn phí (0 ₫)
                              </span>
                            ) : (
                              <span style={{ fontWeight: 700, color: "var(--ink)", fontSize: 14 }}>
                                {Number(x.price).toLocaleString("vi-VN")}{" "}
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
                              Mở chi tiết đợt bán →
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
                      {x.offeringType === "SELF_PACED" ? "Tự học theo tiến độ" : "Học theo lớp"} ·{" "}
                      <strong style={{ color: "var(--blue, #0284c7)" }}>
                        {Number(x.price).toLocaleString("vi-VN")} {x.currency}
                      </strong>
                    </p>
                  </div>
                  <Link
                    className="button button-small"
                    to={`/app/teaching/offerings/${x.offeringId}`}
                    style={{ textDecoration: "none", textAlign: "center", marginTop: 14 }}
                  >
                    Mở chi tiết đợt bán →
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
  const nav = useNavigate();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", paddingBottom: 40 }}>
      <Breadcrumbs
        items={[
          { label: "Giảng dạy", to: "/app/teaching" },
          { label: "Đợt mở bán", to: "/app/teaching/offerings" },
          { label: "Tạo đợt mở bán mới" },
        ]}
      />
      <p className="eyebrow" style={{ marginTop: 12 }}>
        TUYỂN SINH &amp; DOANH THU · TẠO MỚI
      </p>
      <h1>Tạo đợt mở bán mới.</h1>
      <p className="lead">
        Cấu hình đợt tuyển sinh, thiết lập học phí và liên kết khóa học hoặc lớp học phần để cấp quyền học
        viên.
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
          <span>{msg}</span>
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
        <h2>Thông tin đợt mở bán</h2>
        <CatalogCourseSelect label="Khóa học áp dụng" name="courseId" required />
        <p className="subtext" style={{ marginTop: -8, marginBottom: 8 }}>
          Catalog khóa học đã xuất bản. Quyền sử dụng được kiểm tra khi gửi.
        </p>
        <label>
          Hình thức đào tạo
          <select name="offeringType">
            <option value="SELF_PACED">Tự học theo tiến độ (Self-paced)</option>
            <option value="LIVE_COHORT">Học theo lớp trực tiếp (Live Cohort)</option>
          </select>
        </label>
        <Field
          label="Mã lớp liên kết (khi học theo lớp)"
          name="classId"
          placeholder="Mã lớp học phần nếu có"
        />
        <Field
          label="Tên đợt mở bán"
          name="title"
          placeholder="Ví dụ: Đợt tuyển sinh Khóa 2026 - Nhóm 1"
          required
        />
        <Field label="Học phí" name="price" type="number" defaultValue="0" min={0} required />
        <Field label="Tiền tệ" name="currency" defaultValue="VND" required />
        <RevenueQuote />
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
          <button className="button" disabled={busy}>
            {busy ? "Đang tạo…" : "Tạo đợt mở bán"}
          </button>
          <Link className="button button-subtle" to="/app/teaching/offerings">
            Hủy &amp; Quay lại
          </Link>
        </div>
      </form>
    </div>
  );
}
export function OfferingDetail() {
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
                ? "Đợt mở đăng ký đang ở bản nháp."
                : x.state === "PUBLISHED"
                  ? "Học viên có thể nhận quyền truy cập theo quy tắc và thời gian của đợt mở đăng ký."
                  : "Đợt mở đăng ký đã đóng."}
            </p>
            {x.offeringType === "LIVE_COHORT" &&
              (x.classId ? (
                <Link to={`/app/teaching/classes/${x.classId}`}>Mở lớp gắn với đợt này →</Link>
              ) : (
                <p>
                  Cần chọn một lớp có lịch đã xuất bản. <Link to="/app/teaching/classes">Tạo lớp →</Link>
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
              <Field label="Tên offering" name="title" defaultValue={x.title} required />
              <Field label="Giá" name="price" defaultValue={x.price} required />
              <Field label="Tiền tệ" name="currency" defaultValue={x.currency} required />
              <RevenueQuote initialPrice={x.price} initialCurrency={x.currency} />
              <button className="button">Lưu offering</button>
            </form>
            <button
              className="button"
              onClick={async () => {
                try {
                  if (!window.confirm("Mở đăng ký offering này theo điều kiện hiện tại?")) return;
                  await lecturerRequest(`/offerings/${offeringId}/publish`, "POST", {});
                  setMsg("Đã xuất bản offering.");
                  q.retry();
                } catch (y) {
                  setMsg(lecturerError(y));
                }
              }}
            >
              Xuất bản offering
            </button>
          </>
        )}
      </State>
      <p role="status">{msg}</p>
    </>
  );
}

export { LecturerProfilePage } from "./ProfileEditor";
