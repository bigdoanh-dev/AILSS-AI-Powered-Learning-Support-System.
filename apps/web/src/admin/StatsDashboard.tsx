import { Link } from "react-router-dom";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useAdminData } from "./useAdminData";
import { Icon } from "../components/Icon";
import { AnimatedNumber } from "../components/AnimatedNumber";

interface CognitiveLevel {
  level: string;
  rate: number;
  desc: string;
  color: string;
}
interface WeekdayEngagement {
  day: string;
  hours: number;
  percent: number;
}
interface StatsData {
  totalAccounts: number;
  students: number;
  lecturers: number;
  admins: number;
  suspended: number;
  aiSessions: number;
  completionRate: string;
  avgScore: string;
  totalLearningHours: string;
  cognitiveLevels: CognitiveLevel[];
  weekdayEngagement: WeekdayEngagement[];
}

const MOCK_COG: CognitiveLevel[] = [
  {
    level: "Nhận biết (Remember / Recognition)",
    rate: 86,
    desc: "Ghi nhớ thuật ngữ và khái niệm cốt lõi",
    color: "#0284C7",
  },
  {
    level: "Thông hiểu (Understand / Comprehension)",
    rate: 78,
    desc: "Giải thích nguyên lý và diễn giải lỗi",
    color: "#7C3AED",
  },
  {
    level: "Vận dụng (Apply / Execution)",
    rate: 64,
    desc: "Áp dụng công thức, viết mã lệnh thực tế",
    color: "#D97706",
  },
  {
    level: "Phân tích (Analyze / Decomposition)",
    rate: 48,
    desc: "Phân tích cấu trúc dữ liệu và tối ưu",
    color: "#059669",
  },
  {
    level: "Đánh giá (Evaluate / Critique)",
    rate: 52,
    desc: "Review mã nguồn và đánh giá hiệu năng",
    color: "#DC2626",
  },
  {
    level: "Sáng tạo (Create / Architecture)",
    rate: 38,
    desc: "Thiết kế kiến trúc và xây dựng giải pháp",
    color: "#2563EB",
  },
];
const MOCK_WEEK: WeekdayEngagement[] = [
  { day: "Thứ 2", hours: 1840, percent: 82 },
  { day: "Thứ 3", hours: 2150, percent: 95 },
  { day: "Thứ 4", hours: 1980, percent: 88 },
  { day: "Thứ 5", hours: 2260, percent: 100 },
  { day: "Thứ 6", hours: 1720, percent: 76 },
  { day: "Thứ 7", hours: 1450, percent: 64 },
  { day: "Chủ nhật", hours: 1050, percent: 46 },
];
const MOCK: StatsData = {
  totalAccounts: 1292,
  students: 1240,
  lecturers: 48,
  admins: 4,
  suspended: 2,
  aiSessions: 3820,
  completionRate: "76.4%",
  avgScore: "8.4 / 10",
  totalLearningHours: "12.450 giờ",
  cognitiveLevels: MOCK_COG,
  weekdayEngagement: MOCK_WEEK,
};

interface TooltipPayloadItem {
  name?: string;
  value?: number;
  payload?: {
    color?: string;
  };
}

function CustomDonutTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  total: number;
}) {
  if (active && payload && payload.length) {
    const item = payload[0];
    const val = item.value ?? 0;
    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : "0";
    return (
      <div className="donut-custom-tooltip">
        <div className="donut-tooltip-title">
          <span className="donut-tooltip-dot" style={{ backgroundColor: item.payload?.color || "#0284c7" }} />
          <span>{item.name}</span>
        </div>
        <div className="donut-tooltip-stat">
          <strong>{val.toLocaleString()}</strong> tài khoản
          <span className="donut-tooltip-pct">({pct}%)</span>
        </div>
      </div>
    );
  }
  return null;
}

