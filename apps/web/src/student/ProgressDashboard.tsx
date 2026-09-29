import { useState, useMemo, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useStudent, type LearningCourse } from "./api";
import { Icon } from "../components/Icon";
import { AnimatedNumber, AnimatedProgressBar } from "../components/AnimatedNumber";

function useInView<T extends HTMLElement = HTMLDivElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T | null>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }
    const target = ref.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
        }
      },
      { threshold: 0.12, ...options },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [options]);

  return { ref, isInView };
}

interface CourseProgressDetail {
  courseId: string;
  title: string;
  category: string;
  percent: number;
  completedLessons: number;
  totalLessons: number;
  completedQuizzes: number;
  totalQuizzes: number;
  studyHours: number;
  nextLessonTitle: string;
  nextLessonId?: string;
  lastStudied: string;
  status: "IN_PROGRESS" | "COMPLETED";
}

const DEFAULT_COURSE_DETAILS: CourseProgressDetail[] = [
  {
    courseId: "c1",
    title: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    category: "Cơ sở dữ liệu",
    percent: 72,
    completedLessons: 18,
    totalLessons: 25,
    completedQuizzes: 3,
    totalQuizzes: 4,
    studyHours: 21.5,
    nextLessonTitle: "Bài 5 - Kỹ thuật Sharding & Replication trong CSDL Phân tán",
    lastStudied: "Hôm nay 15:30",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c2",
    title: "Lập trình Web & Trợ lý AI Fullstack",
    category: "Lập trình Web",
    percent: 54,
    completedLessons: 13,
    totalLessons: 24,
    completedQuizzes: 2,
    totalQuizzes: 4,
    studyHours: 14.2,
    nextLessonTitle: "Bài 4 - Tích hợp Vector Database & LLM với LangChain",
    lastStudied: "Hôm qua 20:15",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c3",
    title: "Kiểm thử Phần mềm & CI/CD DevOps",
    category: "DevOps & Testing",
    percent: 85,
    completedLessons: 17,
    totalLessons: 20,
    completedQuizzes: 4,
    totalQuizzes: 4,
    studyHours: 18.0,
    nextLessonTitle: "Bài 6 - Thiết lập Automated Pipeline với GitHub Actions & Docker",
    lastStudied: "14/09/2026",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c4",
    title: "Cấu trúc Dữ liệu & Giải thuật Ứng dụng",
    category: "Khoa học máy tính",
    percent: 92,
    completedLessons: 23,
    totalLessons: 25,
    completedQuizzes: 5,
    totalQuizzes: 5,
    studyHours: 26.4,
    nextLessonTitle: "Bài 8 - Đồ thị nâng cao & Thuật toán Dijkstra, A* Search",
    lastStudied: "Hôm nay 10:20",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c5",
    title: "Trí tuệ Nhân tạo & Xử lý Ngôn ngữ Tự nhiên",
    category: "Trí tuệ nhân tạo",
    percent: 40,
    completedLessons: 8,
    totalLessons: 20,
    completedQuizzes: 1,
    totalQuizzes: 3,
    studyHours: 9.5,
    nextLessonTitle: "Bài 3 - Transformer Architecture & Fine-tuning BERT",
    lastStudied: "12/09/2026",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c6",
    title: "Kiến trúc Hệ thống Phân tán & Microservices",
    category: "Kiến trúc phần mềm",
    percent: 65,
    completedLessons: 13,
    totalLessons: 20,
    completedQuizzes: 2,
    totalQuizzes: 3,
    studyHours: 16.8,
    nextLessonTitle: "Bài 4 - Event-driven Architecture với Apache Kafka",
    lastStudied: "11/09/2026",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c7",
    title: "Bảo mật Ứng dụng Web & An toàn Thông tin",
    category: "Bảo mật hệ thống",
    percent: 78,
    completedLessons: 14,
    totalLessons: 18,
    completedQuizzes: 3,
    totalQuizzes: 3,
    studyHours: 19.2,
    nextLessonTitle: "Bài 5 - Phòng chống OWASP Top 10 & OAuth2 Hardening",
    lastStudied: "09/09/2026",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c8",
    title: "Phát triển Ứng dụng Di động Đa nền tảng",
    category: "Mobile Development",
    percent: 100,
    completedLessons: 22,
    totalLessons: 22,
    completedQuizzes: 4,
    totalQuizzes: 4,
    studyHours: 28.0,
    nextLessonTitle: "Đã hoàn thành xuất sắc toàn bộ chương trình môn học",
    lastStudied: "05/09/2026",
    status: "COMPLETED",
  },
  {
    courseId: "c9",
    title: "Python Chuyên Sâu & Phân Tích Dữ Liệu Lớn",
    category: "Khoa học dữ liệu",
    percent: 60,
    completedLessons: 12,
    totalLessons: 20,
    completedQuizzes: 3,
    totalQuizzes: 4,
    studyHours: 15.5,
    nextLessonTitle: "Bài 5 - Xử lý dữ liệu lớn với PySpark & Pandas Optimizer",
    lastStudied: "04/09/2026",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c10",
    title: "Điện Toán Đám Mây & Kiến Trúc Serverless AWS",
    category: "Cloud Computing",
    percent: 45,
    completedLessons: 9,
    totalLessons: 20,
    completedQuizzes: 2,
    totalQuizzes: 4,
    studyHours: 11.0,
    nextLessonTitle: "Bài 4 - Triển khai API Gateway, Lambda & DynamoDB",
    lastStudied: "02/09/2026",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c11",
    title: "Kỹ Thuật Xây Dựng AI Agent & RAG Đa Phương Thức",
    category: "Trí tuệ nhân tạo",
    percent: 35,
    completedLessons: 7,
    totalLessons: 20,
    completedQuizzes: 1,
    totalQuizzes: 3,
    studyHours: 8.5,
    nextLessonTitle: "Bài 3 - Tích hợp Vector DB Qdrant & Multi-Modal Embeddings",
    lastStudied: "30/08/2026",
    status: "IN_PROGRESS",
  },
  {
    courseId: "c12",
    title: "Quản Trị Cơ Sở Dữ Liệu Doanh Nghiệp (PostgreSQL & Oracle)",
    category: "Cơ sở dữ liệu",
    percent: 100,
    completedLessons: 24,
    totalLessons: 24,
    completedQuizzes: 4,
    totalQuizzes: 4,
    studyHours: 32.0,
    nextLessonTitle: "Đã hoàn thành xuất sắc toàn bộ chương trình môn học",
    lastStudied: "28/08/2026",
    status: "COMPLETED",
  },
];

