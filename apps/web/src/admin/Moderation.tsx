import { useUiText } from "../lib/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../auth/session";
import { adminError, adminRequest } from "./api";

export type Report = {
  reportId: string;
  targetType: "COMMENT" | "REVIEW";
  targetId: string;
  state: "OPEN" | "RESOLVED";
  decision: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  // Demo metadata
  contentSnippet?: string;
  authorName?: string;
  reportedReason?: string;
  severity?: "HIGH" | "MEDIUM" | "LOW";
  courseTitle?: string;
  reportedCount?: number;
};

export default function Moderation() {
  const uiText = useUiText();
  const { profile } = useSession();
  const [cursor, setCursor] = useState(""),
    [items, setItems] = useState<Report[]>([]),
    [next, setNext] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Report | null>(null),
    [isDemo, setIsDemo] = useState(false);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("ALL");
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    setPending(true);
    setError("");
    try {
      const result = await adminRequest<Report[]>(
        `/interaction-reports?${new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) })}`,
      );
      setItems(result.data ?? []);
      setIsDemo(false);
      setSelected(result.data?.[0] ?? null);
      setNext(result.meta?.page?.nextCursor || null);
    } catch (error) {
      setItems([]);
      setSelected(null);
      setNext(null);
      setError(adminError(error));
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (profile?.role === "ADMIN") void load();
  }, [cursor, profile?.role]);

  const handleResetDemo = () => {
    void load();
    setSelected(null);
    setIsDemo(false);
  };

  if (profile?.role !== "ADMIN") return <Navigate to="/app" replace />;

  const filteredItems = items.filter((r) => {
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      r.reportId.toLowerCase().includes(q) ||
      r.targetId.toLowerCase().includes(q) ||
      (r.contentSnippet && r.contentSnippet.toLowerCase().includes(q)) ||
      (r.reportedReason && r.reportedReason.toLowerCase().includes(q)) ||
      (r.authorName && r.authorName.toLowerCase().includes(q)) ||
      (r.courseTitle && r.courseTitle.toLowerCase().includes(q));

    if (!matchesSearch) return false;

    if (filterType === "COMMENT") return r.targetType === "COMMENT";
    if (filterType === "REVIEW") return r.targetType === "REVIEW";
    if (filterType === "HIGH") return r.severity === "HIGH";
    if (filterType === "OPEN") return r.state === "OPEN";
    if (filterType === "RESOLVED") return r.state === "RESOLVED";

    return true;
  });

  const openCount = items.filter((r) => r.state === "OPEN").length;
  const highCount = items.filter((r) => r.severity === "HIGH").length;
  const resolvedCount = items.filter((r) => r.state === "RESOLVED").length;

  return (
    <>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">{uiText("ADMIN · AN NINH & CỘNG ĐỒNG")}</p>
          <h1>{uiText("Hàng Đợi Nội Dung Bị Báo Cáo")}</h1>
          <p className="lead">
            {uiText(
              "Xử lý phản ánh từ học viên về bình luận xúc phạm, đánh giá giả mạo hoặc gian lận học thuật theo thứ tự ưu tiên.",
            )}
          </p>
        </div>

        <div className="dashboard-header-actions">
          {isDemo && (
            <button
              className="button button-subtle"
              onClick={handleResetDemo}
              title={uiText("Khôi phục danh sách báo cáo mẫu")}
            >
              {uiText("↻ Tải lại dữ liệu")}
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="moderation-stat-strip">
        <div className="moderation-stat-item">
          <div className="moderation-stat-label">{uiText("Tổng báo cáo")}</div>
          <div className="moderation-stat-val">{items.length}</div>
        </div>
        <div className="moderation-stat-item">
          <div className="moderation-stat-label">{uiText("Chờ xử lý")}</div>
          <div className="moderation-stat-val" style={{ color: "#d97706" }}>
            {openCount}
          </div>
        </div>
        <div className="moderation-stat-item">
          <div className="moderation-stat-label">{uiText("Mức độ nghiêm trọng")}</div>
          <div className="moderation-stat-val" style={{ color: "#dc2626" }}>
            {highCount}
          </div>
        </div>
        <div className="moderation-stat-item">
          <div className="moderation-stat-label">{uiText("Đã giải quyết")}</div>
          <div className="moderation-stat-val" style={{ color: "#16a34a" }}>
            {resolvedCount}
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="admin-table-toolbar">
        <div className="admin-search-input-wrap">
          <span className="admin-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            placeholder={uiText("Tìm theo nội dung, người vi phạm, mã báo cáo...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={uiText("Tìm kiếm nội dung báo cáo")}
          />
        </div>

        <div className="dashboard-filter-group" role="group" aria-label={uiText("Lọc báo cáo")}>
          <button
            type="button"
            className={`filter-pill-button ${filterType === "ALL" ? "active" : ""}`}
            onClick={() => setFilterType("ALL")}
          >
            {uiText("Tất cả (")}
            {items.length})
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterType === "COMMENT" ? "active" : ""}`}
            onClick={() => setFilterType("COMMENT")}
          >
            {uiText("💬 Bình luận")}
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterType === "REVIEW" ? "active" : ""}`}
            onClick={() => setFilterType("REVIEW")}
          >
            {uiText("⭐ Đánh giá")}
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterType === "HIGH" ? "active" : ""}`}
            onClick={() => setFilterType("HIGH")}
            style={{ color: filterType === "HIGH" ? "#fff" : "#dc2626" }}
          >
            {uiText("🔴 Mức độ cao")}
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterType === "RESOLVED" ? "active" : ""}`}
            onClick={() => setFilterType("RESOLVED")}
          >
            {uiText("✓ Đã xử lý")}
          </button>
        </div>
      </div>

      {pending ? (
        <p role="status">{uiText("Đang tải hàng đợi…")}</p>
      ) : error ? (
        <div className="study-state" role="alert">
          <p>{uiText(error)}</p>
          <button className="button secondary" onClick={() => void load()}>
            {uiText("Thử lại")}
          </button>
        </div>
      ) : filteredItems.length ? (
        <div className="moderation-layout">
          {/* QUEUE LIST */}
          <div className="moderation-queue" role="list">
            {filteredItems.map((report) => {
              const isSelected = selected?.reportId === report.reportId;
              const sev = report.severity || "MEDIUM";
              return (
                <div
                  key={report.reportId}
                  role="button"
                  tabIndex={0}
                  className={`moderation-card-item ${isSelected ? "active" : ""}`}
                  onClick={() => setSelected(report)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(report);
                    }
                  }}
                  aria-pressed={isSelected}
                >
                  <div className="moderation-card-top">
                    <span className="course-category-tag">
                      {report.targetType === "COMMENT" ? uiText("💬 BÌNH LUẬN") : uiText("⭐ ĐÁNH GIÁ")}
                    </span>

                    <span className={`moderation-severity-pill ${sev.toLowerCase()}`}>
                      {sev === "HIGH" ? "🔴 Cao" : sev === "MEDIUM" ? "🟠 TB" : uiText("🟡 Thấp")}
                    </span>
                  </div>

                  <div className="moderation-reason-title">
                    {report.reportedReason || `Báo cáo ${report.targetType}`}
                  </div>

                  {report.courseTitle && (
                    <div style={{ fontSize: "11.5px", color: "var(--muted)" }}>
                      {uiText("Môn học: ")}
                      <strong>{report.courseTitle}</strong>
                    </div>
                  )}

                  {report.contentSnippet && (
                    <div className="moderation-content-preview">"{report.contentSnippet}"</div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "4px",
                    }}
                  >
                    <small className="muted" style={{ fontSize: "11px" }}>
                      {uiText("Tác giả: ")}
                      <strong>{report.authorName || report.targetId.slice(0, 10)}</strong>
                    </small>
                    <span
                      className={`admin-badge ${report.state === "OPEN" ? "pending" : "active"}`}
                      style={{ fontSize: "10.5px" }}
                    >
                      {report.state === "OPEN"
                        ? uiText("⏳ Chờ xử lý")
                        : uiText("✓ {0}", [report.decision || "Đã giải quyết"])}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* DETAIL & DECISION PANEL */}
          {selected ? (
            <Decision
              report={selected}
              done={(action?: string) => {
                // Update local items state so user sees resolved state immediately
                setItems((prev) =>
                  prev.map((r) =>
                    r.reportId === selected.reportId
                      ? { ...r, state: "RESOLVED", decision: action || "HIDE" }
                      : r,
                  ),
                );
                setSelected((prev) =>
                  prev ? { ...prev, state: "RESOLVED", decision: action || "HIDE" } : null,
                );
                showToast(
                  `✓ Đã thực thi quyết định [${action === "HIDE" ? "Ẩn nội dung" : action === "WARN" ? "Cảnh báo" : action === "DISMISS" ? "Bỏ qua" : "Khôi phục"}] thành công!`,
                );
              }}
            />
          ) : (
            <div className="study-state">
              {uiText("Chọn một báo cáo ở danh sách bên trái để xem nội dung chi tiết.")}
            </div>
          )}
        </div>
      ) : (
        <div className="study-state">
          {search
            ? uiText('Không tìm thấy báo cáo nào khớp với từ khóa "{0}".', [search])
            : uiText("Không có báo cáo nào đang mở.")}
          <div style={{ marginTop: "14px" }}>
            <button className="button" onClick={handleResetDemo}>
              {uiText("Tải lại báo cáo")}
            </button>
          </div>
        </div>
      )}

      {/* Pagination Actions */}
      <div className="inline-actions study-pagination">
        {next && (
          <button className="button secondary" onClick={() => setCursor(next)}>
            {uiText("Trang tiếp theo →")}
          </button>
        )}
        <button
          className="plain-button"
          onClick={() => {
            setCursor("");
            void load();
          }}
        >
          {uiText("Về trang đầu")}
        </button>
      </div>

      {/* Toast Notice */}
      {toast && (
        <div className="admin-toast-notice" role="status">
          <span>✓</span>
          <span>{toast}</span>
        </div>
      )}
    </>
  );
}

