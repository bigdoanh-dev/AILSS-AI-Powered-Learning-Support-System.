import { CourseArtwork } from "../components/CourseArtwork";
import { CourseSearch } from "../pages/Courses";
import { useState, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "../auth/session";
import {
  useStudent,
  useCommand,
  safeContentUrl,
  monthNow,
  type LearningCourse,
  type Lesson,
  type Progress,
  type Notices,
  type Quiz,
} from "./api";
import { Heading, State, Empty, ProgressView, Status } from "./ui";
import Discussion from "./Discussion";
import { Icon } from "../components/Icon";
import ProgressDashboard from "./ProgressDashboard";
import { useLearningOverview } from "./overview";
import { MediaPlayer } from "./MediaPlayer";

interface MarketplaceCourse {
  courseId: string;
  title: string;
  categoryName: string;
  categoryId: string;
  lecturerName: string;
  rating: number;
  reviewCount: number;
  price: string;
  priceType: "FREE" | "PAID";
  originalPrice?: string;
  durationHours: string;
  lessonsCount: number;
  level: string;
  highlights: string[];
}

interface MarketplaceOffering {
  offeringId: string;
  courseId: string;
  title: string;
  offeringType: "SELF_PACED" | "LIVE_COHORT";
  price: string;
  currency: string;
  state: string;
}

function marketplaceCoursesFrom(offerings?: MarketplaceOffering[]): MarketplaceCourse[] {
  const byCourse = new Map<string, MarketplaceCourse>();
  for (const offering of Array.isArray(offerings) ? offerings : []) {
    if (offering.state !== "PUBLISHED" || byCourse.has(offering.courseId)) continue;
    const amount = Number(offering.price);
    byCourse.set(offering.courseId, {
      courseId: offering.courseId,
      title: offering.title,
      categoryName: "Danh mục giảng viên",
      categoryId: "backend",
      lecturerName: "Giảng viên AILSS",
      rating: 0,
      reviewCount: 0,
      price: amount > 0 ? `${amount.toLocaleString("vi-VN")} ₫` : "Miễn phí",
      priceType: amount > 0 ? "PAID" : "FREE",
      durationHours: "Theo lộ trình",
      lessonsCount: 0,
      level: offering.offeringType === "SELF_PACED" ? "Tự học" : "Lớp trực tuyến",
      highlights: ["Dữ liệu mở bán từ backend", "Quyền học được kích hoạt sau thanh toán"],
    });
  }
  return [...byCourse.values()];
}

function MarketplaceCourseCard({ course: c, owned }: { course: MarketplaceCourse; owned: boolean }) {
  return (
    <article className="marketplace-course-card learning-card">
      <div className="learning-card-media">
        <CourseArtwork title={c.title} categoryId={c.categoryId} />
        <span className="learning-card-type">
          <Icon name="book" size={14} /> {c.level}
        </span>
      </div>
      <div className="learning-card-content">
        <div className="learning-card-heading-row">
          <span className="course-category-chip">{c.categoryName}</span>
          <span className="learning-card-rating">
            <Icon name="starFilled" size={14} /> <strong>{c.reviewCount ? c.rating : "Xem đánh giá"}</strong>
            {c.reviewCount ? ` (${c.reviewCount})` : ""}
          </span>
        </div>
        <h3>{c.title}</h3>
        <p className="learning-card-meta">
          <Icon name="user" size={14} /> {c.lecturerName} <span>•</span> {c.durationHours} <span>•</span>{" "}
          {c.lessonsCount ? `${c.lessonsCount} bài` : "Xem nội dung khóa học"}
        </p>
        <ul className="course-benefits" aria-label="Nội dung nổi bật">
          {c.highlights.map((highlight) => (
            <li key={highlight}>✓ {highlight}</li>
          ))}
        </ul>
        <div className="course-card-divider" />
        <div className="course-price-row">
          <strong className={`course-sale-price ${c.priceType === "FREE" ? "free" : ""}`}>{c.price}</strong>
          {c.originalPrice && <del>{c.originalPrice}</del>}
          {owned && <span className="status-pill status-success">✓ Đã sở hữu</span>}
        </div>
        <div className="course-card-actions">
          <Link className="learning-card-button secondary" to={"/courses/" + c.courseId}>
            <Icon name="eye" size={15} /> Chi tiết
          </Link>
          <Link
            className="learning-card-button primary"
            to={
              owned
                ? "/app/learn/" + c.courseId
                : c.priceType === "PAID"
                  ? "/app/purchase/" + c.courseId
                  : "/app/learn/" + c.courseId
            }
          >
            <Icon name={owned || c.priceType === "FREE" ? "book" : "card"} size={15} />
            {owned ? "Tiếp tục học" : c.priceType === "PAID" ? "Mua ngay" : "Bắt đầu học"}
          </Link>
        </div>
      </div>
    </article>
  );
}

function CourseMarketplaceSearch({
  ownedCourseIds = [],
  onlyUnenrolled = false,
}: {
  ownedCourseIds?: string[];
  onlyUnenrolled?: boolean;
}) {
  const offerings = useStudent<MarketplaceOffering[]>("/offerings?type=SELF_PACED&limit=50");
  const marketplaceCourses = useMemo(() => marketplaceCoursesFrom(offerings.data), [offerings.data]);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [priceFilter, setPriceFilter] = useState<"ALL" | "PAID" | "FREE">("ALL");
  const [hideOwned, setHideOwned] = useState(onlyUnenrolled);

  const filteredCourses = marketplaceCourses.filter((course) => {
    const isOwned = ownedCourseIds.includes(course.courseId);
    if ((onlyUnenrolled || hideOwned) && isOwned) return false;

    const term = searchTerm.trim().toLowerCase();
    const matchesSearch =
      !term ||
      course.title.toLowerCase().includes(term) ||
      course.categoryName.toLowerCase().includes(term) ||
      course.lecturerName.toLowerCase().includes(term) ||
      course.highlights.some((h) => h.toLowerCase().includes(term));

    let matchesCategory = true;
    if (categoryFilter === "AI") matchesCategory = course.categoryName.includes("nhân tạo");
    else if (categoryFilter === "DB") matchesCategory = course.categoryName.includes("dữ liệu");
    else if (categoryFilter === "WEB") matchesCategory = course.categoryName.includes("Web");
    else if (categoryFilter === "DEVOPS")
      matchesCategory = course.categoryName.includes("DevOps") || course.categoryName.includes("Testing");

    const matchesPrice =
      priceFilter === "ALL" ||
      (priceFilter === "PAID" && course.priceType === "PAID") ||
      (priceFilter === "FREE" && course.priceType === "FREE");

    return matchesSearch && matchesCategory && matchesPrice;
  });

  return (
    <section
      id="marketplace-search"
      className="dashboard-section-card marketplace-search-card"
      style={{
        marginTop: 20,
        marginBottom: 24,
        padding: "24px",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="kpi-tag accent" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="sparkles" size={14} /> Khám Phá &amp; Đăng Ký Mua Khóa Học
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Thanh toán VietQR tự động 24/7</span>
          </div>
          <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700, color: "var(--ink)" }}>
            {onlyUnenrolled
              ? "Danh Mục Khóa Học Chưa Đăng Ký (Mở Bán)"
              : "Tìm Kiếm Khóa Học Để Mua & Kích Hoạt Ngay"}
          </h2>
          <p className="subtext" style={{ margin: "4px 0 0 0", fontSize: 13.5 }}>
            {onlyUnenrolled
              ? "Danh sách khóa học chưa kích hoạt trong tài khoản của bạn. Chọn khóa học để mua và kích hoạt ngay."
              : "Tìm kiếm theo tên khóa học, giảng viên hoặc kỹ năng công nghệ cần học."}
          </p>
        </div>
        <Link to="/courses" className="button button-subtle button-small" style={{ fontSize: 13 }}>
          Xem toàn bộ khóa học ↗
        </Link>
      </div>

      {/* Search bar */}
      <div
        className="marketplace-search-bar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--surface-soft)",
          border: "1.5px solid var(--line)",
          borderRadius: 12,
          padding: "8px 14px",
          marginBottom: 16,
        }}
      >
        <span style={{ color: "var(--muted)", display: "flex", alignItems: "center" }}>
          <Icon name="search" size={20} />
        </span>
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Tìm kiếm khóa học để mua (ví dụ: Trí tuệ nhân tạo, Web AI, Cơ sở dữ liệu, DevOps, Python...)"
          aria-label="Tìm kiếm khóa học để mua"
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: "15px",
            color: "var(--ink)",
          }}
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm("")}
            className="button button-subtle button-small"
            style={{ padding: "2px 8px", fontSize: 12, borderRadius: 6 }}
            aria-label="Xóa từ khóa tìm kiếm"
          >
            ✕ Xóa
          </button>
        )}
      </div>

      {/* Filter pills row */}
      <div
        className="marketplace-filter-pills"
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 18,
        }}
        role="group"
        aria-label="Bộ lọc khóa học"
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", marginRight: 4 }}>
          Lọc theo:
        </span>
        <button
          type="button"
          className={`filter-pill-button ${categoryFilter === "ALL" && priceFilter === "ALL" ? "active" : ""}`}
          onClick={() => {
            setCategoryFilter("ALL");
            setPriceFilter("ALL");
          }}
        >
          Tất cả
        </button>
        <button
          type="button"
          className={`filter-pill-button ${priceFilter === "PAID" ? "active" : ""}`}
          onClick={() => {
            setPriceFilter(priceFilter === "PAID" ? "ALL" : "PAID");
          }}
        >
          💳 Khóa có phí (Mua ngay)
        </button>
        <button
          type="button"
          className={`filter-pill-button ${priceFilter === "FREE" ? "active" : ""}`}
          onClick={() => {
            setPriceFilter(priceFilter === "FREE" ? "ALL" : "FREE");
          }}
        >
          🚀 Miễn phí
        </button>
        <button
          type="button"
          className={`filter-pill-button ${hideOwned ? "active" : ""}`}
          onClick={() => setHideOwned(!hideOwned)}
        >
          🛒 Khóa chưa đăng ký (
          {marketplaceCourses.filter((c) => !ownedCourseIds.includes(c.courseId)).length})
        </button>
        <span style={{ color: "var(--line)" }}>|</span>
        <button
          type="button"
          className={`filter-pill-button ${categoryFilter === "AI" ? "active" : ""}`}
          onClick={() => setCategoryFilter(categoryFilter === "AI" ? "ALL" : "AI")}
        >
          🤖 Trí tuệ nhân tạo (AI)
        </button>
        <button
          type="button"
          className={`filter-pill-button ${categoryFilter === "DB" ? "active" : ""}`}
          onClick={() => setCategoryFilter(categoryFilter === "DB" ? "ALL" : "DB")}
        >
          🗄️ Cơ sở dữ liệu
        </button>
        <button
          type="button"
          className={`filter-pill-button ${categoryFilter === "WEB" ? "active" : ""}`}
          onClick={() => setCategoryFilter(categoryFilter === "WEB" ? "ALL" : "WEB")}
        >
          🌐 Lập trình Web
        </button>
        <button
          type="button"
          className={`filter-pill-button ${categoryFilter === "DEVOPS" ? "active" : ""}`}
          onClick={() => setCategoryFilter(categoryFilter === "DEVOPS" ? "ALL" : "DEVOPS")}
        >
          ☁️ DevOps &amp; Testing
        </button>
      </div>

      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}
      >
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          Tìm thấy <strong>{filteredCourses.length}</strong> khóa học
          {searchTerm ? ` cho từ khóa "${searchTerm}"` : ""}
        </span>
      </div>

      {/* Grid Results */}
      {offerings.pending ? (
        <div className="study-state" role="status">
          Đang tải các gói học được mở bán từ backend…
        </div>
      ) : filteredCourses.length > 0 ? (
        <div
          className="marketplace-courses-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
            gap: 16,
          }}
        >
          {filteredCourses.map((course) => (
            <MarketplaceCourseCard
              key={course.courseId}
              course={course}
              owned={ownedCourseIds.includes(course.courseId)}
            />
          ))}
        </div>
      ) : (
        <div
          style={{
            textAlign: "center",
            padding: "36px 16px",
            background: "var(--surface-soft)",
            borderRadius: 12,
            border: "1px dashed var(--line)",
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px 0", color: "var(--ink)" }}>
            Không tìm thấy khóa học nào phù hợp
          </p>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 16px 0" }}>
            Thử tìm kiếm với từ khóa khác như "AI", "Web", "CSDL", "DevOps" hoặc bỏ chọn bộ lọc.
          </p>
          <button
            type="button"
            className="button button-subtle button-small"
            onClick={() => {
              setSearchTerm("");
              setCategoryFilter("ALL");
              setPriceFilter("ALL");
            }}
          >
            ↺ Đặt lại bộ lọc &amp; tìm kiếm
          </button>
        </div>
      )}
    </section>
  );
}

