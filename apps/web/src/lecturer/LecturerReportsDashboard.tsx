import { useLanguage } from "../lib/i18n";
import { useUiText } from "../lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LecturerLearningRadar } from "./LearningRadarPanel";
import { lecturerError, useLecturer } from "./api";
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
const shortClassId = (classId: string) => classId.replaceAll("-", "").slice(0, 8).toUpperCase();

export function LecturerReportsDashboard() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const courses = useLecturer<{ items: { courseId: string; title: string; state?: string }[] }>(
    "/me/owned-courses",
  );
  const [selectedCourse, setSelectedCourse] = useState("");
  const courseItems = courses.data?.items?.filter((item) => item.state !== "ARCHIVED") ?? [];
  const activeCourse = courseItems.some((item) => item.courseId === selectedCourse)
    ? selectedCourse
    : courseItems[0]?.courseId;
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
  const distribution = brackets.map((bracket, index) => ({
    bracket: uiText(bracket),
    count: total.distribution[index] ?? 0,
  }));
  const classScores = classes
    .map((item) => ({ name: item.className, score: aggregateReport([item]).averageScore }))
    .filter((item): item is { name: string; score: number } => item.score !== null);

  function exportCsv() {
    if (!report || !classes.length) return;
    const blob = new Blob(["\uFEFF", reportCsv(report, classes, uiText)], { type: "text/csv;charset=utf-8" });
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
          <p className="eyebrow">{uiText("BÁO CÁO & PHÂN TÍCH GIẢNG DẠY")}</p>
          <h1>{uiText("Báo cáo giảng dạy và kết quả học viên")}</h1>
          <p className="lead">{uiText("Số liệu từ lớp học, bài kiểm tra và điểm danh do bạn phụ trách.")}</p>
        </div>
        <div className="dashboard-header-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="button button-subtle" to="/app/teaching/assessments">
            {uiText("Xem bài kiểm tra")}
          </Link>
          <button className="button" type="button" onClick={exportCsv} disabled={pending || !classes.length}>
            {uiText("Xuất báo cáo CSV")}
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
            {uiText("Lớp học phần")}
          </label>
          <select
            id="report-class"
            value={activeClass}
            onChange={(event) => setSelectedClass(event.target.value)}
            disabled={!report}
          >
            <option value="ALL">
              {uiText("Tất cả lớp học phần (")}
              {report?.classes.length ?? 0} {uiText(" lớp)")}
            </option>
            {report?.classes.map((item) => (
              <option key={item.classId} value={item.classId}>
                {item.className}
              </option>
            ))}
          </select>
          <div className="dashboard-filter-group" role="group" aria-label={uiText("Khoảng thời gian")}>
            {ranges.map((range) => (
              <button
                key={range.days}
                type="button"
                className={`filter-pill-button ${days === range.days ? "active" : ""}`}
                aria-pressed={days === range.days}
                onClick={() => setDays(range.days)}
              >
                {uiText(range.label)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="button button-subtle"
            onClick={() => setRevision((value) => value + 1)}
            disabled={pending}
          >
            {uiText("Làm mới")}
          </button>
        </div>
        {report && (
          <span className="dashboard-status-indicator" role="status">
            {uiText("Đã tải từ máy chủ · ")}
            {new Date(report.fetchedAt).toLocaleString(uiLocale)}
          </span>
        )}
      </div>

      <section className="form-panel" aria-label={uiText("Năng lực theo khóa học")}>
        <label htmlFor="report-course">{uiText("Khóa học xem năng lực")}</label>
        <select
          id="report-course"
          value={activeCourse ?? ""}
          onChange={(event) => setSelectedCourse(event.target.value)}
          disabled={!courseItems.length}
        >
          {!courseItems.length && <option value="">{uiText("Chưa có khóa học")}</option>}
          {courseItems.map((item) => (
            <option key={item.courseId} value={item.courseId}>
              {item.title}
            </option>
          ))}
        </select>
        {!!courses.error && <p role="alert">{lecturerError(courses.error)}</p>}
        {activeCourse && <LecturerLearningRadar key={activeCourse} courseId={activeCourse} />}
      </section>

      {pending && (
        <div className="dashboard-section-card" role="status">
          {uiText("Đang tải dữ liệu báo cáo…")}
        </div>
      )}
      {error && (
        <div className="dashboard-section-card" role="alert">
          <p>
            {uiText("Không thể tải báo cáo: ")}
            {uiText(error)}
          </p>
          <button type="button" className="button" onClick={() => setRevision((value) => value + 1)}>
            {uiText("Thử lại")}
          </button>
        </div>
      )}
      {report && !report.classes.length && (
        <div className="dashboard-section-card" role="status">
          {uiText("Bạn chưa có lớp học phần nào để lập báo cáo.")}
        </div>
      )}

      {report && report.classes.length > 0 && (
        <>
          <p className="subtext" style={{ marginBottom: 14 }}>
            {uiText("Từ ")}
            {new Date(`${report.from}T00:00:00Z`).toLocaleDateString(uiLocale)} {uiText(" đến")}{" "}
            {new Date(`${report.to}T00:00:00Z`).toLocaleDateString(uiLocale)} · {classes.length}{" "}
            {uiText(" lớp ·")} {total.quizzes} {uiText(" bài kiểm tra")}
          </p>
          <div className="workspace-kpi-grid" style={{ marginBottom: 24 }}>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-icon">👨‍🎓</span>
                <span className="kpi-tag accent">
                  {classes.length} {uiText(" lớp")}
                </span>
              </div>
              <div className="kpi-value">{total.students}</div>
              <div className="kpi-label">{uiText("Lượt ghi danh đang học")}</div>
              <p className="kpi-subtext">{uiText("Một học viên ở hai lớp được tính hai lượt.")}</p>
            </div>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-icon">📝</span>
                <span className="kpi-tag accent">
                  {total.submitted}/{total.expected} {uiText(" lượt")}
                </span>
              </div>
              <div className="kpi-value">{number(total.submissionRate, "%")}</div>
              <div className="kpi-label">{uiText("Tỷ lệ nộp bài kiểm tra")}</div>
              <p className="kpi-subtext">
                {total.pending} {uiText(" bài nộp gần nhất đang chờ chấm.")}
              </p>
            </div>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-icon">🎯</span>
                <span className="kpi-tag accent">{uiText("Thang 10")}</span>
              </div>
              <div className="kpi-value">{number(total.averageScore, " / 10")}</div>
              <div className="kpi-label">{uiText("Điểm trung bình đã chấm")}</div>
              <p className="kpi-subtext">
                {total.scored} {uiText(" lượt có điểm · ")}
                {number(total.passRate, "%")} {uiText(" đạt từ 5 điểm.")}
              </p>
            </div>
            <div className="kpi-card">
              <div className="kpi-header">
                <span className="kpi-icon">⏱️</span>
                <span className="kpi-tag accent">
                  {total.present}/{total.recorded} {uiText(" lượt")}
                </span>
              </div>
              <div className="kpi-value">{number(total.attendanceRate, "%")}</div>
              <div className="kpi-label">{uiText("Tỷ lệ có mặt đã ghi nhận")}</div>
              <p className="kpi-subtext">{uiText("Chỉ tính điểm danh đã ghi của buổi học đã diễn ra.")}</p>
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
                  <h2>{uiText("Phổ điểm bài kiểm tra")}</h2>
                  <p className="subtext">
                    {uiText("Bài nộp mới nhất đã chấm của mỗi học viên theo từng bài.")}
                  </p>
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
                <p className="subtext">
                  {uiText("Chưa có bài kiểm tra đã chấm trong khoảng thời gian này.")}
                </p>
              )}
            </section>
            <section className="dashboard-section-card" style={{ margin: 0 }}>
              <div className="section-card-header">
                <div>
                  <h2>{uiText("Điểm trung bình theo lớp")}</h2>
                  <p className="subtext">{uiText("So sánh kết quả đã chấm trên thang 10.")}</p>
                </div>
              </div>
              {classScores.length ? (
                <ResponsiveContainer width="100%" height={Math.max(260, classScores.length * 48)}>
                  <BarChart
                    data={classScores}
                    layout="vertical"
                    margin={{ top: 12, right: 28, left: 16, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #e2e8f0)" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 10]}
                      ticks={[0, 2, 4, 6, 8, 10]}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={160}
                      tickFormatter={(val: string) => (val.length > 20 ? `${val.slice(0, 18)}…` : val)}
                      tick={{ fontSize: 11, fill: "var(--muted, #64748b)" }}
                      interval={0}
                    />
                    <Tooltip
                      formatter={(value) => [
                        `${Number(value).toLocaleString(uiLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 10`,
                        uiText("Điểm TB"),
                      ]}
                      labelFormatter={(label) => uiText("Lớp: {0}", [label])}
                    />
                    <Bar dataKey="score" fill="#059669" radius={[0, 6, 6, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtext">{uiText("Chưa có điểm để so sánh các lớp.")}</p>
              )}
            </section>
          </div>

          <section className="dashboard-section-card">
            <div className="section-card-header">
              <div>
                <h2>{uiText("Chi tiết từng lớp học phần")}</h2>
                <p className="subtext">
                  {uiText("Tính từ dữ liệu lớp, kết quả kiểm tra và điểm danh đã tải.")}
                </p>
              </div>
            </div>
            <div className="table-responsive">
              <table className="dashboard-data-table">
                <thead>
                  <tr>
                    <th>{uiText("Mã lớp")}</th>
                    <th>{uiText("Lớp học phần")}</th>
                    <th>{uiText("Đang học")}</th>
                    <th>{uiText("Bài kiểm tra")}</th>
                    <th>{uiText("Tỷ lệ nộp")}</th>
                    <th>{uiText("Chờ chấm")}</th>
                    <th>{uiText("Điểm TB")}</th>
                    <th>{uiText("Chuyên cần")}</th>
                    <th>{uiText("Tỷ lệ đạt")}</th>
                    <th>{uiText("Trạng thái")}</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((item) => {
                    const stat = aggregateReport([item]);
                    return (
                      <tr key={item.classId}>
                        <td>
                          <code className="code-badge" title={uiText("ID đầy đủ: {0}", [item.classId])}>
                            {shortClassId(item.classId)}
                          </code>
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
                        <td>{item.state === "ACTIVE" ? uiText("Đang dạy") : uiText("Đã đóng")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <p className="subtext">
            {uiText(
              "Tỷ lệ nộp = số cặp học viên–bài kiểm tra có bài nộp trong kỳ / số cặp có thể nộp. Điểm và phổ điểm dùng bài nộp mới nhất đã chấm; bài chờ chấm không đưa vào điểm trung bình. Chuyên cần = có mặt / lượt điểm danh đã ghi (không tính “chưa ghi”). Báo cáo gồm bài kiểm tra của lớp và khóa học liên kết, tính cho học viên đang học có quyền làm bài.",
            )}
          </p>
        </>
      )}
    </div>
  );
}

export default LecturerReportsDashboard;
