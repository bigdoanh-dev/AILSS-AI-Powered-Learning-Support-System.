import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Dialog } from "../components/ui";
import {
  useStudent,
  useCommand,
  dateLabel,
  isUuid,
  type LearningCourse,
  type ClassItem,
  type Quiz,
  type Attempt,
  type Result,
  type Answer,
  type Question,
} from "./api";
import { Heading, State, Empty, Status } from "./ui";
import { useUnsavedChanges } from "../components/product";
export interface StudentAssignmentItem {
  id: string;
  quizId: string;
  title: string;
  courseId: string;
  courseTitle: string;
  format: "OBJECTIVE" | "ESSAY" | "PROJECT";
  questionCount: number;
  durationMinutes?: number;
  status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  score?: number | null;
  maxScore?: number;
  deadlineIso: string;
  deadlineLabel: string;
  latePolicy: "BLOCK_LATE" | "ALLOW_LATE_WITH_FLAG";
  submittedAt?: string | null;
  isLate?: boolean;
  lateMinutes?: number;
  teacherNote?: string;
}

const DEFAULT_STUDENT_ASSIGNMENTS: StudentAssignmentItem[] = [
  {
    id: "asg-urgent-1",
    quizId: "00000000-0000-4000-8000-000000000010",
    title: "Kiểm tra 15 phút: Đại số quan hệ & Tối ưu hóa truy vấn SQL (EXPLAIN ANALYZE)",
    courseId: "c1",
    courseTitle: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    format: "OBJECTIVE",
    questionCount: 15,
    durationMinutes: 15,
    status: "NOT_STARTED",
    score: null,
    maxScore: 10,
    deadlineIso: "2026-09-17T11:00:00",
    deadlineLabel: "11:00 (Trưa nay) - 17/09/2026",
    latePolicy: "BLOCK_LATE",
    teacherNote: "Hạn chót nghiêm ngặt 11:00 trưa nay. Hệ thống sẽ tự động khóa nộp khi quá hạn.",
  },
  {
    id: "asg-2",
    quizId: "00000000-0000-4000-8000-000000000002",
    title: "Lab 03: Tích hợp Vector Database với LangChain & Fastify REST API",
    courseId: "c2",
    courseTitle: "Lập trình Web & Trợ lý AI Fullstack",
    format: "ESSAY",
    questionCount: 3,
    durationMinutes: 60,
    status: "IN_PROGRESS",
    score: null,
    maxScore: 10,
    deadlineIso: "2026-09-17T14:00:00",
    deadlineLabel: "14:00 (2h00 CH) - Hôm nay",
    latePolicy: "BLOCK_LATE",
    teacherNote: "Hạn chót nghiêm ngặt đúng 14:00 hôm nay. Hệ thống sẽ tự động khóa nộp.",
  },
  {
    id: "asg-1",
    quizId: "00000000-0000-4000-8000-000000000001",
    title: "Bài tập lớn: Thiết kế CSDL quan hệ chuẩn hóa 3NF & Phân vùng Sharding",
    courseId: "c1",
    courseTitle: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    format: "PROJECT",
    questionCount: 4,
    durationMinutes: 90,
    status: "NOT_STARTED",
    score: null,
    maxScore: 10,
    deadlineIso: "2026-09-18T14:00:00",
    deadlineLabel: "14:00 (2h00 CH) - 18/09/2026",
    latePolicy: "ALLOW_LATE_WITH_FLAG",
    teacherNote: "Nộp file PDF báo cáo ERD chuẩn hóa và file kịch bản SQL DDL kiểm thử.",
  },
  {
    id: "asg-3",
    quizId: "00000000-0000-4000-8000-000000000003",
    title: "Trắc nghiệm AI Chương 4: Kỹ thuật B-Tree Index & Query Optimization Plan",
    courseId: "c1",
    courseTitle: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    format: "OBJECTIVE",
    questionCount: 25,
    durationMinutes: 40,
    status: "NOT_STARTED",
    score: null,
    maxScore: 10,
    deadlineIso: "2026-09-20T23:59:00",
    deadlineLabel: "23:59 - 20/09/2026",
    latePolicy: "ALLOW_LATE_WITH_FLAG",
    teacherNote: "Ngân hàng 25 câu hỏi trắc nghiệm thích ứng AI củng cố kiến thức.",
  },
  {
    id: "asg-4",
    quizId: "00000000-0000-4000-8000-000000000004",
    title: "Kiểm tra giữa kỳ: Thiết lập Automated CI/CD Pipeline với GitHub Actions",
    courseId: "c3",
    courseTitle: "Kiểm thử Phần mềm & CI/CD DevOps",
    format: "ESSAY",
    questionCount: 5,
    durationMinutes: 75,
    status: "NOT_STARTED",
    score: null,
    maxScore: 10,
    deadlineIso: "2026-09-15T14:00:00",
    deadlineLabel: "14:00 (2h00 CH) - 15/09/2026",
    latePolicy: "BLOCK_LATE",
    teacherNote: "Đã quá hạn nộp bài. Giảng viên quy định khóa nộp khi trễ hạn.",
  },
  {
    id: "asg-late-open",
    quizId: "00000000-0000-4000-8000-000000000011",
    title: "Bài tập tuần 2: Thiết kế Document Schema MongoDB & Aggregate Query",
    courseId: "c1",
    courseTitle: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    format: "PROJECT",
    questionCount: 3,
    durationMinutes: 60,
    status: "NOT_STARTED",
    score: null,
    maxScore: 10,
    deadlineIso: "2026-09-16T18:00:00",
    deadlineLabel: "18:00 - 16/09/2026 (Hôm qua)",
    latePolicy: "ALLOW_LATE_WITH_FLAG",
    teacherNote: "Đã quá hạn ngày hôm qua. Giảng viên cho phép nộp muộn nhưng sẽ gắn cờ đỏ cảnh báo.",
  },
  {
    id: "asg-5",
    quizId: "00000000-0000-4000-8000-000000000005",
    title: "Bài tập thực hành: Dockerize Microservices & Quản lý Container Network",
    courseId: "c3",
    courseTitle: "Kiểm thử Phần mềm & CI/CD DevOps",
    format: "PROJECT",
    questionCount: 2,
    status: "SUBMITTED",
    score: null,
    maxScore: 10,
    deadlineIso: "2026-09-16T14:00:00",
    deadlineLabel: "14:00 (2h00 CH) - 16/09/2026",
    latePolicy: "ALLOW_LATE_WITH_FLAG",
    submittedAt: "16/09/2026 14:45",
    isLate: true,
    lateMinutes: 45,
    teacherNote: "Đã nộp muộn 45 phút. Hệ thống đã đánh dấu cờ đỏ để Giảng viên biết khi chấm.",
  },
  {
    id: "asg-6",
    quizId: "00000000-0000-4000-8000-000000000006",
    title: "Trắc nghiệm AI Chương 1-3: Tổng quan Kiến trúc Web Fullstack & React",
    courseId: "c2",
    courseTitle: "Lập trình Web & Trợ lý AI Fullstack",
    format: "OBJECTIVE",
    questionCount: 30,
    status: "GRADED",
    score: 9.5,
    maxScore: 10,
    deadlineIso: "2026-09-14T14:00:00",
    deadlineLabel: "14:00 (2h00 CH) - 14/09/2026",
    latePolicy: "ALLOW_LATE_WITH_FLAG",
    submittedAt: "14/09/2026 13:20",
    isLate: false,
    teacherNote: "Bài thi trắc nghiệm hoàn thành xuất sắc trước hạn.",
  },
];

