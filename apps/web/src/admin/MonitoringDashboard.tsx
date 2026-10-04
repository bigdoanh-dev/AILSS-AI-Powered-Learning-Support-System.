import { useLanguage } from "../lib/i18n";
import { useUiText } from "../lib/i18n";
import { Link } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useAdminData } from "./useAdminData";

type Monitoring = {
  sampledAt: string;
  prometheus: { available: boolean; url: string };
  grafana: { available: boolean; url: string };
  metrics: { requestRate: number | null; errorPercent: number | null; p95Ms: number | null };
  services: { job: string; instance: string; up: boolean; lastScrape: string; error: string }[];
  alerts: { name: string; severity: string; state: string; summary: string }[] | null;
  history: { time: string; requestRate: number | null }[];
};
const number = (value: number | null | undefined, suffix = "", locale = "vi-VN") =>
  value == null
    ? "Chưa có dữ liệu"
    : `${value.toLocaleString(locale, { maximumFractionDigits: 2 })}${suffix}`;

export default function MonitoringDashboard() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { data, loading, error, refresh } = useAdminData<Monitoring>("/monitoring", { intervalMs: 30_000 });
  return (
    <div className="admin-dashboard-container">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">{uiText("GIÁM SÁT HỆ THỐNG")}</p>
          <h1>Prometheus & Grafana</h1>
          <p className="lead">
            {uiText("Tình trạng dịch vụ, lưu lượng, độ trễ và cảnh báo vận hành. Cập nhật mỗi 30 giây.")}
          </p>
        </div>
        <button className="button" disabled={loading} onClick={refresh}>
          {loading ? uiText("Đang tải…") : uiText("Làm mới")}
        </button>
      </div>
      <Link to="/app/admin">{uiText("← Tổng quan quản trị")}</Link>
      {error && <p role="alert">{uiText(error)}</p>}
      {data && (
        <>
          <p role="status">
            Prometheus: {data.prometheus.available ? uiText("Đã kết nối") : uiText("Không kết nối được")} ·
            Grafana: {data.grafana.available ? uiText("Đã kết nối") : uiText("Không kết nối được")} ·{" "}
            {new Date(data.sampledAt).toLocaleString(uiLocale)}
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
            <a
              className="button button-subtle"
              href={data.prometheus.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {uiText("Mở Prometheus")}
            </a>
            <a
              className="button button-subtle"
              href={data.grafana.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {uiText("Mở dashboard Grafana")}
            </a>
          </div>
          <div className="workspace-kpi-grid">
            {[
              [
                "Dịch vụ đang hoạt động",
                data.prometheus.available
                  ? `${data.services.filter((service) => service.up).length}/${data.services.length}`
                  : "Chưa có dữ liệu",
              ],
              ["Yêu cầu / giây", number(data.metrics.requestRate, "", uiLocale)],
              ["Tỷ lệ lỗi 5xx", number(data.metrics.errorPercent, "%", uiLocale)],
              ["Độ trễ p95", number(data.metrics.p95Ms, " ms", uiLocale)],
            ].map(([label, value]) => (
              <div className="kpi-card" key={uiText(label)}>
                <p>{uiText(label)}</p>
                <strong className="kpi-value">{uiText(value)}</strong>
              </div>
            ))}
          </div>
          <section className="dashboard-section-card">
            <h2>{uiText("Lưu lượng trong 60 phút")}</h2>
            {data.history.length ? (
              <div style={{ height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={data.history}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={(time: string) =>
                        new Date(time).toLocaleTimeString(uiLocale, { hour: "2-digit", minute: "2-digit" })
                      }
                    />
                    <YAxis />
                    <Tooltip labelFormatter={(time) => new Date(String(time)).toLocaleTimeString(uiLocale)} />
                    <Line
                      type="monotone"
                      dataKey="requestRate"
                      name={uiText("Yêu cầu / giây")}
                      stroke="#0ea5e9"
                      dot={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p>{uiText("Chưa thu thập được dữ liệu lưu lượng.")}</p>
            )}
          </section>
          <section className="dashboard-section-card">
            <h2>{uiText("Tình trạng dịch vụ")}</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{uiText("Dịch vụ")}</th>
                    <th>{uiText("Trạng thái")}</th>
                    <th>{uiText("Thu thập gần nhất")}</th>
                    <th>{uiText("Lỗi thu thập")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.services.map((service) => (
                    <tr key={service.job + service.instance}>
                      <td>{service.job}</td>
                      <td>{service.up ? uiText("Hoạt động") : uiText("Mất kết nối")}</td>
                      <td>{new Date(service.lastScrape).toLocaleTimeString(uiLocale)}</td>
                      <td>{service.error || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.services.length && <p>{uiText("Chưa có dịch vụ được Prometheus thu thập.")}</p>}
          </section>
          <section className="dashboard-section-card">
            <h2>{uiText("Cảnh báo")}</h2>
            {data.alerts === null ? (
              <p>{uiText("Không thể tải cảnh báo.")}</p>
            ) : data.alerts.length ? (
              <ul>
                {data.alerts.map((alert, index) => (
                  <li key={`${alert.name}-${index}`}>
                    <strong>{alert.name}</strong> · {alert.state} · {alert.severity}
                    <p>{alert.summary}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{uiText("Không có cảnh báo đang hoạt động.")}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
