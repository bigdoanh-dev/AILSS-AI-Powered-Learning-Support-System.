import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { AnimatedNumber } from "../components/AnimatedNumber";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";

interface ClassStat {
  classId: string;
  className: string;
  courseName: string;
  studentCount: number;
  submissionRate: number;
  pendingCount: number;
  averageScore: number;
  attendanceRate: number;
  passRate: number;
  status: "ACTIVE" | "COMPLETED";
}

const MOCK_CLASSES: ClassStat[] = [
  {
    classId: "cls-01",
    className: "CSDL Nâng cao - Nhóm 01",
    courseName: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    studentCount: 42,
    submissionRate: 95.2,
    pendingCount: 4,
    averageScore: 8.6,
    attendanceRate: 97.4,
    passRate: 100,
    status: "ACTIVE",
  },
  {
    classId: "cls-02",
    className: "Lập trình Web & AI - Nhóm 02",
    courseName: "Lập trình Web & Trợ lý AI Fullstack",
    studentCount: 48,
    submissionRate: 91.6,
    pendingCount: 6,
    averageScore: 8.2,
    attendanceRate: 95.8,
    passRate: 98,
    status: "ACTIVE",
  },
  {
    classId: "cls-03",
    className: "AI & LLM thực chiến - Nhóm 01",
    courseName: "Ứng dụng LLM & Xây dựng Agent thực tế",
    studentCount: 38,
    submissionRate: 89.5,
    pendingCount: 4,
    averageScore: 8.5,
    attendanceRate: 96.0,
    passRate: 97,
    status: "ACTIVE",
  },
];

const GRADE_DISTRIBUTION = [
  { bracket: "Xuất sắc (9.0 - 10)", count: 36, percent: 28, fill: "#059669" },
  { bracket: "Giỏi (8.0 - 8.9)", count: 54, percent: 42, fill: "#0284C7" },
  { bracket: "Khá (6.5 - 7.9)", count: 28, percent: 22, fill: "#D97706" },
  { bracket: "Trung bình (5.0 - 6.4)", count: 8, percent: 6, fill: "#64748B" },
  { bracket: "Cần cố gắng (< 5.0)", count: 2, percent: 2, fill: "#DC2626" },
];

const BLOOM_DATA = [
  { level: "Nhận biết", score: 92, fullMark: 100 },
  { level: "Thông hiểu", score: 86, fullMark: 100 },
  { level: "Vận dụng", score: 78, fullMark: 100 },
  { level: "Phân tích", score: 68, fullMark: 100 },
  { level: "Đánh giá", score: 62, fullMark: 100 },
  { level: "Sáng tạo", score: 54, fullMark: 100 },
];