export function StudentHome() {
  const { profile } = useSession();
  const { courses, classes, progress } = useLearningOverview();
  const notices = useStudent<Notices>("/notifications?month=" + monthNow() + "&limit=3");
  const first = courses.data?.[0];
  const completedLessons = progress.data?.reduce((sum, value) => sum + value.completedCount, 0);
  const average = progress.data?.length
    ? Math.round(progress.data.reduce((sum, value) => sum + value.percent, 0) / progress.data.length)
    : progress.data
      ? 0
      : undefined;
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">KHÔNG GIAN HỌC TẬP</p>
          <h1>Chào {profile?.displayName}, hôm nay học gì?</h1>
          <p>Tiếp tục hành trình học tập và khám phá những điều mới mỗi ngày.</p>
        </div>
        <Link className="button secondary small" to="/app/learn">
          Khóa học của tôi
        </Link>
      </div>
      <div className="workspace-kpi-grid">
        {[
          {
            label: "Khóa học đã đăng ký",
            value: courses.data?.length,
            suffix: " khóa",
            icon: "book" as const,
          },
          {
            label: "Lớp học đã tham gia",
            value: classes.data?.length,
            suffix: " lớp",
            icon: "users" as const,
          },
          {
            label: "Bài học đã hoàn thành",
            value: completedLessons,
            suffix: " bài",
            icon: "checkCircle" as const,
          },
          { label: "Tiến độ trung bình khóa học", value: average, suffix: "%", icon: "chart" as const },
        ].map((item) => (
          <div className="kpi-card" key={item.label}>
            <div className="kpi-header">
              <span className="kpi-icon">
                <Icon name={item.icon} size={20} />
              </span>
            </div>
            <div className="kpi-value">{item.value === undefined ? "—" : `${item.value}${item.suffix}`}</div>
            <div className="kpi-label">{item.label}</div>
          </div>
        ))}
      </div>
      <div className="workspace-quick-actions" role="toolbar" aria-label="Thao tác học tập nhanh">
        <Link className="quick-action-chip" to={first ? `/app/learn/${first.courseId}` : "/courses"}>
          {first ? "Tiếp tục học" : "Khám phá khóa học"}
        </Link>
        <button
          className="quick-action-chip"
          onClick={() =>
            document.getElementById("marketplace-search")?.scrollIntoView({ behavior: "smooth" })
          }
        >
          Tìm khóa học để mua
        </button>
        <Link className="quick-action-chip" to="/app/classes">
          Lớp học của tôi
        </Link>
        <Link className="quick-action-chip" to="/app/schedule">
          Lịch học
        </Link>
        <Link className="quick-action-chip" to="/app/assessments">
          Bài tập &amp; Kiểm tra
        </Link>
        <Link className="quick-action-chip" to="/app/ai-tutor">
          Gia sư AI
        </Link>
        <Link className="quick-action-chip" to="/app/notifications">
          Thông báo {notices.data ? `(${notices.data.items.length})` : ""}
        </Link>
      </div>
      <State query={courses}>
        <section className="dashboard-section-card continue-learning-section">
          <div className="section-card-header">
            <div>
              <p className="eyebrow">TIẾN ĐỘ ĐÀO TẠO</p>
              <h2>{first ? "Tiếp tục học" : "Bắt đầu hành trình học tập"}</h2>
            </div>
            {courses.data?.length ? (
              <span className="kpi-tag accent">{courses.data.length} khóa đang theo học</span>
            ) : null}
          </div>
          {first ? (
            <CourseCards items={courses.data ?? []} />
          ) : (
            <Empty>
              Bạn chưa đăng ký khóa học nào. Chọn khóa học hoặc nhập mã lớp do giảng viên cung cấp để bắt đầu.
            </Empty>
          )}
        </section>
      </State>
      <State query={classes}>
        <section className="dashboard-section-card">
          <div className="section-card-header">
            <div>
              <p className="eyebrow">KHÔNG GIAN LỚP HỌC</p>
              <h2>Lớp học của tôi</h2>
            </div>
            {classes.data?.length ? (
              <span className="kpi-tag accent">{classes.data.length} lớp đang tham gia</span>
            ) : null}
          </div>
          {classes.data?.length ? (
            <div className="home-classes-grid">
              {classes.data.map((item) => (
                <div key={item.classId} className="home-class-tile">
                  <div className="home-class-icon">
                    <Icon name="class" size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ margin: "0 0 4px", fontSize: "15px", fontWeight: 700 }}>{item.name}</h4>
                    <span className="badge">Lớp học trực tiếp</span>
                  </div>
                  <Link className="button button-subtle button-small" to={`/app/classes/${item.classId}`}>
                    Vào lớp →
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Bạn chưa tham gia lớp học nào.</Empty>
          )}
        </section>
      </State>
      {!!progress.error && (
        <State query={{ ...progress, pending: false }}>
          <span />
        </State>
      )}
      <CourseMarketplaceSearch ownedCourseIds={(courses.data ?? []).map((c) => c.courseId)} />
      <State query={notices}>
        <section className="dashboard-section-card">
          <h2>Thông báo gần đây</h2>
          {notices.data?.items.length ? (
            notices.data.items.map((item) => (
              <article key={item.notificationId}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))
          ) : (
            <Empty>Chưa có thông báo.</Empty>
          )}
        </section>
      </State>
    </>
  );
}

