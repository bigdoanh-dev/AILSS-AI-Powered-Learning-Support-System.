import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useAdminData } from "./useAdminData";

interface RevenueData {
  dataSource: "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION";
}

const TIME_RANGES = [
  { id: "today", label: "Hôm nay" },
  { id: "7d", label: "7 ngày" },
  { id: "30d", label: "Tháng này" },
];

export default function RevenueDashboard() {
  const [range, setRange] = useState("30d");
  const { data, loading, error, isLive, refresh, lastUpdated } = useAdminData<RevenueData>(
    `/dashboard/revenue?range=${range}`,
    { fallback: null, intervalMs: 30_000 },
  );
  const hasAuthoritativeData =
    isLive && data?.dataSource === "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION";

  return (
    <div className="admin-dashboard-container">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">TÀI CHÍNH &amp; THƯƠNG MẠI</p>
          <h1>Dashboard Doanh Thu &amp; Đối Soát SePay</h1>
          <p className="lead">
            Chỉ hiển thị số liệu đã được tổng hợp từ thanh toán và hoàn tiền có thể kiểm toán.
          </p>
        </div>
        <Link className="button button-subtle" to="/app">
          ← Tổng quan Admin
        </Link>
      </div>

      <div className="dashboard-toolbar-row">
        <div className="dashboard-filter-group" role="group" aria-label="Khoảng thời gian">
          {TIME_RANGES.map((item) => (
            <button
              key={item.id}
              className={`filter-pill-button ${range === item.id ? "active" : ""}`}
              onClick={() => setRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="dashboard-status-indicator">
          {hasAuthoritativeData ? (
            <>
              <span className="live-dot" />
              <span>
                Dữ liệu đã đối soát
                {lastUpdated ? ` · ${lastUpdated.toLocaleTimeString("vi-VN")}` : ""}
              </span>
            </>
          ) : (
            <>
              <span className="mock-dot" style={{ backgroundColor: "#D97706" }} />
              <span>Chưa có projection tài chính</span>
            </>
          )}
        </div>
      </div>

      {!hasAuthoritativeData ? (
        <section className="dashboard-section-card" role="status" aria-live="polite">
          <div className="section-card-header">
            <div>
              <h2>Chưa có báo cáo doanh thu có thẩm quyền</h2>
              <p className="subtext">
                Hệ thống không dùng KPI, giao dịch hoặc số liệu dự phòng giả. Báo cáo sẽ chỉ xuất
                hiện sau khi projection thanh toán và hoàn tiền đã sẵn sàng.
              </p>
              {error ? <p className="subtext">Máy chủ: {error}</p> : null}
            </div>
            <button className="button button-subtle" onClick={refresh} disabled={loading}>
              <Icon name="refresh" size={15} /> {loading ? "Đang kiểm tra…" : "Kiểm tra lại"}
            </button>
          </div>
        </section>
      ) : (
        <section className="dashboard-section-card" role="status">
          <h2>Projection doanh thu đã sẵn sàng</h2>
          <p className="subtext">
            Nguồn dữ liệu: thanh toán và hoàn tiền có thể kiểm toán. Các chỉ số chi tiết sẽ được
            hiển thị từ payload của projection.
          </p>
        </section>
      )}
    </div>
  );
}