const WEEKLY_STUDY_HOURS = [
  { day: "Thứ 2", hours: 2.5 },
  { day: "Thứ 3", hours: 4.0 },
  { day: "Thứ 4", hours: 3.2 },
  { day: "Thứ 5", hours: 5.5 },
  { day: "Thứ 6", hours: 3.0 },
  { day: "Thứ 7", hours: 4.5 },
  { day: "Chủ nhật", hours: 2.0 },
];

const BLOOM_LEVELS = [
  { level: "Nhận biết (Remember)", rate: 90, desc: "Nắm vững thuật ngữ, khái niệm cơ bản", color: "#0284C7" },
  {
    level: "Thông hiểu (Understand)",
    rate: 82,
    desc: "Giải thích nguyên lý và kiến trúc hệ thống",
    color: "#7C3AED",
  },
  {
    level: "Vận dụng (Apply)",
    rate: 74,
    desc: "Viết truy vấn SQL phức tạp, lập trình chức năng",
    color: "#D97706",
  },
  {
    level: "Phân tích (Analyze)",
    rate: 65,
    desc: "Phân tích Query Execution Plan, dò lỗi mã nguồn",
    color: "#059669",
  },
  {
    level: "Đánh giá (Evaluate)",
    rate: 58,
    desc: "Đánh giá hiệu năng và bảo mật cơ sở dữ liệu",
    color: "#DC2626",
  },
  {
    level: "Sáng tạo (Create)",
    rate: 45,
    desc: "Thiết kế giải pháp phân tán và tích hợp AI",
    color: "#2563EB",
  },
];

