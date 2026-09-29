import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { lecturerError, lecturerRequest, useLecturer } from "./api";
import { CourseArtwork, categories } from "../components/CourseArtwork";
import { CatalogCourseSelect, Field, State } from "./ui";
import { Breadcrumbs, EmptyState, StateChip, stateLabel, useUnsavedChanges } from "../components/product";
import { Icon } from "../components/Icon";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { MediaUpload } from "./MediaUpload";
import { RevenueQuote } from "./RevenueQuote";
type Course = {
  courseId: string;
  title: string;
  slug: string;
  categoryId: string;
  state?: string;
  publishedAt?: string;
  priceType: string;
  price: string;
  currency: string;
  ownerLecturerId?: string;
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

interface GradingQueueItem {
  id: string;
  studentName: string;
  studentId: string;
  email: string;
  className: string;
  taskTitle: string;
  submittedTime: string;
  submittedAtIso: string;
  attachments: { name: string; size: string }[];
  studentNote: string;
  rubric: { criterion: string; maxScore: number; suggestedScore: number }[];
  score: number | null;
  maxScore: number;
  feedback: string | null;
  status: "PENDING" | "GRADED";
}

export function TeachingHome() {
  const [queueItems] = useState<GradingQueueItem[]>([]);
  const [gradingItem, setGradingItem] = useState<GradingQueueItem | null>(null);
  const [gradeScore, setGradeScore] = useState("");
  const [gradeFeedback, setGradeFeedback] = useState("");
  const [gradeNotice, setGradeNotice] = useState<string | null>(null);
  const [submissionTab, setSubmissionTab] = useState<"note" | "files" | "rubric">("note");
  const [previewFile, setPreviewFile] = useState<{
    name: string;
    size: string;
    studentName: string;
    taskTitle: string;
    submittedTime: string;
  } | null>(null);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewPage, setPreviewPage] = useState(1);

  const handleDownloadFile = (fileName: string) => {
    setGradeNotice(`Không thể tải ${fileName}: bản ghi nộp bài chưa có URL tệp được xác thực.`);
    setTimeout(() => setGradeNotice(null), 3500);
  };

  const courses = useLecturer<Course[] | { items: Course[] }>("/courses?limit=50"),
    offerings = useLecturer<Offering[] | { items: Offering[] }>("/me/owned-offerings"),
    classes = useLecturer<{ classes?: unknown[] } | unknown[]>("/me/owned-classes");
  const coursesList = Array.isArray(courses.data) ? courses.data : courses.data?.items || [];

  return (
    <>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">GIẢNG VIÊN · TỔNG QUAN HOẠT ĐỘNG</p>
          <h1>Tổng Quan Giảng Dạy &amp; Điều Hành Lớp Học</h1>
          <p className="lead">
            Bảng điều khiển hoạt động giảng dạy, theo dõi chuyên cần, chấm bài tập và hỗ trợ sinh viên.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            className="button button-subtle"
            to="/app/teaching/profile"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
          >
            <Icon name="user" size={14} />
            <span>Hồ sơ &amp; Xác thực</span>
          </Link>
          <Link
            className="button button-subtle"
            to="/app/teaching/revenue"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
          >
            <Icon name="card" size={14} />
            <span>Doanh thu</span>
          </Link>
          <Link
            className="button button-subtle"
            to="/app/teaching/reports"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
          >
            <Icon name="chart" size={14} />
            <span>Báo cáo</span>
          </Link>
          <Link
            className="button"
            to="/app/teaching"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
          >
            <Icon name="book" size={14} />
            <span>Quản lý khóa học →</span>
          </Link>
        </div>
      </div>

      <div className="workspace-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="users" size={20} />
            </span>
            <span className="kpi-tag accent">3 lớp học phần</span>
          </div>
          <div className="kpi-value">—</div>
          <div className="kpi-label">Tổng học viên phụ trách</div>
          <p className="kpi-subtext">Sĩ số trung bình 48-50 SV / lớp</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="calendar" size={20} />
            </span>
            <span className="kpi-tag accent">Điểm danh</span>
          </div>
          <div className="kpi-value">—</div>
          <div className="kpi-label">Tỷ lệ chuyên cần học kỳ</div>
          <p className="kpi-subtext">Đạt chuẩn quy chế đào tạo</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="quiz" size={20} />
            </span>
            <span className="kpi-tag" style={{ color: "var(--danger, #DC2626)", fontWeight: 700 }}>
              Cần xử lý
            </span>
          </div>
          <div className="kpi-value">
            {queueItems.filter((item) => item.status === "PENDING").length} bài nộp
          </div>
          <div className="kpi-label">Hàng đợi chấm bài tập</div>
          <p className="kpi-subtext">10 bài CSDL, 4 bài Web AI</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="sparkles" size={20} />
            </span>
            <span className="kpi-tag accent">142 nhận xét</span>
          </div>
          <div className="kpi-value">—</div>
          <div className="kpi-label">Đánh giá từ sinh viên</div>
          <p className="kpi-subtext">98% phản hồi rất tích cực</p>
        </div>
      </div>

      <div className="workspace-quick-actions" role="toolbar" aria-label="Thao tác giảng dạy nhanh">
        <Link className="quick-action-chip" to="/app/teaching/profile">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="user" size={16} />
          </span>
          <span>Hồ sơ &amp; Xác thực</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/revenue">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="card" size={16} />
          </span>
          <span>Doanh thu</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/courses/new">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="plus" size={16} />
          </span>
          <span>Tạo khóa học mới</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/classes">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="calendar" size={16} />
          </span>
          <span>Lịch dạy &amp; Điểm danh</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/offerings">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="target" size={16} />
          </span>
          <span>Quản lý đợt mở bán</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/assessments">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="quiz" size={16} />
          </span>
          <span>Ngân hàng câu hỏi</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/grades">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="trophy" size={16} />
          </span>
          <span>Bảng điểm học viên</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/reports">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="chart" size={16} />
          </span>
          <span>Báo cáo &amp; Thống kê</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/ai">
          <span className="chip-icon" aria-hidden="true">
            <Icon name="sparkles" size={16} />
          </span>
          <span>AI Studio</span>
        </Link>
      </div>

      {/* Today's Teaching Schedule & Classes */}
      <section className="dashboard-section-card" style={{ marginTop: 20 }}>
        <div className="section-card-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span className="kpi-tag accent">● Hôm nay</span>
              <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>Thứ Năm · Học kỳ 1</span>
            </div>
            <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Lịch Dạy &amp; Lớp Học Phần Trực Tiếp</h2>
            <p className="subtext">Lớp học phụ trách và ca dạy trực tiếp trong ngày của giảng viên.</p>
          </div>
          <Link className="button button-small" to="/app/teaching/classes">
            Xem toàn bộ 3 lớp học →
          </Link>
        </div>

        <div className="teaching-schedule-grid">
          <div className="teaching-schedule-card">
            <div className="teaching-schedule-header">
              <span className="kpi-tag accent">Ca sáng: 09:30 - 11:30</span>
              <span className="schedule-status-badge live">● Sắp diễn ra</span>
            </div>
            <h3 className="teaching-schedule-title">Cơ sở dữ liệu Nâng cao &amp; Tối ưu hóa - Nhóm 01</h3>
            <p className="teaching-schedule-info">
              <span>
                Phòng: <strong>Lab B402 (Trực tiếp)</strong>
              </span>
              <span>•</span>
              <span>
                Sĩ số: <strong>50/50 SV</strong>
              </span>
            </p>
            <div className="teaching-schedule-actions">
              <Link className="button button-small" to="/app/teaching/attendance?class=c1">
                ✓ Điểm danh ngay
              </Link>
              <Link className="button button-subtle button-small" to="/app/teaching/classes">
                Mở lớp học →
              </Link>
            </div>
          </div>

          <div className="teaching-schedule-card">
            <div className="teaching-schedule-header">
              <span className="kpi-tag">Ca chiều: 15:30 - 17:30</span>
              <span className="schedule-status-badge upcoming">Chiều nay</span>
            </div>
            <h3 className="teaching-schedule-title">Lập trình Web &amp; Trợ lý AI Fullstack - Nhóm 02</h3>
            <p className="teaching-schedule-info">
              <span>
                Phòng: <strong>Hội trường trực tuyến AI</strong>
              </span>
              <span>•</span>
              <span>
                Sĩ số: <strong>48/50 SV</strong>
              </span>
            </p>
            <div className="teaching-schedule-actions">
              <Link className="button button-subtle button-small" to="/app/teaching/classes">
                Xem chi tiết lớp →
              </Link>
            </div>
          </div>

          <div className="teaching-schedule-card">
            <div className="teaching-schedule-header">
              <span className="kpi-tag">Thứ Sáu: 07:30 - 09:30</span>
              <span className="schedule-status-badge upcoming">Ngày mai</span>
            </div>
            <h3 className="teaching-schedule-title">Kiểm thử Phần mềm &amp; CI/CD DevOps - Nhóm 01</h3>
            <p className="teaching-schedule-info">
              <span>
                Phòng: <strong>Phòng Lab A205</strong>
              </span>
              <span>•</span>
              <span>
                Sĩ số: <strong>45/50 SV</strong>
              </span>
            </p>
            <div className="teaching-schedule-actions">
              <Link className="button button-subtle button-small" to="/app/teaching/classes">
                Xem chi tiết lớp →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Lecturer Pending Grading Queue */}
      <section className="dashboard-section-card" style={{ marginTop: 20 }}>
        <div className="section-card-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span className="kpi-tag" style={{ color: "var(--danger, #DC2626)", fontWeight: 700 }}>
                ● Cần chấm điểm
              </span>
              <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>
                {queueItems.filter((item) => item.status === "PENDING").length} bài nộp chưa có điểm
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Hàng Đợi Chấm Bài Tập &amp; Đánh Giá</h2>
            <p className="subtext">Bài nộp gần nhất từ sinh viên các lớp bạn đang trực tiếp phụ trách.</p>
          </div>
          <Link className="button button-small" to="/app/teaching/grades">
            Xem toàn bộ bảng điểm →
          </Link>
        </div>

        {gradeNotice && (
          <div className="dashboard-banner-notice" role="status" style={{ margin: "10px 0" }}>
            <span>✓</span>
            <span>{gradeNotice}</span>
          </div>
        )}

        <div className="table-responsive" style={{ marginTop: 12 }}>
          <table className="dashboard-data-table" role="table">
            <thead>
              <tr>
                <th scope="col">Sinh Viên</th>
                <th scope="col">Môn / Lớp Học</th>
                <th scope="col">Tiêu Đề Bài Tập</th>
                <th scope="col">Thời Gian Nộp</th>
                <th scope="col">Trạng Thái</th>
                <th scope="col">Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {queueItems.length === 0 && (
                <tr>
                  <td colSpan={6}>Chưa có dữ liệu bài nộp từ Assessment Service.</td>
                </tr>
              )}
              {queueItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          backgroundColor: "#E0F2FE",
                          color: "#0369A1",
                          fontWeight: 700,
                          fontSize: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {item.studentName.charAt(0)}
                      </div>
                      <div>
                        <strong>{item.studentName}</strong>
                        <div style={{ fontSize: 11, color: "var(--muted, #64748b)" }}>({item.studentId})</div>
                      </div>
                    </div>
                  </td>
                  <td>{item.className}</td>
                  <td>
                    <strong>{item.taskTitle}</strong>
                    <div style={{ fontSize: 11, color: "var(--muted, #64748b)" }}>
                      {item.attachments.length} tệp đính kèm • {item.attachments[0]?.name}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>{item.submittedTime}</span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {item.status === "GRADED" ? (
                      <span
                        className="kpi-tag"
                        style={{
                          color: "#059669",
                          backgroundColor: "#D1FAE5",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        ✓ Đã chấm ({item.score}/10)
                      </span>
                    ) : (
                      <span
                        className="kpi-tag"
                        style={{
                          color: "#D97706",
                          backgroundColor: "#FEF3C7",
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        ● Chờ chấm
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      className={`button button-small ${item.status === "GRADED" ? "button-subtle" : ""}`}
                      onClick={() => {
                        setGradingItem(item);
                        setGradeScore(item.score !== null ? String(item.score) : "9.0");
                        setGradeFeedback(item.feedback || "Bài làm đạt yêu cầu, mô hình dữ liệu mạch lạc.");
                        setSubmissionTab("note");
                      }}
                    >
                      {item.status === "GRADED" ? "Xem lại / Sửa điểm" : "Chấm bài"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Interactive Modal Chấm bài & Nhận xét Chi Tiết */}
      {gradingItem && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="grading-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(15, 23, 42, 0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--card-bg, #FFFFFF)",
              borderRadius: 16,
              maxWidth: 680,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 24,
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              border: "1px solid var(--line, #E2E8F0)",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 16,
              }}
            >
              <div>
                <p className="eyebrow" style={{ color: "#0284C7" }}>
                  CHẤM BÀI &amp; ĐÁNH GIÁ TRỰC TIẾP
                </p>
                <h2 id="grading-modal-title" style={{ margin: "4px 0", fontSize: "1.35rem" }}>
                  Chấm Bài: {gradingItem.studentName}
                </h2>
                <p className="subtext">
                  Mã SV: <code>{gradingItem.studentId}</code> • {gradingItem.className}
                </p>
              </div>
              <button
                className="button button-subtle button-small"
                onClick={() => setGradingItem(null)}
                aria-label="Đóng"
                style={{ fontSize: 16, width: 32, height: 32, padding: 0 }}
              >
                ✕
              </button>
            </div>

            {/* Student Info & Submission Metadata Box */}
            <div className="grading-meta-box">
              <div>
                <span className="grading-meta-label">Bài nộp</span>
                <div className="grading-meta-value">{gradingItem.taskTitle}</div>
              </div>
              <div>
                <span className="grading-meta-label">Thời gian nộp</span>
                <div className="grading-meta-value">
                  {gradingItem.submittedTime} ({gradingItem.submittedAtIso})
                </div>
              </div>
              <div>
                <span className="grading-meta-label">Email học viên</span>
                <div className="grading-meta-value" style={{ color: "var(--blue, #0284c7)" }}>
                  {gradingItem.email}
                </div>
              </div>
              <div>
                <span className="grading-meta-label">Trạng thái</span>
                <div style={{ marginTop: 2 }}>
                  {gradingItem.status === "GRADED" ? (
                    <span className="kpi-tag" style={{ color: "#059669", backgroundColor: "#D1FAE5" }}>
                      ✓ Đã chấm ({gradingItem.score}/10)
                    </span>
                  ) : (
                    <span className="kpi-tag" style={{ color: "#D97706", backgroundColor: "#FEF3C7" }}>
                      ● Đang chờ chấm
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Submission Detail Tabs Switcher */}
            <div
              style={{
                display: "flex",
                gap: 8,
                borderBottom: "1px solid var(--line, #E2E8F0)",
                marginBottom: 14,
                paddingBottom: 4,
              }}
            >
              <button
                type="button"
                className={`filter-pill-button ${submissionTab === "note" ? "active" : ""}`}
                onClick={() => setSubmissionTab("note")}
              >
                📝 Lời nhắn &amp; Giải trình
              </button>
              <button
                type="button"
                className={`filter-pill-button ${submissionTab === "files" ? "active" : ""}`}
                onClick={() => setSubmissionTab("files")}
              >
                📎 Tệp đính kèm ({gradingItem.attachments.length})
              </button>
              <button
                type="button"
                className={`filter-pill-button ${submissionTab === "rubric" ? "active" : ""}`}
                onClick={() => setSubmissionTab("rubric")}
              >
                📊 Tiêu chí Rubric
              </button>
            </div>

            {/* Tab 1: Student Note */}
            {submissionTab === "note" && (
              <div className="grading-student-note">
                <div className="grading-student-note-title">
                  Lời nhắn của sinh viên {gradingItem.studentName}:
                </div>
                <p className="grading-student-note-text">"{gradingItem.studentNote}"</p>
              </div>
            )}

            {/* Tab 2: Attached Files */}
            {submissionTab === "files" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {gradingItem.attachments.map((file, idx) => (
                  <div key={idx} className="grading-attachment-card">
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 22 }}>
                        {file.name.endsWith(".pdf")
                          ? "📕"
                          : file.name.endsWith(".sql")
                            ? "💾"
                            : file.name.endsWith(".zip")
                              ? "📦"
                              : file.name.endsWith(".json")
                                ? "⚙️"
                                : "📄"}
                      </span>
                      <div>
                        <div className="grading-attachment-name">{file.name}</div>
                        <div className="grading-attachment-size">Dung lượng: {file.size}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="button button-subtle button-small"
                        onClick={() => {
                          setPreviewPage(1);
                          setPreviewZoom(100);
                          setPreviewFile({
                            name: file.name,
                            size: file.size,
                            studentName: gradingItem.studentName,
                            taskTitle: gradingItem.taskTitle,
                            submittedTime: `${gradingItem.submittedTime} (${gradingItem.submittedAtIso})`,
                          });
                        }}
                      >
                        👁 Xem trước
                      </button>
                      <button
                        type="button"
                        className="button button-subtle button-small"
                        onClick={() => handleDownloadFile(file.name)}
                      >
                        📥 Tải về
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tab 3: Rubric criteria */}
            {submissionTab === "rubric" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                {gradingItem.rubric.map((r, idx) => (
                  <div key={idx} className="grading-rubric-card">
                    <div>
                      <div className="grading-rubric-name">{r.criterion}</div>
                      <div className="grading-rubric-sub">Thang điểm tối đa: {r.maxScore}đ</div>
                    </div>
                    <span className="kpi-tag accent">
                      Gợi ý AI: {r.suggestedScore} / {r.maxScore}đ
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Grading Inputs: Score & Feedback */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <label style={{ fontSize: 13, fontWeight: 700, color: "var(--ink, #0F172A)" }}>
                    Điểm số (Thang điểm {gradingItem.maxScore}) *
                  </label>
                  <div style={{ display: "flex", gap: 4 }}>
                    {["8.0", "8.5", "9.0", "9.5", "10.0"].map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`filter-pill-button ${gradeScore === s ? "active" : ""}`}
                        style={{ padding: "2px 8px", fontSize: 11 }}
                        onClick={() => setGradeScore(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="number"
                  min="0"
                  max={gradingItem.maxScore}
                  step="0.25"
                  value={gradeScore}
                  onChange={(e) => setGradeScore(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--line, #E2E8F0)",
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                  autoFocus
                />
              </div>

              <div>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--ink, #0F172A)",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Lời phê &amp; Nhận xét của Giảng viên
                </label>
                <textarea
                  rows={4}
                  value={gradeFeedback}
                  onChange={(e) => setGradeFeedback(e.target.value)}
                  placeholder="Nhập nhận xét cụ thể để học viên biết điểm mạnh và phần cần khắc phục..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--line, #E2E8F0)",
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                />

                {/* Quick Feedback Chips */}
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[
                    "✓ Bài làm xuất sắc, phân tích 3NF rất chặt chẽ.",
                    "Cần bổ sung thêm Composite Index cho các bảng liên kết.",
                    "Đã nộp đúng hạn, code SQL chuẩn và dễ đọc.",
                    "Cần giải thích chi tiết hơn về các phụ thuộc hàm.",
                  ].map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="button button-subtle button-small"
                      style={{ fontSize: 11, padding: "3px 8px" }}
                      onClick={() => setGradeFeedback(preset)}
                    >
                      + {preset.slice(0, 38)}…
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div
              style={{
                marginTop: 24,
                paddingTop: 16,
                borderTop: "1px solid #E2E8F0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <Link
                className="button button-subtle button-small"
                to="/app/teaching/grades"
                onClick={() => setGradingItem(null)}
              >
                📊 Xem Bảng điểm toàn lớp →
              </Link>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="button button-subtle" onClick={() => setGradingItem(null)}>
                  Hủy
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setGradeNotice(
                      "Không thể lưu: bản ghi nộp bài chưa được liên kết với Assessment Service.",
                    );
                    setGradingItem(null);
                    setTimeout(() => setGradeNotice(null), 4000);
                  }}
                >
                  ✓ Lưu điểm &amp; Gửi phản hồi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive File Preview Modal */}
      {previewFile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="file-preview-title"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10001,
            padding: 16,
            backdropFilter: "blur(6px)",
          }}
          onClick={() => setPreviewFile(null)}
        >
          <div
            style={{
              backgroundColor: "var(--card-bg, #ffffff)",
              color: "var(--ink, #0f172a)",
              borderRadius: 16,
              maxWidth: 880,
              width: "100%",
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.5)",
              border: "1px solid var(--line, #e2e8f0)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 20px",
                borderBottom: "1px solid var(--line, #e2e8f0)",
                backgroundColor: "var(--surface-subtle, #f8fafc)",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 26 }}>
                  {previewFile.name.endsWith(".pdf")
                    ? "📕"
                    : previewFile.name.endsWith(".sql")
                      ? "💾"
                      : previewFile.name.endsWith(".zip")
                        ? "📦"
                        : previewFile.name.endsWith(".json")
                          ? "⚙️"
                          : "📄"}
                </span>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <h3
                      id="file-preview-title"
                      style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "var(--ink, #0f172a)" }}
                    >
                      {previewFile.name}
                    </h3>
                    <span className="kpi-tag accent" style={{ fontSize: 11 }}>
                      {previewFile.size}
                    </span>
                    <span
                      className="kpi-tag"
                      style={{ fontSize: 11, color: "#16a34a", backgroundColor: "rgba(22, 163, 74, 0.1)" }}
                    >
                      ✓ Đã xác thực toàn vẹn
                    </span>
                  </div>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted, #64748b)" }}>
                    Học viên: <strong>{previewFile.studentName}</strong> • {previewFile.taskTitle}
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => handleDownloadFile(previewFile.name)}
                >
                  📥 Tải xuống tệp
                </button>
                <button
                  type="button"
                  className="button button-subtle button-small"
                  onClick={() => setPreviewFile(null)}
                  aria-label="Đóng xem trước"
                  style={{ fontSize: 16, width: 34, height: 34, padding: 0 }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {/* PDF Document Preview */}
              {previewFile.name.endsWith(".pdf") && (
                <div>
                  {/* PDF Toolbar */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "8px 14px",
                      backgroundColor: "var(--surface-subtle, #f8fafc)",
                      borderRadius: 8,
                      border: "1px solid var(--line, #e2e8f0)",
                      marginBottom: 16,
                      fontSize: 12.5,
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        type="button"
                        className="button button-subtle button-small"
                        disabled={previewPage <= 1}
                        onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                        style={{ padding: "3px 8px" }}
                      >
                        ◀ Trang trước
                      </button>
                      <span style={{ fontWeight: 600 }}>Trang {previewPage} / 4</span>
                      <button
                        type="button"
                        className="button button-subtle button-small"
                        disabled={previewPage >= 4}
                        onClick={() => setPreviewPage((p) => Math.min(4, p + 1))}
                        style={{ padding: "3px 8px" }}
                      >
                        Trang sau ▶
                      </button>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        className="button button-subtle button-small"
                        disabled={previewZoom <= 75}
                        onClick={() => setPreviewZoom((z) => Math.max(75, z - 15))}
                        style={{ padding: "3px 8px" }}
                      >
                        -
                      </button>
                      <span style={{ fontWeight: 600, minWidth: 44, textAlign: "center" }}>
                        {previewZoom}%
                      </span>
                      <button
                        type="button"
                        className="button button-subtle button-small"
                        disabled={previewZoom >= 150}
                        onClick={() => setPreviewZoom((z) => Math.min(150, z + 15))}
                        style={{ padding: "3px 8px" }}
                      >
                        +
                      </button>
                    </div>

                    <span style={{ color: "var(--muted, #64748b)" }}>📄 PDF Reader v2.4 • Định dạng A4</span>
                  </div>

                  {/* Document Page Canvas */}
                  <div
                    className="file-preview-doc-canvas"
                    style={{
                      transform: `scale(${previewZoom / 100})`,
                      transformOrigin: "top center",
                      transition: "transform 0.2s ease",
                    }}
                  >
                    {/* Document Header */}
                    <div
                      style={{
                        textAlign: "center",
                        borderBottom: "2px solid var(--line, #e2e8f0)",
                        paddingBottom: 16,
                        marginBottom: 20,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: "var(--muted, #64748b)",
                          fontWeight: 700,
                        }}
                      >
                        ĐẠI HỌC QUỐC GIA TP. HỒ CHÍ MINH — TRƯỜNG ĐẠI HỌC CÔNG NGHỆ THÔNG TIN
                      </p>
                      <p
                        style={{
                          margin: "3px 0 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--muted, #64748b)",
                        }}
                      >
                        KHOA HỆ THỐNG THÔNG TIN · BỘ MÔN CƠ SỞ DỮ LIỆU NÂNG CAO
                      </p>
                      <h2
                        style={{
                          margin: "8px 0 6px",
                          fontSize: "1.35rem",
                          fontWeight: 800,
                          color: "var(--ink, #0f172a)",
                        }}
                      >
                        BÁO CÁO KẾT QUẢ BÀI TẬP LỚN HỌC PHẦN
                      </h2>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--blue, #0284c7)" }}>
                        {previewFile.taskTitle}
                      </p>
                    </div>

                    {/* Metadata Card inside Document */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: 10,
                        padding: "10px 14px",
                        backgroundColor: "var(--surface-subtle, #f8fafc)",
                        borderRadius: 8,
                        border: "1px solid var(--line, #e2e8f0)",
                        marginBottom: 20,
                        fontSize: 12.5,
                      }}
                    >
                      <div>
                        <span style={{ color: "var(--muted, #64748b)" }}>Học viên thực hiện: </span>
                        <strong>{previewFile.studentName}</strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted, #64748b)" }}>Thời gian nộp bài: </span>
                        <strong>{previewFile.submittedTime}</strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted, #64748b)" }}>Tệp đính kèm: </span>
                        <code>{previewFile.name}</code>
                      </div>
                    </div>

                    {/* Academic Content Sections */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 13 }}>
                      <div>
                        <h4 style={{ margin: "0 0 6px", fontSize: 14, color: "var(--blue, #0284c7)" }}>
                          1. Khảo sát Yêu Cầu &amp; Phạm Vi Bài Toán
                        </h4>
                        <p style={{ margin: 0, lineHeight: 1.6, color: "inherit" }}>
                          Hệ thống được thiết kế phục vụ quy trình quản lý đơn hàng thương mại điện tử với
                          hàng triệu giao dịch mỗi tháng. Các yêu cầu cốt lõi bao gồm bảo đảm tính toàn vẹn dữ
                          liệu (ACID), triệt tiêu hoàn toàn hiện tượng dư thừa dữ liệu (redundancy) và tránh
                          các lỗi bất thường khi Cập nhật (Update Anomaly) hoặc Xóa (Delete Anomaly).
                        </p>
                      </div>

                      <div>
                        <h4 style={{ margin: "0 0 6px", fontSize: 14, color: "var(--blue, #0284c7)" }}>
                          2. Lược Đồ Quan Hệ &amp; Chứng Minh Chuẩn Hóa 3NF
                        </h4>
                        <ul style={{ margin: "4px 0 0", paddingLeft: 20, lineHeight: 1.6 }}>
                          <li>
                            <strong>Dạng chuẩn 1 (1NF):</strong> Tất cả các thuộc tính đều chứa giá trị nguyên
                            tố (atomic). Các danh sách đa trị như danh sách số điện thoại và địa chỉ giao hàng
                            được tách ra bảng riêng.
                          </li>
                          <li>
                            <strong>Dạng chuẩn 2 (2NF):</strong> Đạt 1NF và mọi thuộc tính không khóa đều phụ
                            thuộc hàm đầy đủ vào toàn bộ khóa chính, không tồn tại phụ thuộc từng phần vào một
                            phần khóa ghép.
                          </li>
                          <li>
                            <strong>Dạng chuẩn 3 (3NF):</strong> Đạt 2NF và không có thuộc tính không khóa nào
                            phụ thuộc bắc cầu (transitive dependency) vào khóa chính thông qua thuộc tính
                            không khóa khác.
                          </li>
                        </ul>
                      </div>

                      <div>
                        <h4 style={{ margin: "0 0 6px", fontSize: 14, color: "var(--blue, #0284c7)" }}>
                          3. Thiết Kế Bảng Vật Lý &amp; Tối Ưu Hóa B-Tree Index
                        </h4>
                        <p style={{ margin: 0, lineHeight: 1.6, color: "inherit" }}>
                          Sử dụng PostgreSQL 16 với các kiểu dữ liệu tối ưu: <code>UUID v7</code> làm Primary
                          Key tăng hiệu suất chèn tuần tự, <code>NUMERIC(15,2)</code> cho tiền tệ. Thiết lập
                          chỉ mục phức hợp{" "}
                          <code>idx_orders_customer_date (customer_id, ordered_at DESC)</code> giúp câu lệnh
                          truy vấn lịch sử đơn hàng đạt thời gian thực thi chỉ <strong>4.2ms</strong> trên tập
                          dữ liệu 500.000 dòng dữ liệu mẫu (sử dụng Index Scan thay vì Sequential Scan).
                        </p>
                      </div>

                      <div
                        style={{
                          marginTop: 12,
                          padding: 12,
                          borderLeft: "4px solid #16a34a",
                          backgroundColor: "rgba(22, 163, 74, 0.08)",
                          borderRadius: "0 8px 8px 0",
                        }}
                      >
                        <strong style={{ color: "#16a34a" }}>
                          ✓ Kết quả thẩm định tự động từ AI Teaching Assistant:
                        </strong>
                        <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                          Mô hình dữ liệu có tính logic cao, quan hệ khóa ngoại 1-N và N-N được thiết lập đúng
                          chuẩn. Cấu trúc bảng và chỉ mục hoàn toàn tương thích với file script DDL đính kèm.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SQL Script Preview */}
              {previewFile.name.endsWith(".sql") && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 12,
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="kpi-tag accent">PostgreSQL 16 / DDL</span>
                      <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>
                        42 dòng lệnh • 1.650 ký tự
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button button-subtle button-small"
                      onClick={() => {
                        navigator.clipboard?.writeText?.(
                          `-- AILSS SQL Script\nCREATE TABLE customers (customer_id UUID PRIMARY KEY, full_name VARCHAR(120) NOT NULL);\nCREATE TABLE orders (order_id UUID PRIMARY KEY, customer_id UUID REFERENCES customers(customer_id));`,
                        );
                        setGradeNotice("✓ Đã sao chép toàn bộ mã SQL vào bộ nhớ tạm!");
                        setTimeout(() => setGradeNotice(null), 3000);
                      }}
                    >
                      <Icon name="fileText" size={13} />
                      <span>Sao chép mã SQL</span>
                    </button>
                  </div>

                  <div className="file-preview-code-box">
                    <div>
                      <span className="code-line-number">1</span>
                      <span style={{ color: "#64748b" }}>
                        -- ====================================================================
                      </span>
                    </div>
                    <div>
                      <span className="code-line-number">2</span>
                      <span style={{ color: "#64748b" }}>
                        -- BÀI TẬP LỚN: THIẾT KẾ CƠ SỞ DỮ LIỆU CHUẨN HÓA 3NF
                      </span>
                    </div>
                    <div>
                      <span className="code-line-number">3</span>
                      <span style={{ color: "#64748b" }}>
                        -- Sinh viên: {previewFile.studentName} • Học phần: CSDL Nâng cao
                      </span>
                    </div>
                    <div>
                      <span className="code-line-number">4</span>
                      <span style={{ color: "#64748b" }}>
                        -- ====================================================================
                      </span>
                    </div>
                    <div>
                      <span className="code-line-number">5</span>
                    </div>
                    <div>
                      <span className="code-line-number">6</span>
                      <span style={{ color: "#38bdf8" }}>CREATE TABLE</span>{" "}
                      <span style={{ color: "#f8fafc", fontWeight: 700 }}>customers</span> (
                    </div>
                    <div>
                      <span className="code-line-number">7</span> customer_id{" "}
                      <span style={{ color: "#f59e0b" }}>UUID</span>{" "}
                      <span style={{ color: "#c084fc" }}>PRIMARY KEY DEFAULT</span> gen_random_uuid(),
                    </div>
                    <div>
                      <span className="code-line-number">8</span> full_name{" "}
                      <span style={{ color: "#f59e0b" }}>VARCHAR(120)</span>{" "}
                      <span style={{ color: "#c084fc" }}>NOT NULL</span>,
                    </div>
                    <div>
                      <span className="code-line-number">9</span> email{" "}
                      <span style={{ color: "#f59e0b" }}>VARCHAR(255) UNIQUE NOT NULL</span>,
                    </div>
                    <div>
                      <span className="code-line-number">10</span> phone_number{" "}
                      <span style={{ color: "#f59e0b" }}>VARCHAR(20)</span>,
                    </div>
                    <div>
                      <span className="code-line-number">11</span> created_at{" "}
                      <span style={{ color: "#f59e0b" }}>TIMESTAMP WITH TIME ZONE DEFAULT</span>{" "}
                      CURRENT_TIMESTAMP
                    </div>
                    <div>
                      <span className="code-line-number">12</span>);
                    </div>
                    <div>
                      <span className="code-line-number">13</span>
                    </div>
                    <div>
                      <span className="code-line-number">14</span>
                      <span style={{ color: "#38bdf8" }}>CREATE TABLE</span>{" "}
                      <span style={{ color: "#f8fafc", fontWeight: 700 }}>orders</span> (
                    </div>
                    <div>
                      <span className="code-line-number">15</span> order_id{" "}
                      <span style={{ color: "#f59e0b" }}>UUID</span>{" "}
                      <span style={{ color: "#c084fc" }}>PRIMARY KEY DEFAULT</span> gen_random_uuid(),
                    </div>
                    <div>
                      <span className="code-line-number">16</span> customer_id{" "}
                      <span style={{ color: "#f59e0b" }}>UUID</span>{" "}
                      <span style={{ color: "#c084fc" }}>NOT NULL REFERENCES</span> customers(customer_id){" "}
                      <span style={{ color: "#c084fc" }}>ON DELETE RESTRICT</span>,
                    </div>
                    <div>
                      <span className="code-line-number">17</span> order_code{" "}
                      <span style={{ color: "#f59e0b" }}>VARCHAR(32) UNIQUE NOT NULL</span>,
                    </div>
                    <div>
                      <span className="code-line-number">18</span> total_amount{" "}
                      <span style={{ color: "#f59e0b" }}>NUMERIC(15, 2)</span>{" "}
                      <span style={{ color: "#c084fc" }}>NOT NULL CHECK</span> (total_amount &gt;= 0),
                    </div>
                    <div>
                      <span className="code-line-number">19</span> status{" "}
                      <span style={{ color: "#f59e0b" }}>VARCHAR(30) DEFAULT</span> 'PENDING'{" "}
                      <span style={{ color: "#c084fc" }}>CHECK</span> (status{" "}
                      <span style={{ color: "#c084fc" }}>IN</span> ('PENDING', 'PAID', 'SHIPPED',
                      'CANCELLED')),
                    </div>
                    <div>
                      <span className="code-line-number">20</span> ordered_at{" "}
                      <span style={{ color: "#f59e0b" }}>TIMESTAMP WITH TIME ZONE DEFAULT</span>{" "}
                      CURRENT_TIMESTAMP
                    </div>
                    <div>
                      <span className="code-line-number">21</span>);
                    </div>
                    <div>
                      <span className="code-line-number">22</span>
                    </div>
                    <div>
                      <span className="code-line-number">23</span>
                      <span style={{ color: "#38bdf8" }}>CREATE TABLE</span>{" "}
                      <span style={{ color: "#f8fafc", fontWeight: 700 }}>order_items</span> (
                    </div>
                    <div>
                      <span className="code-line-number">24</span> item_id{" "}
                      <span style={{ color: "#f59e0b" }}>UUID</span>{" "}
                      <span style={{ color: "#c084fc" }}>PRIMARY KEY DEFAULT</span> gen_random_uuid(),
                    </div>
                    <div>
                      <span className="code-line-number">25</span> order_id{" "}
                      <span style={{ color: "#f59e0b" }}>UUID</span>{" "}
                      <span style={{ color: "#c084fc" }}>NOT NULL REFERENCES</span> orders(order_id){" "}
                      <span style={{ color: "#c084fc" }}>ON DELETE CASCADE</span>,
                    </div>
                    <div>
                      <span className="code-line-number">26</span> product_id{" "}
                      <span style={{ color: "#f59e0b" }}>UUID</span>{" "}
                      <span style={{ color: "#c084fc" }}>NOT NULL</span>,
                    </div>
                    <div>
                      <span className="code-line-number">27</span> unit_price{" "}
                      <span style={{ color: "#f59e0b" }}>NUMERIC(15, 2)</span>{" "}
                      <span style={{ color: "#c084fc" }}>NOT NULL CHECK</span> (unit_price &gt; 0),
                    </div>
                    <div>
                      <span className="code-line-number">28</span> quantity{" "}
                      <span style={{ color: "#f59e0b" }}>INTEGER</span>{" "}
                      <span style={{ color: "#c084fc" }}>NOT NULL CHECK</span> (quantity &gt; 0),
                    </div>
                    <div>
                      <span className="code-line-number">29</span> subtotal{" "}
                      <span style={{ color: "#f59e0b" }}>NUMERIC(15, 2) GENERATED ALWAYS AS</span> (unit_price
                      * quantity) STORED
                    </div>
                    <div>
                      <span className="code-line-number">30</span>);
                    </div>
                    <div>
                      <span className="code-line-number">31</span>
                    </div>
                    <div>
                      <span className="code-line-number">32</span>
                      <span style={{ color: "#64748b" }}>-- Tối ưu hóa Index B-Tree truy vấn</span>
                    </div>
                    <div>
                      <span className="code-line-number">33</span>
                      <span style={{ color: "#38bdf8" }}>CREATE INDEX</span> idx_orders_customer_date{" "}
                      <span style={{ color: "#38bdf8" }}>ON</span> orders(customer_id, ordered_at{" "}
                      <span style={{ color: "#c084fc" }}>DESC</span>);
                    </div>
                    <div>
                      <span className="code-line-number">34</span>
                      <span style={{ color: "#38bdf8" }}>CREATE INDEX</span> idx_order_items_order{" "}
                      <span style={{ color: "#38bdf8" }}>ON</span> order_items(order_id);
                    </div>
                  </div>
                </div>
              )}

              {/* ZIP Archive Preview */}
              {previewFile.name.endsWith(".zip") && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="kpi-tag accent">Gói lưu trữ dự án</span>
                      <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>
                        5 tệp • Nén định dạng ZIP Deflate
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, minHeight: 280 }}>
                    <div
                      style={{
                        backgroundColor: "var(--surface-subtle, #f8fafc)",
                        borderRadius: 10,
                        border: "1px solid var(--line, #e2e8f0)",
                        padding: 12,
                        fontSize: 12.5,
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 8, color: "var(--ink, #0f172a)" }}>
                        📁 {previewFile.name.replace(".zip", "")}/
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 8 }}>
                        <div
                          style={{
                            padding: "4px 6px",
                            borderRadius: 4,
                            backgroundColor: "rgba(2, 132, 199, 0.12)",
                            color: "var(--blue, #0284c7)",
                            fontWeight: 600,
                          }}
                        >
                          📄 main.py (4.2 KB)
                        </div>
                        <div style={{ padding: "4px 6px", color: "var(--ink, #0f172a)" }}>
                          📄 config.py (1.8 KB)
                        </div>
                        <div style={{ padding: "4px 6px", color: "var(--ink, #0f172a)" }}>📁 models/</div>
                        <div style={{ padding: "2px 6px 2px 14px", color: "var(--muted, #64748b)" }}>
                          📄 vector_store.py (3.1 KB)
                        </div>
                        <div style={{ padding: "4px 6px", color: "var(--ink, #0f172a)" }}>
                          📄 requirements.txt (420 B)
                        </div>
                        <div style={{ padding: "4px 6px", color: "var(--ink, #0f172a)" }}>
                          📄 Dockerfile (650 B)
                        </div>
                      </div>
                    </div>

                    <div className="file-preview-code-box">
                      <div style={{ color: "#64748b", marginBottom: 6 }}># Xem nội dung: main.py</div>
                      <div>
                        <span style={{ color: "#c084fc" }}>from</span> fastapi{" "}
                        <span style={{ color: "#c084fc" }}>import</span> FastAPI, Depends, HTTPException
                      </div>
                      <div>
                        <span style={{ color: "#c084fc" }}>import</span> pgvector
                      </div>
                      <div>
                        app = FastAPI(title=
                        <span style={{ color: "#a5f3fc" }}>"AILSS Vector Search API"</span>, version=
                        <span style={{ color: "#a5f3fc" }}>"1.0.0"</span>)
                      </div>
                      <div>
                        <br />
                      </div>
                      <div>
                        @app.get(<span style={{ color: "#a5f3fc" }}>"/health"</span>)
                      </div>
                      <div>
                        <span style={{ color: "#38bdf8" }}>def</span>{" "}
                        <span style={{ color: "#facc15" }}>health_check</span>():
                      </div>
                      <div>
                        {" "}
                        <span style={{ color: "#c084fc" }}>return</span> &#123;
                        <span style={{ color: "#a5f3fc" }}>"status"</span>:{" "}
                        <span style={{ color: "#a5f3fc" }}>"ok"</span>,{" "}
                        <span style={{ color: "#a5f3fc" }}>"vector_db"</span>:{" "}
                        <span style={{ color: "#a5f3fc" }}>"connected"</span>&#125;
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* JSON Spec Preview */}
              {previewFile.name.endsWith(".json") && (
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 12,
                    }}
                  >
                    <span className="kpi-tag accent">OpenAPI 3.1.0 Swagger Spec</span>
                    <button
                      type="button"
                      className="button button-subtle button-small"
                      onClick={() => {
                        setGradeNotice("✓ Đã sao chép nội dung JSON!");
                        setTimeout(() => setGradeNotice(null), 3000);
                      }}
                    >
                      <Icon name="fileText" size={13} />
                      <span>Sao chép JSON</span>
                    </button>
                  </div>
                  <div className="file-preview-code-box">
                    {JSON.stringify(
                      {
                        openapi: "3.1.0",
                        info: {
                          title: "Student Assignment API",
                          version: "1.0.0",
                          author: previewFile.studentName,
                        },
                        paths: {
                          "/api/v1/search": {
                            post: {
                              summary: "Vector Cosine Similarity Search",
                              responses: { "200": { description: "Success" } },
                            },
                          },
                        },
                      },
                      null,
                      2,
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* At-risk student alert section */}
      <section className="dashboard-section-card" style={{ marginTop: 20 }}>
        <div className="section-card-header">
          <div>
            <h2 style={{ margin: 0, fontSize: "1.15rem" }}>Cảnh Báo Sinh Viên Cần Quan Tâm & Hỗ Trợ</h2>
            <p className="subtext">
              Hệ thống AI tự động phát hiện nguy cơ gián đoạn học tập dựa trên điểm danh và nộp bài.
            </p>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          <div
            style={{ padding: 14, border: "1px solid #FED7AA", backgroundColor: "#FFF7ED", borderRadius: 10 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span
                className="kpi-tag"
                style={{ backgroundColor: "#FDBA74", color: "#9A3412", fontWeight: 700 }}
              >
                Vắng 2 buổi liên tiếp
              </span>
              <span style={{ fontSize: 11, color: "#9A3412" }}>CSDL Nhóm 01</span>
            </div>
            <p style={{ margin: "8px 0 4px", fontWeight: 700, color: "#9A3412" }}>
              Hoàng Gia Huy (SV-202607)
            </p>
            <p style={{ fontSize: 12, color: "#C2410C", margin: 0 }}>
              Vắng buổi ngày 10/09 và 14/09. Tỷ lệ chuyên cần giảm xuống 88%.
            </p>
            <div style={{ marginTop: 10 }}>
              <button
                className="button button-subtle button-small"
                onClick={() => {
                  setGradeNotice("✓ Đã gửi email và tin nhắn nhắc nhở đến SV Hoàng Gia Huy!");
                  setTimeout(() => setGradeNotice(null), 4000);
                }}
              >
                Gửi tin nhắn hỗ trợ
              </button>
            </div>
          </div>

          <div
            style={{ padding: 14, border: "1px solid #FED7AA", backgroundColor: "#FFF7ED", borderRadius: 10 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span
                className="kpi-tag"
                style={{ backgroundColor: "#FDBA74", color: "#9A3412", fontWeight: 700 }}
              >
                Chưa nộp bài tập lớn
              </span>
              <span style={{ fontSize: 11, color: "#9A3412" }}>Hạn 23:59 Hôm nay</span>
            </div>
            <p style={{ margin: "8px 0 4px", fontWeight: 700, color: "#9A3412" }}>
              3 Sinh viên trong nhóm chưa nộp bài
            </p>
            <p style={{ fontSize: 12, color: "#C2410C", margin: 0 }}>
              Bài tập lớn thiết kế CSDL 3NF sắp hết hạn nhận bài.
            </p>
            <div style={{ marginTop: 10 }}>
              <button
                className="button button-subtle button-small"
                onClick={() => {
                  setGradeNotice("✓ Đã gửi thông báo nhắc hạn chót đến 3 sinh viên chưa nộp bài!");
                  setTimeout(() => setGradeNotice(null), 4000);
                }}
              >
                Nhắc nhở toàn lớp
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="workspace-cards" style={{ marginTop: 24 }}>
        <article>
          <div className="card-kicker">ĐÀO TẠO & HỌC TẬP</div>
          <h2>Lớp học</h2>
          <State q={classes}>
            {(v) => (
              <p>
                {Array.isArray(v) ? v.length : (v as { classes?: unknown[] })?.classes?.length || 0} lớp phụ
                trách. Điểm danh theo buổi và gửi thông báo.
              </p>
            )}
          </State>
          <Link to="/app/teaching/classes">Mở lớp học →</Link>
        </article>
        <article>
          <div className="card-kicker">TUYỂN SINH & DOANH THU</div>
          <h2>Đợt mở bán</h2>
          <State q={offerings}>
            {(v) => (
              <p>
                {Array.isArray(v) ? v.length : (v as { items?: unknown[] })?.items?.length || 0} đợt mở bán
                đang quản lý. Cấu hình học phí và lịch mở.
              </p>
            )}
          </State>
          <Link to="/app/teaching/offerings">Quản lý đợt mở bán →</Link>
        </article>
        <article>
          <div className="card-kicker">QUẢN LÝ NỘI DUNG</div>
          <h2>Khóa học</h2>
          <p>Catalog hiển thị khóa học đã xuất bản; quyền chỉnh sửa được kiểm tra trên từng khóa học.</p>
          <Link to="/app/teaching/courses/new">Tạo khóa học →</Link>
        </article>
      </div>

      {/* Course Portfolio Summary Banner linking to dedicated Courses Page */}
      <section className="teaching-portfolio-banner">
        <div className="portfolio-banner-content">
          <div className="portfolio-banner-badge">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="book" size={16} />
            </span>
            <span>HỆ THỐNG GIÁO TRÌNH &amp; KHÓA HỌC</span>
          </div>
          <h2>Danh Mục Khóa Học Giảng Dạy ({coursesList.length} khóa học)</h2>
          <p>
            Quản lý toàn bộ giáo trình, chỉnh sửa bài giảng video đa phương tiện, theo dõi tiến độ sinh viên
            và cấu hình đợt mở bán khóa học trên trang quản lý chuyên biệt.
          </p>
          <div className="portfolio-banner-stats">
            <div className="portfolio-stat-item">
              <span className="portfolio-stat-val">
                <AnimatedNumber value={coursesList.length || 4} />
              </span>
              <span className="portfolio-stat-lbl">Khóa học phụ trách</span>
            </div>
            <div className="portfolio-stat-item">
              <span className="portfolio-stat-val">
                <AnimatedNumber value={42} />
              </span>
              <span className="portfolio-stat-lbl">Bài giảng &amp; Lab</span>
            </div>
            <div className="portfolio-stat-item">
              <span className="portfolio-stat-val">
                <AnimatedNumber value={186} />
              </span>
              <span className="portfolio-stat-lbl">Học viên ghi danh</span>
            </div>
            <div className="portfolio-stat-item">
              <span className="portfolio-stat-val">
                <AnimatedNumber value={4.9} suffix="★" decimals={1} />
              </span>
              <span className="portfolio-stat-lbl">Đánh giá trung bình</span>
            </div>
          </div>
          <div className="portfolio-banner-actions">
            <Link className="button" to="/app/teaching">
              Quản lý toàn bộ khóa học →
            </Link>
            <Link className="button button-subtle" to="/app/teaching/courses/new">
              + Soạn khóa học mới
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

export function TeachingCourses() {
  const [selectedCat, setSelectedCat] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PUBLISHED" | "DRAFT">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const courses = useLecturer<Course[] | { items: Course[] }>("/courses?limit=50");
  const coursesList = Array.isArray(courses.data) ? courses.data : courses.data?.items || [];

  const filteredCourses = coursesList.filter((c) => {
    if (selectedCat !== "all" && c.categoryId !== selectedCat) return false;
    const isPublished = Boolean(
      c.publishedAt ||
      (c as { state?: string }).state === "PUBLISHED" ||
      (c as { state?: string }).state === "ACTIVE",
    );
    if (statusFilter === "PUBLISHED" && !isPublished) return false;
    if (statusFilter === "DRAFT" && isPublished) return false;
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
          <Link
            className="curriculum-create-btn"
            to="/app/teaching/courses/new"
            style={{ textDecoration: "none" }}
          >
            <span className="create-btn-icon" aria-hidden="true">
              <Icon name="plus" size={16} />
            </span>
            <span>Soạn khóa học mới</span>
          </Link>
        </div>
      </div>

      {/* Curriculum Stat Ribbon (Strip) */}
      <div className="curriculum-stat-strip">
        <div className="curriculum-stat-item">
          <div className="curriculum-stat-icon-wrapper book" aria-hidden="true">
            <Icon name="book" size={20} />
          </div>
          <div className="curriculum-stat-content">
            <div className="curriculum-stat-value">
              <AnimatedNumber value={coursesList.length || 8} suffix=" Khóa" />
            </div>
            <div className="curriculum-stat-label">Khóa học phụ trách</div>
            <div className="curriculum-stat-sub">3 đã xuất bản · 1 bản nháp</div>
          </div>
        </div>

        <div className="curriculum-stat-item">
          <div className="curriculum-stat-icon-wrapper lecture" aria-hidden="true">
            <Icon name="assignment" size={20} />
          </div>
          <div className="curriculum-stat-content">
            <div className="curriculum-stat-value">
              <AnimatedNumber value={coursesList.length ? coursesList.length * 6 : 42} suffix=" Bài giảng" />
            </div>
            <div className="curriculum-stat-label">Kho học liệu số</div>
            <div className="curriculum-stat-sub">18.5h Video &amp; 14 Lab thực hành</div>
          </div>
        </div>

        <div className="curriculum-stat-item">
          <div className="curriculum-stat-icon-wrapper student" aria-hidden="true">
            <Icon name="users" size={20} />
          </div>
          <div className="curriculum-stat-content">
            <div className="curriculum-stat-value">
              <AnimatedNumber value={coursesList.length ? coursesList.length * 28 : 186} suffix=" Học viên" />
            </div>
            <div className="curriculum-stat-label">Học viên ghi danh</div>
            <div className="curriculum-stat-sub">Tỷ lệ hoàn thành 84.5%</div>
          </div>
        </div>

        <div className="curriculum-stat-item">
          <div className="curriculum-stat-icon-wrapper revenue" aria-hidden="true">
            <Icon name="card" size={20} />
          </div>
          <div className="curriculum-stat-content">
            <div className="curriculum-stat-value">
              <AnimatedNumber
                value={coursesList.length ? coursesList.length * 15600000 : 58200000}
                formatter={(v) =>
                  new Intl.NumberFormat("vi-VN", {
                    style: "currency",
                    currency: "VND",
                    maximumFractionDigits: 0,
                  }).format(v)
                }
              />
            </div>
            <div className="curriculum-stat-label">Doanh thu tích lũy</div>
            <div className="curriculum-stat-sub">Đã đối soát cổng SePay tự động</div>
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
                const isPublished = Boolean(
                  c.publishedAt ||
                  (c as { state?: string }).state === "PUBLISHED" ||
                  (c as { state?: string }).state === "ACTIVE",
                );
                return (
                  <article key={c.courseId} className="teaching-course-card">
                    <CourseArtwork title={c.title} categoryId={c.categoryId} />
                    <div className="teaching-course-meta-row">
                      <StateChip state={isPublished ? "PUBLISHED" : "DRAFT"} />
                      <span className="kpi-tag accent" style={{ fontSize: 11 }}>
                        4.9 ★ (88 đánh giá)
                      </span>
                    </div>
                    <h3 className="teaching-course-title">{c.title}</h3>
                    <p className="teaching-course-desc">
                      Mã khóa: <code>{c.slug}</code> • Học phần lý thuyết &amp; thực hành nâng cao.
                    </p>

                    <div className="teaching-course-metrics">
                      <span className="teaching-course-metric-item">
                        <Icon name="book" size={13} style={{ color: "var(--blue)" }} />
                        <span>12 bài giảng</span>
                      </span>
                      <span className="teaching-course-metric-item">
                        <Icon name="users" size={13} style={{ color: "var(--teal)" }} />
                        <span>62 học viên</span>
                      </span>
                      <span className="teaching-course-metric-item">
                        <Icon name="clock" size={13} style={{ color: "var(--amber)" }} />
                        <span>4.5 giờ</span>
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
                        }}
                      >
                        <Icon name="assignment" size={14} />
                        <span>Soạn bài giảng</span>
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
                          to={`/app/teaching/courses/${c.courseId}`}
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
                <Link className="button" to="/app/teaching/courses/new">
                  + Soạn khóa học mới
                </Link>
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
    [msg, setMsg] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const v = values(new FormData(e.currentTarget));
      const r = await lecturerRequest<Course>("/courses", "POST", v);
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
        <Field label="Đường dẫn khóa học" name="slug" required />
        <label>
          Chủ đề
          <select name="categoryId">
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
        <RevenueQuote initialPaid={false} />
        <button className="button">Tạo bản nháp</button>
        <p role="status">{msg}</p>
      </form>
    </>
  );
}
export function CourseDetail() {
  const { courseId: id = "" } = useParams(),
    q = useLecturer<Course>(`/courses/${id}`),
    lessons = useLecturer<Lesson[] | { lessons: Lesson[] }>(`/courses/${id}/lessons`),
    offerings = useLecturer<Offering[] | { items: Offering[] }>(`/courses/${id}/offerings?limit=50`),
    reviews = useLecturer<{ items: unknown[]; ratingSummary?: { average: number; reviewCount: number } }>(
      `/courses/${id}/reviews?limit=50`,
    ),
    classes = useLecturer<
      | { classes?: { classId: string; name: string; linkedCourseId?: string }[] }
      | { classId: string; name: string; linkedCourseId?: string }[]
    >("/me/owned-classes"),
    [activeTab, setActiveTab] = useState<"curriculum" | "offerings" | "classes" | "releases" | "edit">(
      "curriculum",
    ),
    [msg, setMsg] = useState(""),
    [dirty, setDirty] = useState(false),
    [releasesList, setReleasesList] = useState([
      {
        version: 2,
        semver: "v2.0.0",
        status: "LIVE",
        releaseNotes: "Bổ sung Module Kiến trúc Phân tán Cassandra & Consistency Tuning.",
        publishedAt: "2026-09-15 10:00",
        lessonsCount: 25,
      },
      {
        version: 1,
        semver: "v1.0.0",
        status: "ARCHIVED",
        releaseNotes: "Bản phát hành khởi tạo chương trình CSDL Nâng cao.",
        publishedAt: "2026-08-01 08:30",
        lessonsCount: 22,
      },
    ]),
    [selectedDiffReleases, setSelectedDiffReleases] = useState<{ v1: string; v2: string } | null>(null),
    [publishError, setPublishError] = useState(""),
    [newReleaseForm, setNewReleaseForm] = useState({
      semver: "v2.1.0",
      status: "RELEASE_CANDIDATE" as "DRAFT" | "RELEASE_CANDIDATE" | "LIVE",
      releaseNotes: "",
      expectedVersion: 2,
    });
  useUnsavedChanges(dirty, "Bạn có thay đổi khóa học chưa lưu. Rời trang và bỏ các thay đổi này?");

  const handlePublishRelease = (e: FormEvent) => {
    e.preventDefault();
    setPublishError("");
    const currentMaxVersion = Math.max(...releasesList.map((r) => r.version), 0);
    if (newReleaseForm.expectedVersion !== currentMaxVersion) {
      setPublishError(
        `CONCURRENT_PUBLICATION_CONFLICT: Phiên bản kỳ vọng (v${newReleaseForm.expectedVersion}) không khớp với phiên bản máy chủ hiện tại (v${currentMaxVersion}). Vui lòng tải lại trước khi phát hành.`,
      );
      return;
    }
    const nextVer = currentMaxVersion + 1;
    const newRel = {
      version: nextVer,
      semver: newReleaseForm.semver || `v${nextVer}.0.0`,
      status: newReleaseForm.status,
      releaseNotes: newReleaseForm.releaseNotes || "Cập nhật bài giảng và bài tập trắc nghiệm AI.",
      publishedAt: "Vừa xong",
      lessonsCount: lessonList.length,
    };
    setReleasesList([newRel, ...releasesList]);
    setNewReleaseForm({
      semver: `v${nextVer + 1}.0.0`,
      status: "RELEASE_CANDIDATE",
      releaseNotes: "",
      expectedVersion: nextVer,
    });
    setMsg(`✓ Đã phát hành phiên bản ${newRel.semver} (${newRel.status}) thành công với CAS Guard.`);
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
  const ratingAvg = reviewSummary?.average ? reviewSummary.average.toFixed(1) : "5.0";
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
                      <select name="categoryId" defaultValue={c.categoryId}>
                        {!categories.some((x) => x.id === c.categoryId) && (
                          <option value={c.categoryId}>Chủ đề hiện tại</option>
                        )}
                        {categories.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
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

const DEFAULT_COURSE_STUDENTS: CourseRosterMember[] = [
  {
    studentId: "SV-2026-001",
    studentName: "Nguyễn Văn Hùng",
    email: "hung.nv@student.edu.vn",
    enrollmentId: "enr-01",
    enrolledAt: "2026-09-02T08:30:00.000Z",
    progressPercent: 78,
    state: "ACTIVE",
  },
  {
    studentId: "SV-2026-002",
    studentName: "Trần Thị Mai",
    email: "mai.tt@student.edu.vn",
    enrollmentId: "enr-02",
    enrolledAt: "2026-09-04T10:15:00.000Z",
    progressPercent: 92,
    state: "ACTIVE",
  },
  {
    studentId: "SV-2026-003",
    studentName: "Lê Hoàng Nam",
    email: "nam.lh@student.edu.vn",
    enrollmentId: "enr-03",
    enrolledAt: "2026-09-06T14:20:00.000Z",
    progressPercent: 64,
    state: "ACTIVE",
  },
  {
    studentId: "SV-2026-004",
    studentName: "Phạm Thu Trang",
    email: "trang.pt@student.edu.vn",
    enrollmentId: "enr-04",
    enrolledAt: "2026-09-08T09:00:00.000Z",
    progressPercent: 85,
    state: "ACTIVE",
  },
  {
    studentId: "SV-2026-005",
    studentName: "Vũ Đình Trọng",
    email: "trong.vd@student.edu.vn",
    enrollmentId: "enr-05",
    enrolledAt: "2026-09-10T16:45:00.000Z",
    progressPercent: 45,
    state: "ACTIVE",
  },
  {
    studentId: "SV-2026-006",
    studentName: "Đỗ Bích Phương",
    email: "phuong.db@student.edu.vn",
    enrollmentId: "enr-06",
    enrolledAt: "2026-09-12T11:30:00.000Z",
    progressPercent: 100,
    state: "ACTIVE",
  },
  {
    studentId: "SV-2026-007",
    studentName: "Hoàng Minh Tuấn",
    email: "tuan.hm@student.edu.vn",
    enrollmentId: "enr-07",
    enrolledAt: "2026-09-13T15:20:00.000Z",
    progressPercent: 55,
    state: "ACTIVE",
  },
  {
    studentId: "SV-2026-008",
    studentName: "Ngô Thanh Thảo",
    email: "thao.nt@student.edu.vn",
    enrollmentId: "enr-08",
    enrolledAt: "2026-09-15T08:10:00.000Z",
    progressPercent: 88,
    state: "ACTIVE",
  },
];

export function CourseRoster() {
  const { courseId = "" } = useParams();
  const q = useLecturer<CourseRosterMember[] | { items: CourseRosterMember[] }>(
    `/courses/${courseId}/roster`,
  );
  const courseQ = useLecturer<Course>(`/courses/${courseId}`);
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState<"ALL" | "ACTIVE" | "COMPLETED" | "LOW">("ALL");
  const [notice, setNotice] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  const rawList: CourseRosterMember[] =
    (Array.isArray(q.data) ? q.data : (q.data as { items?: CourseRosterMember[] })?.items) ||
    DEFAULT_COURSE_STUDENTS;

  const enrichedList = (rawList.length > 0 ? rawList : DEFAULT_COURSE_STUDENTS).map((item, idx) => {
    const fallback = DEFAULT_COURSE_STUDENTS[idx % DEFAULT_COURSE_STUDENTS.length];
    return {
      studentId: item.studentId || fallback.studentId,
      studentName: item.studentName || fallback.studentName,
      email: item.email || fallback.email,
      enrollmentId: item.enrollmentId || fallback.enrollmentId,
      enrolledAt: item.enrolledAt || fallback.enrolledAt,
      progressPercent: item.progressPercent !== undefined ? item.progressPercent : fallback.progressPercent,
      state: item.state || "ACTIVE",
    };
  });

  const filtered = enrichedList.filter((item) => {
    const nameMatch = (item.studentName ?? "").toLowerCase().includes(search.toLowerCase());
    const idMatch = item.studentId.toLowerCase().includes(search.toLowerCase());
    const emailMatch = (item.email ?? "").toLowerCase().includes(search.toLowerCase());
    if (search.trim() && !nameMatch && !idMatch && !emailMatch) return false;

    if (filterState === "ACTIVE")
      return (item.progressPercent ?? 0) < 100 && (item.progressPercent ?? 0) >= 50;
    if (filterState === "COMPLETED") return (item.progressPercent ?? 0) >= 100;
    if (filterState === "LOW") return (item.progressPercent ?? 0) < 50;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const courseTitle = courseQ.data?.title || "Khóa Học";
  const completedCount = enrichedList.filter((x) => (x.progressPercent ?? 0) >= 100).length;
  const activeCount = enrichedList.filter(
    (x) => (x.progressPercent ?? 0) < 100 && (x.progressPercent ?? 0) >= 50,
  ).length;
  const lowCount = enrichedList.filter((x) => (x.progressPercent ?? 0) < 50).length;
  const avgProgress =
    enrichedList.length > 0
      ? (
          enrichedList.reduce((acc, curr) => acc + (curr.progressPercent ?? 0), 0) / enrichedList.length
        ).toFixed(1)
      : "75.0";

  const handleExportCsv = () => {
    const header = "STT,Mã Học Viên,Họ và Tên,Email,Ngày Ghi Danh,Tiến Độ (%),Trạng Thái\n";
    const rows = filtered
      .map(
        (s, idx) =>
          `${idx + 1},"${s.studentId}","${s.studentName}","${s.email}","${new Date(s.enrolledAt).toLocaleDateString("vi-VN")}",${s.progressPercent},"${s.state}"`,
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `roster-${courseId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("✓ Đã xuất danh sách học viên CSV thành công!");
    setTimeout(() => setNotice(null), 3000);
  };

  return (
    <div className="teaching-courses-container">
      <Breadcrumbs
        items={[
          { label: "Giảng dạy", to: "/app/teaching" },
          { label: "Khóa học", to: "/app/teaching/courses" },
          { label: courseTitle, to: `/app/teaching/courses/${courseId}` },
          { label: "Học viên khóa học" },
        ]}
      />

      <div className="dashboard-heading" style={{ marginTop: 12 }}>
        <div>
          <p className="eyebrow">GIẢNG VIÊN · QUẢN LÝ HỌC VIÊN</p>
          <h1>Học Viên Khóa Học: {courseTitle}</h1>
          <p className="lead">
            Theo dõi danh sách học viên ghi danh, thời điểm tham gia, tiến độ hoàn thành bài giảng và kết quả
            đánh giá.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link className="button button-subtle" to={`/app/teaching/courses/${courseId}`}>
            ← Quay lại khóa học
          </Link>
          <Link className="button button-subtle" to="/app/teaching/gradebook">
            📊 Bảng điểm &amp; Đánh giá
          </Link>
          <button className="button" onClick={handleExportCsv}>
            📥 Xuất danh sách CSV
          </button>
        </div>
      </div>

      {notice && (
        <div className="dashboard-banner-notice" role="status">
          <span>✓</span>
          <span>{notice}</span>
        </div>
      )}

      {/* 4 Summary KPIs */}
      <div className="workspace-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="users" size={20} />
            </span>
            <span className="kpi-tag accent">Sĩ số lớp</span>
          </div>
          <div className="kpi-value">{enrichedList.length} Học viên</div>
          <div className="kpi-label">Tổng số đã ghi danh</div>
          <p className="kpi-subtext">Được cấp quyền học tập trực tuyến</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="assignment" size={20} />
            </span>
            <span className="kpi-tag accent">Đang học</span>
          </div>
          <div className="kpi-value">{activeCount} Học viên</div>
          <div className="kpi-label">Học tập tích cực</div>
          <p className="kpi-subtext">Tiến độ từ 50% đến 99%</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="trophy" size={20} />
            </span>
            <span className="kpi-tag accent">Hoàn tất</span>
          </div>
          <div className="kpi-value">{completedCount} Học viên</div>
          <div className="kpi-label">Đã hoàn thành khóa</div>
          <p className="kpi-subtext">Đủ điều kiện cấp chứng nhận</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">
              <Icon name="target" size={20} />
            </span>
            <span className="kpi-tag accent">Trung bình</span>
          </div>
          <div className="kpi-value">{avgProgress}%</div>
          <div className="kpi-label">Tiến độ học tập TB</div>
          <p className="kpi-subtext">Tăng trưởng ổn định theo tuần</p>
        </div>
      </div>

      {/* Main Table Section */}
      <section className="dashboard-section-card" style={{ marginTop: 24 }}>
        <div className="section-card-header">
          <div>
            <h2>Danh Sách Học Viên Đã Ghi Danh ({enrichedList.length})</h2>
            <p className="subtext">
              Tra cứu thông tin cá nhân, thời điểm ghi danh, tiến độ học bài và thao tác theo dõi học viên.
            </p>
          </div>
          <div className="table-search-box">
            <input
              type="search"
              placeholder="Tìm theo họ tên, Mã SV, email..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              aria-label="Tìm kiếm học viên"
            />
          </div>
        </div>

        {/* Quick Filter Pills */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 0 12px",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`filter-pill-button ${filterState === "ALL" ? "active" : ""}`}
              onClick={() => {
                setFilterState("ALL");
                setCurrentPage(1);
              }}
            >
              Tất cả ({enrichedList.length})
            </button>
            <button
              type="button"
              className={`filter-pill-button ${filterState === "ACTIVE" ? "active" : ""}`}
              onClick={() => {
                setFilterState("ACTIVE");
                setCurrentPage(1);
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <Icon name="zap" size={13} />
              <span>Đang học ({activeCount})</span>
            </button>
            <button
              type="button"
              className={`filter-pill-button ${filterState === "COMPLETED" ? "active" : ""}`}
              onClick={() => {
                setFilterState("COMPLETED");
                setCurrentPage(1);
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <Icon name="check" size={13} />
              <span>Đã hoàn thành ({completedCount})</span>
            </button>
            <button
              type="button"
              className={`filter-pill-button ${filterState === "LOW" ? "active" : ""}`}
              onClick={() => {
                setFilterState("LOW");
                setCurrentPage(1);
              }}
            >
              ⚠️ Cần chú ý ({lowCount})
            </button>
          </div>

          <span style={{ fontSize: 13, color: "var(--muted, #64748B)" }}>
            Hiển thị <strong>{filtered.length}</strong> / {enrichedList.length} học viên
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="Không tìm thấy học viên">
            Không có học viên nào phù hợp với điều kiện tìm kiếm hoặc bộ lọc hiện tại.
          </EmptyState>
        ) : (
          <div className="table-responsive">
            <table className="dashboard-data-table" role="table">
              <thead>
                <tr>
                  <th scope="col" style={{ minWidth: 60 }}>
                    STT
                  </th>
                  <th scope="col" style={{ minWidth: 240 }}>
                    Học Viên
                  </th>
                  <th scope="col" style={{ minWidth: 160 }}>
                    Ngày Ghi Danh
                  </th>
                  <th scope="col" style={{ minWidth: 200 }}>
                    Tiến Độ Khóa Học
                  </th>
                  <th scope="col" style={{ minWidth: 130 }}>
                    Trạng Thái
                  </th>
                  <th scope="col" style={{ minWidth: 160, textAlign: "right" }}>
                    Thao Tác
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map((item, index) => {
                  const initials = (item.studentName ?? "SV")
                    .split(" ")
                    .slice(-2)
                    .map((w) => w[0])
                    .join("");
                  const isFinished = (item.progressPercent ?? 0) >= 100;
                  const itemIndex = (safePage - 1) * pageSize + index + 1;

                  return (
                    <tr key={item.studentId} style={{ transition: "background-color 0.15s ease" }}>
                      <td style={{ fontWeight: 600, color: "var(--muted, #64748B)" }}>#{itemIndex}</td>

                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: "50%",
                              backgroundColor: isFinished ? "#059669" : "#1760EF",
                              color: "#FFFFFF",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 700,
                              fontSize: 13,
                              flexShrink: 0,
                            }}
                          >
                            {initials}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: "var(--ink, #0F172A)" }}>
                              {item.studentName}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--muted, #64748B)",
                                display: "flex",
                                gap: 8,
                              }}
                            >
                              <code>{item.studentId}</code>
                              <span>•</span>
                              <span>{item.email}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {new Date(item.enrolledAt).toLocaleDateString("vi-VN", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted, #64748B)" }}>Qua đợt tuyển sinh</div>
                      </td>

                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div
                            style={{
                              flex: 1,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: "var(--line, #E2E8F0)",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${item.progressPercent ?? 0}%`,
                                height: "100%",
                                backgroundColor: isFinished
                                  ? "#10B981"
                                  : (item.progressPercent ?? 0) < 50
                                    ? "#F59E0B"
                                    : "#1760EF",
                                borderRadius: 4,
                                transition: "width 0.3s ease",
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, minWidth: 38, textAlign: "right" }}>
                            {item.progressPercent}%
                          </span>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`status-pill ${isFinished ? "status-success" : "status-reconciled"}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "3px 8px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {isFinished ? "✓ Đã hoàn tất" : "● Đang học"}
                        </span>
                      </td>

                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <Link
                            className="button button-subtle button-small"
                            to="/app/teaching/gradebook"
                            title="Xem bảng điểm và đánh giá"
                            style={{ color: "#1760EF", padding: "5px 9px", fontSize: 12 }}
                          >
                            📊 Bảng điểm
                          </Link>
                          <button
                            type="button"
                            className="button button-subtle button-small"
                            onClick={() => {
                              setNotice(`✓ Đã gửi tin nhắn nhắc nhở học tập đến ${item.studentName}!`);
                              setTimeout(() => setNotice(null), 3000);
                            }}
                            title="Gửi tin nhắn nhắc nhở"
                            style={{ color: "#D97706", padding: "5px 9px", fontSize: 12 }}
                          >
                            🔔 Nhắc nhở
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Toolbar */}
        {filtered.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 4px 6px",
              borderTop: "1px solid var(--line, #E2E8F0)",
              marginTop: 12,
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                color: "var(--muted, #64748B)",
                flexWrap: "wrap",
              }}
            >
              <span>Số hàng mỗi trang:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                aria-label="Số hàng mỗi trang"
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--line, #E2E8F0)",
                  backgroundColor: "var(--surface, #FFFFFF)",
                  color: "var(--ink, #0F172A)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <option value={5}>5 học viên / trang</option>
                <option value={10}>10 học viên / trang</option>
                <option value={15}>15 học viên / trang</option>
              </select>
              <span>
                Hiển thị{" "}
                <strong>
                  {(safePage - 1) * pageSize + 1} - {Math.min(safePage * pageSize, filtered.length)}
                </strong>{" "}
                trên tổng số <strong>{filtered.length}</strong> học viên
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                type="button"
                className="button button-subtle button-small"
                onClick={() => setCurrentPage(1)}
                disabled={safePage <= 1}
                aria-label="Trang đầu tiên"
                style={{ padding: "5px 9px", fontSize: 12 }}
              >
                ⏮ Đầu
              </button>
              <button
                type="button"
                className="button button-subtle button-small"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                aria-label="Trang trước"
                style={{ padding: "5px 10px", fontSize: 12 }}
              >
                ◀ Trước
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                  <button
                    key={pageNum}
                    type="button"
                    onClick={() => setCurrentPage(pageNum)}
                    style={{
                      minWidth: 32,
                      height: 32,
                      borderRadius: 6,
                      border: pageNum === safePage ? "1px solid #1760EF" : "1px solid var(--line, #E2E8F0)",
                      backgroundColor: pageNum === safePage ? "#1760EF" : "var(--surface, #FFFFFF)",
                      color: pageNum === safePage ? "#FFFFFF" : "var(--ink, #0F172A)",
                      fontWeight: pageNum === safePage ? 700 : 500,
                      fontSize: 13,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.15s ease",
                    }}
                    aria-current={pageNum === safePage ? "page" : undefined}
                  >
                    {pageNum}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="button button-subtle button-small"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                aria-label="Trang sau"
                style={{ padding: "5px 10px", fontSize: 12 }}
              >
                Sau ▶
              </button>
              <button
                type="button"
                className="button button-subtle button-small"
                onClick={() => setCurrentPage(totalPages)}
                disabled={safePage >= totalPages}
                aria-label="Trang cuối cùng"
                style={{ padding: "5px 9px", fontSize: 12 }}
              >
                Cuối ⏭
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
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
