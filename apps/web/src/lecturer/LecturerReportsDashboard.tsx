import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { lecturerError } from "./api";
import {
  aggregateReport,
  loadTeachingReport,
  reportCsv,
  ReportDataError,
  type TeachingReport,
} from "./teachingReport";

type RangeDays = 30 | 90 | 365;
const ranges: { days: RangeDays; label: string }[] = [
  { days: 30, label: "30 ngày" },
  { days: 90, label: "90 ngày" },
  { days: 365, label: "365 ngày" },
];
const brackets = ["Dưới 5", "5–<6,5", "6,5–<8", "8–<9", "9–10"];
const number = (value: number | null, suffix = "") => (value === null ? "—" : `${value.toFixed(1)}${suffix}`);

export function LecturerReportsDashboard() {
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [days, setDays] = useState<RangeDays>(30);
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<TeachingReport | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setPending(true);
    setError(null);
    setReport(null);
    loadTeachingReport(days, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setReport(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof ReportDataError ? cause.message : lecturerError(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [days, revision]);

  const activeClass = report?.classes.some((item) => item.classId === selectedClass) ? selectedClass : "ALL";
  const classes = useMemo(
    () => report?.classes.filter((item) => activeClass === "ALL" || item.classId === activeClass) ?? [],
    [report, activeClass],
  );
  const total = useMemo(() => aggregateReport(classes), [classes]);
  const distribution = brackets.map((bracket, index) => ({ bracket, count: total.distribution[index] ?? 0 }));
  const classScores = classes
    .map((item) => ({ name: item.className, score: aggregateReport([item]).averageScore }))
    .filter((item): item is { name: string; score: number } => item.score !== null);

  function exportCsv() {
    if (!report || !classes.length) return;
    const blob = new Blob(["\uFEFF", reportCsv(report, classes)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `AILSS_BaoCaoGiangDay_${report.from}_${report.to}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div
      className="admin-dashboard-container"
      style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 20px" }}
    >
      <div className="dashboard-heading" style={{ marginBottom: 20 }}>
        <div>
          <p className="eyebrow">BÁO CÁO &amp; PHÂN TÍCH GIẢNG DẠY</p>
          <h1>Báo cáo giảng dạy và kết quả học viên</h1>
          <p className="lead">Số liệu từ lớp học, bài kiểm tra và điểm danh do bạn phụ trách.</p>
        </div>
        <div className="dashboard-header-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="button button-subtle" to="/app/teaching/assessments">
            Xem bài kiểm tra
          </Link>
          <button className="button" type="button" onClick={exportCsv} disabled={pending || !classes.length}>
            Xuất báo cáo CSV
          </button>
        </div>
      </div>

      <div
        className="dashboard-toolbar-row"
        style={{
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label htmlFor="report-class" style={{ fontWeight: 600 }}>
            Lớp học phần
          </label>
          <select
            id="report-class"
            value={activeClass}
            onChange={(event) => setSelectedClass(event.target.value)}
            disabled={!report}
          >
            <option value="ALL">Tất cả lớp học phần ({report?.classes.length ?? 0} lớp)</option>
            {report?.classes.map((item) => (
              <option key={item.classId} value={item.classId}>
                {item.className}
              </option>
            ))}
          </select>
          <div className="dashboard-filter-group" role="group" aria-label="Khoảng thời gian">
            {ranges.map((range) => (
              <button
                key={range.days}
                type="button"
                className={`filter-pill-button ${days === range.days ? "active" : ""}`}
                aria-pressed={days === range.days}
                onClick={() => setDays(range.days)}
              >
                {range.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="button button-subtle"
            onClick={() => setRevision((value) => value + 1)}
            disabled={pending}
          >
            Làm mới
          </button>
        </div>
        {report && (
          <span className="dashboard-status-indicator" role="status">
            Đã tải từ máy chủ · {new Date(report.fetchedAt).toLocaleString("vi-VN")}
          </span>
        )}
      </div>

      {pending && (
        <div className="dashboard-section-card" role="status">
          Đang tải dữ liệu báo cáo…
        </div>
      )}
      {error && (
        <div className="dashboard-section-card" role="alert">
          <p>Không thể tải báo cáo: {error}</p>
          <button type="button" className="button" onClick={() => setRevision((value) => value + 1)}>
            Thử lại
          </button>
        </div>
      )}
      {report && !report.classes.length && (
        <div className="dashboard-section-card" role="status">
          Bạn chưa có lớp học phần nào để lập báo cáo.
        </div>
      )}

      {report && report.classes.length > 0 && (
        <>
          <p className="subtext" style={{ marginBottom: 14 }}>
            Từ {new Date(`${report.from}T00:00:00Z`).toLocaleDateString("vi-VN")} đến{" "}
            {new Date(`${report.to}T00:00:00Z`).toLocaleDateString("vi-VN")} · {classes.length} lớp ·{" "}
            {total.quizzes} bài kiểm tra
          </p>
          <div className="workspace-kpi-grid" style={{ marginBottom: 24 }}>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-icon">👨‍🎓</span>
                <span className="kpi-tag accent">{classes.length} lớp</span>
              </div>
              <div className="kpi-value">{total.students}</div>
              <div className="kpi-label">Lượt ghi danh đang học</div>
              <p className="kpi-subtext">Một học viên ở hai lớp được tính hai lượt.</p>
            </div>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-icon">📝</span>
                <span className="kpi-tag accent">
                  {total.submitted}/{total.expected} lượt
                </span>
              </div>
              <div className="kpi-value">{number(total.submissionRate, "%")}</div>
              <div className="kpi-label">Tỷ lệ nộp bài kiểm tra</div>
              <p className="kpi-subtext">{total.pending} bài nộp gần nhất đang chờ chấm.</p>
            </div>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-icon">🎯</span>
                <span className="kpi-tag accent">Thang 10</span>
              </div>
              <div className="kpi-value">{number(total.averageScore, " / 10")}</div>
              <div className="kpi-label">Điểm trung bình đã chấm</div>
              <p className="kpi-subtext">
                {total.scored} lượt có điểm · {number(total.passRate, "%")} đạt từ 5 điểm.
              </p>
            </div>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-icon">⏱️</span>
                <span className="kpi-tag accent">
                  {total.present}/{total.recorded} lượt
                </span>
              </div>
              <div className="kpi-value">{number(total.attendanceRate, "%")}</div>
              <div className="kpi-label">Tỷ lệ có mặt đã ghi nhận</div>
              <p className="kpi-subtext">Chỉ tính điểm danh đã ghi của buổi học đã diễn ra.</p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
              gap: 20,
              marginBottom: 24,
            }}
          >
            <section className="dashboard-section-card" style={{ margin: 0 }}>
              <div className="section-card-header">
                <div>
                  <h2>Phổ điểm bài kiểm tra</h2>
                  <p className="subtext">Bài nộp mới nhất đã chấm của mỗi học viên theo từng bài.</p>
                </div>
              </div>
              {total.scored ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={distribution} margin={{ top: 12, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e2e8f0)" />
                    <XAxis dataKey="bracket" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [`${value} lượt`, "Số bài"]} />
                    <Bar dataKey="count" fill="#0284C7" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtext">Chưa có bài kiểm tra đã chấm trong khoảng thời gian này.</p>
              )}
            </section>
            <section className="dashboard-section-card" style={{ margin: 0 }}>
              <div className="section-card-header">
                <div>
                  <h2>Điểm trung bình theo lớp</h2>
                  <p className="subtext">So sánh kết quả đã chấm trên thang 10.</p>
                </div>
              </div>
              {classScores.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={classScores}
                    layout="vertical"
                    margin={{ top: 12, right: 20, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e2e8f0)" />
                    <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)} / 10`, "Điểm TB"]} />
                    <Bar dataKey="score" fill="#059669" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtext">Chưa có điểm để so sánh các lớp.</p>
              )}
            </section>
          </div>

          <section className="dashboard-section-card">
            <div className="section-card-header">
              <div>
                <h2>Chi tiết từng lớp học phần</h2>
                <p className="subtext">Tính từ dữ liệu lớp, kết quả kiểm tra và điểm danh đã tải.</p>
              </div>
            </div>
            <div className="table-responsive">
              <table className="dashboard-data-table">
                <thead>
                  <tr>
                    <th>Mã lớp</th>
                    <th>Lớp học phần</th>
                    <th>Đang học</th>
                    <th>Bài kiểm tra</th>
                    <th>Tỷ lệ nộp</th>
                    <th>Chờ chấm</th>
                    <th>Điểm TB</th>
                    <th>Chuyên cần</th>
                    <th>Tỷ lệ đạt</th>
                    <th>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((item) => {
                    const stat = aggregateReport([item]);
                    return (
                      <tr key={item.classId}>
                        <td>
                          <code className="code-badge">{item.classId}</code>
                        </td>
                        <td>
                          <strong>{item.className}</strong>
                        </td>
                        <td>{item.students}</td>
                        <td>{item.quizzes}</td>
                        <td>{number(stat.submissionRate, "%")}</td>
                        <td>{item.pending}</td>
                        <td>{number(stat.averageScore, " / 10")}</td>
                        <td>{number(stat.attendanceRate, "%")}</td>
                        <td>{number(stat.passRate, "%")}</td>
                        <td>{item.state === "ACTIVE" ? "Đang dạy" : "Đã đóng"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <p className="subtext">
            Tỷ lệ nộp = số cặp học viên–bài kiểm tra có bài nộp trong kỳ / số cặp có thể nộp. Điểm và phổ điểm
            dùng bài nộp mới nhất đã chấm; bài chờ chấm không đưa vào điểm trung bình. Chuyên cần = có mặt /
            lượt điểm danh đã ghi (không tính “chưa ghi”). Báo cáo gồm bài kiểm tra của lớp và khóa học liên
            kết, tính cho học viên đang học có quyền làm bài.
          </p>
        </>
      )}
    </div>
  );
}

export default LecturerReportsDashboard;
