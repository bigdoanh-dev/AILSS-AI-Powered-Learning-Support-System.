import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useStudent, type LearningCourse, type Progress } from "./api";
import { useLearningOverview } from "./overview";
import { Heading, State, Empty, ProgressView } from "./ui";
import { Icon } from "../components/Icon";
import { StudentLearningRadar } from "./LearningRadarPanel";

interface StudentAnalyticsProps {
  courses: LearningCourse[];
  progress: Progress[];
}

function StudentAnalyticsOverview({ courses, progress }: StudentAnalyticsProps) {
  // 1. Calculate real Course Progress List (No fake fallback math)
  const courseProgressList = useMemo(() => {
    return courses.map((c) => {
      const p = progress.find((item) => item.courseId === c.courseId);
      const percent = p ? Math.min(100, Math.max(0, p.percent)) : 0;
      const completed = p ? p.completedCount : 0;
      const total = p?.publishedTotal ?? 0;
      return {
        id: c.courseId,
        title: c.title.length > 22 ? `${c.title.slice(0, 20)}…` : c.title,
        fullTitle: c.title,
        completedPercent: percent,
        remainingPercent: Math.max(0, 100 - percent),
        completedCount: completed,
        remainingCount: Math.max(0, total - completed),
        totalCount: total,
      };
    });
  }, [courses, progress]);

  // Overall average percent (real)
  const avgCompletion = useMemo(() => {
    if (!courseProgressList.length) return 0;
    return Math.round(
      courseProgressList.reduce((acc, c) => acc + c.completedPercent, 0) / courseProgressList.length,
    );
  }, [courseProgressList]);

  // Real course status counts
  const statusCounts = useMemo(() => {
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    for (const c of courseProgressList) {
      if (c.completedPercent >= 100) {
        completed++;
      } else if (c.completedPercent > 0) {
        inProgress++;
      } else {
        notStarted++;
      }
    }
    return { completed, inProgress, notStarted };
  }, [courseProgressList]);

  // Donut chart data based on real course statuses
  const donutData = useMemo(() => {
    return [
      { name: "Đã hoàn thành", value: statusCounts.completed, color: "#10b981" },
      { name: "Đang học", value: statusCounts.inProgress, color: "#1760ef" },
      { name: "Chưa bắt đầu", value: statusCounts.notStarted, color: "#cbd5e1" },
    ].filter((item) => item.value > 0);
  }, [statusCounts]);

  // Lesson totals
  const totalCompletedLessons = useMemo(
    () => courseProgressList.reduce((acc, c) => acc + c.completedCount, 0),
    [courseProgressList],
  );
  const totalPublishedLessons = useMemo(
    () => courseProgressList.reduce((acc, c) => acc + c.totalCount, 0),
    [courseProgressList],
  );
  const lessonRate =
    totalPublishedLessons > 0 ? Math.round((totalCompletedLessons / totalPublishedLessons) * 100) : 0;

  return (
    <div className="student-analytics-section" aria-label="Bảng phân tích trực quan tiến độ học tập">
      {/* ROW 1: DONUT CHART (PHÂN BỐ TRẠNG THÁI) + TỔNG LƯỢNG BÀI HỌC TÍCH LŨY */}
      <div className="student-charts-row">
        {/* DONUT CHART */}
        <section className="student-chart-card">
          <div className="student-chart-header">
            <div>
              <h3>Phân bố trạng thái khóa học</h3>
              <p className="subtext">Tỷ lệ các khóa đã hoàn tất, đang học dở dang và chưa bắt đầu</p>
            </div>
            <span className="badge">Tổng thể</span>
          </div>

          <div className="donut-summary-container">
            <div className="donut-chart-wrapper">
              <ResponsiveContainer width={170} height={170}>
                <PieChart>
                  <Pie
                    data={
                      donutData.length ? donutData : [{ name: "Chưa bắt đầu", value: 1, color: "#cbd5e1" }]
                    }
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={75}
                    startAngle={90}
                    endAngle={-270}
                    dataKey="value"
                    stroke="none"
                  >
                    {(donutData.length
                      ? donutData
                      : [{ name: "Chưa bắt đầu", value: 1, color: "#cbd5e1" }]
                    ).map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: unknown, name: unknown) => [`${val} khóa học`, `${name}`]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center-metric">
                <strong>{avgCompletion}%</strong>
                <span>Trung bình</span>
              </div>
            </div>

            <div className="donut-legend-list">
              <div className="donut-legend-item">
                <span className="donut-legend-dot" style={{ backgroundColor: "#10b981" }} />
                <div className="donut-legend-text">
                  <strong>{statusCounts.completed} khóa hoàn thành (100%)</strong>
                  <span>Đã học hết toàn bộ bài giảng</span>
                </div>
              </div>
              <div className="donut-legend-item">
                <span className="donut-legend-dot" style={{ backgroundColor: "#1760ef" }} />
                <div className="donut-legend-text">
                  <strong>{statusCounts.inProgress} khóa đang học</strong>
                  <span>Nội dung đang tiếp tục tích lũy</span>
                </div>
              </div>
              <div className="donut-legend-item">
                <span className="donut-legend-dot" style={{ backgroundColor: "#cbd5e1" }} />
                <div className="donut-legend-text">
                  <strong>{statusCounts.notStarted} khóa chưa học</strong>
                  <span>Chưa bắt đầu học bài đầu tiên</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* BÀI HỌC TÍCH LŨY */}
        <section className="student-chart-card">
          <div className="student-chart-header">
            <div>
              <h3>Tổng lượng bài học tích lũy</h3>
              <p className="subtext">Tổng hợp số lượng bài giảng đã hoàn thành trên toàn bộ các khóa học</p>
            </div>
            <span className="kpi-tag accent">{lessonRate}% đạt chuẩn</span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 16,
              height: "100%",
              padding: "10px 0",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--muted)" }}>Tỷ lệ bài giảng đã hoàn tất</span>
                <strong>
                  {totalCompletedLessons} / {totalPublishedLessons} bài học
                </strong>
              </div>
              <div
                style={{
                  height: 12,
                  background: "var(--line, #e2e8f0)",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${lessonRate}%`,
                    background: "linear-gradient(90deg, #1760ef 0%, #10b981 100%)",
                    borderRadius: 6,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
              <div
                style={{
                  padding: "12px 14px",
                  background: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  borderRadius: 10,
                }}
              >
                <div style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>Đã hoàn tất</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#059669", marginTop: 2 }}>
                  {totalCompletedLessons}
                </div>
                <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "2px 0 0" }}>Bài giảng tích lũy</p>
              </div>
              <div
                style={{
                  padding: "12px 14px",
                  background: "rgba(2, 132, 199, 0.08)",
                  border: "1px solid rgba(2, 132, 199, 0.2)",
                  borderRadius: 10,
                }}
              >
                <div style={{ fontSize: 12, color: "#0284c7", fontWeight: 600 }}>Cần hoàn thành</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#0284c7", marginTop: 2 }}>
                  {Math.max(0, totalPublishedLessons - totalCompletedLessons)}
                </div>
                <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "2px 0 0" }}>Bài giảng đang chờ</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ROW 2: BIỂU ĐỒ CỘT TIẾN ĐỘ TỪNG KHÓA HỌC */}
      <section className="student-chart-card">
        <div className="student-chart-header">
          <div>
            <h3>Tiến độ hoàn thành từng khóa học</h3>
            <p className="subtext">So sánh tỷ lệ phần trăm bài giảng đã học giữa các khóa học đã ghi danh</p>
          </div>
          <span className="badge">{courseProgressList.length} khóa học</span>
        </div>

        <div style={{ width: "100%", height: 320, minHeight: 300, marginTop: 8 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={courseProgressList.slice(0, 10)}
              margin={{ top: 16, right: 24, left: 0, bottom: 48 }}
              barGap={6}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e2e8f0)" vertical={false} />
              <XAxis
                dataKey="title"
                tick={{ fontSize: 12, fill: "var(--muted, #64748b)" }}
                interval={0}
                angle={-15}
                textAnchor="end"
                dy={8}
                height={50}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 12, fill: "var(--muted, #64748b)" }}
                width={45}
              />
              <Tooltip
                formatter={(v: unknown, name: unknown) => [
                  `${v}%`,
                  name === "completedPercent" ? "Đã học" : "Còn lại",
                ]}
                labelFormatter={(_label, payload) => {
                  const item = payload?.[0]?.payload;
                  return item ? `${item.fullTitle} (${item.completedCount}/${item.totalCount} bài học)` : "";
                }}
              />
              <Legend
                verticalAlign="bottom"
                wrapperStyle={{ paddingTop: 20 }}
                formatter={(val) => (val === "completedPercent" ? "Đã học (%)" : "Còn lại (%)")}
              />
              <Bar
                dataKey="completedPercent"
                name="completedPercent"
                fill="#1760ef"
                radius={[6, 6, 0, 0]}
                maxBarSize={48}
              />
              <Bar
                dataKey="remainingPercent"
                name="remainingPercent"
                fill="#cbd5e1"
                radius={[6, 6, 0, 0]}
                maxBarSize={48}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function CourseProgress({ course }: { course: LearningCourse }) {
  const query = useStudent<Progress>(`/courses/${course.courseId}/progress`);
  const percent = query.data?.percent ?? 0;
  const isComplete = percent >= 100 || !!query.data?.completed;

  return (
    <article className="study-card progress-course-card animate-fade-in">
      <div className="progress-course-header">
        <div className="progress-course-icon-ring">
          <Icon name="book" size={20} />
        </div>
        <div className="progress-course-title-wrap">
          <div className="progress-course-badge-row">
            <span className="badge">Khóa học</span>
            {isComplete ? (
              <span className="status-pill status-success">✓ Đã hoàn thành</span>
            ) : (
              <span className="status-pill status-pending">● Đang học</span>
            )}
          </div>
          <h2>{course.title}</h2>
        </div>
      </div>

      <div className="progress-course-body">
        <State query={query}>{query.data && <ProgressView value={query.data} />}</State>
      </div>

      <div className="progress-course-footer">
        <Link className="button secondary progress-open-btn" to={`/app/learn/${course.courseId}`}>
          <span>{isComplete ? "Xem lại khóa học" : "Mở khóa học"} →</span>
        </Link>
      </div>
    </article>
  );
}

export default function ProgressDashboard() {
  const { courses, progress } = useLearningOverview();
  const [search, setSearch] = useState("");
  const list =
    courses.data?.filter((c) => c.title.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi"))) ??
    [];
  const completed = progress.data?.filter((p) => p.completed || p.percent >= 100).length;
  const lessons = progress.data?.reduce((sum, p) => sum + p.completedCount, 0);

  const coursesCount = courses.data ? String(courses.data.length) : "0";
  const completedCount = completed !== undefined ? String(completed) : "0";
  const lessonsCount = lessons !== undefined ? String(lessons) : "0";

  const avgCompletion = useMemo(() => {
    if (!progress.data?.length) return 0;
    return Math.round(progress.data.reduce((sum, p) => sum + p.percent, 0) / progress.data.length);
  }, [progress.data]);

  const hasCourses = (courses.data?.length ?? 0) > 0;
  const firstCourse = courses.data?.[0];

  return (
    <div className="student-progress-container animate-fade-in">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">HỌC TẬP &amp; KẾT QUẢ ĐẠT ĐƯỢC</p>
          <Heading title="Tiến độ học tập">Theo dõi các khóa học và bài giảng bạn đã hoàn thành.</Heading>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button" to="/courses">
            Khám phá khóa học
          </Link>
        </div>
      </div>

      <div className="workspace-kpi-grid">
        <div className="kpi-card progress-kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">📚</span>
            <span className="kpi-tag accent">Đang học</span>
          </div>
          <div className="kpi-value">{coursesCount}</div>
          <div className="kpi-label">Khóa học đã đăng ký</div>
          <p className="kpi-subtext">Toàn bộ chương trình tham gia</p>
        </div>

        <div className="kpi-card progress-kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">🏆</span>
            <span className="kpi-tag accent">Mục tiêu</span>
          </div>
          <div className="kpi-value">{completedCount}</div>
          <div className="kpi-label">Khóa học đã hoàn thành</div>
          <p className="kpi-subtext">Đạt 100% nội dung &amp; bài giảng</p>
        </div>

        <div className="kpi-card progress-kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">📖</span>
            <span className="kpi-tag accent">Tích lũy</span>
          </div>
          <div className="kpi-value">{lessonsCount}</div>
          <div className="kpi-label">Bài học đã hoàn thành</div>
          <p className="kpi-subtext">Tổng các bài giảng đã tích lũy</p>
        </div>

        <div className="kpi-card progress-kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon">📊</span>
            <span className="kpi-tag accent">Tiến độ</span>
          </div>
          <div className="kpi-number" style={{ fontSize: "2rem", fontWeight: 800, color: "var(--ink)" }}>
            {avgCompletion}%
          </div>
          <div className="kpi-label">Tiến độ trung bình</div>
          <p className="kpi-subtext">Tỷ lệ hoàn thành trên toàn bộ khóa học</p>
        </div>
      </div>

      {/* Quick Action Toolbar */}
      <div className="workspace-quick-actions" role="toolbar" aria-label="Thao tác học tập nhanh">
        <Link
          className="quick-action-chip"
          to={firstCourse ? `/app/learn/${firstCourse.courseId}` : "/courses"}
        >
          <span>{firstCourse ? "Tiếp tục học khóa gần nhất" : "Khám phá khóa học"}</span>
        </Link>
        <Link className="quick-action-chip" to="/app/classes">
          <span>Lớp học của tôi</span>
        </Link>
        <Link className="quick-action-chip" to="/app/schedule">
          <span>Lịch học</span>
        </Link>
        <Link className="quick-action-chip" to="/app/assessments">
          <span>Bài tập &amp; Kiểm tra</span>
        </Link>
        <Link className="quick-action-chip" to="/app/ai-tutor">
          <span>Gia sư AI</span>
        </Link>
        <Link className="quick-action-chip" to="/courses">
          <span>Khám phá khóa học mới</span>
        </Link>
      </div>

      {!!progress.error && (
        <State query={{ ...progress, pending: false }}>
          <span />
        </State>
      )}
      {!courses.pending && !courses.error && (
        <StudentLearningRadar
          key={(courses.data ?? []).map((course) => course.courseId).join(":")}
          courses={courses.data ?? []}
        />
      )}

      {/* Visual Analytics Overview - 100% real backend data */}
      {hasCourses && !progress.error && (
        <StudentAnalyticsOverview courses={courses.data ?? []} progress={progress.data ?? []} />
      )}

      <div className="progress-search-card">
        <label className="progress-search-label">
          <span className="progress-search-title">Tìm khóa học</span>
          <div className="progress-search-wrap">
            <Icon name="search" size={16} className="progress-search-icon" />
            <input
              className="progress-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tên khóa học"
            />
            {search && (
              <button
                type="button"
                className="progress-search-clear"
                onClick={() => setSearch("")}
                aria-label="Xóa từ khóa tìm kiếm"
              >
                ✕
              </button>
            )}
          </div>
        </label>
      </div>

      <State query={courses}>
        {list.length ? (
          <div className="progress-course-grid">
            {list.map((c) => (
              <CourseProgress key={c.courseId} course={c} />
            ))}
          </div>
        ) : (
          <Empty>
            {courses.data?.length ? "Không có khóa học phù hợp." : "Bạn chưa đăng ký khóa học nào."}
          </Empty>
        )}
      </State>
    </div>
  );
}