function Decision({ report, done }: { report: Report; done: (action?: string) => void }) {
  const uiText = useUiText();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<string>("HIDE");
  const [reason, setReason] = useState(
    report.reportedReason
      ? `Vi phạm quy chế cộng đồng: ${report.reportedReason}`
      : "Vi phạm quy chế cộng đồng và chuẩn mực giao tiếp học thuật AILSS.",
  );
  const [currentPassword, setCurrentPassword] = useState("");

  useEffect(() => {
    setReason(
      report.reportedReason
        ? `Vi phạm quy chế cộng đồng: ${report.reportedReason}`
        : "Vi phạm quy chế cộng đồng và chuẩn mực giao tiếp học thuật AILSS.",
    );
    setMessage("");
  }, [report]);

  const quickReasons = [
    "Vi phạm quy chế chống spam & quảng cáo",
    "Ngôn từ kích động, xúc phạm giảng viên",
    "Gian lận thi cử & lộ đáp án bài kiểm tra",
    "Đánh giá giả mạo phá hoại (Review bombing)",
    "Bình luận lạc đề, không liên quan môn học",
  ];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await adminRequest(
        `/interaction-reports/${report.reportId}/moderate`,
        "POST",
        {
          action,
          reason,
          currentPassword,
        },
        { "If-Match": `"v${report.version}"` },
      );
      done(action);
    } catch (error) {
      setMessage(adminError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-panel moderation-detail" onSubmit={(e) => void submit(e)}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <p className="eyebrow" style={{ margin: 0 }}>
          {uiText("THẨM ĐỊNH NỘI DUNG")}
        </p>
        <span className={`admin-badge ${report.state === "OPEN" ? "pending" : "active"}`}>
          {report.state === "OPEN"
            ? uiText("⏳ ĐANG CHỜ XỬ LÝ")
            : uiText("✓ ĐÃ GIẢI QUYẾT ({0})", [report.decision || "RESOLVED"])}
        </span>
      </div>

      <h2>{report.targetType === "COMMENT" ? uiText("Bình luận thảo luận") : uiText("Đánh giá khóa học")}</h2>

      {/* Target Reported Content Box */}
      <div className="moderation-target-box">
        <div className="moderation-target-title">
          {uiText("⚠️ NỘI DUNG BỊ BÁO CÁO VI PHẠM (")}
          {report.reportedCount
            ? uiText("{0} lượt phản ánh", [report.reportedCount])
            : uiText("Được báo cáo")}
          )
        </div>
        <blockquote className="moderation-target-text">
          "{report.contentSnippet || "Nội dung phản ánh từ người dùng hệ thống."}"
        </blockquote>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", margin: "12px 0 16px" }}>
        <div>
          <dt style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>
            {uiText("Mã Báo cáo (UUID)")}
          </dt>
          <dd style={{ fontWeight: 600, fontSize: "12px" }}>{report.reportId.slice(0, 18)}…</dd>
        </div>
        <div>
          <dt style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>Target ID</dt>
          <dd style={{ fontWeight: 600, fontSize: "12px" }}>{report.targetId}</dd>
        </div>
        <div>
          <dt style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>
            {uiText("Môn học liên quan")}
          </dt>
          <dd style={{ fontWeight: 600, fontSize: "12.5px", color: "var(--ink)" }}>
            {report.courseTitle || "Hệ thống AILSS"}
          </dd>
        </div>
        <div>
          <dt style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>
            {uiText("Tác giả nội dung")}
          </dt>
          <dd style={{ fontWeight: 600, fontSize: "12.5px" }}>{report.authorName || "Học viên"}</dd>
        </div>
      </dl>

      <label>
        {uiText("Quyết định kiểm duyệt")}
        <select name="action" value={action} onChange={(e) => setAction(e.target.value)} required>
          <option value="HIDE">{uiText("Ẩn nội dung khỏi hệ thống (HIDE)")}</option>
          <option value="WARN">{uiText("Ghi nhận cảnh báo tài khoản (WARN)")}</option>
          <option value="DISMISS">{uiText("Bỏ qua báo cáo, giữ nguyên nội dung (DISMISS)")}</option>
          <option value="RESTORE">{uiText("Khôi phục nội dung đã ẩn (RESTORE)")}</option>
        </select>
      </label>

      <label style={{ marginTop: "12px" }}>
        {uiText("Lý do quyết định kiểm duyệt")}
        <textarea
          name="reason"
          rows={3}
          maxLength={1000}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={uiText("Nhập căn cứ xử lý vi phạm...")}
        />
      </label>

      {/* Quick Reason Fill Buttons */}
      <div style={{ margin: "4px 0 14px" }}>
        <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px" }}>
          {uiText("Gợi ý lý do nhanh:")}
        </div>
        <div className="moderation-quick-reasons">
          {quickReasons.map((qr, idx) => (
            <button
              type="button"
              key={idx}
              className="moderation-quick-reason-btn"
              onClick={() => setReason(qr)}
            >
              + {qr}
            </button>
          ))}
        </div>
      </div>

      <label style={{ marginTop: "12px" }}>
        {uiText("Mật khẩu Quản trị viên hiện tại")}
        <input
          name="currentPassword"
          type="password"
          maxLength={128}
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder={uiText("Nhập mật khẩu admin để xác thực...")}
        />
      </label>
      <p className="muted" style={{ fontSize: "11.5px" }}>
        {uiText("Mật khẩu được xác minh lại riêng cho mỗi quyết định kiểm duyệt.")}
      </p>

      <button className="button" disabled={busy || !currentPassword} style={{ marginTop: "8px" }}>
        {busy ? uiText("Đang xử lý…") : uiText("Xác nhận quyết định")}
      </button>

      {message && (
        <p role="status" className="notice error">
          {uiText(message)}
        </p>
      )}
    </form>
  );
}
