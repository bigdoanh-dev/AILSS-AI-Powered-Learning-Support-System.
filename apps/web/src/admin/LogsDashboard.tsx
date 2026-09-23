import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAdminData } from "./useAdminData";
import { useSSE, type SSEEvent } from "../lib/useSSE";
import { Icon } from "../components/Icon";

export interface LogEntry {
  id: string;
  category: "COMMERCE" | "AUTH" | "MODERATION" | "ADMIN";
  action: string;
  actor: string;
  time: string;
  date: string;
  status: "SUCCESS" | "WARN" | "RESOLVED" | "APPROVED";
  requestId: string;
  ip: string;
  details: string;
  payload: Record<string, unknown>;
}

interface LogsData {
  items: LogEntry[];
  meta?: { page?: { nextCursor: string | null } };
}

const CATEGORIES = [
  { id: "ALL", label: "Tất cả chuyên mục" },
  { id: "COMMERCE", label: "Thương mại & SePay" },
  { id: "AUTH", label: "Bảo mật & Auth" },
  { id: "MODERATION", label: "Kiểm duyệt nội dung" },
  { id: "ADMIN", label: "Vận hành Admin" },
];

export default function LogsDashboard() {
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [newLogsCount, setNewLogsCount] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data: apiData, loading, error, isLive, refresh, lastUpdated } = useAdminData<LogsData>(
    `/audit-logs?${selectedCategory !== "ALL" ? `category=${selectedCategory}&` : ""}limit=50`,
    { fallback: null, intervalMs: 60_000 },
  );
  const logs = apiData?.items ?? [];

  // SSE realtime — nhận log mới
  useSSE(isLive ? "/web-session/sse/notifications" : null, useCallback((event: SSEEvent) => {
    if (event.type === "audit_log" || event.type === "update") {
      setNewLogsCount((n) => n + 1);
    }
  }, []));

  const filteredLogs = logs.filter((log) => {
    const matchCat = selectedCategory === "ALL" || log.category === selectedCategory;
    const matchSearch =
      !search ||
      log.action.toLowerCase().includes(search.toLowerCase()) ||
      log.actor.toLowerCase().includes(search.toLowerCase()) ||
      log.requestId.toLowerCase().includes(search.toLowerCase()) ||
      log.details.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleExportJson = useCallback(async () => {
    setExportError(null);
    try {
      const res = await fetch(`/web-session/admin/export/audit-logs${selectedCategory !== "ALL" ? `?category=${selectedCategory}` : ""}`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ailss-audit-logs-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Không thể xuất nhật ký có thẩm quyền từ máy chủ.");
    }
  }, [selectedCategory]);

  return (
    <div className="admin-dashboard-container">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">KIỂM TOÁN & AN TOÀN HỆ THỐNG</p>
          <h1>Nhật Ký Hệ Thống & Kiểm Toán An Ninh</h1>
          <p className="lead">Theo dõi biến động xác thực, giao dịch SePay, kiểm duyệt và tác vụ quản trị.</p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button button-subtle" to="/app">← Tổng quan Admin</Link>
          <button className="button" onClick={() => void handleExportJson()}>📥 Xuất JSON</button>
        </div>
      </div>

      {error && (
        <div className="dashboard-banner-error" role="alert" style={{ background: "#FEE2E2", color: "#991B1B", padding: "12px 16px", borderRadius: 8, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>⚠️ Không thể đồng bộ nhật ký kiểm toán từ máy chủ ({error}). Không hiển thị dữ liệu thay thế.</span>
          <button className="button button-small button-subtle" onClick={refresh}>Thử lại</button>
        </div>
      )}
      {exportError ? <div className="dashboard-banner-error" role="alert">{exportError}</div> : null}

      {/* SSE realtime badge */}
      {newLogsCount > 0 && (
        <div className="dashboard-banner-notice sse-live-banner" role="status">
          <span className="live-dot" />
          <span>{newLogsCount} sự kiện mới — <button className="inline-link" onClick={() => { setNewLogsCount(0); refresh(); }}>Tải lại ngay</button></span>
        </div>
      )}

      {/* Status */}
      <div className="dashboard-toolbar-row">
        <div className="dashboard-filter-group" role="group" aria-label="Bộ lọc chuyên mục">
          {CATEGORIES.map((cat) => (
            <button key={cat.id} className={`filter-pill-button ${selectedCategory === cat.id ? "active" : ""}`} onClick={() => setSelectedCategory(cat.id)}>{cat.label}</button>
          ))}
        </div>
        <div className="dashboard-status-indicator">
          {isLive ? (
            <><span className="live-dot" /><span>Dữ liệu thực{lastUpdated ? ` · ${lastUpdated.toLocaleTimeString("vi-VN")}` : ""}</span></>
          ) : error ? (
            <><span className="mock-dot" style={{ backgroundColor: "#EF4444" }} /><span>Mất kết nối máy chủ</span></>
          ) : (
            <><span className="mock-dot" /><span>Chưa kết nối API</span></>
          )}
          <button className="button button-subtle button-small" onClick={refresh} disabled={loading}>↻</button>
        </div>
      </div>

      {/* KPI */}
      <div className="workspace-kpi-grid">
        <div className="kpi-card"><div className="kpi-header"><span className="kpi-icon"><Icon name="receipt" size={20} /></span><span className="kpi-tag accent">Thời gian thực</span></div><div className="kpi-value">{logs.length} sự kiện</div><div className="kpi-label">Nhật ký 24 giờ qua</div></div>
        <div className="kpi-card"><div className="kpi-header"><span className="kpi-icon"><Icon name="lock" size={20} /></span></div><div className="kpi-value">—</div><div className="kpi-label">Chứng thực chữ ký API</div></div>
        <div className="kpi-card"><div className="kpi-header"><span className="kpi-icon"><Icon name="zap" size={20} /></span></div><div className="kpi-value">—</div><div className="kpi-label">Lỗi đối soát tồn đọng</div></div>
        <div className="kpi-card"><div className="kpi-header"><span className="kpi-icon"><Icon name="shield" size={20} /></span></div><div className="kpi-value">Chưa xác minh</div><div className="kpi-label">Trạng thái tuân thủ</div></div>
      </div>

      {/* Search */}
      <div className="table-search-box full-width-search">
        <input type="search" placeholder="Tìm theo Request ID, Actor, hành động..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm kiếm nhật ký" />
      </div>

      {/* Table */}
      <section className="dashboard-section-card">
        <div className="table-responsive">
          <table className="dashboard-data-table" role="table">
            <thead>
              <tr><th>Thời Gian</th><th>Chuyên Mục</th><th>Hành Động</th><th>Tác Nhân</th><th>Mã YC</th><th>Trạng Thái</th></tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr
                  key={log.id}
                  className={`clickable-log-row ${selectedLog?.id === log.id ? "table-row-selected" : ""}`}
                  onClick={() => setSelectedLog(selectedLog?.id === log.id ? null : log)}
                  role="button"
                  tabIndex={0}
                  aria-label={`Xem chi tiết ${log.requestId}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedLog(selectedLog?.id === log.id ? null : log);
                    }
                  }}
                >
                  <td><span className="time-sub">{log.time} <small>({log.date})</small></span></td>
                  <td><span className={`category-tag category-${log.category.toLowerCase()}`}>{log.category}</span></td>
                  <td><strong>{log.action}</strong><div className="log-snippet-text">{log.details}</div></td>
                  <td><code className="actor-code">{log.actor}</code></td>
                  <td><code className="code-badge">{log.requestId}</code></td>
                  <td><span className={`status-pill ${log.status === "SUCCESS" || log.status === "APPROVED" || log.status === "RESOLVED" ? "status-success" : "status-warning"}`}>{log.status}</span></td>
                </tr>
              ))}
              {filteredLogs.length === 0 && <tr><td colSpan={6} className="table-empty-row">Không có bản ghi phù hợp.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* JSON Drawer */}
      {selectedLog && (
        <section className="dashboard-section-card log-detail-panel" role="dialog" aria-label="Chi tiết sự kiện nhật ký">
          <div className="section-card-header">
            <div>
              <h2>Chi Tiết Sự Kiện: {selectedLog.action}</h2>
              <p className="subtext">
                Request ID: <code>{selectedLog.requestId}</code> • Tác nhân: <code>{selectedLog.actor}</code> (IP: {selectedLog.ip})
              </p>
            </div>
            <button className="button button-subtle" onClick={() => setSelectedLog(null)}>✕ Đóng</button>
          </div>
          <div className="log-detail-content">
            <p className="log-summary-lead">{selectedLog.details}</p>
            <h3>Cấu Trúc Dữ Liệu Payload (JSON):</h3>
            <pre className="json-code-block" tabIndex={0}><code>{JSON.stringify(selectedLog.payload, null, 2)}</code></pre>
          </div>
        </section>
      )}
    </div>
  );
}
