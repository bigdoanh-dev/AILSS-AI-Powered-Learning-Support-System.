import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSession } from "../auth/session";
import { Icon, type IconName } from "../components/Icon";
import { money, RevenueChart, RevenueCourses, type RevenueCourse } from "../components/RevenuePanels";
import { useAdminData, type AdminDataState } from "./useAdminData";
import type {
  Monitoring,
  Operations,
  OverviewLogs,
  OverviewPayouts,
  OverviewRevenue,
  OverviewStats,
} from "./overview-types";
import "./admin-overview.css";

const ranges = [
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
  { value: "90d", label: "90 ngày" },
  { value: "365d", label: "1 năm" },
];
const number = (value: number | null | undefined) =>
  value == null ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(value);
const percent = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(2)}%`);
const duration = (value: number | null | undefined) => (value == null ? "—" : `${value.toFixed(1)} ms`);
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
const sumMoney = (rows: string[]) => rows.reduce((sum, value) => sum + BigInt(value), 0n).toString();

function Metric({
  title,
  value,
  note,
  icon,
  tone = "blue",
}: {
  title: string;
  value: string;
  note: string;
  icon?: IconName;
  tone?: string;
}) {
  return (
    <article className={`aoc-metric aoc-tone-${tone}`}>
      <div className="aoc-metric-label">
        {title}
        {icon ? <Icon name={icon} size={18} /> : null}
      </div>
      <strong className="aoc-metric-value">{value}</strong>
      <span className="aoc-metric-note">{note}</span>
    </article>
  );
}
function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`aoc-panel ${className}`} aria-label={title}>
      <div className="aoc-panel-heading">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function DetailsLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="aoc-details" to={to}>
      {children}
      <Icon name="chevronRight" size={15} />
    </Link>
  );
}
function SourceState({ state }: { state: Pick<AdminDataState<unknown>, "loading" | "error"> }) {
  return state.error ? (
    <p className="aoc-source-error" role="alert">
      {state.error}
    </p>
  ) : state.loading ? (
    <p className="aoc-source-note" role="status">
      Đang cập nhật dữ liệu…
    </p>
  ) : null;
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="aoc-empty">
      <Icon name="chart" size={24} />
      <p>{children}</p>
    </div>
  );
}

function PrometheusPanel({ state }: { state: AdminDataState<Monitoring> }) {
  const mon = state.data;
  return (
    <section className="admin-overview-panel aoc-prometheus" aria-label="Giám sát Prometheus và Grafana">
      <div className="admin-panel-header">
        <h2>Prometheus &amp; Grafana</h2>
        <Link className="button button-subtle" to="/app/admin/monitoring">
          Xem giám sát
        </Link>
      </div>
      <SourceState state={state} />
      <p role="status">
        Prometheus: {mon ? (mon.prometheus.available ? "Đã kết nối" : "Không kết nối được") : "Chưa xác định"}{" "}
        · Grafana: {mon ? (mon.grafana.available ? "Đã kết nối" : "Không kết nối được") : "Chưa xác định"}
      </p>
      <div className="aoc-metrics aoc-four">
        <Metric
          title="Dịch vụ đang hoạt động"
          value={
            mon?.services.length
              ? `${mon.services.filter((item) => item.up).length}/${mon.services.length}`
              : "—"
          }
          note="Trạng thái từ lần thu thập gần nhất"
        />
        <Metric
          title="Yêu cầu / giây"
          value={mon?.metrics.requestRate?.toFixed(2) ?? "—"}
          note="Lưu lượng thực tế"
        />
        <Metric title="Tỷ lệ lỗi 5xx" value={percent(mon?.metrics.errorPercent)} note="Lỗi từ các dịch vụ" />
        <Metric title="Độ trễ p95" value={duration(mon?.metrics.p95Ms)} note="Số liệu Prometheus" />
      </div>
      {mon?.history.some((point) => point.requestRate != null) ? (
        <div className="aoc-monitor-chart" role="img" aria-label="Lưu lượng yêu cầu trong giờ gần nhất">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={mon.history} margin={{ left: -16, right: 8 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis
                dataKey="time"
                tickFormatter={(value) =>
                  new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
                }
                tick={{ fill: "var(--muted)", fontSize: 11 }}
                minTickGap={32}
              />
              <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} />
              <Tooltip
                labelFormatter={(value) => new Date(String(value)).toLocaleTimeString("vi-VN")}
                contentStyle={{ background: "var(--surface)", borderColor: "var(--line)", borderRadius: 10 }}
              />
              <Area
                dataKey="requestRate"
                name="Yêu cầu / giây"
                stroke="#0284c7"
                fill="#38bdf8"
                fillOpacity={0.12}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty>Chưa có lịch sử lưu lượng từ Prometheus.</Empty>
      )}
    </section>
  );
}

type Health = "Healthy" | "Warning" | "Critical" | "Unknown";
const healthLabels = {
  Healthy: "Hoạt động tốt",
  Warning: "Cần theo dõi",
  Critical: "Cần xử lý",
  Unknown: "Chưa xác định",
};
const serviceNames = [
  { label: "API Gateway", jobs: ["ailss-api-gateway"] },
  { label: "Identity Service", jobs: ["ailss-identity"] },
  { label: "Learning Service", jobs: ["ailss-learning"] },
  { label: "AI Service", jobs: ["ailss-ai", "ailss-ai-worker"] },
  { label: "Media Service", jobs: ["ailss-media-worker", "ailss-media-delivery"] },
];
function healthRows(mon: Monitoring | null, ops: Operations | null) {
  const services = serviceNames.map(({ label, jobs }) => {
    const targets = mon?.services.filter((service) => jobs.includes(service.job)) ?? [];
    const metrics = jobs.map((job) => ops?.serviceMetrics[job]);
    const p95s = metrics.flatMap((item) => (item?.p95Ms == null ? [] : [item.p95Ms]));
    const errors = metrics.flatMap((item) => (item?.errorPercent == null ? [] : [item.errorPercent]));
    const uptimes = metrics.flatMap((item) => (item?.uptimeSeconds == null ? [] : [item.uptimeSeconds]));
    const p95 = p95s.length ? Math.max(...p95s) : null;
    const error = errors.length ? Math.max(...errors) : null;
    const waitingForScrape = targets.some(
      (target) => !target.up && !target.error && !(Date.parse(target.lastScrape) > 0),
    );
    const status: Health =
      !targets.length || waitingForScrape
        ? "Unknown"
        : targets.some((target) => !target.up) || (error ?? 0) >= 5
          ? "Critical"
          : targets.length < jobs.length ||
              (error ?? 0) >= 1 ||
              (p95 ?? 0) >= 1000 ||
              targets.some(
                (target) =>
                  !Number.isFinite(Date.parse(target.lastScrape)) ||
                  Date.now() - Date.parse(target.lastScrape) > 60000,
              )
            ? "Warning"
            : "Healthy";
    return { label, status, p95, error, uptime: uptimes.length ? Math.min(...uptimes) : null };
  });
  return [
    ...services,
    ...[
      { name: "cassandra", label: "Database" },
      { name: "rabbitmq", label: "Queue" },
    ].map((item) => {
      const dependency = ops?.dependencies.find((dep) => dep.name === item.name);
      return {
        label: item.label,
        status: (dependency ? (dependency.ready ? "Healthy" : "Critical") : "Unknown") as Health,
        p95: null,
        error: null,
        uptime: null,
      };
    }),
  ];
}

export default function AdminHome() {
  const { profile } = useSession();
  const [range, setRange] = useState("30d");
  const [trend, setTrend] = useState("registrations");
  const stats = useAdminData<OverviewStats>("/dashboard/stats", { intervalMs: 60000 });
  const monitoring = useAdminData<Monitoring>("/monitoring");
  const operations = useAdminData<Operations>(`/dashboard/operations?range=${range}`, { intervalMs: 60000 });
  const revenue = useAdminData<OverviewRevenue>("/dashboard/revenue?range=30d", { intervalMs: 60000 });
  const payouts = useAdminData<OverviewPayouts>("/payouts", { intervalMs: 120000 });
  const logs = useAdminData<OverviewLogs>("/audit-logs?limit=5", { intervalMs: 60000 });
  const states = [stats, monitoring, operations, revenue, payouts, logs];
  const updating = states.some((state) => state.loading);
  const st = stats.data;
  const mon = monitoring.data;
  const ops = operations.data;
  const rev = revenue.data?.dataSource === "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION" ? revenue.data : null;
  const rows = healthRows(mon, ops);
  const alerts = mon?.alerts?.filter((alert) => alert.state === "firing" || alert.state === "pending") ?? [];
  const needsAttention = rows.filter((row) => row.status === "Critical" || row.status === "Warning");
  const alertCount = mon?.alerts == null ? null : alerts.length + needsAttention.length;
  const timestamps = states.flatMap((state) => (state.lastUpdated ? [state.lastUpdated.getTime()] : []));
  const updated = timestamps.length
    ? new Date(Math.max(...timestamps)).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    : "Đang tải";
  const month = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "UTC",
  }).formatToParts(new Date());
  const monthKey = `${month.find((part) => part.type === "year")?.value}-${month.find((part) => part.type === "month")?.value}`;
  const monthlyRows = rev?.dailyRevenue.filter((day) => day.day.startsWith(monthKey)) ?? [];
  const monthCovered = monthlyRows.some((day) => day.day === monthKey + "-01");
  const monthRevenue = rev && monthCovered ? money(sumMoney(monthlyRows.map((day) => day.netMinor))) : "—";
  const pendingPayout = payouts.data
    ? money(
        sumMoney(
          payouts.data.instructions
            .filter((item) => item.status === "PENDING_TRANSFER")
            .map((item) => item.amountMinor),
        ),
      )
    : "—";
  const selectedDays = Number(range.slice(0, -1));
  const revenuePoints =
    rev?.dailyRevenue
      .slice(-Math.min(30, selectedDays))
      .map((day) => ({ time: `${day.day}T00:00:00Z`, value: Number(day.netMinor) })) ?? [];
  const trendPoints = trend === "revenue" ? revenuePoints : (ops?.trends[trend] ?? []);
  const trendLabel = {
    registrations: "Đăng ký mới mỗi ngày",
    activeUsers: "Người dùng hoạt động",
    enrollments: "Lượt ghi danh",
    aiRequests: "AI requests mỗi ngày",
    revenue: "Doanh thu sau hoàn tiền",
  }[trend];
  const ai = ops?.metrics;
  const features = [
    { name: "Trợ lý hội thoại", value: ai?.assistantRequests },
    { name: "Quiz Generator", value: ai?.quizRequests },
  ].flatMap((item) => (item.value == null ? [] : [{ name: item.name, value: item.value }]));
  const topCourses = rev
    ? [
        ...rev.lecturers
          .reduce((all, lecturer) => {
            for (const course of lecturer.courses) {
              const prior = all.get(course.courseId);
              all.set(
                course.courseId,
                prior
                  ? {
                      ...course,
                      orders: prior.orders + course.orders,
                      grossMinor: sumMoney([prior.grossMinor, course.grossMinor]),
                      refundMinor: sumMoney([prior.refundMinor, course.refundMinor]),
                      netMinor: sumMoney([prior.netMinor, course.netMinor]),
                    }
                  : course,
              );
            }
            return all;
          }, new Map<string, RevenueCourse>())
          .values(),
      ]
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 5)
    : [];
  const statusCounts = (["Healthy", "Warning", "Critical", "Unknown"] as Health[])
    .map((name, index) => ({
      name,
      value: rows.filter((row) => row.status === name).length,
      color: ["#059669", "#d97706", "#dc2626", "#94a3b8"][index],
    }))
    .filter((item) => item.value > 0);
  return (
    <div className="admin-control-center">
      <div className="aoc-heading">
        <div>
          <h1>Admin Control Center</h1>
          <p>Xin chào {profile?.displayName || "Admin"}. Tổng quan nền tảng, học tập và vận hành AILSS.</p>
          <div className="aoc-update">
            <span className={mon?.prometheus.available ? "aoc-live-dot" : "aoc-idle-dot"} />
            Cập nhật lúc {updated}
            <span>Tự động làm mới</span>
          </div>
        </div>
        <button
          className="button button-subtle"
          disabled={updating}
          onClick={() => states.forEach((state) => state.refresh())}
        >
          <Icon name="refresh" size={16} />
          {updating ? "Đang cập nhật…" : "Làm mới"}
        </button>
      </div>
      <section className="aoc-metrics aoc-overview-kpis" aria-label="KPI tổng quan hệ thống">
        <Metric
          title="Tổng người dùng"
          value={number(st?.totalAccounts)}
          note="Bao gồm tài khoản đang tạm khóa"
          icon="users"
        />
        <Metric
          title="Sinh viên đang hoạt động"
          value={number(st?.students)}
          note="Trạng thái tài khoản ACTIVE"
          icon="graduation"
          tone="green"
        />
        <Metric
          title="Giảng viên đang hoạt động"
          value={number(st?.lecturers)}
          note="Trạng thái tài khoản ACTIVE"
          icon="user"
          tone="purple"
        />
        <Metric
          title="Tổng khóa học"
          value={number(st?.totalCourses)}
          note={st?.totalCourses == null ? "Chưa có tổng hợp toàn hệ thống" : "Khóa học trên nền tảng"}
          icon="book"
        />
        <Metric
          title="Tỷ lệ hoàn thành khóa học"
          value={st?.completionRate != null ? `${st.completionRate.replace(/%$/, "")}%` : "—"}
          note={st?.completionRate == null ? "Chưa có dữ liệu tổng hợp" : "Toàn nền tảng"}
          icon="checkCircle"
          tone="green"
        />
        <Metric
          title="Phiên học hôm nay"
          value={number(st?.learningSessionsToday)}
          note={
            st?.learningSessionsToday == null ? "Chưa có dữ liệu phiên học" : "Các phiên học được ghi nhận"
          }
          icon="clock"
        />
        <Metric
          title="Doanh thu tháng"
          value={monthRevenue}
          note={`Sau hoàn tiền · ${monthKey} · kỳ UTC`}
          icon="card"
          tone="purple"
        />
        <Metric
          title="Cảnh báo hệ thống"
          value={number(alertCount)}
          note={alertCount == null ? "Chưa đọc được nguồn cảnh báo" : "Cảnh báo và nhóm dịch vụ cần xử lý"}
          icon="bell"
          tone={alertCount ? "amber" : "green"}
        />
      </section>
      <SourceState state={stats} />
      <Panel
        title="Tăng trưởng nền tảng"
        description="Theo dõi đăng ký, mức sử dụng AI và doanh thu."
        action={
          <div className="aoc-ranges" role="group" aria-label="Khoảng thời gian tăng trưởng">
            {ranges.map((item) => (
              <button
                key={item.value}
                aria-pressed={range === item.value}
                onClick={() => setRange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      >
        <div className="aoc-trend-tabs" role="group" aria-label="Chỉ số tăng trưởng">
          {[
            { value: "registrations", label: "Người dùng mới" },
            { value: "activeUsers", label: "Active users" },
            { value: "enrollments", label: "Ghi danh" },
            { value: "aiRequests", label: "AI usage" },
            { value: "revenue", label: "Doanh thu" },
          ].map((item) => (
            <button key={item.value} aria-pressed={trend === item.value} onClick={() => setTrend(item.value)}>
              {item.label}
            </button>
          ))}
        </div>
        <SourceState state={trend === "revenue" ? revenue : operations} />
        {trendPoints.some((point) => point.value != null) ? (
          <div className="aoc-growth-chart" role="img" aria-label={trendLabel}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendPoints} margin={{ top: 16, left: 4, right: 12 }}>
                <defs>
                  <linearGradient id="aoc-growth-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0284c7" stopOpacity={0.23} />
                    <stop offset="100%" stopColor="#0284c7" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  tickFormatter={dateLabel}
                  minTickGap={32}
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                />
                <YAxis
                  allowDecimals={trend === "revenue"}
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                  tickFormatter={(value) =>
                    trend === "revenue"
                      ? new Intl.NumberFormat("vi-VN", { notation: "compact" }).format(value)
                      : number(value)
                  }
                />
                <Tooltip
                  labelFormatter={(value) => dateLabel(String(value))}
                  contentStyle={{
                    background: "var(--surface)",
                    borderColor: "var(--line)",
                    borderRadius: 10,
                  }}
                />
                <Area
                  dataKey="value"
                  name={trendLabel}
                  stroke="#0284c7"
                  strokeWidth={2.5}
                  fill="url(#aoc-growth-fill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty>
            {trend === "activeUsers"
              ? "Chưa có tổng hợp người dùng hoạt động theo ngày."
              : trend === "enrollments"
                ? "Chưa có lịch sử ghi danh toàn nền tảng."
                : "Chưa có dữ liệu trong khoảng thời gian này."}
          </Empty>
        )}
        <p className="aoc-source-note">
          {trend === "revenue"
            ? `Doanh thu có dữ liệu tối đa 30 ngày; đang hiển thị ${revenuePoints.length} ngày. Các kỳ dài hơn chưa có báo cáo.`
            : ops?.coverageNote ||
              "Lịch sử phụ thuộc thời gian lưu trữ và độ phủ dữ liệu của hệ thống giám sát."}
        </p>
      </Panel>
      <div className="aoc-operations-row">
        <Panel
          title="System Health / Operations"
          description="Healthy / Warning / Critical · cập nhật từ giám sát và readiness."
          action={<DetailsLink to="/app/admin/monitoring">Chi tiết</DetailsLink>}
        >
          <SourceState state={operations} />
          <div className="aoc-table-scroll" tabIndex={0} role="region" aria-label="Bảng trạng thái dịch vụ">
            <table className="aoc-service-table">
              <thead>
                <tr>
                  <th>Dịch vụ</th>
                  <th>Trạng thái</th>
                  <th>Uptime</th>
                  <th>p95</th>
                  <th>Lỗi 5xx</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>
                      <span
                        className={`aoc-status aoc-status-${row.status.toLowerCase()}`}
                        title={healthLabels[row.status]}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>
                      {row.uptime == null
                        ? "—"
                        : row.uptime >= 86400
                          ? `${Math.floor(row.uptime / 86400)} ngày`
                          : `${Math.floor(row.uptime / 3600)}h ${Math.floor((row.uptime % 3600) / 60)}m`}
                    </td>
                    <td>{duration(row.p95)}</td>
                    <td>{percent(row.error)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="aoc-mini-metrics">
            <div>
              <span>Request volume · {ranges.find((item) => item.value === range)?.label}</span>
              <strong>{number(ai?.requestVolume)}</strong>
            </div>
            <div>
              <span>AI jobs thất bại · cùng kỳ</span>
              <strong>{number(ai?.failedJobs)}</strong>
            </div>
            <div>
              <span>Media queue</span>
              <strong>{number(ai?.queueDepth)}</strong>
            </div>
            <div>
              <span>Dung lượng media</span>
              <strong>
                {ai?.storageBytes == null ? "—" : `${(ai.storageBytes / 1024 ** 3).toFixed(2)} GiB`}
              </strong>
            </div>
          </div>
          <p className="aoc-source-note">
            Warning khi lỗi ≥ 1%, p95 ≥ 1 giây hoặc dữ liệu thu thập trễ; Critical khi dịch vụ ngừng hoạt động
            hoặc lỗi ≥ 5%.
          </p>
        </Panel>
        <Panel title="Cảnh báo cần xử lý" action={<Icon name="bell" size={20} />} className="aoc-alert-panel">
          {mon?.alerts == null && !needsAttention.length ? (
            <p className="aoc-source-note">Chưa xác định được cảnh báo. Kiểm tra kết nối Prometheus.</p>
          ) : alerts.length || needsAttention.length ? (
            <ul className="aoc-alert-list">
              {needsAttention.map((row) => (
                <li key={row.label}>
                  <Icon name="alert" size={18} />
                  <div>
                    <strong>
                      {row.label} · {row.status}
                    </strong>
                    <span>Kiểm tra trạng thái dịch vụ và nhật ký.</span>
                    <DetailsLink to="/app/admin/monitoring">Mở giám sát</DetailsLink>
                  </div>
                </li>
              ))}
              {alerts.slice(0, 5).map((alert, index) => (
                <li key={alert.name + index}>
                  <Icon name="flag" size={18} />
                  <div>
                    <strong>{alert.name}</strong>
                    <span>{alert.summary || "Kiểm tra cảnh báo trên Prometheus."}</span>
                    <small>
                      {alert.severity} · {alert.state}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="aoc-clear">
              <Icon name="checkCircle" size={30} />
              <strong>Chưa có cảnh báo đang kích hoạt</strong>
              <p>Tiếp tục theo dõi trạng thái hệ thống.</p>
            </div>
          )}
          <div className="aoc-health-donut" role="img" aria-label="Phân bố trạng thái các nhóm dịch vụ">
            <ResponsiveContainer width="100%" height={148}>
              <PieChart>
                <Pie
                  data={statusCounts}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={43}
                  outerRadius={62}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {statusCounts.map((item) => (
                    <Cell key={item.name} fill={item.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    borderColor: "var(--line)",
                    borderRadius: 10,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="aoc-donut-legend">
              {statusCounts.map((item) => (
                <span key={item.name}>
                  <i style={{ background: item.color }} />
                  {item.name} <strong>{item.value}</strong>
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </div>
      <PrometheusPanel state={monitoring} />
      <div className="aoc-two-columns">
        <Panel
          title="User & Academic Risk"
          description="Theo dõi rủi ro ở mức toàn nền tảng."
          action={<DetailsLink to="/app/admin/stats">Thống kê học tập</DetailsLink>}
        >
          <div className="aoc-risk-grid">
            {[
              { title: "Sinh viên có nguy cơ", value: st?.atRiskStudents, icon: "flag" },
              { title: "Không hoạt động > 7 ngày", value: st?.inactiveStudents, icon: "clock" },
              { title: "Khóa học hoàn thành thấp", value: st?.lowCompletionCourses, icon: "book" },
              { title: "Giảng viên cần rà soát", value: st?.lecturersNeedingReview, icon: "shield" },
            ].map((item) => (
              <Metric
                key={item.title}
                title={item.title}
                value={number(item.value)}
                note={item.value == null ? "Chưa có dữ liệu tổng hợp" : "Số liệu toàn nền tảng"}
                icon={item.icon as IconName}
                tone="amber"
              />
            ))}
          </div>
          <div className="aoc-risk-note">
            <Icon name="info" size={18} />
            <p>
              Phân bố Healthy / Warning / Critical, rủi ro theo khoa và heatmap hoạt động sẽ hiển thị khi có
              dữ liệu học tập tổng hợp. Tài khoản ACTIVE không đồng nghĩa với sinh viên học thường xuyên.
            </p>
          </div>
          <div className="aoc-inline-links">
            <DetailsLink to="/app/admin/users">Quản lý người dùng</DetailsLink>
            <DetailsLink to="/app/admin/lecturer-applications">Duyệt giảng viên</DetailsLink>
          </div>
        </Panel>
        <Panel
          title="AI Operations"
          description={`Mức sử dụng API AI · ${ranges.find((item) => item.value === range)?.label}.`}
          action={<DetailsLink to="/app/admin/ai">AI quản trị</DetailsLink>}
        >
          <SourceState state={operations} />
          <div className="aoc-ai-metrics">
            {[
              { title: "AI requests hôm nay", value: number(ai?.aiRequestsToday) },
              { title: "AI requests trong kỳ", value: number(ai?.aiRequests) },
              { title: "Phản hồi trung bình", value: duration(ai?.aiLatencyMs) },
              { title: "Failed requests (5xx)", value: number(ai?.aiFailed) },
              { title: "Token usage", value: "—" },
              { title: "AI cost", value: "—" },
              { title: "Safety violations", value: "—" },
              { title: "RAG retrieval success", value: "—" },
            ].map((item) => (
              <div key={item.title}>
                <span>{item.title}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
          <h3>AI usage by feature</h3>
          {features.length ? (
            <div className="aoc-feature-chart" role="img" aria-label="Sử dụng API trợ lý và tạo quiz">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={features} layout="vertical" margin={{ right: 16, left: 0 }}>
                  <XAxis type="number" tick={{ fill: "var(--muted)", fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={116}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      borderColor: "var(--line)",
                      borderRadius: 10,
                    }}
                  />
                  <Bar
                    dataKey="value"
                    name="Requests"
                    fill="#7c3aed"
                    radius={[0, 4, 4, 0]}
                    barSize={18}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty>Chưa có dữ liệu sử dụng API AI.</Empty>
          )}
          <div className="aoc-feature-labels">
            {["AI Tutor", "Teacher Copilot", "Quiz Generator", "Course Advisor", "RAG Search"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <p className="aoc-source-note">
            AI Tutor, Copilot và Advisor dùng chung API hội thoại, hiện chưa tách theo tính năng/role. Token,
            chi phí, safety và RAG chưa có nguồn tổng hợp; “—” không phải số 0.
          </p>
        </Panel>
      </div>
      <Panel
        title="Tài chính / Marketplace"
        description="Doanh thu 30 ngày gần nhất từ thanh toán và hoàn tiền đã đối soát."
        action={<DetailsLink to="/app/admin/revenue">Đối soát tài chính</DetailsLink>}
      >
        <SourceState state={revenue} />
        <div className="aoc-metrics aoc-finance-metrics">
          <Metric
            title="Gross revenue"
            value={rev ? money(rev.grossMinor) : "—"}
            note="Tổng doanh số bán · 30 ngày"
            icon="card"
          />
          <Metric
            title="Platform revenue"
            value={rev ? money(sumMoney(rev.lecturers.map((item) => item.estimatedPlatformMinor))) : "—"}
            note="Phí theo từng đơn, đã trừ hoàn tiền"
            icon="receipt"
            tone="purple"
          />
          <Metric
            title="Lecturer payout pending"
            value={pendingPayout}
            note={payouts.data ? `Phiếu chờ chuyển · kỳ ${payouts.data.month}` : "Chưa có dữ liệu chi trả"}
            icon="clock"
            tone="amber"
          />
          <Metric
            title="Refund requests"
            value={number(rev?.pendingRefunds)}
            note="Yêu cầu chờ xử lý · chưa tổng hợp"
            icon="refresh"
            tone="amber"
          />
          <Metric
            title="Failed payments"
            value={number(rev?.failedPayments)}
            note="Thanh toán thất bại · chưa tổng hợp"
            icon="alert"
            tone="amber"
          />
        </div>
        <SourceState state={payouts} />
        <div className="aoc-finance-detail">
          <div>
            <h3>Revenue trend</h3>
            {rev ? (
              <RevenueChart rows={rev.dailyRevenue} />
            ) : (
              <Empty>Chưa có báo cáo doanh thu đã đối soát.</Empty>
            )}
          </div>
          <div>
            <h3>Khóa học bán chạy</h3>
            {rev ? <RevenueCourses rows={topCourses} /> : <Empty>Chưa có dữ liệu bán khóa học.</Empty>}
            {rev ? (
              <p className="aoc-source-note">
                {number(rev.orderCount)} đơn thanh toán · {number(rev.refundCount)} lượt hoàn tiền đã xử lý ·{" "}
                {money(rev.refundMinor)}.
              </p>
            ) : null}
          </div>
        </div>
      </Panel>
      <div className="aoc-two-columns">
        <Panel
          title="Hoạt động gần đây"
          description="Nhật ký có thẩm quyền từ hệ thống."
          action={<DetailsLink to="/app/admin/logs">Xem nhật ký</DetailsLink>}
        >
          <SourceState state={logs} />
          {logs.data?.items.length ? (
            <ul className="aoc-activity-list">
              {logs.data.items.map((item) => (
                <li key={item.id}>
                  <span className="aoc-activity-icon">
                    <Icon name={item.category === "COMMERCE" ? "card" : "shield"} size={17} />
                  </span>
                  <div>
                    <strong>{item.action}</strong>
                    <span>
                      {item.category} · {item.status}
                    </span>
                  </div>
                  <time>
                    {item.date} {item.time}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Chưa có hoạt động được trả về từ nhật ký.</Empty>
          )}
        </Panel>
        <Panel title="Thao tác nhanh" description="Mở trực tiếp các trang quản trị liên quan.">
          <div className="aoc-quick-actions">
            {[
              {
                label: "Review Lecturer",
                description: "Duyệt hồ sơ giảng viên",
                to: "lecturer-applications",
                icon: "graduation",
              },
              {
                label: "Manage Users",
                description: "Tra cứu và quản lý tài khoản",
                to: "users",
                icon: "users",
              },
              {
                label: "Review Reports",
                description: "Kiểm duyệt báo cáo",
                to: "moderation",
                icon: "shield",
              },
              { label: "System Settings", description: "Cài đặt hệ thống", to: "settings", icon: "settings" },
              { label: "View Logs", description: "Nhật ký vận hành", to: "logs", icon: "fileText" },
              {
                label: "AI Configuration",
                description: "Cấu hình và hướng dẫn AI",
                to: "settings",
                icon: "brain",
              },
              {
                label: "Financial Reconciliation",
                description: "Doanh thu và đối soát",
                to: "revenue",
                icon: "receipt",
              },
              { label: "Manage Courses", description: "Quản trị khóa học", to: "courses", icon: "book" },
            ].map((item) => (
              <Link key={item.label} to={`/app/admin/${item.to}`}>
                <Icon name={item.icon as IconName} size={19} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <Icon name="chevronRight" size={15} />
              </Link>
            ))}
            <button disabled title="Hệ thống chưa có quy trình tạo Admin từ dashboard">
              <Icon name="plus" size={19} />
              <span>
                <strong>Create Admin</strong>
                <small>Chưa hỗ trợ trên dashboard</small>
              </span>
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