export function LecturerReportsDashboard() {
  const [selectedClass, setSelectedClass] = useState<string>("ALL");
  const [timeRange, setTimeRange] = useState<string>("semester");
  const [csvNotice, setCsvNotice] = useState<string | null>(null);

  const filteredClasses = useMemo(() => {
    if (selectedClass === "ALL") return MOCK_CLASSES;
    return MOCK_CLASSES.filter((c) => c.classId === selectedClass);
  }, [selectedClass]);

  const totalStudents = useMemo(
    () => filteredClasses.reduce((acc, c) => acc + c.studentCount, 0),
    [filteredClasses]
  );
  const avgSubmission = useMemo(
    () => (filteredClasses.reduce((acc, c) => acc + c.submissionRate, 0) / (filteredClasses.length || 1)).toFixed(1),
    [filteredClasses]
  );
  const avgScore = useMemo(
    () => (filteredClasses.reduce((acc, c) => acc + c.averageScore, 0) / (filteredClasses.length || 1)).toFixed(1),
    [filteredClasses]
  );
  const avgAttendance = useMemo(
    () => (filteredClasses.reduce((acc, c) => acc + c.attendanceRate, 0) / (filteredClasses.length || 1)).toFixed(1),
    [filteredClasses]
  );

  const handleExportCsv = () => {
    const headers = [
      "Mã Lớp,Lớp Học Phần,Môn Học,Sĩ Số,Tỷ Lệ Nộp (%),Bài Chờ Chấm,Điểm TB,Chuyên Cần (%),Tỷ Lệ Đạt (%)",
    ];
    const rows = filteredClasses.map(
      (c) =>
        `"${c.classId}","${c.className}","${c.courseName}",${c.studentCount},${c.submissionRate}%,${c.pendingCount},${c.averageScore},${c.attendanceRate}%,${c.passRate}%`
    );
    const content = [headers, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `AILSS_BaoCaoGiangDay_${new Date().toISOString().slice(0, 10)}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setCsvNotice("✓ Đã xuất tệp báo cáo thống kê giảng dạy CSV thành công!");
    setTimeout(() => setCsvNotice(null), 4000);
  };

  return (
    <div className="admin-dashboard-container" style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 20px" }}>
      {/* Header */}
      <div className="dashboard-heading" style={{ marginBottom: 20 }}>
        <div>
          <p className="eyebrow" style={{ color: "var(--blue, #0284C7)", fontWeight: 700 }}>
            BÁO CÁO &amp; PHÂN TÍCH GIẢNG DẠY
          </p>
          <h1 style={{ margin: "4px 0 8px" }}>Báo Cáo Thống Kê Giảng Dạy &amp; Đánh Giá Sinh Viên</h1>
          <p className="lead" style={{ margin: 0, color: "var(--muted, #64748b)" }}>
            Báo cáo tổng hợp kết quả học tập, phân phổ điểm và phân tích năng lực sinh viên theo lớp phụ trách.
          </p>
        </div>
        <div className="dashboard-header-actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Link className="button button-subtle" to="/app/teaching/grades">
            🏆 Sổ điểm học viên
          </Link>
          <button className="button" onClick={handleExportCsv}>
            📥 Xuất báo cáo CSV
          </button>
        </div>
      </div>

      {csvNotice && (
        <div className="dashboard-banner-notice" role="status" style={{ marginBottom: 16 }}>
          <span>✓</span>
          <span>{csvNotice}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="dashboard-toolbar-row" style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted, #64748b)" }}>Lớp học phần:</span>
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--line, #e2e8f0)",
              backgroundColor: "var(--surface, #ffffff)",
              color: "var(--ink, #0f172a)",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            <option value="ALL">Tất cả lớp học phần (3 lớp)</option>
            {MOCK_CLASSES.map((c) => (
              <option key={c.classId} value={c.classId}>
                {c.className}
              </option>
            ))}
          </select>

          <div className="dashboard-filter-group" role="group" aria-label="Khoảng thời gian" style={{ marginLeft: 8 }}>
            {[
              { id: "30d", label: "30 ngày" },
              { id: "semester", label: "Học kỳ này" },
              { id: "year", label: "Cả năm" },
            ].map((t) => (
              <button
                key={t.id}
                className={`filter-pill-button ${timeRange === t.id ? "active" : ""}`}
                onClick={() => setTimeRange(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dashboard-status-indicator">
          <span className="live-dot" />
          <span>Dữ liệu thực · {new Date().toLocaleDateString("vi-VN")}</span>
        </div>
      </div>

      {/* 4 KPIs Cards */}
      <div className="workspace-kpi-grid" style={{ marginBottom: 24 }}>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">👨‍🎓</span>
            <span className="kpi-tag accent">{filteredClasses.length} lớp học</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={totalStudents} suffix=" SV" />
          </div>
          <div className="kpi-label">Tổng sinh viên phụ trách</div>
          <p className="kpi-subtext">100% tài khoản đã kích hoạt</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">📝</span>
            <span className="kpi-tag accent">Đúng hạn</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={parseFloat(avgSubmission)} suffix="%" decimals={1} />
          </div>
          <div className="kpi-label">Tỷ lệ nộp bài đánh giá</div>
          <p className="kpi-subtext">Còn 14 bài chờ chấm điểm</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">🎯</span>
            <span className="kpi-tag accent">Thang điểm 10</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={parseFloat(avgScore)} suffix=" / 10" decimals={1} />
          </div>
          <div className="kpi-label">Điểm đánh giá trung bình</div>
          <p className="kpi-subtext">98.5% sinh viên đạt chuẩn môn</p>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">⏱️</span>
            <span className="kpi-tag accent">Chuyên cần</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={parseFloat(avgAttendance)} suffix="%" decimals={1} />
          </div>
          <div className="kpi-label">Tỷ lệ điểm danh có mặt</div>
          <p className="kpi-subtext">Tự động đối soát từ QR &amp; GPS</p>
        </div>
      </div>

      {/* Charts Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 20, marginBottom: 24 }}>
        {/* Grade Distribution */}
        <section className="dashboard-section-card" style={{ margin: 0 }}>
          <div className="section-card-header">
            <div>
              <h2 style={{ fontSize: "1.1rem" }}>Phổ Điểm Đánh Giá Sinh Viên</h2>
              <p className="subtext">Phân bố điểm số các bài kiểm tra &amp; bài tập lớn gần nhất.</p>
            </div>
          </div>
          <div className="recharts-wrapper">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={GRADE_DISTRIBUTION} margin={{ top: 12, right: 16, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e2e8f0)" />
                <XAxis dataKey="bracket" tick={{ fontSize: 11, fill: "var(--muted, #64748b)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted, #64748b)" }} />
                <Tooltip
                  formatter={(value: any, _name: any, item: any) => [
                    `${value} sinh viên (${item?.payload?.percent ?? 0}%)`,
                    "Số lượng",
                  ]}
                />
                <Bar
                  dataKey="count"
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

        {/* Bloom Radar Matrix */}
        <section className="dashboard-section-card" style={{ margin: 0 }}>
          <div className="section-card-header">
            <div>
              <h2 style={{ fontSize: "1.1rem" }}>Năng Lực Nhận Thức Bloom Của Lớp</h2>
              <p className="subtext">Mức độ hoàn thành câu hỏi phân theo 6 cấp độ tư duy.</p>
            </div>
          </div>
          <div className="recharts-wrapper">
            <ResponsiveContainer width="100%" height={230}>
              <RadarChart data={BLOOM_DATA}>
                <PolarGrid stroke="var(--line, #e2e8f0)" />
                <PolarAngleAxis dataKey="level" tick={{ fontSize: 11, fill: "var(--muted, #64748b)" }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Radar
                  name="Mức độ đạt"
                  dataKey="score"
                  stroke="#0284C7"
                  fill="#0284C7"
                  fillOpacity={0.25}
                  isAnimationActive={true}
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
                <Tooltip formatter={(val: any) => [`${val}% chuẩn`, "Độ chuẩn xác"]} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Class Detailed Table */}
      <section className="dashboard-section-card">
        <div className="section-card-header">
          <div>
            <h2 style={{ fontSize: "1.15rem" }}>Bảng Thống Kê Chi Tiết Từng Lớp Học Phần</h2>
            <p className="subtext">Chỉ số tiến độ, bài nộp, điểm trung bình và kết quả theo lớp phụ trách.</p>
          </div>
        </div>
        <div className="table-responsive">
          <table className="dashboard-data-table" role="table">
            <thead>
              <tr>
                <th scope="col">Mã Lớp</th>
                <th scope="col">Tên Lớp &amp; Khóa Học</th>
                <th scope="col">Sĩ Số</th>
                <th scope="col">Tỷ Lệ Nộp</th>
                <th scope="col">Bài Chờ Chấm</th>
                <th scope="col">Điểm TB Lớp</th>
                <th scope="col">Chuyên Cần</th>
                <th scope="col">Tỷ Lệ Đạt</th>
                <th scope="col">Trạng Thái</th>
              </tr>
            </thead>
            <tbody>
              {filteredClasses.map((c) => (
                <tr key={c.classId}>
                  <td>
                    <code className="code-badge">{c.classId}</code>
                  </td>
                  <td>
                    <strong>{c.className}</strong>
                    <div style={{ fontSize: 11, color: "var(--muted, #64748b)" }}>{c.courseName}</div>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{c.studentCount} SV</span>
                  </td>
                  <td>
                    <span style={{ color: "#059669", fontWeight: 600 }}>{c.submissionRate}%</span>
                  </td>
                  <td>
                    {c.pendingCount > 0 ? (
                      <span className="kpi-tag" style={{ color: "#D97706", backgroundColor: "#FEF3C7", fontWeight: 700, whiteSpace: "nowrap" }}>
                        ● {c.pendingCount} bài chờ
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted, #64748b)", fontSize: 12 }}>Đã chấm hết</span>
                    )}
                  </td>
                  <td>
                    <span style={{ fontWeight: 700, color: "var(--blue, #0284C7)", fontSize: 14 }}>
                      {c.averageScore} / 10
                    </span>
                  </td>
                  <td>
                    <span style={{ color: "#15803D", fontWeight: 600 }}>{c.attendanceRate}%</span>
                  </td>
                  <td>
                    <span style={{ color: "#059669", fontWeight: 700 }}>{c.passRate}%</span>
                  </td>
                  <td>
                    <span className="status-pill status-success">Đang giảng dạy</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cohort Mastery & Friction Diagnostics */}
      <section className="dashboard-section-card" id="cohort-friction-diagnostics">
        <div className="section-card-header">
          <div>
            <span className="kpi-tag accent">Learning Intelligence</span>
            <h2 style={{ fontSize: "1.15rem", marginTop: 4 }}>Chẩn Đoán Năng Lực &amp; Điểm Nghẽn Tri Thức Nhóm Học Viên (Cohort Friction)</h2>
            <p className="subtext">
              Phân tích phân vị năng lực (P25 / Trung vị / P75), phát hiện điểm nghẽn học tập và cảnh báo lỗ hổng tiền đề theo chuẩn Canonical Policy (70/50).
            </p>
          </div>
        </div>

        <div className="table-responsive">
          <table className="dashboard-data-table" role="table">
            <thead>
              <tr>
                <th scope="col">Khái Niệm / Module</th>
                <th scope="col">Khóa Học</th>
                <th scope="col">P25</th>
                <th scope="col">Trung Vị (Median)</th>
                <th scope="col">P75</th>
                <th scope="col">Tỷ Lệ Đạt (≥70%)</th>
                <th scope="col">Đánh Giá Ma Trận Năng Lực</th>
                <th scope="col">Khuyến Nghị Hành Động</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Tối ưu hóa B-Tree &amp; Hash Indexing</strong></td>
                <td>CSDL Nâng cao</td>
                <td><span style={{ color: "#DC2626", fontWeight: 700 }}>42%</span></td>
                <td><strong>65%</strong></td>
                <td><span style={{ color: "#16A34A" }}>84%</span></td>
                <td>62%</td>
                <td>
                  <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, backgroundColor: "#FEF3C7", color: "#B45309" }}>
                    ⚠ ĐIỂM NGHẼN (FRICTION)
                  </span>
                </td>
                <td>
                  <button type="button" className="button button-subtle button-small" style={{ fontSize: 11 }}>
                    Tạo đề luyện tập củng cố
                  </button>
                </td>
              </tr>
              <tr>
                <td><strong>Phân mảnh Dữ liệu &amp; Sharding Cassandra</strong></td>
                <td>CSDL Nâng cao</td>
                <td><span style={{ color: "#DC2626", fontWeight: 700 }}>38%</span></td>
                <td><strong>58%</strong></td>
                <td><span style={{ color: "#16A34A" }}>76%</span></td>
                <td>52%</td>
                <td>
                  <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, backgroundColor: "#FEE2E2", color: "#DC2626" }}>
                    ● LỖ HỔNG TIỀN ĐỀ (&lt;50%)
                  </span>
                </td>
                <td>
                  <button type="button" className="button button-subtle button-small" style={{ fontSize: 11 }}>
                    Gợi ý bài học tiền đề
                  </button>
                </td>
              </tr>
              <tr>
                <td><strong>Thiết Kế Schema Phân Tán &amp; Wide-Row</strong></td>
                <td>CSDL Nâng cao</td>
                <td><span style={{ color: "#16A34A", fontWeight: 700 }}>72%</span></td>
                <td><strong>85%</strong></td>
                <td><span style={{ color: "#16A34A" }}>94%</span></td>
                <td>91%</td>
                <td>
                  <span style={{ padding: "3px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, backgroundColor: "#DCFCE7", color: "#15803D" }}>
                    ✓ NẮM VỮNG TỐT (EXCELLENT)
                  </span>
                </td>
                <td>
                  <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>Tiến độ ổn định</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default LecturerReportsDashboard;