export default function StatsDashboard() {
  const {
    data: apiData,
    loading,
    error,
    isLive,
    refresh,
    lastUpdated,
  } = useAdminData<StatsData>("/dashboard/stats", { fallback: MOCK, intervalMs: 60_000 });
  const d = apiData ?? MOCK;

  const userRoles = [
    { name: "Học viên", value: d.students, color: "#0284c7" },
    { name: "Giảng viên", value: d.lecturers, color: "#7c3aed" },
    { name: "Admin", value: d.admins, color: "#059669" },
    { name: "Tạm khóa", value: d.suspended, color: "#dc2626" },
  ];
  const cogData = (d.cognitiveLevels ?? MOCK_COG).map((c) => ({
    subject: c.level,
    A: c.rate,
    fullMark: 100,
  }));

  return (
    <div className="admin-dashboard-container">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">DỮ LIỆU & PHÂN TÍCH HỌC TẬP</p>
          <h1>Dashboard Người Dùng & Năng Lực Học Tập AI</h1>
          <p className="lead">
            Phân tích cơ cấu tài khoản, chỉ số luyện đề thích ứng AI và ma trận cấp độ nhận thức Bloom.
          </p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button button-subtle" to="/app">
            ← Tổng quan Admin
          </Link>
          <span className={isLive ? "kpi-tag accent" : error ? "kpi-tag warn" : "kpi-tag"}>
            {isLive
              ? `Dữ liệu thực · ${lastUpdated?.toLocaleTimeString("vi-VN") ?? ""}`
              : error
                ? "Mất kết nối máy chủ"
                : "Chưa kết nối API"}
          </span>
          <button className="button button-subtle button-small" onClick={refresh} disabled={loading}>
            ↻
          </button>
          <Link className="button" to="/app/admin/users">
            👥 Quản lý người dùng
          </Link>
        </div>
      </div>

      {error && (
        <div
          className="dashboard-banner-error"
          role="alert"
          style={{
            background: "#FEE2E2",
            color: "#991B1B",
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>⚠️ Không thể đồng bộ dữ liệu thống kê từ máy chủ ({error}). Hiển thị bản lưu gần nhất.</span>
          <button className="button button-small button-subtle" onClick={refresh}>
            Thử lại
          </button>
        </div>
      )}

      {/* User Structure Card */}
      <section className="dashboard-section-card">
        <div className="section-card-header">
          <div>
            <h2>Cơ Cấu Người Dùng Hệ Thống</h2>
            <p className="subtext">Tổng hợp tài khoản đang hoạt động và phân cấp theo vai trò.</p>
          </div>
          <span className="kpi-tag accent">
            <AnimatedNumber value={d.totalAccounts} suffix=" Tổng Tài Khoản" />
          </span>
        </div>
        <div className="stats-charts-row">
          <div className="user-stats-grid">
            <div className="user-stat-card">
              <span className="user-stat-icon">
                <Icon name="graduation" size={20} />
              </span>
              <div className="user-stat-number" style={{ color: "#0284c7" }}>
                <AnimatedNumber value={d.students} />
              </div>
              <div className="user-stat-role">Học Viên (Students)</div>
              <div className="user-stat-sub">94.2% hoạt động 30 ngày</div>
            </div>
            <div className="user-stat-card">
              <span className="user-stat-icon">
                <Icon name="users" size={20} />
              </span>
              <div className="user-stat-number" style={{ color: "#7c3aed" }}>
                <AnimatedNumber value={d.lecturers} />
              </div>
              <div className="user-stat-role">Giảng Viên (Lecturers)</div>
              <div className="user-stat-sub">3 hồ sơ chờ xét duyệt</div>
            </div>
            <div className="user-stat-card">
              <span className="user-stat-icon">
                <Icon name="shield" size={20} />
              </span>
              <div className="user-stat-number" style={{ color: "#059669" }}>
                <AnimatedNumber value={d.admins} />
              </div>
              <div className="user-stat-role">Quản Trị Viên</div>
              <div className="user-stat-sub">Bảo mật 2FA kích hoạt</div>
            </div>
            <div className="user-stat-card">
              <span className="user-stat-icon">
                <Icon name="lock" size={20} />
              </span>
              <div className="user-stat-number" style={{ color: "#dc2626" }}>
                <AnimatedNumber value={d.suspended} />
              </div>
              <div className="user-stat-role">Tạm Khóa</div>
              <div className="user-stat-sub">Vi phạm cộng đồng</div>
            </div>
          </div>

          {/* Upgraded Donut Chart Box */}
          <div className="recharts-pie-wrapper user-donut-box">
            <div className="donut-chart-relative">
              <ResponsiveContainer width="100%" height={170}>
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={userRoles}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={72}
                    paddingAngle={2}
                    cornerRadius={3}
                    dataKey="value"
                    label={false}
                    labelLine={false}
                    isAnimationActive={true}
                    animationDuration={1000}
                    animationEasing="ease-out"
                  >
                    {userRoles.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomDonutTooltip total={d.totalAccounts} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center-kpi" aria-hidden="true">
                <span className="donut-kpi-num">
                  <AnimatedNumber value={d.totalAccounts} />
                </span>
                <span className="donut-kpi-label">Tổng TK</span>
              </div>
            </div>

            {/* Custom Modern Legend Grid */}
            <div className="user-donut-legend-grid">
              {userRoles.map((role) => {
                const pct = d.totalAccounts > 0 ? ((role.value / d.totalAccounts) * 100).toFixed(1) : "0";
                return (
                  <div key={role.name} className="user-donut-legend-item">
                    <span className="donut-legend-dot" style={{ backgroundColor: role.color }} />
                    <span className="donut-legend-name">{role.name}</span>
                    <span className="donut-legend-val" style={{ color: role.color }}>
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="user-stats-actions">
          <Link className="button button-subtle" to="/app/admin/users">
            Tra cứu danh sách thành viên →
          </Link>
          <Link className="button button-subtle" to="/app/admin/lecturer-applications">
            Xét duyệt hồ sơ giảng viên →
          </Link>
        </div>
      </section>

      {/* AI KPIs */}
      <div className="workspace-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">
              <Icon name="sparkles" size={20} />
            </span>
            <span className="kpi-tag accent">AI Adaptive</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={d.aiSessions} suffix=" lượt" />
          </div>
          <div className="kpi-label">Luyện đề thi thích ứng AI</div>
          <p className="kpi-subtext">Đề thi tự điều chỉnh theo năng lực</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">
              <Icon name="target" size={20} />
            </span>
            <span className="kpi-tag accent">+5.2% tháng này</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={d.completionRate} />
          </div>
          <div className="kpi-label">Tỷ lệ hoàn thành khóa học</div>
          <p className="kpi-subtext">Học viên hoàn thành bài giảng và bài tập</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">
              <Icon name="trophy" size={20} />
            </span>
            <span className="kpi-tag">Thang điểm 10</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={d.avgScore} />
          </div>
          <div className="kpi-label">Điểm đánh giá trung bình</div>
          <p className="kpi-subtext">Dựa trên 1.450 bài kiểm tra</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">
              <Icon name="clock" size={20} />
            </span>
            <span className="kpi-tag accent">Tích lũy</span>
          </div>
          <div className="kpi-value">
            <AnimatedNumber value={d.totalLearningHours} />
          </div>
          <div className="kpi-label">Tổng thời lượng học tập</div>
          <p className="kpi-subtext">TB 10.2 giờ / học viên / tháng</p>
        </div>
      </div>

      {/* Bloom RadarChart + list */}
      <section className="dashboard-section-card">
        <div className="section-card-header">
          <div>
            <h2>Ma Trận 6 Cấp Độ Nhận Thức Bloom</h2>
            <p className="subtext">Tỷ lệ làm chủ kiến thức của học viên theo ngân hàng câu hỏi AI.</p>
          </div>
        </div>
        <div className="stats-charts-row">
          <div className="recharts-radar-wrapper">
            <ResponsiveContainer width="100%" height={260}>
              <RadarChart data={cogData}>
                <PolarGrid stroke="var(--line, #dce3ee)" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 12, fill: "var(--muted, #53617a)" }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Radar
                  name="Mức đạt chuẩn"
                  dataKey="A"
                  stroke="#1760ef"
                  fill="#1760ef"
                  fillOpacity={0.2}
                  isAnimationActive={true}
                  animationDuration={1200}
                  animationEasing="ease-out"
                />
                <Tooltip formatter={(v: unknown) => `${String(v)}%`} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="cognitive-levels-list">
            {(d.cognitiveLevels ?? MOCK_COG).map((cog, index) => (
              <div key={index} className="cognitive-level-card">
                <div className="cognitive-level-info">
                  <div className="cognitive-level-title-row">
                    <span className="cognitive-level-name">{cog.level}</span>
                    <span className="cognitive-level-score" style={{ color: cog.color }}>
                      {cog.rate}% Đạt chuẩn
                    </span>
                  </div>
                  <p className="cognitive-level-desc">{cog.desc}</p>
                </div>
                <div className="cognitive-progress-track">
                  <div
                    className="cognitive-progress-fill"
                    style={{ width: `${cog.rate}%`, backgroundColor: cog.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Weekly BarChart */}
      <section className="dashboard-section-card">
        <div className="section-card-header">
          <div>
            <h2>Tương Tác Học Tập Theo Tuần</h2>
            <p className="subtext">Tổng số giờ truy cập học tập trực tuyến phân bổ theo ngày trong tuần.</p>
          </div>
        </div>
        <div className="recharts-wrapper">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={d.weekdayEngagement ?? MOCK_WEEK}
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #dce3ee)" />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: "var(--muted, #53617a)" }} />
              <YAxis tick={{ fontSize: 12, fill: "var(--muted, #53617a)" }} />
              <Tooltip formatter={(v: unknown) => `${String(v)} giờ`} />
              <Bar
                dataKey="hours"
                name="Giờ học"
                fill="#7c3aed"
                radius={[4, 4, 0, 0]}
                isAnimationActive={true}
                animationDuration={1200}
                animationEasing="ease-out"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="weekly-engagement-chart" aria-label="Thống kê theo ngày">
          {(d.weekdayEngagement ?? MOCK_WEEK).map((w, index) => (
            <div key={index} className="weekly-bar-col">
              <span className="weekly-day-label">{w.day}</span>
              <span className="weekly-hours-val">{w.hours}h</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