export function Learn() {
  const own = useStudent<LearningCourse[]>("/me/courses");
  const offeringCatalog = useStudent<MarketplaceOffering[]>("/offerings?type=SELF_PACED&limit=50");
  const [activeTab, setActiveTab] = useState<"ALL" | "OWNED" | "UNENROLLED">("ALL");
  const ownedIds = own.data?.map((c) => c.courseId) || [];
  const marketplaceCourses = useMemo(
    () => marketplaceCoursesFrom(offeringCatalog.data),
    [offeringCatalog.data],
  );
  const unenrolledMarketplace = marketplaceCourses.filter((c) => !ownedIds.includes(c.courseId));

  return (
    <>
      <Heading title="Khóa học AILSS">
        Quản lý các khóa học đã đăng ký và khám phá danh mục khóa học để đăng ký mua trực tuyến tiện lợi, an
        toàn.
      </Heading>

      <div
        className="course-hub-segmented-bar"
        style={{
          display: "flex",
          gap: "10px",
          marginBottom: "24px",
          flexWrap: "wrap",
        }}
        role="tablist"
        aria-label="Phân loại khóa học"
      >
        <button
          type="button"
          className={`filter-pill-button ${activeTab === "ALL" ? "active" : ""}`}
          onClick={() => setActiveTab("ALL")}
          style={{ padding: "9px 18px", fontSize: "14px", fontWeight: 700 }}
        >
          ⚡ Tất cả khóa học ({marketplaceCourses.length})
        </button>
        <button
          type="button"
          className={`filter-pill-button ${activeTab === "OWNED" ? "active" : ""}`}
          onClick={() => setActiveTab("OWNED")}
          style={{ padding: "9px 18px", fontSize: "14px", fontWeight: 700 }}
        >
          🎓 Khóa học đã đăng ký ({own.data?.length || 0})
        </button>
        <button
          type="button"
          className={`filter-pill-button ${activeTab === "UNENROLLED" ? "active" : ""}`}
          onClick={() => setActiveTab("UNENROLLED")}
          style={{ padding: "9px 18px", fontSize: "14px", fontWeight: 700 }}
        >
          🛒 Khóa học chưa đăng ký để mua ({unenrolledMarketplace.length})
        </button>
      </div>

      {(activeTab === "ALL" || activeTab === "OWNED") && (
        <section className="study-card course-hub-owned" id="my-courses" style={{ marginBottom: "30px" }}>
          <div className="course-hub-section-heading">
            <div>
              <p className="eyebrow">KHÔNG GIAN HỌC TẬP</p>
              <h2>Khóa học của tôi (Đã đăng ký)</h2>
            </div>
            <span className="kpi-tag accent">{own.data?.length || 0} khóa học đang học</span>
          </div>
          <State query={own}>
            {own.data?.length ? (
              <CourseCards items={own.data} />
            ) : (
              <Empty>
                Bạn chưa đăng ký khóa học nào. Hãy khám phá và mua khóa học bên dưới để bắt đầu học ngay.
              </Empty>
            )}
          </State>
        </section>
      )}

      {(activeTab === "ALL" || activeTab === "UNENROLLED") && (
        <CourseMarketplaceSearch ownedCourseIds={ownedIds} onlyUnenrolled={activeTab === "UNENROLLED"} />
      )}

      {activeTab === "ALL" && (
        <section className="course-hub-catalog" id="course-catalog">
          <div className="course-hub-section-heading">
            <div>
              <p className="eyebrow">DANH MỤC AILSS</p>
              <h2>Tìm kiếm &amp; Khám phá khóa học</h2>
            </div>
            <span>Tìm kiếm, xem chi tiết và đăng ký ngay</span>
          </div>
          <CourseSearch />
        </section>
      )}
    </>
  );
}
function OwnedCourseCard({ course, index = 0 }: { course: LearningCourse; index?: number }) {
  const progress = useStudent<Progress>(`/courses/${course.courseId}/progress`);
  const isCompleted = progress.data && progress.data.percent >= 100;
  return (
    <article
      className={`learning-card owned-learning-card ${isCompleted ? "is-completed" : ""}`}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="learning-card-media">
        <CourseArtwork title={course.title} />
        <span className="learning-card-type">{course.priceType === "FREE" ? "Miễn phí" : "Đã đăng ký"}</span>
        {isCompleted && (
          <span className="learning-card-completed-badge">
            <Icon name="checkCircle" size={13} />
            <span>Đã hoàn thành</span>
          </span>
        )}
      </div>
      <div className="learning-card-content">
        <h3 title={course.title}>{course.title}</h3>
        <State query={progress}>{progress.data && <ProgressView value={progress.data} />}</State>
        <div className="learning-card-action-bar">
          <Link
            className="learning-card-button primary continue-learning-btn"
            to={`/app/learn/${course.courseId}`}
          >
            <span>Tiếp tục học</span>
            <span className="continue-btn-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </div>
      </div>
    </article>
  );
}
function CourseCards({ items }: { items: LearningCourse[] }) {
  return (
    <div className="learning-grid">
      {items.map((course, idx) => (
        <OwnedCourseCard key={course.courseId} course={course} index={idx} />
      ))}
    </div>
  );
}

