import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type RevenueDay = {
  day: string;
  grossMinor: string;
  refundMinor: string;
  netMinor: string;
  orders?: number;
};
export type RevenueCourse = {
  courseId: string;
  title: string;
  grossMinor: string;
  refundMinor: string;
  netMinor: string;
  orders: number;
};
export type LecturerRevenue = {
  lecturerId: string;
  grossMinor: string;
  refundMinor: string;
  netMinor: string;
  estimatedPlatformMinor: string;
  estimatedEarningsMinor: string;
  orders: number;
  dailyRevenue: RevenueDay[];
  courses: RevenueCourse[];
};
export const money = (value: string | number | bigint) => {
  const amount =
    typeof value === "bigint"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? BigInt(value)
        : Number(value);
  return `${new Intl.NumberFormat("vi-VN").format(amount)} ₫`;
};

export function RevenueChart({ rows }: { rows: RevenueDay[] }) {
  const points = rows.map((row) => ({
    day: new Date(`${row.day}T00:00:00Z`).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
    gross: Number(row.grossMinor),
    net: Number(row.netMinor),
    orders: row.orders ?? 0,
  }));

  return (
    <div className="revenue-chart" role="img" aria-label={`Biểu đồ doanh thu ${rows.length} ngày`}>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={points} margin={{ top: 16, right: 20, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0284c7" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#0284c7" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line, #e2e8f0)" strokeDasharray="3 3" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={{ stroke: "var(--line, #e2e8f0)" }}
            tick={{ fontSize: 12, fill: "var(--muted, #64748b)" }}
          />
          <YAxis
            tickFormatter={(n: number) => `${Math.round(n / 1000)}k`}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--muted, #64748b)" }}
            width={58}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (active && payload && payload.length) {
                const netVal = Number(payload.find((p) => p.dataKey === "net")?.value ?? 0);
                const grossVal = Number(payload.find((p) => p.dataKey === "gross")?.value ?? 0);
                return (
                  <div className="rev-custom-tooltip">
                    <div className="rev-tooltip-date">Ngày {label}</div>
                    <div className="rev-tooltip-row">
                      <span style={{ color: "#0284c7", fontWeight: 600 }}>Sau hoàn tiền:</span>
                      <strong>{money(netVal)}</strong>
                    </div>
                    <div className="rev-tooltip-row">
                      <span style={{ color: "var(--muted)", fontWeight: 500 }}>Doanh số gốc:</span>
                      <span>{money(grossVal)}</span>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Area
            type="monotone"
            dataKey="gross"
            stroke="#94a3b8"
            strokeDasharray="4 4"
            fill="none"
            strokeWidth={1.5}
            name="gross"
          />
          <Area
            type="monotone"
            dataKey="net"
            stroke="#0284c7"
            fill="url(#revenueFill)"
            strokeWidth={3}
            name="net"
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="rev-chart-legend" style={{ justifyContent: "center", marginTop: 12 }}>
        <span className="rev-chart-legend-item">
          <span className="rev-legend-dot net" />
          <span>Doanh thu ròng (sau hoàn tiền, trước phí nền tảng)</span>
        </span>
        <span className="rev-chart-legend-item">
          <span className="rev-legend-dot gross" />
          <span>Tổng doanh số bán</span>
        </span>
      </div>
    </div>
  );
}

export function RevenueCourses({ rows }: { rows: RevenueCourse[] }) {
  const maxNet = Math.max(...rows.map((r) => Number(r.netMinor)), 1);

  return (
    <div className="rev-course-breakdown-list">
      {rows.length ? (
        rows.map((course, index) => {
          const percent = Math.min(100, Math.round((Number(course.netMinor) / maxNet) * 100));
          return (
            <div key={course.courseId} className="rev-course-breakdown-item">
              <div className="rev-course-top-row">
                <div className="rev-course-title-group">
                  <span className="rev-rank-badge">#{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h4 className="rev-course-title">{course.title}</h4>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {course.orders} lượt thanh toán · hoàn {money(course.refundMinor)}
                    </span>
                  </div>
                </div>
                <span className="rev-course-net-amount">{money(course.netMinor)}</span>
              </div>
              <div className="rev-progress-track">
                <div className="rev-progress-fill" style={{ width: `${percent}%` }} />
              </div>
            </div>
          );
        })
      ) : (
        <p style={{ color: "var(--muted)", fontSize: 13.5, margin: "10px 0" }}>
          Chưa có giao dịch trong khoảng thời gian này.
        </p>
      )}
    </div>
  );
}