export function Assessments() {
  const [params, setParams] = useSearchParams();
  const c = params.get("course"),
    k = params.get("class");
  const [target, setTarget] = useState(c && isUuid(c) ? "COURSE/" + c : k && isUuid(k) ? "CLASS/" + k : "");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "PENDING" | "IN_PROGRESS" | "SUBMITTED" | "OVERDUE"
  >("ALL");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");

  const courses = useStudent<LearningCourse[]>("/me/courses"),
    classes = useStudent<ClassItem[]>("/me/classes");

  // Filter list by target course/class
  const baseList: StudentAssignmentItem[] = useMemo(() => {
    if (!target) return DEFAULT_STUDENT_ASSIGNMENTS;
    const [type, id] = target.split("/");
    if (type === "COURSE") {
      return DEFAULT_STUDENT_ASSIGNMENTS.filter(
        (a) => a.courseId === id || a.courseTitle.toLowerCase().includes("cơ sở dữ liệu"),
      );
    }
    return DEFAULT_STUDENT_ASSIGNMENTS;
  }, [target]);

  // Priority sorting: UNFINISHED (NOT_STARTED, IN_PROGRESS) MUST COME FIRST!
  // And within unfinished: SẮP HẾT HẠN (DEADLINE GẦN NHẤT) LÊN ĐẦU TIÊN!
  const sortedAndFiltered = useMemo(() => {
    // Current simulated baseline time is 2026-09-17T05:00:00
    const nowTime = new Date("2026-09-17T05:00:00").getTime();

    return baseList
      .filter((item) => {
        // Search filter
        const matchSearch =
          item.title.toLowerCase().includes(search.toLowerCase()) ||
          item.courseTitle.toLowerCase().includes(search.toLowerCase());

        // Status filter
        const isOverdue =
          new Date(item.deadlineIso).getTime() < nowTime &&
          item.status !== "SUBMITTED" &&
          item.status !== "GRADED";
        let matchStatus = true;
        if (statusFilter === "PENDING") {
          matchStatus = item.status === "NOT_STARTED" || item.status === "IN_PROGRESS";
        } else if (statusFilter === "IN_PROGRESS") {
          matchStatus = item.status === "IN_PROGRESS";
        } else if (statusFilter === "SUBMITTED") {
          matchStatus = item.status === "SUBMITTED" || item.status === "GRADED";
        } else if (statusFilter === "OVERDUE") {
          matchStatus = isOverdue;
        }

        return matchSearch && matchStatus;
      })
      .sort((a, b) => {
        const aIsFinished = a.status === "SUBMITTED" || a.status === "GRADED";
        const bIsFinished = b.status === "SUBMITTED" || b.status === "GRADED";

        // RULE 1: Unfinished assignments ALWAYS come before finished ones!
        if (!aIsFinished && bIsFinished) return -1;
        if (aIsFinished && !bIsFinished) return 1;

        // If both are unfinished:
        if (!aIsFinished && !bIsFinished) {
          const timeA = new Date(a.deadlineIso).getTime();
          const timeB = new Date(b.deadlineIso).getTime();

          const aIsOverdue = timeA < nowTime;
          const bIsOverdue = timeB < nowTime;

          // If one is locked overdue (cannot be submitted): push down after actionable items
          const aIsLocked = aIsOverdue && a.latePolicy === "BLOCK_LATE";
          const bIsLocked = bIsOverdue && b.latePolicy === "BLOCK_LATE";
          if (!aIsLocked && bIsLocked) return -1;
          if (aIsLocked && !bIsLocked) return 1;

          // For remaining actionable assignments (upcoming expiring soonest & overdue allowing late):
          // SẮP HẾT HẠN LÊN ĐẦU: nearest deadline first (timeA - timeB)
          return timeA - timeB;
        }

        // Both are finished: sort by most recently submitted
        const subA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const subB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return subB - subA;
      });
  }, [baseList, search, statusFilter]);

  // Counts for KPIs and pills
  const nowTime = new Date("2026-09-17T05:00:00").getTime();
  const pendingCount = baseList.filter(
    (a) => a.status === "NOT_STARTED" || a.status === "IN_PROGRESS",
  ).length;
  const inProgressCount = baseList.filter((a) => a.status === "IN_PROGRESS").length;
  const submittedCount = baseList.filter((a) => a.status === "SUBMITTED" || a.status === "GRADED").length;
  const overdueCount = baseList.filter(
    (a) => new Date(a.deadlineIso).getTime() < nowTime && a.status !== "SUBMITTED" && a.status !== "GRADED",
  ).length;

  return (
    <div className="admin-dashboard-container" style={{ padding: "0 4px" }}>
      {/* Header */}
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">HỌC VIÊN · TRUNG TÂM BÀI TẬP</p>
          <h1>Danh Sách Bài Kiểm Tra &amp; Bài Tập Nộp</h1>
          <p className="lead">
            Theo dõi lịch hạn nộp bài và các phương án quy định nộp muộn do giảng viên thiết lập.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button button-subtle" to="/app/learn">
            ← Khóa học của tôi
          </Link>
          <Link className="button" to="/app/progress">
            Xem tiến độ học tập →
          </Link>
        </div>
      </div>

      {/* 4 Core Summary KPI Cards */}
      <div className="workspace-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              📋
            </span>
            <span className="kpi-tag">Toàn bộ</span>
          </div>
          <div className="kpi-value">{baseList.length} bài</div>
          <div className="kpi-label">Tổng số bài tập được giao</div>
          <p className="kpi-subtext">Trắc nghiệm AI, Tự luận và Đồ án</p>
        </div>

        <div
          className="kpi-card"
          style={{ borderColor: pendingCount > 0 ? "rgba(217,119,6,0.3)" : undefined }}
        >
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              ⏳
            </span>
            <span className="kpi-tag accent" style={{ backgroundColor: "#fef3c7", color: "#b45309" }}>
              Cần làm
            </span>
          </div>
          <div className="kpi-value" style={{ color: "#d97706" }}>
            {pendingCount} bài
          </div>
          <div className="kpi-label">Cần làm &amp; nộp ngay</div>
          <p className="kpi-subtext">Bài tập chưa nộp hoặc đang làm</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              ✅
            </span>
            <span className="kpi-tag accent" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>
              Đã nộp
            </span>
          </div>
          <div className="kpi-value" style={{ color: "#16a34a" }}>
            {submittedCount} bài
          </div>
          <div className="kpi-label">Đã nộp &amp; Đã chấm điểm</div>
          <p className="kpi-subtext">Bài làm đã lưu trữ an toàn</p>
        </div>

        <div
          className="kpi-card"
          style={{ borderColor: overdueCount > 0 ? "rgba(220,38,38,0.3)" : undefined }}
        >
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              ⏰
            </span>
            <span className="kpi-tag" style={{ backgroundColor: "#fee2e2", color: "#991b1b" }}>
              Cảnh báo
            </span>
          </div>
          <div className="kpi-value" style={{ color: "#dc2626" }}>
            {overdueCount} bài
          </div>
          <div className="kpi-label">Quá hạn nộp bài</div>
          <p className="kpi-subtext">Theo quy định hạn chót của Giảng viên</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <section className="dashboard-section-card" style={{ marginTop: 20 }}>
        <div className="section-card-header" style={{ marginBottom: 16 }}>
          <div>
            <h2>Bộ Lọc &amp; Tìm Kiếm Bài Tập</h2>
            <p className="subtext">Lọc theo môn học, tìm theo tên bài hoặc chọn theo trạng thái thực hiện.</p>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
          {/* Target course/class select */}
          <div style={{ minWidth: 260, flex: 1 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Khóa học hoặc lớp:
            </label>
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setParams(e.target.value ? { target: e.target.value } : {});
              }}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8 }}
            >
              <option value="">Tất cả các khóa học &amp; lớp phụ trách</option>
              {courses.data?.map((v) => (
                <option key={v.courseId} value={"COURSE/" + v.courseId}>
                  Khóa học: {v.title}
                </option>
              ))}
              {classes.data?.map((v) => (
                <option key={v.classId} value={"CLASS/" + v.classId}>
                  Lớp: {v.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search Box */}
          <div style={{ minWidth: 240, flex: 1 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Tìm kiếm tên bài tập:
            </label>
            <input
              type="search"
              placeholder="Nhập tên bài tập, bài lab..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8 }}
            />
          </div>
        </div>

        {/* Status Filter Pills */}
        <div className="dashboard-filter-group" role="tablist" style={{ marginTop: 14, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`filter-pill-button ${statusFilter === "ALL" ? "active" : ""}`}
            onClick={() => setStatusFilter("ALL")}
          >
            Tất cả ({baseList.length})
          </button>
          <button
            type="button"
            className={`filter-pill-button ${statusFilter === "PENDING" ? "active" : ""}`}
            onClick={() => setStatusFilter("PENDING")}
            style={{ fontWeight: 700 }}
          >
            ⏳ Chưa làm / Cần nộp ({pendingCount})
          </button>
          <button
            type="button"
            className={`filter-pill-button ${statusFilter === "IN_PROGRESS" ? "active" : ""}`}
            onClick={() => setStatusFilter("IN_PROGRESS")}
          >
            📝 Đang làm ({inProgressCount})
          </button>
          <button
            type="button"
            className={`filter-pill-button ${statusFilter === "SUBMITTED" ? "active" : ""}`}
            onClick={() => setStatusFilter("SUBMITTED")}
          >
            ✅ Đã nộp ({submittedCount})
          </button>
          <button
            type="button"
            className={`filter-pill-button ${statusFilter === "OVERDUE" ? "active" : ""}`}
            onClick={() => setStatusFilter("OVERDUE")}
          >
            ⏰ Quá hạn ({overdueCount})
          </button>
        </div>
      </section>

      {/* Assignment List Section - With Mode Switch & Data Table */}
      <section style={{ marginTop: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "1.25rem" }}>
              Danh Sách Bài Làm ({sortedAndFiltered.length} bài)
            </h2>
            <p className="subtext" style={{ margin: "4px 0 0 0" }}>
              Theo dõi và hoàn thành các bài kiểm tra, bài tập thực hành theo kế hoạch học tập.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div className="dashboard-filter-group" role="group" aria-label="Chế độ hiển thị">
              <button
                type="button"
                className={`filter-pill-button ${viewMode === "table" ? "active" : ""}`}
                onClick={() => setViewMode("table")}
                title="Hiển thị dưới dạng bảng danh sách tổng hợp"
              >
                📑 Dạng danh sách
              </button>
              <button
                type="button"
                className={`filter-pill-button ${viewMode === "cards" ? "active" : ""}`}
                onClick={() => setViewMode("cards")}
                title="Hiển thị dưới dạng thẻ chi tiết"
              >
                🗂️ Dạng thẻ chi tiết
              </button>
            </div>
            <span style={{ fontSize: 13, color: "var(--muted, #64748b)" }}>
              <strong>{sortedAndFiltered.length}</strong> bài tập
            </span>
          </div>
        </div>

        {viewMode === "table" ? (
          /* BẢNG DANH SÁCH (DATA TABLE VIEW) - MẶC ĐỊNH */
          <div
            className="table-responsive"
            style={{
              border: "1px solid var(--line, #e2e8f0)",
              borderRadius: 12,
              backgroundColor: "var(--surface, #ffffff)",
              overflow: "hidden",
            }}
          >
            <table className="dashboard-data-table" role="table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 80, textAlign: "center" }}>
                    STT
                  </th>
                  <th scope="col" style={{ minWidth: 280 }}>
                    Bài Kiểm Tra &amp; Khóa Học
                  </th>
                  <th scope="col" style={{ minWidth: 220 }}>
                    Lịch Hạn Nộp &amp; Đếm Ngược
                  </th>
                  <th scope="col" style={{ minWidth: 200 }}>
                    Quy Định Của Giảng Viên
                  </th>
                  <th scope="col" style={{ minWidth: 150, textAlign: "center" }}>
                    Trạng Thái
                  </th>
                  <th scope="col" style={{ minWidth: 160, textAlign: "right" }}>
                    Thao Tác
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedAndFiltered.map((item, index) => {
                  const isOverdue =
                    new Date(item.deadlineIso).getTime() < nowTime &&
                    item.status !== "SUBMITTED" &&
                    item.status !== "GRADED";
                  const isUntaken = item.status === "NOT_STARTED";
                  const isInProgress = item.status === "IN_PROGRESS";
                  const isSubmitted = item.status === "SUBMITTED" || item.status === "GRADED";
                  const isDueToday = item.deadlineIso.includes("2026-09-17") && !isOverdue && !isSubmitted;

                  return (
                    <tr
                      key={item.id}
                      style={{
                        backgroundColor: isDueToday
                          ? "rgba(239, 68, 68, 0.04)"
                          : isOverdue && item.latePolicy === "BLOCK_LATE"
                            ? "rgba(100, 116, 139, 0.04)"
                            : "transparent",
                      }}
                    >
                      {/* Cột 1: Số thứ tự STT */}
                      <td style={{ textAlign: "center" }}>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: isDueToday ? "#dc2626" : "var(--muted, #64748b)",
                          }}
                        >
                          #{index + 1}
                        </span>
                      </td>

                      {/* Cột 2: Bài kiểm tra & Khóa học */}
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span
                              className="assessment-format-badge"
                              style={{ fontSize: 11, padding: "2px 6px" }}
                            >
                              {item.format === "OBJECTIVE"
                                ? "⚡ Trắc nghiệm"
                                : item.format === "ESSAY"
                                  ? "✍️ Tự luận"
                                  : "📁 Đồ án nộp file"}
                            </span>
                            <span
                              className="assessment-course-badge"
                              style={{ fontSize: 11, padding: "2px 6px" }}
                            >
                              {item.courseTitle.split("&")[0]?.trim()}
                            </span>
                          </div>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 14,
                              color: "var(--ink, #0f172a)",
                              lineHeight: 1.4,
                            }}
                          >
                            <Link
                              to={"/app/assessments/" + item.quizId}
                              style={{ color: "inherit", textDecoration: "none" }}
                            >
                              {item.title}
                            </Link>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--muted, #64748b)" }}>
                            {item.questionCount} câu hỏi{" "}
                            {item.durationMinutes ? `• Thời lượng: ${item.durationMinutes} phút` : ""}
                          </div>
                        </div>
                      </td>

                      {/* Cột 3: Hạn nộp & Đếm ngược */}
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>⏱️ {item.deadlineLabel}</div>
                          <div>
                            {isOverdue ? (
                              <span className="assessment-countdown-tag overdue">⚠️ ĐÃ QUÁ HẠN</span>
                            ) : isDueToday ? (
                              <span className="assessment-countdown-tag urgent">
                                🔥 SẮP HẾT HẠN (Hôm nay)
                              </span>
                            ) : (
                              <span className="assessment-countdown-tag normal">⏳ Còn hơn 1 ngày</span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Cột 4: Chính sách quá hạn của GV */}
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {item.latePolicy === "BLOCK_LATE" ? (
                            <div
                              style={{
                                color: "#dc2626",
                                fontWeight: 700,
                                fontSize: 12,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <span>🚫 Khóa cổng khi trễ</span>
                            </div>
                          ) : (
                            <div
                              style={{
                                color: "#d97706",
                                fontWeight: 700,
                                fontSize: 12,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <span>🚩 Cho nộp trễ (Cờ đỏ)</span>
                            </div>
                          )}
                          <div style={{ fontSize: 11, color: "var(--muted, #64748b)" }}>
                            {item.latePolicy === "BLOCK_LATE"
                              ? "Quá hạn không được phép nộp"
                              : "Vẫn được nộp nhưng gắn cờ đỏ"}
                          </div>
                        </div>
                      </td>

                      {/* Cột 5: Trạng thái & Kết quả */}
                      <td style={{ textAlign: "center" }}>
                        {isOverdue && item.latePolicy === "BLOCK_LATE" ? (
                          <span
                            className="status-pill"
                            style={{ backgroundColor: "#FEE2E2", color: "#DC2626", fontSize: 12 }}
                          >
                            ⛔ Đã khóa nộp
                          </span>
                        ) : isOverdue && item.latePolicy === "ALLOW_LATE_WITH_FLAG" ? (
                          <span className="badge-late-flag" style={{ fontSize: 11 }}>
                            🚩 Quá hạn nộp
                          </span>
                        ) : isUntaken ? (
                          <span className="status-pill status-pending" style={{ fontSize: 12 }}>
                            ⏳ Chưa làm
                          </span>
                        ) : isInProgress ? (
                          <span
                            className="status-pill"
                            style={{ backgroundColor: "#FEF3C7", color: "#B45309", fontSize: 12 }}
                          >
                            📝 Đang làm
                          </span>
                        ) : item.isLate ? (
                          <span className="badge-late-flag" style={{ fontSize: 11 }}>
                            ⚠️ Nộp muộn (+{item.lateMinutes}p)
                          </span>
                        ) : item.score !== null && item.score !== undefined ? (
                          <span className="status-pill status-success" style={{ fontSize: 12 }}>
                            🎯 {item.score} / {item.maxScore ?? 10}đ
                          </span>
                        ) : (
                          <span className="status-pill status-success" style={{ fontSize: 12 }}>
                            ✓ Đã nộp (Chờ chấm)
                          </span>
                        )}
                      </td>

                      {/* Cột 6: Thao tác */}
                      <td style={{ textAlign: "right" }}>
                        {isSubmitted ? (
                          <Link
                            className="button button-subtle button-small"
                            to={"/app/assessments/" + item.quizId}
                          >
                            👁️ Xem bài
                          </Link>
                        ) : isOverdue && item.latePolicy === "BLOCK_LATE" ? (
                          <button
                            className="button button-subtle button-small"
                            disabled
                            style={{ opacity: 0.5, cursor: "not-allowed" }}
                            title="Đã khóa nộp bài theo quy định của Giảng viên"
                          >
                            ⛔ Đã khóa
                          </button>
                        ) : isOverdue && item.latePolicy === "ALLOW_LATE_WITH_FLAG" ? (
                          <Link
                            className="button button-small"
                            to={"/app/assessments/" + item.quizId}
                            style={{ backgroundColor: "#DC2626", borderColor: "#DC2626", color: "#FFFFFF" }}
                          >
                            🚩 Nộp muộn →
                          </Link>
                        ) : (
                          <Link
                            className="button button-small"
                            to={"/app/assessments/" + item.quizId}
                            style={isDueToday ? { boxShadow: "0 0 10px rgba(239, 68, 68, 0.3)" } : {}}
                          >
                            {isInProgress ? "Tiếp tục →" : "Làm bài ngay →"}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {sortedAndFiltered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table-empty-row" style={{ padding: 36, textAlign: "center" }}>
                      Không tìm thấy bài tập nào khớp với bộ lọc hiện tại.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* THẺ CHI TIẾT (CARDS VIEW) */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sortedAndFiltered.map((item) => {
              const isOverdue =
                new Date(item.deadlineIso).getTime() < nowTime &&
                item.status !== "SUBMITTED" &&
                item.status !== "GRADED";
              const isUntaken = item.status === "NOT_STARTED";
              const isInProgress = item.status === "IN_PROGRESS";
              const isSubmitted = item.status === "SUBMITTED" || item.status === "GRADED";

              return (
                <article
                  key={item.id}
                  className={`assessment-assignment-card ${
                    isOverdue && item.latePolicy === "BLOCK_LATE"
                      ? "priority-overdue"
                      : isUntaken
                        ? "priority-untaken"
                        : isInProgress
                          ? "priority-in-progress"
                          : "status-completed"
                  }`}
                >
                  {/* Header Row */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className="assessment-course-badge">{item.courseTitle}</span>
                      <span className="assessment-format-badge">
                        {item.format === "OBJECTIVE"
                          ? "⚡ Trắc nghiệm AI (Tự động chấm)"
                          : item.format === "ESSAY"
                            ? "✍️ Tự luận (Giảng viên chấm)"
                            : "📁 Đồ án / Nộp file (Giảng viên chấm)"}
                      </span>
                      {item.durationMinutes && (
                        <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>
                          ⏱️ {item.durationMinutes} phút
                        </span>
                      )}
                    </div>

                    {/* Status Badges */}
                    <div>
                      {isOverdue && item.latePolicy === "BLOCK_LATE" ? (
                        <span className="assessment-countdown-tag overdue">⛔ ĐÃ KHÓA NỘP (QUÁ HẠN)</span>
                      ) : isOverdue && item.latePolicy === "ALLOW_LATE_WITH_FLAG" ? (
                        <span className="badge-late-flag">🚩 QUÁ HẠN - CHO PHÉP NỘP MUỘN (GẮN CỜ ĐỎ)</span>
                      ) : isUntaken ? (
                        <span className="assessment-countdown-tag urgent">⏳ CHƯA LÀM (CẦN NỘP)</span>
                      ) : isInProgress ? (
                        <span
                          className="assessment-countdown-tag normal"
                          style={{ backgroundColor: "#fef3c7", color: "#b45309" }}
                        >
                          📝 ĐANG LÀM DỞ
                        </span>
                      ) : item.isLate ? (
                        <span className="badge-late-flag">⚠️ ĐÃ NỘP MUỘN (+{item.lateMinutes} phút)</span>
                      ) : (
                        <span
                          className="assessment-countdown-tag"
                          style={{ backgroundColor: "#dcfce7", color: "#166534" }}
                        >
                          ✓ ĐÃ NỘP ĐÚNG HẠN
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Assignment Title & Teacher Instructions */}
                  <div>
                    <h3 className="assessment-title-text">{item.title}</h3>
                    {item.teacherNote && (
                      <p style={{ margin: "6px 0 0 0", fontSize: 13, color: "var(--muted, #64748b)" }}>
                        <strong>Hướng dẫn từ Giảng viên:</strong> {item.teacherNote}
                      </p>
                    )}
                  </div>

                  {/* Deadline Row */}
                  <div className="assessment-deadline-row">
                    <div className="assessment-deadline-text">
                      <span style={{ fontSize: 16 }}>📅</span>
                      <span>
                        <strong>Lịch hạn nộp bài:</strong> {item.deadlineLabel}
                      </span>
                    </div>

                    <div>
                      {isOverdue ? (
                        <span className="assessment-countdown-tag overdue">⚠️ Đã hết hạn nộp</span>
                      ) : item.deadlineIso.includes("2026-09-17") ? (
                        <span className="assessment-countdown-tag urgent">🔥 Hết hạn hôm nay!</span>
                      ) : (
                        <span className="assessment-countdown-tag normal">⏳ Còn hơn 1 ngày</span>
                      )}
                    </div>
                  </div>

                  {/* Late Policy Box (Giảng viên quyết định phương án) */}
                  {item.latePolicy === "BLOCK_LATE" ? (
                    isOverdue ? (
                      <div className="late-banner-strict" role="alert">
                        <span style={{ fontSize: 18 }}>⛔</span>
                        <div>
                          <strong>QUYẾT ĐỊNH CỦA GIẢNG VIÊN (KHÓA NỘP KHI QUÁ HẠN):</strong> Bài kiểm tra đã
                          quá hạn nộp lúc <strong>{item.deadlineLabel}</strong>. Giảng viên quy định{" "}
                          <u>học viên không được phép nộp trễ</u> và bị cảnh báo vi phạm deadline. Cổng nộp
                          bài hiện đã bị khóa hoàn toàn.
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "var(--muted, #64748b)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          background: "rgba(2,132,199,0.04)",
                          padding: "8px 12px",
                          borderRadius: 8,
                        }}
                      >
                        <span>🔒</span>
                        <span>
                          <strong>Quy định Giảng viên:</strong> Hạn nộp nghiêm ngặt. Hệ thống sẽ{" "}
                          <u>tự động khóa cổng nộp đúng {item.deadlineLabel}</u>, học viên quá hạn sẽ không
                          được phép nộp.
                        </span>
                      </div>
                    )
                  ) : isOverdue && !isSubmitted ? (
                    <div className="late-banner-allowed" role="alert">
                      <span style={{ fontSize: 18 }}>⏰</span>
                      <div>
                        <strong>QUYẾT ĐỊNH CỦA GIẢNG VIÊN (CHO PHÉP NỘP MUỘN CÓ CỜ ĐỎ):</strong> Bài kiểm tra
                        đã quá hạn lúc <strong>{item.deadlineLabel}</strong>. Bạn vẫn được phép nộp bài, tuy
                        nhiên bài làm sẽ bị{" "}
                        <strong style={{ color: "#dc2626" }}>ĐÁNH DẤU ĐỎ ("NỘP MUỘN")</strong> trong bảng chấm
                        thi để Giảng viên biết và trừ điểm chuyên cần theo quy định!
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: 12.5,
                        color: "var(--muted, #64748b)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        background: "rgba(217,119,6,0.06)",
                        padding: "8px 12px",
                        borderRadius: 8,
                      }}
                    >
                      <span>⏱️</span>
                      <span>
                        <strong>Quy định Giảng viên:</strong> Cho phép nộp muộn sau {item.deadlineLabel}. Lưu
                        ý: bài nộp trễ sẽ bị <u>đánh dấu cờ đỏ</u> để Giảng viên biết khi chấm.
                      </span>
                    </div>
                  )}

                  {/* Card Footer Actions & Submission Details */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "auto",
                      paddingTop: 4,
                      flexWrap: "wrap",
                      gap: 10,
                    }}
                  >
                    <div>
                      {isSubmitted ? (
                        <div style={{ fontSize: 13 }}>
                          <span style={{ color: "var(--muted, #64748b)" }}>Đã nộp: </span>
                          <strong>{item.submittedAt}</strong>
                          {item.score !== null && item.score !== undefined ? (
                            <span style={{ marginLeft: 12, fontWeight: 700, color: "#16a34a" }}>
                              Điểm số: {item.score} / {item.maxScore ?? 10}
                            </span>
                          ) : (
                            <span style={{ marginLeft: 12, color: "#d97706", fontWeight: 600 }}>
                              (⏳ Đang chờ Giảng viên chấm điểm)
                            </span>
                          )}
                        </div>
                      ) : (
                        <span style={{ fontSize: 12.5, color: "var(--muted, #64748b)" }}>
                          {item.questionCount} câu hỏi · Thời lượng {item.durationMinutes || 45} phút
                        </span>
                      )}
                    </div>

                    <div>
                      {isSubmitted ? (
                        <Link className="button button-subtle" to={"/app/assessments/" + item.quizId}>
                          Xem lại bài đã nộp →
                        </Link>
                      ) : isOverdue && item.latePolicy === "BLOCK_LATE" ? (
                        <button
                          className="button"
                          disabled
                          style={{ opacity: 0.45, cursor: "not-allowed", backgroundColor: "#94a3b8" }}
                          title="Đã quá hạn nộp bài. Cổng nộp đã đóng theo quy định của Giảng viên."
                        >
                          ⛔ Đã khóa nộp bài
                        </button>
                      ) : isOverdue && item.latePolicy === "ALLOW_LATE_WITH_FLAG" ? (
                        <Link
                          className="button"
                          to={"/app/assessments/" + item.quizId}
                          style={{ backgroundColor: "#dc2626", borderColor: "#dc2626", color: "#ffffff" }}
                        >
                          🚩 Nộp muộn (Đánh dấu đỏ) →
                        </Link>
                      ) : (
                        <Link className="button" to={"/app/assessments/" + item.quizId}>
                          {isInProgress ? "Tiếp tục làm bài →" : "Làm bài ngay →"}
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            {sortedAndFiltered.length === 0 && (
              <div
                className="study-card"
                style={{ textAlign: "center", padding: 36, color: "var(--muted, #64748b)" }}
              >
                Không tìm thấy bài tập nào khớp với bộ lọc hiện tại.
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export function QuizDetail() {
  const { quizId = "" } = useParams(),
    meta = DEFAULT_STUDENT_ASSIGNMENTS.find((a) => a.quizId === quizId),
    q = useStudent<Quiz>(meta ? null : "/quizzes/" + quizId),
    command = useCommand(),
    navigate = useNavigate();

  // Demo assignments are local catalogue previews and intentionally have no server resource.
  const isMissingDemoQuiz = !!meta;
  const detailQuery = q;
  const canStartAttempt = !!q.data;
  const deadlineStr = q.data?.closesAt || meta?.deadlineIso;
  const latePolicy = meta?.latePolicy || "ALLOW_LATE_WITH_FLAG";
  const nowTime = new Date("2026-09-17T05:00:00").getTime();
  const isOverdue = deadlineStr ? new Date(deadlineStr).getTime() < nowTime : false;

  return (
    <>
      <Link to="/app/assessments">← Danh sách bài tập &amp; kiểm tra</Link>
      <Heading title={q.data?.title || meta?.title || "Bài kiểm tra"} />
      <State query={detailQuery}>
        <section className="study-card">
          <h2>Chuẩn bị làm bài</h2>
          <p>
            {q.data?.questionCount || meta?.questionCount || 4} câu hỏi
            {q.data?.durationSeconds
              ? ` · ${q.data.durationSeconds / 60} phút`
              : meta?.durationMinutes
                ? ` · ${meta.durationMinutes} phút`
                : ""}
          </p>
          {(q.data?.opensAt || meta) && (
            <p>Mở lúc {dateLabel(q.data?.opensAt || "2026-09-14T08:00:00Z")} · Asia/Ho_Chi_Minh</p>
          )}
          {deadlineStr && (
            <div className="assessment-deadline-row" style={{ margin: "12px 0" }}>
              <div className="assessment-deadline-text">
                <strong>📅 Lịch hạn nộp bài:</strong> {meta?.deadlineLabel || dateLabel(deadlineStr)}
              </div>
              <div>
                {isOverdue ? (
                  <span className="assessment-countdown-tag overdue">⚠️ Đã hết hạn</span>
                ) : (
                  <span className="assessment-countdown-tag urgent">⏳ Đang mở nộp</span>
                )}
              </div>
            </div>
          )}

          {/* Late Policy Warning */}
          {latePolicy === "BLOCK_LATE" ? (
            isOverdue ? (
              <div className="late-banner-strict" role="alert" style={{ margin: "14px 0" }}>
                <span>⛔</span>
                <div>
                  <strong>CẢNH BÁO QUÁ HẠN NỘP:</strong> Bài kiểm tra đã đóng lúc{" "}
                  <strong>{meta?.deadlineLabel || dateLabel(deadlineStr || "")}</strong>. Theo quy định của
                  Giảng viên, <u>học viên không được phép nộp trễ</u>. Bạn không thể bắt đầu làm bài nữa.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "var(--muted, #64748b)", margin: "10px 0" }}>
                🔒 <strong>Quy định Giảng viên:</strong> Khóa nộp bài khi quá hạn. Hãy hoàn thành trước hạn
                chót.
              </div>
            )
          ) : isOverdue ? (
            <div className="late-banner-allowed" role="alert" style={{ margin: "14px 0" }}>
              <span>⏰</span>
              <div>
                <strong>ĐÃ QUÁ HẠN NỘP BÀI:</strong> Giảng viên cho phép bạn nộp muộn, tuy nhiên lần làm bài
                này sẽ bị <strong style={{ color: "#dc2626" }}>ĐÁNH DẤU ĐỎ ("NỘP MUỘN")</strong> để Giảng viên
                biết và chấm điểm trừ trễ hạn.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--muted, #64748b)", margin: "10px 0" }}>
              ⏱️ <strong>Quy định Giảng viên:</strong> Cho phép nộp muộn (bài nộp trễ sẽ bị đánh dấu đỏ).
            </div>
          )}

          <p>Số lần làm tối đa: {q.data?.attemptLimit ?? 1}.</p>
          <p>
            Nếu bạn đang có lần làm bài chưa nộp, hệ thống sẽ mở lại lần đó. Thời gian bắt đầu được tính khi
            bạn bấm nút bên dưới.
          </p>

          {isMissingDemoQuiz && (
            <div className="late-banner-allowed" role="status" style={{ margin: "14px 0" }}>
              <span>ℹ️</span>
              <div>
                <strong>Nội dung giới thiệu:</strong> Bài kiểm tra này đang xuất hiện trong dữ liệu minh họa
                nhưng chưa được giảng viên phát hành trên hệ thống. Thông tin lịch và quy định vẫn được hiển
                thị để bạn theo dõi; chức năng bắt đầu làm bài sẽ mở sau khi nội dung được phát hành.
              </div>
            </div>
          )}

          {!canStartAttempt ? (
            <button
              className="button"
              disabled
              style={{ opacity: 0.55, cursor: "not-allowed", backgroundColor: "#64748b" }}
              title="Bài kiểm tra chưa được phát hành"
            >
              Chưa mở nội dung bài kiểm tra
            </button>
          ) : isOverdue && latePolicy === "BLOCK_LATE" ? (
            <button
              className="button"
              disabled={true}
              style={{ opacity: 0.5, cursor: "not-allowed", backgroundColor: "#94a3b8" }}
              title="Cổng nộp bài đã khóa theo quy định của Giảng viên"
            >
              ⛔ Đã khóa nộp bài (Không được phép nộp)
            </button>
          ) : isOverdue && latePolicy === "ALLOW_LATE_WITH_FLAG" ? (
            <button
              className="button"
              style={{ backgroundColor: "#dc2626", borderColor: "#dc2626", color: "#fff" }}
              disabled={command.busy}
              onClick={async () => {
                const a = await command.run<Attempt>("/quizzes/" + quizId + "/attempts", "POST");
                if (a) navigate("/app/attempts/" + a.attemptId);
              }}
            >
              🚩 Bắt đầu làm bài (Nộp muộn - Đánh dấu đỏ) →
            </button>
          ) : (
            <button
              className="button"
              disabled={command.busy}
              onClick={async () => {
                const a = await command.run<Attempt>("/quizzes/" + quizId + "/attempts", "POST");
                if (a) navigate("/app/attempts/" + a.attemptId);
              }}
            >
              Bắt đầu / tiếp tục làm bài
            </button>
          )}

          <Status command={command} />
        </section>
      </State>
    </>
  );
}
export function AttemptPage() {
  const { attemptId = "" } = useParams(),
    query = useStudent<Attempt>("/attempts/" + attemptId),
    command = useCommand(),
    navigate = useNavigate();
  const [active, setActive] = useState<Attempt | null>(null);
  return (
    <>
      <Heading title="Lần làm bài của bạn" />
      <State query={query}>
        {query.data && (
          <>
            {query.data.state === "SUBMITTED" ? (
              <section className="study-card">
                <h2>Bài đã nộp</h2>
                <Link className="button" to={"/app/attempts/" + attemptId + "/result"}>
                  Xem kết quả →
                </Link>
              </section>
            ) : query.data.state === "EXPIRED" ? (
              <Empty>
                Bài kiểm tra đã hết thời gian.{" "}
                <Link to={"/app/assessments/" + query.data.quizId}>Về bài kiểm tra</Link>
              </Empty>
            ) : active ? (
              <AnswerForm
                key={active.attemptId}
                attempt={active}
                onSuccess={() => navigate("/app/attempts/" + active.attemptId + "/result")}
              />
            ) : (
              <section className="study-card">
                <h2>
                  {query.data.state === "CREATED"
                    ? "Lần làm bài đã được tạo"
                    : "Tiếp tục lần làm bài đang diễn ra"}
                </h2>
                {query.data.deadlineAt && (
                  <p>Hạn nộp: {dateLabel(query.data.deadlineAt)} · Asia/Ho_Chi_Minh</p>
                )}
                <p>Câu trả lời chưa nộp không được tự động lưu. Giữ trang này mở trong khi làm bài.</p>
                <button
                  className="button"
                  disabled={command.busy}
                  onClick={async () => {
                    const next = await command.run<Attempt>(
                      "/quizzes/" + query.data!.quizId + "/attempts",
                      "POST",
                    );
                    if (next) {
                      if (next.attemptId !== attemptId) navigate("/app/attempts/" + next.attemptId);
                      else setActive(next);
                    }
                  }}
                >
                  Tải câu hỏi và tiếp tục
                </button>
                <Status command={command} />
              </section>
            )}
          </>
        )}
      </State>
    </>
  );
}
function AnswerForm({ attempt, onSuccess }: { attempt: Attempt; onSuccess: () => void }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({}),
    [confirm, setConfirm] = useState(false),
    [frozen, setFrozen] = useState(false),
    [current, setCurrent] = useState(0),
    command = useCommand();
  const submission = useRef<{
    fingerprint: string;
    payload: { answers: Answer[]; clientSubmittedAt: string };
  } | null>(null);
  const questions = attempt.questions || [];
  const answered = (q: Question) => {
    const a = answers[q.questionId];
    return (
      !!a &&
      ("text" in a ? !!a.text.trim() : "selectedOptionIds" in a ? a.selectedOptionIds.length > 0 : true)
    );
  };
  const answeredCount = questions.filter(answered).length;
  useUnsavedChanges(
    answeredCount > 0 && !frozen,
    "Câu trả lời chưa nộp không được lưu trên máy chủ. Rời trang và bỏ bài đang làm?",
  );
  const changed = (answer: Answer) => {
    setAnswers((v) => ({ ...v, [answer.questionId]: answer }));
  };
  return (
    <section className="study-card study-assessment">
      <h2>Trả lời câu hỏi</h2>
      {attempt.deadlineAt && <AttemptTimer deadline={attempt.deadlineAt} />}
      <p>
        Câu trả lời chưa nộp không được lưu trên máy chủ. Làm mới hoặc đóng trang có thể làm mất nội dung.
      </p>
      <p>
        {answeredCount} / {questions.length} câu đã trả lời.
      </p>
      <nav className="question-nav" aria-label="Đi đến câu hỏi">
        {questions.map((q, i) => (
          <a
            key={q.questionId}
            className={`${answered(q) ? "answered" : "unanswered"} ${current === i ? "current" : ""}`}
            href={"#q-" + q.questionId}
            aria-current={current === i ? "step" : undefined}
            onClick={() => setCurrent(i)}
            aria-label={`Câu ${i + 1}: ${answered(q) ? "đã trả lời" : "chưa trả lời"}`}
          >
            {i + 1}
          </a>
        ))}
      </nav>
      <fieldset disabled={frozen || command.busy} className="answer-fields">
        <legend className="sr-only">Nội dung bài làm</legend>
        {questions.map((q, i) => (
          <fieldset id={"q-" + q.questionId} key={q.questionId} className="study-question">
            <legend>
              {i + 1}. {q.prompt}
            </legend>
            <QuestionInput question={q} answer={answers[q.questionId]} onChange={changed} />
          </fieldset>
        ))}
      </fieldset>
      <button
        className="button"
        disabled={frozen || command.busy || !questions.length}
        onClick={() => setConfirm(true)}
      >
        Nộp bài
      </button>
      {command.message === "Dịch vụ tạm thời không khả dụng. Hãy thử lại." ? (
        <p role="status">
          Chưa thể xác nhận trạng thái nộp bài. Hãy thử lại để kiểm tra và tiếp tục yêu cầu trước.
        </p>
      ) : (
        <Status command={command} />
      )}
      <Dialog
        open={confirm}
        onClose={() => {
          if (!command.busy) setConfirm(false);
        }}
        title="Xác nhận nộp bài"
      >
        <h2>Bạn đã sẵn sàng nộp?</h2>
        <p>
          Đã trả lời: {answeredCount}. Chưa trả lời: {questions.length - answeredCount}. Sau khi nộp thành
          công, bạn không thể sửa câu trả lời.
        </p>
        <button
          className="button"
          disabled={command.busy}
          onClick={async () => {
            const list = Object.values(answers),
              fingerprint = JSON.stringify(list);
            if (submission.current?.fingerprint !== fingerprint)
              submission.current = {
                fingerprint,
                payload: { answers: list, clientSubmittedAt: new Date().toISOString() },
              };
            try {
              localStorage.setItem(
                "ailss_student_submission_" + attempt.attemptId,
                JSON.stringify({
                  answers: list,
                  submittedAt: new Date().toISOString(),
                }),
              );
            } catch {
              /* ignore localStorage error */
            }
            const result = await command.run<Result>(
              "/attempts/" + attempt.attemptId + "/submit",
              "POST",
              submission.current.payload,
            );
            if (result) {
              setFrozen(true);
              setConfirm(false);
              onSuccess();
            }
          }}
        >
          Xác nhận nộp bài
        </button>
        <button className="button secondary" disabled={command.busy} onClick={() => setConfirm(false)}>
          Tiếp tục kiểm tra
        </button>
        {command.message === "Dịch vụ tạm thời không khả dụng. Hãy thử lại." ? (
          <p role="status">
            Chưa thể xác nhận trạng thái nộp bài. Hãy thử lại để kiểm tra và tiếp tục yêu cầu trước.
          </p>
        ) : (
          <Status command={command} />
        )}
      </Dialog>
    </section>
  );
}
function AttemptTimer({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now()),
      timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const left = Math.max(0, Date.parse(deadline) - now),
    seconds = Math.floor(left / 1000),
    hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    rest = seconds % 60;
  return (
    <p className="attempt-timer" role="timer">
      <strong>
        Thời gian còn lại: {hours ? `${hours}:` : ""}
        {String(minutes).padStart(2, "0")}:{String(rest).padStart(2, "0")}
      </strong>
      <br />
      <span>Hạn nộp theo máy chủ: {dateLabel(deadline)} · Asia/Ho_Chi_Minh</span>
      {left === 0 && (
        <>
          <br />
          <span>Đồng hồ đã về 0. Hệ thống sẽ xác nhận trạng thái khi bạn thực hiện thao tác tiếp theo.</span>
        </>
      )}
    </p>
  );
}
function QuestionInput({
  question: q,
  answer: a,
  onChange,
}: {
  question: Question;
  answer?: Answer;
  onChange: (a: Answer) => void;
}) {
  const isEssay =
    (q.questionType as string) === "ESSAY" ||
    q.prompt.toLowerCase().includes("tự luận") ||
    q.prompt.toLowerCase().includes("trình bày") ||
    q.prompt.toLowerCase().includes("phân tích");

  const isProjectFile =
    (q.questionType as string) === "FILE_UPLOAD" ||
    q.prompt.toLowerCase().includes("đồ án") ||
    q.prompt.toLowerCase().includes("tải file") ||
    q.prompt.toLowerCase().includes("nộp file");

  if (isProjectFile) {
    const textVal = a && "text" in a ? a.text : "";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "8px 0" }}>
        <div
          style={{
            padding: 12,
            backgroundColor: "var(--surface-sunken, #f1f5f9)",
            borderRadius: 8,
            border: "1px dashed var(--brand, #0284c7)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand, #0284c7)" }}>
            📁 Nộp tệp đồ án / Báo cáo (Giảng viên chấm thủ công)
          </span>
          <p style={{ margin: "4px 0 8px 0", fontSize: 12, color: "var(--muted, #64748b)" }}>
            Định dạng cho phép: .PDF, .ZIP, .DOCX hoặc liên kết lưu trữ trực tuyến (GitHub, Google Drive)
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label className="button button-subtle button-small" style={{ cursor: "pointer", margin: 0 }}>
              📎 Chọn tệp từ máy tính
              <input
                type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const desc = `[Tệp: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)] - Đã tải lên.`;
                    onChange({ questionId: q.questionId, text: desc });
                  }
                }}
              />
            </label>
            {textVal && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#16a34a" }}>
                ✓ {textVal.slice(0, 50)}...
              </span>
            )}
          </div>
        </div>
        <label>
          Hoặc dán liên kết Repository / Cloud Drive & Ghi chú đồ án:
          <input
            placeholder="https://github.com/your-username/project-repo hoặc mô tả nộp bài..."
            maxLength={500}
            value={textVal}
            onChange={(e) => onChange({ questionId: q.questionId, text: e.target.value })}
          />
        </label>
      </div>
    );
  }

  if (isEssay) {
    const textVal = a && "text" in a ? a.text : "";
    return (
      <div style={{ margin: "8px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>
            ✍️ Bài làm tự luận (Giảng viên chấm thủ công)
          </span>
          <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>{textVal.length} / 500 ký tự</span>
        </div>
        <textarea
          rows={5}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--line, #cbd5e1)",
            fontFamily: "inherit",
            fontSize: 14,
          }}
          placeholder="Nhập nội dung bài luận, câu trả lời tự luận hoặc lời giải chi tiết..."
          maxLength={500}
          value={textVal}
          onChange={(e) => onChange({ questionId: q.questionId, text: e.target.value })}
        />
      </div>
    );
  }

  if (q.questionType === "SHORT_ANSWER")
    return (
      <label>
        Câu trả lời ngắn
        <input
          maxLength={500}
          value={a && "text" in a ? a.text : ""}
          onChange={(e) => onChange({ questionId: q.questionId, text: e.target.value })}
        />
      </label>
    );
  if (q.questionType === "TRUE_FALSE")
    return (
      <>
        {[true, false].map((v) => (
          <label className="answer-option" key={String(v)}>
            <input
              type="radio"
              name={q.questionId}
              checked={!!a && "value" in a && a.value === v}
              onChange={() => onChange({ questionId: q.questionId, value: v })}
            />
            {v ? "Đúng" : "Sai"}
          </label>
        ))}
      </>
    );
  return (
    <>
      {q.options?.map((option) => (
        <label className="answer-option" key={option}>
          <input
            type={q.questionType === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
            name={q.questionId}
            checked={
              q.questionType === "MULTIPLE_CHOICE"
                ? !!a && "selectedOptionIds" in a && a.selectedOptionIds.includes(option)
                : !!a && "selectedOptionId" in a && a.selectedOptionId === option
            }
            onChange={(e) => {
              if (q.questionType === "MULTIPLE_CHOICE") {
                const previous = a && "selectedOptionIds" in a ? a.selectedOptionIds : [];
                onChange({
                  questionId: q.questionId,
                  selectedOptionIds: e.target.checked
                    ? [...previous, option]
                    : previous.filter((v) => v !== option),
                });
              } else onChange({ questionId: q.questionId, selectedOptionId: option });
            }}
          />
          {option}
        </label>
      ))}
    </>
  );
}
export function ResultPage() {
  const { attemptId = "" } = useParams(),
    q = useStudent<Result>("/attempts/" + attemptId + "/result");

  const manualRecord = (() => {
    try {
      const raw = localStorage.getItem("ailss_manual_grade_" + attemptId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const studentSub = (() => {
    try {
      const raw = localStorage.getItem("ailss_student_submission_" + attemptId);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const isManualGraded = !!manualRecord && manualRecord.status === "GRADED";
  const hasEssayOrProject = studentSub?.answers?.some(
    (ans: { text?: string; fileName?: string }) =>
      ("text" in ans && ans.text && ans.text.length > 20) || "fileName" in ans,
  );
  const isPendingManual = !isManualGraded && hasEssayOrProject;

  return (
    <>
      <Heading title="Kết quả bài kiểm tra" />
      <State query={q}>
        {q.data && (
          <>
            {isPendingManual ? (
              <section className="study-welcome" style={{ borderLeft: "4px solid #D97706" }}>
                <p className="eyebrow" style={{ color: "#D97706" }}>
                  ⏳ TRẠNG THÁI: CHỜ GIẢNG VIÊN CHẤM THỦ CÔNG
                </p>
                <h2>Bài thi đã được ghi nhận</h2>
                <p className="subtext">
                  Bạn đã nộp thành công bài thi (Tự luận / Đồ án nộp file). Giảng viên phụ trách sẽ trực tiếp
                  đọc bài làm, đánh giá và gửi điểm số cùng lời nhận xét chi tiết.
                </p>
                <div
                  style={{
                    margin: "16px 0",
                    padding: "12px 16px",
                    backgroundColor: "var(--surface-sunken, #f8fafc)",
                    borderRadius: 8,
                    border: "1px solid var(--line, #e2e8f0)",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
                    📋 Tình trạng: Đã tiếp nhận bài làm lúc {dateLabel(q.data.submittedAt)} · Đang chờ giảng
                    viên chấm
                  </p>
                </div>
                <Link className="button" to="/app/learn">
                  Trở lại học tập →
                </Link>
              </section>
            ) : isManualGraded ? (
              <section className="study-welcome" style={{ borderLeft: "4px solid #16A34A" }}>
                <p className="eyebrow" style={{ color: "#16A34A" }}>
                  ✍️ ĐÃ CHẤM THỦ CÔNG BỞI GIẢNG VIÊN
                </p>
                <h2>
                  {manualRecord.manualScore ?? q.data.score} / {q.data.maxScore}
                </h2>
                <p>
                  Đã nộp lúc {dateLabel(q.data.submittedAt)} · Đã chấm lúc {dateLabel(manualRecord.gradedAt)}
                </p>
                {manualRecord.teacherFeedback && (
                  <div
                    style={{
                      margin: "16px 0",
                      padding: "14px 18px",
                      backgroundColor: "#F0FDF4",
                      border: "1px solid #BBF7D0",
                      borderRadius: 8,
                      textAlign: "left",
                    }}
                  >
                    <p style={{ fontWeight: 700, color: "#166534", marginBottom: 4 }}>
                      💬 Nhận xét & Lời phê của Giảng viên:
                    </p>
                    <p style={{ margin: 0, color: "#15803D", fontStyle: "italic", fontSize: "14px" }}>
                      "{manualRecord.teacherFeedback}"
                    </p>
                  </div>
                )}
                <Link className="button" to="/app/learn">
                  Trở lại học tập →
                </Link>
              </section>
            ) : (
              <section className="study-welcome">
                <p className="eyebrow">⚡ ĐIỂM SỐ CHẤM TỰ ĐỘNG</p>
                <h2>
                  {q.data.score} / {q.data.maxScore}
                </h2>
                <p>Đã nộp lúc {dateLabel(q.data.submittedAt)} · Asia/Ho_Chi_Minh</p>
                <p>Hệ thống trắc nghiệm khách quan đã chấm điểm tự động tức thì.</p>
                <Link className="button" to="/app/learn">
                  Trở lại học tập →
                </Link>
              </section>
            )}
          </>
        )}
      </State>
    </>
  );
}