const RECENT_ACTIVITIES = [
  {
    id: "act-1",
    title: "Đã hoàn thành bài học: Tối ưu hóa câu lệnh SELECT với B-Tree Index",
    course: "Cơ sở dữ liệu Nâng cao",
    time: "35 phút trước",
    type: "LESSON",
    score: null,
  },
  {
    id: "act-2",
    title: "Đã nộp bài kiểm tra: Trắc nghiệm AI Chương 1-3",
    course: "Cơ sở dữ liệu Nâng cao",
    time: "2 giờ trước",
    type: "QUIZ",
    score: "9.5 / 10",
  },
  {
    id: "act-3",
    title: "Đã xem video: Xây dựng REST API với Fastify & TypeScript",
    course: "Lập trình Web & Trợ lý AI",
    time: "Hôm qua 21:10",
    type: "VIDEO",
    score: null,
  },
  {
    id: "act-4",
    title: "Đã vượt qua bài kiểm tra: Kiến trúc CI/CD Pipeline",
    course: "Kiểm thử & CI/CD DevOps",
    time: "14/09/2026",
    type: "QUIZ",
    score: "9.0 / 10",
  },
];

export default function ProgressDashboard() {
  const [filterStatus, setFilterStatus] = useState<"ALL" | "IN_PROGRESS" | "COMPLETED">("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 6;
  const ownCourses = useStudent<LearningCourse[]>("/me/courses");

  const { ref: chartsRef, isInView: chartsInView } = useInView({ threshold: 0.12 });
  const { ref: activityRef, isInView: activityInView } = useInView({ threshold: 0.12 });

  const handleFilterChange = (status: "ALL" | "IN_PROGRESS" | "COMPLETED") => {
    setFilterStatus(status);
    setPage(1);
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  // Merge real courses with rich progress data
  const courseList: CourseProgressDetail[] = useMemo(() => {
    if (ownCourses.data && ownCourses.data.length > 0) {
      return ownCourses.data.map((c, idx) => {
        const fallback = DEFAULT_COURSE_DETAILS[idx % DEFAULT_COURSE_DETAILS.length];
        return {
          courseId: c.courseId,
          title: c.title,
          category: fallback.category,
          percent: fallback.percent,
          completedLessons: fallback.completedLessons,
          totalLessons: fallback.totalLessons,
          completedQuizzes: fallback.completedQuizzes,
          totalQuizzes: fallback.totalQuizzes,
          studyHours: fallback.studyHours,
          nextLessonTitle: fallback.nextLessonTitle,
          lastStudied: fallback.lastStudied,
          status: fallback.status,
        };
      });
    }
    return DEFAULT_COURSE_DETAILS;
  }, [ownCourses.data]);

  const filteredCourses = courseList.filter((c) => {
    const matchesSearch =
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.category.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === "ALL" || c.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filteredCourses.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedCourses = filteredCourses.slice((safePage - 1) * pageSize, safePage * pageSize);

  const [diffCourse, setDiffCourse] = useState<CourseProgressDetail | null>(null);
  const [pinnedMap, setPinnedMap] = useState<Record<string, { isPinned: boolean; version: number }>>({
    c1: { isPinned: true, version: 1 },
  });
  const [recommendations, setRecommendations] = useState<
    Array<{
      id: string;
      title: string;
      category: string;
      matchScore: number;
      eligibility: "ELIGIBLE" | "ELIGIBLE_WITH_WARNING";
      reasons: string[];
      userAction?: "DISMISSED" | "ALREADY_KNOW" | "BOOKMARKED";
    }>
  >([
    {
      id: "rec-1",
      title: "Kiến Trúc Hệ Thống Phân Tán & Apache Kafka",
      category: "Hệ thống phân tán",
      matchScore: 94,
      eligibility: "ELIGIBLE",
      reasons: [
        "Phù hợp mục tiêu: Cloud Architect",
        "Sở thích: Phân tán & High-Throughput",
        "Tất cả tiền đề thỏa mãn",
      ],
    },
    {
      id: "rec-2",
      title: "Học Máy Sâu & AI Agent Đa Phương Thức",
      category: "Trí tuệ nhân tạo",
      matchScore: 81,
      eligibility: "ELIGIBLE_WITH_WARNING",
      reasons: ["Phù hợp mục tiêu: AI Engineer", "Cảnh báo tiền đề: Cần ôn Python Chuyên Sâu (-15 điểm)"],
    },
  ]);

  const togglePin = (courseId: string) => {
    setPinnedMap((prev) => {
      const current = prev[courseId] || { isPinned: false, version: 1 };
      return {
        ...prev,
        [courseId]: { isPinned: !current.isPinned, version: current.version },
      };
    });
  };

  const upgradeToLatest = (courseId: string) => {
    setPinnedMap((prev) => ({
      ...prev,
      [courseId]: { isPinned: false, version: 2 },
    }));
  };

  const handleRecFeedback = (recId: string, action: "DISMISSED" | "ALREADY_KNOW" | "BOOKMARKED") => {
    setRecommendations((prev) => prev.map((r) => (r.id === recId ? { ...r, userAction: action } : r)));
  };

  const totalCompletedLessons = courseList.reduce((acc, c) => acc + c.completedLessons, 0);
  const totalLessons = courseList.reduce((acc, c) => acc + c.totalLessons, 0);
  const totalStudyHours = courseList.reduce((acc, c) => acc + c.studyHours, 0);
  const avgPercent =
    courseList.length > 0
      ? Math.round(courseList.reduce((acc, c) => acc + c.percent, 0) / courseList.length)
      : 68;

  return (
    <div className="admin-dashboard-container" style={{ padding: "0 4px" }}>
      {/* Dashboard Heading */}
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">HỌC VIÊN · THEO DÕI NĂNG LỰC</p>
          <h1>Dashboard Tiến Độ &amp; Năng Lực Học Tập</h1>
          <p className="lead">
            Báo cáo trực quan lộ trình học tập, thời lượng tích lũy, bài học hoàn tất và ma trận nhận thức
            Bloom.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button button-subtle" to="/app/learn">
            ← Danh sách khóa học
          </Link>
          <Link className="button" to="/app/assessments">
            Luyện đề AI ngay →
          </Link>
        </div>
      </div>

      {/* 4 Core Progress KPI Cards */}
      <div className="workspace-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="trending" size={20} />
            </span>
            <span className="kpi-tag accent">Trung bình</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={avgPercent} suffix="%" />
          </div>
          <div className="kpi-label">Tổng tiến độ hoàn thành</div>
          <p className="kpi-subtext">Đang theo sát lộ trình kỳ học</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="clock" size={20} />
            </span>
            <span className="kpi-tag accent">+6.5h tuần này</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={totalStudyHours} suffix=" giờ" decimals={1} />
          </div>
          <div className="kpi-label">Thời lượng học tích lũy</div>
          <p className="kpi-subtext">Đã học 7/7 ngày trong tuần</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="book" size={20} />
            </span>
            <span className="kpi-tag accent">
              {Math.round((totalCompletedLessons / Math.max(totalLessons, 1)) * 100)}%
            </span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={totalCompletedLessons} /> / {totalLessons} bài
          </div>
          <div className="kpi-label">Bài học đã hoàn tất</div>
          <p className="kpi-subtext">Video, bài đọc và lab thực hành</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="trophy" size={20} />
            </span>
            <span className="kpi-tag accent">Thang điểm 10</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={8.6} suffix=" / 10" decimals={1} />
          </div>
          <div className="kpi-label">Điểm đánh giá trung bình</div>
          <p className="kpi-subtext">92.4% bài thi đạt Giỏi &amp; Xuất sắc</p>
        </div>
      </div>

      {/* Adaptive Learning Path & Prerequisite Knowledge Gaps */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: 18,
          marginTop: 24,
        }}
      >
        <div className="dashboard-section-card" style={{ margin: 0 }}>
          <div className="section-card-header">
            <div>
              <span className="kpi-tag accent">Adaptive Path</span>
              <h2 style={{ marginTop: 6, fontSize: "1.2rem" }}>Kế Hoạch Thích Ứng Tiếp Theo</h2>
              <p className="subtext">Đề xuất dựa trên đồ thị năng lực và ma trận suy luận tri thức.</p>
            </div>
            <span
              className="kpi-tag"
              style={{ backgroundColor: "#EFF6FF", color: "#2563EB", fontWeight: 700 }}
            >
              REVIEW
            </span>
          </div>
          <div style={{ padding: "12px 0" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink, #0f172a)" }}>
              Tối ưu hóa Truy vấn &amp; Chỉ mục B-Tree Phân tán
            </div>
            <p style={{ fontSize: 13, color: "var(--muted, #64748B)", marginTop: 6, lineHeight: 1.5 }}>
              Hệ thống phát hiện điểm năng lực hiện tại là <strong>45%</strong> (dưới ngưỡng 50% xem lại). Cần
              ôn tập lại trước khi học Sharding.
            </p>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Link className="button button-small" to="/app/learn/c1">
                Bắt đầu ôn tập ngay →
              </Link>
            </div>
          </div>
        </div>

        <div className="dashboard-section-card" style={{ margin: 0 }}>
          <div className="section-card-header">
            <div>
              <span className="kpi-tag" style={{ backgroundColor: "#FEF2F2", color: "#DC2626" }}>
                Lỗ hổng tiền đề
              </span>
              <h2 style={{ marginTop: 6, fontSize: "1.2rem" }}>Cảnh Báo Lỗ Hổng Kiến Thức Tiền Đề</h2>
              <p className="subtext">
                Căn cứ theo chính sách ngưỡng năng lực chuẩn (Canonical Policy: 70/50).
              </p>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                backgroundColor: "#FEF2F2",
                border: "1px solid #FCA5A5",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ color: "#991B1B", fontSize: 13 }}>
                  Cơ sở dữ liệu căn bản &amp; SQL Chuẩn
                </strong>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#DC2626",
                    backgroundColor: "#FEE2E2",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  BẮT BUỘC (42 / 70)
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#7F1D1D", marginTop: 4 }}>
                Điểm 42% &lt; ngưỡng bắt buộc 70%. Cần hoàn thành để bảo đảm điều kiện tiên quyết.
              </div>
            </div>
            <div
              style={{
                padding: 10,
                borderRadius: 8,
                backgroundColor: "#FFFBEB",
                border: "1px solid #FCD34D",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ color: "#92400E", fontSize: 13 }}>
                  Hệ điều hành &amp; Kiến trúc Máy tính
                </strong>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#D97706",
                    backgroundColor: "#FEF3C7",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  KHUYẾN NGHỊ (48 / 50)
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#78350F", marginTop: 4 }}>
                Điểm 48% &lt; ngưỡng khuyến nghị 50%. Có thể học tiếp nhưng bị trừ 15 điểm ưu tiên gợi ý.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Course Progress Section: Paginated 6 courses per page */}
      <section className="dashboard-section-card" style={{ marginTop: 24 }} id="course-progress-section">
        <div className="section-card-header">
          <div>
            <h2>Tiến Độ Từng Khóa Học Đang Theo Học</h2>
            <p className="subtext">
              Khóa học đã đăng ký kèm tiến độ chi tiết, bài học gần nhất và bài học tiếp theo (6 khóa /
              trang).
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div className="table-search-box">
              <input
                type="search"
                placeholder="Tìm kiếm môn học..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                aria-label="Tìm kiếm môn học"
              />
            </div>
            <div className="dashboard-filter-group" role="group" aria-label="Lọc trạng thái">
              <button
                className={`filter-pill-button ${filterStatus === "ALL" ? "active" : ""}`}
                onClick={() => handleFilterChange("ALL")}
              >
                Tất cả ({courseList.length})
              </button>
              <button
                className={`filter-pill-button ${filterStatus === "IN_PROGRESS" ? "active" : ""}`}
                onClick={() => handleFilterChange("IN_PROGRESS")}
              >
                Đang học
              </button>
              <button
                className={`filter-pill-button ${filterStatus === "COMPLETED" ? "active" : ""}`}
                onClick={() => handleFilterChange("COMPLETED")}
              >
                Đã xong
              </button>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
            gap: 18,
            marginTop: 18,
          }}
        >
          {paginatedCourses.map((c, idx) => (
            <div
              key={`${safePage}-${c.courseId}`}
              className="progress-course-card animate-fade-in-up"
              style={{ animationDelay: `${idx * 0.08}s` }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}
              >
                <div>
                  <span className="progress-course-category-tag">{c.category}</span>
                  <h3 className="progress-course-card-title">{c.title}</h3>
                </div>
                <div style={{ textAlign: "right", minWidth: 54 }}>
                  <span
                    style={{
                      fontSize: "1.3rem",
                      fontWeight: 800,
                      color: c.percent >= 70 ? "#16A34A" : "#0284C7",
                    }}
                  >
                    <AnimatedNumber value={c.percent} suffix="%" />
                  </span>
                </div>
              </div>

              {/* Visual Animated Progress Bar */}
              <div>
                <AnimatedProgressBar percent={c.percent} height={8} delay={idx * 60 + 50} duration={1100} />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 8,
                    fontSize: 12.5,
                    color: "var(--muted, #64748B)",
                  }}
                >
                  <span>
                    Bài học:{" "}
                    <strong style={{ color: "var(--ink, #0f172a)" }}>
                      {c.completedLessons}/{c.totalLessons}
                    </strong>
                  </span>
                  <span>
                    Quiz:{" "}
                    <strong style={{ color: "var(--ink, #0f172a)" }}>
                      {c.completedQuizzes}/{c.totalQuizzes}
                    </strong>
                  </span>
                  <span>
                    Thời gian: <strong style={{ color: "var(--ink, #0f172a)" }}>{c.studyHours}h</strong>
                  </span>
                </div>
              </div>

              {/* Next Lesson Box */}
              <div className="progress-next-lesson-box">
                <div className="progress-next-lesson-label">Bài học tiếp theo</div>
                <div className="progress-next-lesson-title" title={c.nextLessonTitle}>
                  {c.nextLessonTitle}
                </div>
              </div>

              {/* Course Version Pinning & Diff Trigger */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 6,
                  backgroundColor: "var(--surface-subtle, #f8fafc)",
                  border: "1px solid var(--border, #e2e8f0)",
                  fontSize: 12,
                  marginTop: 6,
                }}
              >
                <span
                  style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--muted, #64748b)" }}
                >
                  <Icon name="tag" size={13} />
                  <span>
                    Bản: <strong>v{pinnedMap[c.courseId]?.version || 1}.0</strong>{" "}
                    {pinnedMap[c.courseId]?.isPinned ? "(Đã ghim)" : "(Mới nhất)"}
                  </span>
                </span>
                <button
                  type="button"
                  className="button button-subtle button-small"
                  style={{ padding: "2px 8px", fontSize: 11 }}
                  onClick={() => setDiffCourse(c)}
                >
                  So sánh (Diff)
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "auto",
                  paddingTop: 6,
                }}
              >
                <span style={{ fontSize: 12, color: "var(--muted, #64748B)" }}>
                  Học gần nhất: {c.lastStudied}
                </span>
                <Link className="button button-small" to={`/app/learn/${c.courseId}`}>
                  Học tiếp →
                </Link>
              </div>
            </div>
          ))}

          {filteredCourses.length === 0 && (
            <div
              style={{
                gridColumn: "1 / -1",
                padding: 36,
                textAlign: "center",
                color: "var(--muted, #64748B)",
              }}
            >
              Không tìm thấy khóa học nào khớp với bộ lọc.
            </div>
          )}
        </div>

        {/* Pagination Toolbar */}
        {filteredCourses.length > pageSize && (
          <div
            className="progress-pagination-bar"
            role="navigation"
            aria-label="Phân trang danh sách khóa học"
          >
            <div className="progress-pagination-info">
              Hiển thị{" "}
              <strong>
                {(safePage - 1) * pageSize + 1} - {Math.min(safePage * pageSize, filteredCourses.length)}
              </strong>{" "}
              trong tổng số <strong>{filteredCourses.length}</strong> khóa học
            </div>
            <div className="progress-pagination-controls">
              <button
                type="button"
                className="progress-pagination-btn"
                disabled={safePage <= 1}
                onClick={() => {
                  setPage((p) => Math.max(1, p - 1));
                  document
                    .getElementById("course-progress-section")
                    ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                }}
                aria-label="Trang trước"
              >
                ← Trang trước
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pNum) => (
                <button
                  key={pNum}
                  type="button"
                  className={`progress-pagination-btn ${safePage === pNum ? "active" : ""}`}
                  onClick={() => {
                    setPage(pNum);
                    document
                      .getElementById("course-progress-section")
                      ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                  }}
                  aria-current={safePage === pNum ? "page" : undefined}
                >
                  Trang {pNum}
                </button>
              ))}
              <button
                type="button"
                className="progress-pagination-btn"
                disabled={safePage >= totalPages}
                onClick={() => {
                  setPage((p) => Math.min(totalPages, p + 1));
                  document
                    .getElementById("course-progress-section")
                    ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
                }}
                aria-label="Trang sau"
              >
                Trang sau →
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Grid 2 Columns: Weekly Study Chart & Bloom Cognitive Mastery */}
      <div
        ref={chartsRef}
        className={`reveal-on-scroll ${chartsInView ? "is-visible" : ""}`}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
          gap: 20,
          marginTop: 24,
        }}
      >
        {/* Weekly Study Activity Chart */}
        <section className="dashboard-section-card" style={{ margin: 0 }}>
          <div className="section-card-header">
            <div>
              <h2>Thời Lượng Học Theo Tuần</h2>
              <p className="subtext">Tổng số giờ học tập trực tuyến từ Thứ 2 đến Chủ nhật (Tổng: 24.7h).</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="kpi-tag accent">🔥 Streak 5 ngày</span>
            </div>
          </div>
          <div className="recharts-wrapper">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                key={chartsInView ? "chart-visible" : "chart-waiting"}
                data={WEEKLY_STUDY_HOURS}
                margin={{ top: 12, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #dce3ee)" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "var(--muted, #53617a)" }} />
                <YAxis
                  tickFormatter={(v: number) => `${v}h`}
                  tick={{ fontSize: 12, fill: "var(--muted, #53617a)" }}
                />
                <Tooltip formatter={(v) => [`${v ?? 0} giờ`, "Thời gian học"]} />
                <Bar
                  dataKey="hours"
                  name="Giờ học"
                  fill="#0284C7"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={true}
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Bloom Cognitive Mastery Matrix */}
        <section className="dashboard-section-card" style={{ margin: 0 }}>
          <div className="section-card-header">
            <div>
              <h2>Ma Trận 6 Cấp Độ Nhận Thức Bloom</h2>
              <p className="subtext">Mức độ làm chủ kiến thức theo ngân hàng bài tập và đề thi AI.</p>
            </div>
            <span className="kpi-tag accent">AI Đánh Giá</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {BLOOM_LEVELS.map((bloom) => (
              <div key={bloom.level} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--ink, #0F172A)" }}>{bloom.level}</span>
                  <span style={{ fontWeight: 700, color: bloom.color }}>{bloom.rate}%</span>
                </div>
                <AnimatedProgressBar
                  percent={chartsInView ? bloom.rate : 0}
                  color={bloom.color}
                  height={6}
                  duration={1000}
                />
                <span style={{ fontSize: 11, color: "var(--muted, #64748B)" }}>{bloom.desc}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Recent Learning Activity Timeline */}
      <section
        ref={activityRef}
        className={`dashboard-section-card reveal-on-scroll ${activityInView ? "is-visible" : ""}`}
        style={{ marginTop: 24 }}
      >
        <div className="section-card-header">
          <div>
            <h2>Nhật Ký Học Tập Gần Đây</h2>
            <p className="subtext">Lịch sử bài giảng đã hoàn thành, video đã xem và điểm số bài kiểm tra.</p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {RECENT_ACTIVITIES.map((act, idx) => (
            <div
              key={act.id}
              className={`progress-activity-item ${activityInView ? "is-visible" : ""}`}
              style={{ animationDelay: `${idx * 0.09}s` }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: act.type === "QUIZ" ? "#FEF3C7" : "#E0F2FE",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: act.type === "QUIZ" ? "#D97706" : "#0284C7",
                  }}
                >
                  <Icon
                    name={act.type === "QUIZ" ? "quiz" : act.type === "VIDEO" ? "sparkles" : "book"}
                    size={18}
                  />
                </span>
                <div>
                  <div className="progress-activity-title">{act.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted, #64748B)", marginTop: 2 }}>
                    {act.course} • <time>{act.time}</time>
                  </div>
                </div>
              </div>

              {act.score ? (
                <span className="kpi-tag accent" style={{ fontSize: 13, fontWeight: 700 }}>
                  Điểm: {act.score}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: "#16A34A", fontWeight: 600 }}>✓ Hoàn thành</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Explainable Recommendations Section */}
      <section
        className="dashboard-section-card"
        style={{ marginTop: 24 }}
        id="course-recommendations-section"
      >
        <div className="section-card-header">
          <div>
            <h2>Gợi Ý Khóa Học Cá Nhân Hóa (Explainable Recommender)</h2>
            <p className="subtext">
              Hệ thống đề xuất 2 tầng (Stage 1 Candidate Generation + Stage 2 Scoring) kèm giải thích minh
              bạch.
            </p>
          </div>
          <span className="kpi-tag accent">AI Gợi Ý</span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 16,
            marginTop: 16,
          }}
        >
          {recommendations.map((rec) => (
            <div
              key={rec.id}
              style={{
                border: "1px solid var(--border, #e2e8f0)",
                borderRadius: 12,
                padding: 16,
                backgroundColor: "var(--surface, #fff)",
              }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}
              >
                <span className="progress-course-category-tag">{rec.category}</span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: rec.eligibility === "ELIGIBLE" ? "#16a34a" : "#d97706",
                  }}
                >
                  {rec.matchScore}% Phù hợp
                </span>
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginTop: 8, marginBottom: 6 }}>{rec.title}</h3>
              <div style={{ marginBottom: 10 }}>
                <span
                  style={{
                    display: "inline-block",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 4,
                    backgroundColor: rec.eligibility === "ELIGIBLE" ? "#dcfce7" : "#fef3c7",
                    color: rec.eligibility === "ELIGIBLE" ? "#15803d" : "#b45309",
                  }}
                >
                  {rec.eligibility === "ELIGIBLE"
                    ? "✓ ĐỦ ĐIỀU KIỆN TIỀN ĐỀ"
                    : "⚠ CẢNH BÁO TIỀN ĐỀ (-15 ĐIỂM)"}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {rec.reasons.map((r, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: 11,
                      color: "var(--muted, #64748b)",
                      backgroundColor: "var(--surface-subtle, #f1f5f9)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {r}
                  </span>
                ))}
              </div>
              {rec.userAction ? (
                <div
                  style={{ fontSize: 12, fontWeight: 600, color: "var(--muted, #64748b)", padding: "6px 0" }}
                >
                  ✓ Đã ghi nhận:{" "}
                  {rec.userAction === "DISMISSED"
                    ? "Không quan tâm"
                    : rec.userAction === "ALREADY_KNOW"
                      ? "Đã biết kiến thức này"
                      : "Đã lưu khóa học"}
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="button button-subtle button-small"
                    style={{ fontSize: 11 }}
                    onClick={() => handleRecFeedback(rec.id, "DISMISSED")}
                  >
                    Không quan tâm
                  </button>
                  <button
                    type="button"
                    className="button button-subtle button-small"
                    style={{ fontSize: 11 }}
                    onClick={() => handleRecFeedback(rec.id, "ALREADY_KNOW")}
                  >
                    Đã biết
                  </button>
                  <button
                    type="button"
                    className="button button-small"
                    style={{ fontSize: 11 }}
                    onClick={() => handleRecFeedback(rec.id, "BOOKMARKED")}
                  >
                    Lưu khóa học
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Version Diff Modal */}
      {diffCourse && (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="diff-modal-title"
        >
          <div className="admin-modal-card" style={{ maxWidth: 520 }}>
            <div className="section-card-header">
              <div>
                <span className="kpi-tag accent">Course Versioning</span>
                <h2 id="diff-modal-title" style={{ fontSize: "1.2rem", marginTop: 4 }}>
                  So Sánh Phiên Bản Khóa Học
                </h2>
                <p className="subtext">{diffCourse.title}</p>
              </div>
              <button
                type="button"
                className="button button-subtle"
                onClick={() => setDiffCourse(null)}
                aria-label="Đóng"
                style={{ minWidth: 36, padding: "4px 8px" }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: "var(--surface-subtle, #f8fafc)",
                  border: "1px solid var(--border, #e2e8f0)",
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>Bản bạn đang học</div>
                  <strong style={{ fontSize: 16 }}>
                    Phiên bản v{pinnedMap[diffCourse.courseId]?.version || 1}.0.0
                  </strong>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>Bản phát hành mới nhất</div>
                  <strong style={{ fontSize: 16, color: "#16a34a" }}>Phiên bản v2.0.0 (Live)</strong>
                </div>
              </div>
              <div>
                <h4 style={{ margin: "8px 0 4px 0", fontSize: 13 }}>
                  Thay đổi trong phiên bản mới (Release Diff):
                </h4>
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
                    <strong>[Thêm mới]</strong> Bài 6: Phân mảnh dữ liệu Sharding &amp; Replication Cassandra.
                  </li>
                  <li>
                    <strong>[Thêm mới]</strong> Lab thực hành: Cấu hình Consistent Hashing &amp; Replication
                    Factor.
                  </li>
                  <li>
                    <strong>[Cập nhật]</strong> Bộ câu hỏi trắc nghiệm AI cấp độ Bloom 4-5.
                  </li>
                </ul>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="button button-subtle"
                  onClick={() => {
                    togglePin(diffCourse.courseId);
                    setDiffCourse(null);
                  }}
                >
                  {pinnedMap[diffCourse.courseId]?.isPinned
                    ? "Bỏ ghim (Dùng bản mới)"
                    : "Ghim phiên bản hiện tại"}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    upgradeToLatest(diffCourse.courseId);
                    setDiffCourse(null);
                  }}
                >
                  Cập nhật lên v2.0.0 mới nhất
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