export function CourseLearning() {
  const navigate = useNavigate();
  const { courseId = "", lessonId } = useParams();
  const [lessonSearch, setLessonSearch] = useState("");
  const [courseTab, setCourseTab] = useState<"lessons" | "exercises">("lessons");
  const course = useStudent<LearningCourse>("/me/courses/" + courseId),
    lessons = useStudent<Lesson[]>("/courses/" + courseId + "/lessons"),
    progress = useStudent<Progress>("/courses/" + courseId + "/progress"),
    courseQuizzes = useStudent<Quiz[]>(
      courseTab === "exercises" ? "/targets/COURSE/" + courseId + "/quizzes" : null,
    );
  const command = useCommand();
  return (
    <>
      <Link to="/app/learn">← Học tập</Link>
      <Heading title={course.data?.title || "Khóa học của bạn"} />

      <div
        className="module-segmented-bar"
        role="tablist"
        aria-label="Phân hệ khóa học"
        style={{ marginBottom: "20px" }}
      >
        <button
          type="button"
          className={`segmented-tab ${courseTab === "lessons" ? "active" : ""}`}
          onClick={() => setCourseTab("lessons")}
        >
          <span>📖 Phần Học (Lý thuyết & Bài giảng)</span>
        </button>
        <button
          type="button"
          className={`segmented-tab ${courseTab === "exercises" ? "active" : ""}`}
          onClick={() => setCourseTab("exercises")}
        >
          <span>📝 Phần Bài Tập & Đánh Giá</span>
          <span className="red-badge-dot" title="Có bài tập chưa nộp" />
        </button>
      </div>

      <State query={course}>
        {course.data && (
          <>
            {courseTab === "lessons" ? (
              <>
                <div className="study-grid">
                  <section className="study-card">
                    <h2>Tiến độ học tập</h2>
                    <State query={progress}>{progress.data && <ProgressView value={progress.data} />}</State>
                    {!progress.data && course.data.priceType === "FREE" && (
                      <>
                        <button
                          className="button"
                          disabled={command.busy}
                          onClick={async () => {
                            if (await command.run("/courses/" + courseId + "/enrollments", "POST")) {
                              navigate("/app/result", {
                                state: {
                                  success: true,
                                  title: "Đăng ký khóa học thành công",
                                  message: "Khóa học miễn phí đã được thêm vào tài khoản của bạn.",
                                  to: "/app/learn/" + courseId,
                                  label: "Bắt đầu học",
                                },
                              });
                            }
                          }}
                        >
                          Đăng ký học miễn phí
                        </button>
                        <Status command={command} />
                      </>
                    )}
                    {!progress.data && course.data.priceType === "PAID" && (
                      <Link className="button" to={"/app/purchase/" + courseId}>
                        Đăng ký khóa học có phí →
                      </Link>
                    )}
                    <Link to="/app/progress">Xem tiến độ</Link>
                  </section>
                  <section className="study-card">
                    <h2>Kiểm tra kiến thức</h2>
                    <p>Chọn bài kiểm tra của khóa học khi bạn đã sẵn sàng.</p>
                    <Link to={"/app/assessments?course=" + courseId}>Xem bài kiểm tra →</Link>
                  </section>
                </div>
                <div className="study-layout">
                  <aside className="study-card">
                    <details open>
                      <summary>Nội dung khóa học</summary>
                      <State query={lessons}>
                        {lessons.data?.length ? (
                          <div className="lesson-chapters">
                            <label>
                              Tìm bài trong khóa học
                              <input
                                type="search"
                                value={lessonSearch}
                                onChange={(e) => setLessonSearch(e.target.value)}
                                placeholder="Tên bài hoặc chương"
                              />
                            </label>
                            <small>{lessons.data.length} bài giảng</small>
                            {[...new Set(lessons.data.map((l) => l.sectionTitle || "Bài giảng"))].map(
                              (section, index) => {
                                const group = lessons.data!.filter(
                                  (l) =>
                                    (l.sectionTitle || "Bài giảng") === section &&
                                    (!lessonSearch ||
                                      (l.title + " " + section)
                                        .toLocaleLowerCase("vi")
                                        .includes(lessonSearch.toLocaleLowerCase("vi"))),
                                );
                                if (!group.length) return null;
                                return (
                                  <details
                                    key={section}
                                    open={
                                      !!lessonSearch ||
                                      index === 0 ||
                                      group.some((l) => l.lessonId === lessonId)
                                    }
                                  >
                                    <summary>
                                      {section} <small>({group.length})</small>
                                    </summary>
                                    <ol className="lesson-nav">
                                      {group.map((l) => (
                                        <li key={l.lessonId}>
                                          <Link
                                            aria-current={l.lessonId === lessonId ? "page" : undefined}
                                            to={`/app/learn/${courseId}/lessons/${l.lessonId}`}
                                          >
                                            {l.title}
                                          </Link>
                                          {l.preview && <small>Học thử</small>}
                                        </li>
                                      ))}
                                    </ol>
                                  </details>
                                );
                              },
                            )}
                          </div>
                        ) : (
                          <Empty>Khóa học chưa có bài học.</Empty>
                        )}
                      </State>
                    </details>
                  </aside>
                  <section className="study-card">
                    {lessonId ? (
                      <LessonView
                        key={lessonId}
                        lessonId={lessonId}
                        courseId={courseId}
                        refresh={progress.retry}
                      />
                    ) : (
                      <>
                        <h2>Chọn bài học để bắt đầu</h2>
                        <p>Mỗi bài học gồm nội dung giảng dạy hoặc tài liệu để bạn thực hành.</p>
                        {lessons.data?.[0] && (
                          <Link
                            className="button"
                            to={`/app/learn/${courseId}/lessons/${lessons.data[0].lessonId}`}
                          >
                            Mở bài đầu tiên →
                          </Link>
                        )}
                      </>
                    )}
                  </section>
                </div>
                <Discussion
                  type="COURSE"
                  id={courseId}
                  canWrite={!!progress.data}
                  canReview={!!progress.data && progress.data.percent >= 20}
                />
              </>
            ) : (
              <section className="dashboard-section-card" style={{ marginTop: "16px" }}>
                <div className="section-card-header">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <h2>Bài Tập &amp; Kiểm Tra Đánh Giá Của Khóa Học</h2>
                    {courseQuizzes.data && (
                      <span className="amber-badge-pill">● {courseQuizzes.data.length} đề bài</span>
                    )}
                  </div>
                  <Link to={"/app/assessments?course=" + courseId} className="button small">
                    Tất cả bài kiểm tra →
                  </Link>
                </div>

                <State query={courseQuizzes}>
                  {courseQuizzes.data && courseQuizzes.data.length > 0 ? (
                    <div className="home-card-list">
                      {courseQuizzes.data.map((q) => (
                        <div key={q.quizId} className="home-activity-card">
                          <div className="home-activity-card-top">
                            <span className="badge">{q.state === "PUBLISHED" ? "ĐANG MỞ" : q.state}</span>
                            <span className="amber-badge-pill">● {q.questionCount} câu hỏi</span>
                          </div>
                          <h3 className="home-activity-card-title">{q.title}</h3>
                          <div className="home-activity-card-meta">
                            <span>
                              ⏱️{" "}
                              {q.durationSeconds
                                ? `${Math.round(q.durationSeconds / 60)} phút`
                                : "Không giới hạn"}
                            </span>
                            <Link to={`/app/assessments/${q.quizId}`} className="button small">
                              Vào làm bài →
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty>Khóa học hiện chưa có bài tập hoặc bài kiểm tra nào.</Empty>
                  )}
                </State>
              </section>
            )}
          </>
        )}
      </State>
    </>
  );
}
function LessonView({
  lessonId,
  courseId,
  refresh,
}: {
  lessonId: string;
  courseId: string;
  refresh: () => void;
}) {
  const lesson = useStudent<Lesson>("/lessons/" + lessonId),
    command = useCommand();
  const [saved, setSaved] = useState<boolean | null>(null);
  const url = safeContentUrl(
    lesson.data?.contentUrl?.startsWith("/web-session/library/")
      ? new URL(lesson.data.contentUrl, window.location.origin).href
      : lesson.data?.contentUrl,
  );
  return (
    <State query={lesson}>
      {lesson.data && lesson.data.courseId !== courseId ? (
        <Empty>Bài học không thuộc khóa học này.</Empty>
      ) : (
        lesson.data && (
          <>
            <p className="eyebrow">BÀI HỌC</p>
            <h2>{lesson.data.title}</h2>
            {lesson.data.mediaAssetId ? (
              <MediaPlayer key={lessonId} lessonId={lessonId} title={lesson.data.title} />
            ) : lesson.data.externalVideo &&
              /^https:\/\/(drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/preview|www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]+)$/.test(
                lesson.data.externalVideo,
              ) ? (
              <div className="lesson-media">
                <iframe
                  className="lesson-document"
                  src={lesson.data.externalVideo}
                  title={lesson.data.title}
                  allow="fullscreen"
                  allowFullScreen
                />
                <p>
                  Video do giảng viên cung cấp. Nếu Google Drive yêu cầu quyền truy cập, mở video và đăng nhập
                  tài khoản được chia sẻ.
                </p>
                <a
                  className="button secondary"
                  href={lesson.data.externalVideo.replace("/preview", "/view")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Mở video gốc
                </a>
              </div>
            ) : url ? (
              <>
                {lesson.data.contentType?.startsWith("video/") ? (
                  <div className="lesson-media">
                    <video controls playsInline preload="metadata" src={url} aria-label={lesson.data.title}>
                      <p>Trình duyệt chưa hỗ trợ phát video. Hãy mở liên kết bài học bên dưới.</p>
                    </video>
                    <p>Dùng nút phát để bắt đầu. Bạn có thể tua và điều chỉnh tốc độ học.</p>
                  </div>
                ) : lesson.data.contentType === "application/pdf" ? (
                  <iframe className="lesson-document" src={url} title={lesson.data.title} />
                ) : (
                  <p>Mở tài liệu bài học để đọc và thực hành theo hướng dẫn.</p>
                )}
                <a
                  className="button secondary"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  Mở bài giảng trong tab mới ↗
                </a>
                <p className="muted">Nếu không mở được nội dung, hãy tải lại bài học.</p>
                <button className="plain-button" onClick={lesson.retry}>
                  Tải lại liên kết
                </button>
              </>
            ) : (
              <Empty>Bài học chưa có tài liệu đính kèm.</Empty>
            )}
            <div className="study-completion">
              <h3>Ghi nhận việc học</h3>
              <p>Đánh dấu khi bạn đã đọc và thực hành xong bài này.</p>
              <div className="inline-actions">
                {[true, false].map((completed) => (
                  <button
                    className={completed ? "button" : "button secondary"}
                    key={String(completed)}
                    disabled={command.busy}
                    onClick={async () => {
                      const result = await command.run<Progress>(
                        "/lessons/" + lessonId + "/completion",
                        "PUT",
                        { completed },
                      );
                      if (result) {
                        setSaved(completed);
                        refresh();
                      }
                    }}
                  >
                    {completed ? "Đánh dấu đã hoàn thành" : "Đánh dấu chưa hoàn thành"}
                  </button>
                ))}
              </div>
              {saved !== null && (
                <p role="status">
                  {saved ? "Đã lưu hoàn thành bài này." : "Đã lưu bài này chưa hoàn thành."}
                </p>
              )}
              <Status command={command} />
            </div>
          </>
        )
      )}
    </State>
  );
}

export function ProgressPage() {
  return <ProgressDashboard />;
}
