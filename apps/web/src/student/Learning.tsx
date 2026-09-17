import { CourseArtwork } from "../components/CourseArtwork";
import { CourseSearch } from "../pages/Courses";
import { useState } from "react";
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
  type ClassItem,
  type Notices,
} from "./api";
import { Heading, State, Empty, ProgressView, Status } from "./ui";
import Discussion from "./Discussion";
import { Icon } from "../components/Icon";
import ProgressDashboard from "./ProgressDashboard";

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

const MARKETPLACE_COURSES: MarketplaceCourse[] = [
  {
    courseId: "10000000-0000-4000-8000-000000000002",
    title: "Lập trình Web & Trợ lý AI Fullstack",
    categoryName: "Lập trình Web",
    categoryId: "web-ai",
    lecturerName: "ThS. Hoàng Quốc Bảo",
    rating: 4.9,
    reviewCount: 210,
    price: "590.000 ₫",
    originalPrice: "750.000 ₫",
    priceType: "PAID",
    durationHours: "34.0h",
    lessonsCount: 28,
    level: "Trung cấp",
    highlights: ["Trợ lý AI Copilot & Chatbot", "FastAPI, React 19 & LangChain", "Cấp chứng chỉ hoàn thành"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000001",
    title: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa truy vấn",
    categoryName: "Cơ sở dữ liệu",
    categoryId: "database",
    lecturerName: "TS. Nguyễn Minh Trí",
    rating: 4.8,
    reviewCount: 142,
    price: "490.000 ₫",
    originalPrice: "650.000 ₫",
    priceType: "PAID",
    durationHours: "21.5h",
    lessonsCount: 25,
    level: "Nâng cao",
    highlights: ["Tối ưu Sharding & Replication", "Đo lường chỉ mục EXPLAIN", "Thực hành DB 500k bản ghi"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000003",
    title: "DevOps CI/CD Pipeline & Kubernetes Thực chiến",
    categoryName: "DevOps & Testing",
    categoryId: "devops",
    lecturerName: "Kỹ sư Đặng Hải Nam",
    rating: 4.6,
    reviewCount: 96,
    price: "450.000 ₫",
    originalPrice: "550.000 ₫",
    priceType: "PAID",
    durationHours: "18.0h",
    lessonsCount: 20,
    level: "Chuyên sâu",
    highlights: ["GitHub Actions & ArgoCD", "Triển khai Kube Microservices", "Zero-downtime Rolling Update"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000004",
    title: "Kỹ thuật Prompt Engineering & Tinh chỉnh LLM Cơ bản",
    categoryName: "Trí tuệ nhân tạo",
    categoryId: "ai",
    lecturerName: "ThS. Đỗ Tuấn Kiệt",
    rating: 4.7,
    reviewCount: 88,
    price: "350.000 ₫",
    originalPrice: "490.000 ₫",
    priceType: "PAID",
    durationHours: "12.5h",
    lessonsCount: 15,
    level: "Nhập môn",
    highlights: ["Few-Shot & Chain-of-Thought", "Đánh giá RAG và LLM Testing", "Thực hành tương tác AI Tutor"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000005",
    title: "Nhập môn Kiểm thử Phần mềm & Automation Test",
    categoryName: "DevOps & Testing",
    categoryId: "testing",
    lecturerName: "ThS. Lê Thị Ánh Tuyết",
    rating: 4.6,
    reviewCount: 75,
    price: "Miễn phí",
    priceType: "FREE",
    durationHours: "9.5h",
    lessonsCount: 14,
    level: "Nhập môn",
    highlights: ["Unit Test với Vitest", "E2E Testing với Playwright", "Tự động hóa kiểm thử liên tục"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000006",
    title: "Python: Lập trình từ Nền tảng tới Hướng đối tượng",
    categoryName: "Lập trình Web",
    categoryId: "python",
    lecturerName: "ThS. Doanh Nguyễn",
    rating: 4.9,
    reviewCount: 318,
    price: "Miễn phí",
    priceType: "FREE",
    durationHours: "28.0h",
    lessonsCount: 32,
    level: "Cơ bản",
    highlights: ["100 bài tập code tự động", "Lập trình OOP chuyên sâu", "Học liệu video & slide bản quyền"],
  },
];

function MarketplaceCourseCard({ course: c, owned }: { course: MarketplaceCourse; owned: boolean }) {
  return (
    <article className="marketplace-course-card learning-card">
      <div className="learning-card-media">
        <CourseArtwork title={c.title} categoryId={c.categoryId} />
        <span className="learning-card-type"><Icon name="sparkles" size={14} /> AI hỗ trợ</span>
      </div>
      <div className="learning-card-content">
        <div className="learning-card-heading-row">
          <span className="course-category-chip">{c.categoryName}</span>
          <span className="learning-card-rating"><Icon name="starFilled" size={14} /> <strong>{c.rating}</strong> ({c.reviewCount})</span>
        </div>
        <h3>{c.title}</h3>
        <p className="learning-card-meta">
          <Icon name="user" size={14} /> {c.lecturerName} <span>•</span> {c.durationHours} <span>•</span> {c.lessonsCount} bài
        </p>
        <ul className="course-benefits" aria-label="Nội dung nổi bật">
          {c.highlights.map((highlight) => <li key={highlight}>✓ {highlight}</li>)}
        </ul>
        <div className="course-card-divider" />
        <div className="course-price-row">
          <strong className={`course-sale-price ${c.priceType === "FREE" ? "free" : ""}`}>{c.price}</strong>
          {c.originalPrice && <del>{c.originalPrice}</del>}
          {c.priceType === "PAID" && <span className="course-discount-chip">Ưu đãi</span>}
          {owned && <span className="status-pill status-success">✓ Đã sở hữu</span>}
        </div>
        <div className="course-card-actions">
          <Link className="learning-card-button secondary" to={"/courses/" + c.courseId}>
            <Icon name="eye" size={15} /> Chi tiết
          </Link>
          <Link
            className="learning-card-button primary"
            to={owned ? "/app/learn/" + c.courseId : c.priceType === "PAID" ? "/app/purchase/" + c.courseId : "/app/learn/" + c.courseId}
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
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [priceFilter, setPriceFilter] = useState<"ALL" | "PAID" | "FREE">("ALL");
  const [hideOwned, setHideOwned] = useState(onlyUnenrolled);

  const filteredCourses = MARKETPLACE_COURSES.filter((course) => {
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
          🛒 Khóa chưa đăng ký ({MARKETPLACE_COURSES.filter((c) => !ownedCourseIds.includes(c.courseId)).length})
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          Tìm thấy <strong>{filteredCourses.length}</strong> khóa học
          {searchTerm ? ` cho từ khóa "${searchTerm}"` : ""}
        </span>
      </div>

      {/* Grid Results */}
      {filteredCourses.length > 0 ? (
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
  const courses = useStudent<LearningCourse[]>("/me/courses"),
    classes = useStudent<ClassItem[]>("/me/classes"),
    notices = useStudent<Notices>("/notifications?month=" + monthNow() + "&limit=3");
  const first = courses.data?.[0];
  const coursesList = courses.data || [];
  const classesList = classes.data || [];
  const noticeCount = notices.data?.items?.length ?? 0;

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
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="trophy" size={20} />
            </span>
            <span className="kpi-tag accent">Thang 10 · Giỏi</span>
          </div>
          <div className="kpi-value">8.6 / 10</div>
          <div className="kpi-label">Điểm trung bình tích lũy (GPA)</div>
          <p className="kpi-subtext">Đạt chuẩn năng lực môn học</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="zap" size={20} />
            </span>
            <span className="kpi-tag accent">🔥 5 ngày liên tiếp</span>
          </div>
          <div className="kpi-value">5 ngày</div>
          <div className="kpi-label">Chuỗi học tập (Study Streak)</div>
          <p className="kpi-subtext">Mục tiêu cá nhân: 7 ngày / tuần</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="quiz" size={20} />
            </span>
            <span className="kpi-tag" style={{ color: "var(--danger, #DC2626)", fontWeight: 700 }}>Hạn 23:59 hôm nay</span>
          </div>
          <div className="kpi-value">2 bài tập</div>
          <div className="kpi-label">Bài tập & Đánh giá chờ nộp</div>
          <p className="kpi-subtext">Bài lớn CSDL & Lab Web AI</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="book" size={20} />
            </span>
            <span className="kpi-tag accent">Tiến độ 68%</span>
          </div>
          <div className="kpi-value">{courses.pending ? "…" : `${coursesList.length || 2} khóa`}</div>
          <div className="kpi-label">Khóa học & Lớp trực tuyến</div>
          <p className="kpi-subtext">{classesList.length || 2} lớp sinh hoạt học phần</p>
        </div>
      </div>

      <div className="workspace-quick-actions" role="toolbar" aria-label="Thao tác học tập nhanh">
        <a className="quick-action-chip" href="#marketplace-search">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="search" size={16} />
          </span>
          <span>🛒 Tìm khóa học để mua</span>
        </a>
        <Link className="quick-action-chip" to={first ? "/app/learn/" + first.courseId : "/courses"}>
          <span className="chip-icon" aria-hidden="true">
            <Icon name="zap" size={16} />
          </span>
          <span>{first ? "Tiếp tục bài học gần nhất" : "Khám phá khóa học"}</span>
        </Link>
        <Link className="quick-action-chip" to="/app/classes">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="calendar" size={16} />
          </span>
          <span>Lịch lớp học</span>
        </Link>
        <Link className="quick-action-chip" to="/app/assessments">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="quiz" size={16} />
          </span>
          <span>Bài tập & Kiểm tra</span>
          <span className="red-badge-dot" title="Có bài chưa nộp" />
        </Link>
        <Link className="quick-action-chip" to="/app/notifications">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="bell" size={16} />
          </span>
          <span>Thông báo ({noticeCount})</span>
        </Link>
      </div>

      {/* Course Marketplace Search */}
      <CourseMarketplaceSearch ownedCourseIds={coursesList.map((c) => c.courseId)} />

      <div className="student-dashboard">
        <div className="dashboard-primary">
          <State query={courses}>
            <article className="continue-course">
              <CourseArtwork title={first?.title || "Cơ sở dữ liệu"} eager />
              <div className="continue-course-content">
                <small>{first ? "Tiếp tục học" : "Bắt đầu hành trình"}</small>
                <h2>{first?.title || "Học từng bài. Tiến từng bước."}</h2>
                <p>
                  {first
                    ? "Bài giảng, học liệu và bài luyện tập của bạn."
                    : "Tìm một khóa học phù hợp để bắt đầu."}
                </p>
                <Link className="button" to={first ? "/app/learn/" + first.courseId : "/courses"}>
                  {first ? "Tiếp tục học" : "Khám phá khóa học"}
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </article>
          </State>

          {/* AI Tutor Adaptive Study Recommendation Card */}
          <section className="dashboard-section-card" style={{ marginTop: 20 }}>
            <div className="section-card-header">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span className="kpi-tag accent">✦ Trợ lý AI Phân Tích Thích Ứng</span>
                  <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>Cá nhân hóa theo năng lực Bloom</span>
                </div>
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Đề xuất củng cố: Tối ưu hóa truy vấn SQL & Đánh chỉ mục Index</h3>
                <p className="subtext" style={{ marginTop: 6, lineHeight: 1.5 }}>
                  Dựa trên kết quả bài trắc nghiệm gần nhất, bạn đạt <strong>88% phần Nhận biết</strong> nhưng cần củng cố mức độ <strong>Vận dụng (Bloom Level 3)</strong>. Trợ lý AI đã soạn sẵn 10 câu hỏi trắc nghiệm tương tác giúp bạn tự tin đạt điểm 9+.
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <Link className="button button-small" to="/app/assessments">
                Luyện đề thích ứng ngay (15 phút) →
              </Link>
              <Link className="button button-subtle button-small" to="/app/classes">
                Xem lại ghi chú bài giảng
              </Link>
            </div>
          </section>

          {/* My Enrolled Course Progress Grid */}
          <section className="dashboard-section-card" style={{ marginTop: 20 }}>
            <div className="section-card-header">
              <div>
                <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Tiến độ khóa học của bạn</h3>
                <p className="subtext">Theo dõi lộ trình hoàn thành từng môn học trong kỳ.</p>
              </div>
              <Link className="button button-subtle button-small" to="/app/progress">
                Xem chi tiết tiến độ →
              </Link>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
              <div className="student-progress-overview-item">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <strong style={{ fontSize: 14.5 }}>Cơ sở dữ liệu Nâng cao & Tối ưu hóa</strong>
                    <div style={{ fontSize: 12.5, color: "var(--muted, #64748b)", marginTop: 3 }}>
                      Bài tiếp theo: Bài 5 - Kỹ thuật Sharding &amp; Replication
                    </div>
                  </div>
                  <span className="kpi-tag accent" style={{ fontWeight: 700, fontSize: 13 }}>72%</span>
                </div>
                <div style={{ width: "100%", height: 7, backgroundColor: "var(--line, #e2e8f0)", borderRadius: 4, overflow: "hidden" }}>
                  <div className="progress-bar-fill" style={{ width: "72%", height: "100%", backgroundColor: "var(--blue, #0284c7)", borderRadius: 4 }} />
                </div>
              </div>

              <div className="student-progress-overview-item">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <strong style={{ fontSize: 14.5 }}>Lập trình Web & Trợ lý AI Fullstack</strong>
                    <div style={{ fontSize: 12.5, color: "var(--muted, #64748b)", marginTop: 3 }}>
                      Bài tiếp theo: Bài 4 - Tích hợp Vector Database với LangChain
                    </div>
                  </div>
                  <span className="kpi-tag accent" style={{ fontWeight: 700, fontSize: 13 }}>54%</span>
                </div>
                <div style={{ width: "100%", height: 7, backgroundColor: "var(--line, #e2e8f0)", borderRadius: 4, overflow: "hidden" }}>
                  <div className="progress-bar-fill" style={{ width: "54%", height: "100%", backgroundColor: "#7c3aed", borderRadius: 4 }} />
                </div>
              </div>
            </div>
          </section>

          <section className="discovery-section">
            <h2>Khám phá điều mới</h2>
            <CourseSearch compact />
          </section>
        </div>
        <aside className="dashboard-aside">
          <section>
            <div className="section-title">
              <h2>Lớp học của tôi</h2>
              <Link to="/app/classes">Xem tất cả</Link>
            </div>
            <State query={classes}>
              {classes.data?.length ? (
                classes.data.slice(0, 4).map((c) => (
                  <Link className="upcoming-class" key={c.classId} to={"/app/classes/" + c.classId}>
                    <span className="class-symbol" aria-hidden="true">
                      <Icon name="class" size={16} />
                    </span>
                    <span>
                      <strong>{c.name}</strong>
                      <small>Xem lịch và bài học</small>
                    </span>
                    <span aria-hidden="true">›</span>
                  </Link>
                ))
              ) : (
                <p>Chưa có lớp học. Bạn có thể tham gia bằng mã từ giảng viên.</p>
              )}
            </State>
          </section>
          <section>
            <div className="section-title">
              <h2>Cập nhật mới</h2>
              <Link to="/app/notifications">Thông báo</Link>
            </div>
            <State query={notices}>
              {notices.data?.items.length ? (
                notices.data.items.map((n) => (
                  <div className="notification-preview" key={n.notificationId}>
                    <span className="status-dot" />
                    <strong>{n.title}</strong>
                    <p>{n.body}</p>
                  </div>
                ))
              ) : (
                <p>Bạn đã xem hết thông báo. Những cập nhật mới sẽ xuất hiện tại đây.</p>
              )}
            </State>
          </section>
          <Link className="profile-prompt" to="/app/account">
            <span aria-hidden="true">◉</span>
            <div>
              <strong>Hồ sơ của bạn</strong>
              <p>Cập nhật thông tin và ảnh đại diện.</p>
            </div>
            <span aria-hidden="true">›</span>
          </Link>
        </aside>
      </div>

      <div className="home-section-grid">
        {/* Section: Bài tập cần hoàn thành */}
        <section className="dashboard-section-card">
          <div className="section-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2>📝 Bài tập cần hoàn thành</h2>
              <span className="red-badge-pill">● 2 bài chưa nộp</span>
            </div>
            <Link className="button button-subtle button-small" to="/app/classes">Xem tất cả →</Link>
          </div>
          <div className="home-card-list">
            <Link className="home-activity-card" to="/app/classes">
              <div className="home-activity-card-top">
                <span className="badge">Cơ sở dữ liệu Nâng cao</span>
                <span className="red-badge-pill">● Chưa nộp</span>
              </div>
              <h3 className="home-activity-card-title">Bài tập lớn: Thiết kế CSDL quan hệ chuẩn hóa 3NF</h3>
              <div className="home-activity-card-meta">
                <span style={{ color: "#dc2626", fontWeight: 600 }}>⏰ Hạn nộp: 23:59 Hôm nay</span>
                <span style={{ color: "#0284c7", fontWeight: 700 }}>Làm bài →</span>
              </div>
            </Link>
            <Link className="home-activity-card" to="/app/classes">
              <div className="home-activity-card-top">
                <span className="badge">Lập trình Web & AI</span>
                <span className="red-badge-pill">● Chưa nộp</span>
              </div>
              <h3 className="home-activity-card-title">Bài thực hành 03: Xây dựng REST API với Node.js</h3>
              <div className="home-activity-card-meta">
                <span style={{ color: "#dc2626", fontWeight: 600 }}>⏰ Hạn nộp: 23:59 Ngày mai</span>
                <span style={{ color: "#0284c7", fontWeight: 700 }}>Làm bài →</span>
              </div>
            </Link>
            <Link className="home-activity-card" to="/app/classes">
              <div className="home-activity-card-top">
                <span className="badge">Cơ sở dữ liệu Nâng cao</span>
                <span className="green-badge-pill">✓ Đã nộp</span>
              </div>
              <h3 className="home-activity-card-title">Bài tập cá nhân: Tối ưu truy vấn với B-Tree Index</h3>
              <div className="home-activity-card-meta">
                <span>Hạn nộp: 20/09/2026</span>
                <span style={{ color: "#16a34a", fontWeight: 600 }}>Xem lại bài nộp</span>
              </div>
            </Link>
          </div>
        </section>

        {/* Section: Bài kiểm tra & Đề thi AI */}
        <section className="dashboard-section-card">
          <div className="section-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2>✨ Bài kiểm tra &amp; Đề thi AI</h2>
              <span className="amber-badge-pill">● 2 đề chờ thi</span>
            </div>
            <Link className="button button-subtle button-small" to="/app/assessments">Tất cả đề thi →</Link>
          </div>
          <div className="home-card-list">
            <Link className="home-activity-card" to="/app/assessments">
              <div className="home-activity-card-top">
                <span className="badge">AI ADAPTIVE</span>
                <span className="red-badge-pill">● Chưa làm</span>
              </div>
              <h3 className="home-activity-card-title">Kiểm tra trắc nghiệm AI: Chuẩn hóa dữ liệu &amp; SQL Nâng cao</h3>
              <div className="home-activity-card-meta">
                <span>⏱️ 45 phút • 30 câu hỏi thích ứng</span>
                <span style={{ color: "#d97706", fontWeight: 700 }}>Vào thi ngay →</span>
              </div>
            </Link>
            <Link className="home-activity-card" to="/app/assessments">
              <div className="home-activity-card-top">
                <span className="badge">AI ADAPTIVE</span>
                <span className="red-badge-pill">● Chưa làm</span>
              </div>
              <h3 className="home-activity-card-title">Đề thi thử Thích ứng AI: JavaScript &amp; REST API</h3>
              <div className="home-activity-card-meta">
                <span>⏱️ 30 phút • 20 câu hỏi</span>
                <span style={{ color: "#d97706", fontWeight: 700 }}>Vào thi ngay →</span>
              </div>
            </Link>
            <Link className="home-activity-card" to="/app/assessments">
              <div className="home-activity-card-top">
                <span className="badge">ĐÃ HOÀN THÀNH</span>
                <span className="green-badge-pill">✓ Điểm: 9.5 / 10</span>
              </div>
              <h3 className="home-activity-card-title">Kiểm tra 15 phút: Mô hình hóa ERD &amp; Ràng buộc toàn vẹn</h3>
              <div className="home-activity-card-meta">
                <span>⏱️ 15 phút • 10 câu</span>
                <span style={{ color: "#16a34a", fontWeight: 600 }}>Xem phân tích AI</span>
              </div>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
export function Learn() {
  const own = useStudent<LearningCourse[]>("/me/courses");
  const [activeTab, setActiveTab] = useState<"ALL" | "OWNED" | "UNENROLLED">("ALL");
  const ownedIds = own.data?.map((c) => c.courseId) || [];
  const unenrolledMarketplace = MARKETPLACE_COURSES.filter((c) => !ownedIds.includes(c.courseId));

  return (
    <>
      <Heading title="Khóa học AILSS">
        Quản lý các khóa học đã đăng ký và khám phá danh mục khóa học để đăng ký mua trực tuyến tiện lợi, an toàn.
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
          ⚡ Tất cả khóa học ({MARKETPLACE_COURSES.length})
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
              <Empty>Bạn chưa đăng ký khóa học nào. Hãy khám phá và mua khóa học bên dưới để bắt đầu học ngay.</Empty>
            )}
          </State>
        </section>
      )}

      {(activeTab === "ALL" || activeTab === "UNENROLLED") && (
        <CourseMarketplaceSearch
          ownedCourseIds={ownedIds}
          onlyUnenrolled={activeTab === "UNENROLLED"}
        />
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
function CourseCards({ items }: { items: LearningCourse[] }) {
  return (
    <div className="study-grid">
      {items.map((c) => (
        <article className="study-course study-card-rich" key={c.courseId}>
          <div className="study-artwork-wrapper">
            <CourseArtwork title={c.title} />
            <span className="course-badge-overlay">{c.priceType === "FREE" ? "Miễn phí" : "Đã sở hữu"}</span>
          </div>
          <div className="study-course-body">
            <h3>{c.title}</h3>
            <div className="card-action-row">
              <Link
                className="card-action-btn primary"
                to={`/app/learn/${c.courseId}`}
              >
                Tiếp tục học →
              </Link>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
export function CourseLearning() {
  const navigate = useNavigate();
  const { courseId = "", lessonId } = useParams();
  const [lessonSearch, setLessonSearch] = useState("");
  const [courseTab, setCourseTab] = useState<"lessons" | "exercises">("lessons");
  const course = useStudent<LearningCourse>("/courses/" + courseId),
    lessons = useStudent<Lesson[]>("/courses/" + courseId + "/lessons"),
    progress = useStudent<Progress>("/courses/" + courseId + "/progress");
  const command = useCommand();
  return (
    <>
      <Link to="/app/learn">← Học tập</Link>
      <Heading title={course.data?.title || "Khóa học của bạn"} />

      <div className="module-segmented-bar" role="tablist" aria-label="Phân hệ khóa học" style={{ marginBottom: "20px" }}>
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
                                  !!lessonSearch || index === 0 || group.some((l) => l.lessonId === lessonId)
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
                    <h2>Bài Tập & Kiểm Tra Đánh Giá Của Khóa Học</h2>
                    <span className="amber-badge-pill">● 2 đề chưa hoàn thành</span>
                  </div>
                  <Link to={"/app/assessments?course=" + courseId} className="button small">
                    Tất cả bài kiểm tra →
                  </Link>
                </div>

                <div className="home-card-list">
                  <div className="home-activity-card">
                    <div className="home-activity-card-top">
                      <span className="badge">ÔN TẬP CHUYÊN ĐỀ</span>
                      <span className="red-badge-pill">● Chưa làm</span>
                    </div>
                    <h3 className="home-activity-card-title">Trắc nghiệm ôn tập Chương 1: Kiến trúc & Mô hình quan hệ</h3>
                    <div className="home-activity-card-meta">
                      <span>⏱️ 15 phút • 10 câu hỏi trắc nghiệm</span>
                      <Link to={"/app/assessments?course=" + courseId} className="button small">Vào thi →</Link>
                    </div>
                  </div>

                  <div className="home-activity-card">
                    <div className="home-activity-card-top">
                      <span className="badge">BÀI THỰC HÀNH</span>
                      <span className="red-badge-pill">● Chưa nộp</span>
                    </div>
                    <h3 className="home-activity-card-title">Bài tập thực hành: Thiết kế lược đồ CSDL chuẩn hóa 3NF</h3>
                    <div className="home-activity-card-meta">
                      <span style={{ color: "#dc2626", fontWeight: 600 }}>⏰ Hạn nộp: 23:59 Chủ Nhật</span>
                      <Link to={"/app/assessments?course=" + courseId} className="button small">Nộp bài tập →</Link>
                    </div>
                  </div>

                  <div className="home-activity-card">
                    <div className="home-activity-card-top">
                      <span className="badge">AI ADAPTIVE EXAM</span>
                      <span className="green-badge-pill">✓ Đạt: 9.2 / 10</span>
                    </div>
                    <h3 className="home-activity-card-title">Đề thi đánh giá năng lực thích ứng AI AILSS</h3>
                    <div className="home-activity-card-meta">
                      <span>⏱️ 30 phút • 25 câu hỏi thích ứng Bloom</span>
                      <span style={{ color: "#16a34a", fontWeight: 600 }}>Đã hoàn thành</span>
                    </div>
                  </div>
                </div>
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
            {lesson.data.externalVideo &&
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
