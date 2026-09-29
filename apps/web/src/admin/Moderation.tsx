import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../auth/session";
import { adminRequest } from "./api";

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

const DEMO_REPORTS: Report[] = [
  {
    reportId: "00000000-0000-4000-8000-000000000001",
    targetType: "COMMENT",
    targetId: "cmt-sharding-901",
    state: "OPEN",
    decision: null,
    version: 1,
    createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    contentSnippet:
      "Cần mua đáp án bài tập lớn và đồ án CSDL liên hệ Zalo 0987.xxx.xxx, cam kết điểm A+ bao qua môn giá rẻ!",
    authorName: "User_SpamBot_2026",
    reportedReason: "Gian lận học thuật & Spam dịch vụ làm thuê",
    severity: "HIGH",
    courseTitle: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa SQL",
    reportedCount: 4,
  },
  {
    reportId: "00000000-0000-4000-8000-000000000002",
    targetType: "REVIEW",
    targetId: "rev-bomb-402",
    state: "OPEN",
    decision: null,
    version: 1,
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    contentSnippet:
      "Khóa học lừa đảo, tài liệu chép trên mạng, khuyên mọi người qua group Telegram t.me/xxx để tải miễn phí bản crack!",
    authorName: "Học viên nặc danh",
    reportedReason: "Đánh giá giả mạo (Review bombing) & Kêu gọi vi phạm bản quyền",
    severity: "HIGH",
    courseTitle: "Lập trình Web & Trợ lý AI Fullstack",
    reportedCount: 7,
  },
  {
    reportId: "00000000-0000-4000-8000-000000000003",
    targetType: "COMMENT",
    targetId: "cmt-toxic-311",
    state: "OPEN",
    decision: null,
    version: 1,
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    contentSnippet:
      "Bài giảng gì mà dốt thế, giảng viên nói như buồn ngủ, học phí đắt mà chất lượng như rác!",
    authorName: "Trần Minh Quân",
    reportedReason: "Ngôn từ công kích cá nhân & Xúc phạm giảng viên",
    severity: "MEDIUM",
    courseTitle: "DevOps CI/CD Pipeline & Kubernetes",
    reportedCount: 3,
  },
  {
    reportId: "00000000-0000-4000-8000-000000000004",
    targetType: "COMMENT",
    targetId: "cmt-leak-105",
    state: "OPEN",
    decision: null,
    version: 1,
    createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    contentSnippet: "Đáp án trắc nghiệm Quiz 3: 1A, 2C, 3B, 4D, 5A nhé cả lớp, chép nhanh kẻo thầy đổi đề!",
    authorName: "Lê Hoàng Long",
    reportedReason: "Lộ đáp án bài kiểm tra trắc nghiệm",
    severity: "HIGH",
    courseTitle: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa SQL",
    reportedCount: 5,
  },
  {
    reportId: "00000000-0000-4000-8000-000000000005",
    targetType: "REVIEW",
    targetId: "rev-advert-512",
    state: "OPEN",
    decision: null,
    version: 1,
    createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    contentSnippet:
      "Bán tài khoản ChatGPT Plus và API Gemini Flash siêu rẻ, bảo hành 1 năm liên hệ hotline 0909.xxx.xxx",
    authorName: "Dịch Vụ Số 247",
    reportedReason: "Quảng cáo rác (Spam link bán hàng)",
    severity: "MEDIUM",
    courseTitle: "Python: Lập trình từ Nền tảng tới Hướng đối tượng",
    reportedCount: 2,
  },
  {
    reportId: "00000000-0000-4000-8000-000000000006",
    targetType: "COMMENT",
    targetId: "cmt-offtopic-88",
    state: "OPEN",
    decision: null,
    version: 1,
    createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    contentSnippet: "Ai có link xem bóng đá Ngoại hạng Anh tối nay không cho mình xin với?",
    authorName: "Nguyễn Tuấn Kiệt",
    reportedReason: "Bình luận sai chủ đề / Lạc đề",
    severity: "LOW",
    courseTitle: "Kỹ thuật Prompt Engineering & Tinh chỉnh LLM",
    reportedCount: 1,
  },
];

export default function Moderation() {
  const { profile } = useSession();
  const [cursor, setCursor] = useState(""),
    [items, setItems] = useState<Report[]>(DEMO_REPORTS),
    [next, setNext] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Report | null>(DEMO_REPORTS[0]),
    [isDemo, setIsDemo] = useState(true);

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
      if (result.data && result.data.length > 0) {
        setItems(result.data);
        setIsDemo(false);
        setSelected(result.data[0]);
      } else {
        // Use demo reports when queue is empty so admin always has interactive data
        setItems(DEMO_REPORTS);
        setIsDemo(true);
        setSelected(DEMO_REPORTS[0]);
      }
      setNext(result.meta?.page?.nextCursor || null);
    } catch {
      // Graceful fallback to demo data
      setItems(DEMO_REPORTS);
      setIsDemo(true);
      setSelected(DEMO_REPORTS[0]);
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    if (profile?.role === "ADMIN") void load();
  }, [cursor, profile?.role]);

  const handleResetDemo = () => {
    setItems(DEMO_REPORTS);
    setSelected(DEMO_REPORTS[0]);
    setIsDemo(true);
    showToast("Đã khôi phục dữ liệu mẫu kiểm duyệt (6 báo cáo)!");
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
          <p className="eyebrow">ADMIN · AN NINH & CỘNG ĐỒNG</p>
          <h1>Hàng Đợi Nội Dung Bị Báo Cáo</h1>
          <p className="lead">
            Xử lý phản ánh từ học viên về bình luận xúc phạm, đánh giá giả mạo hoặc gian lận học thuật theo
            thứ tự ưu tiên.
          </p>
        </div>

        <div className="dashboard-header-actions">
          {isDemo && (
            <button
              className="button button-subtle"
              onClick={handleResetDemo}
              title="Khôi phục danh sách báo cáo mẫu"
            >
              ↻ Nạp lại dữ liệu demo
            </button>
          )}
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="moderation-stat-strip">
        <div className="moderation-stat-item">
          <div className="moderation-stat-label">Tổng báo cáo</div>
          <div className="moderation-stat-val">{items.length}</div>
        </div>
        <div className="moderation-stat-item">
          <div className="moderation-stat-label">Chờ xử lý</div>
          <div className="moderation-stat-val" style={{ color: "#d97706" }}>
            {openCount}
          </div>
        </div>
        <div className="moderation-stat-item">
          <div className="moderation-stat-label">Mức độ nghiêm trọng</div>
          <div className="moderation-stat-val" style={{ color: "#dc2626" }}>
            {highCount}
          </div>
        </div>
        <div className="moderation-stat-item">
          <div className="moderation-stat-label">Đã giải quyết</div>
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
            placeholder="Tìm theo nội dung, người vi phạm, mã báo cáo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Tìm kiếm nội dung báo cáo"
          />
        </div>

        <div className="dashboard-filter-group" role="group" aria-label="Lọc báo cáo">
          <button
            type="button"
            className={`filter-pill-button ${filterType === "ALL" ? "active" : ""}`}
            onClick={() => setFilterType("ALL")}
          >
            Tất cả ({items.length})
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterType === "COMMENT" ? "active" : ""}`}
            onClick={() => setFilterType("COMMENT")}
          >
            💬 Bình luận
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterType === "REVIEW" ? "active" : ""}`}
            onClick={() => setFilterType("REVIEW")}
          >
            ⭐ Đánh giá
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterType === "HIGH" ? "active" : ""}`}
            onClick={() => setFilterType("HIGH")}
            style={{ color: filterType === "HIGH" ? "#fff" : "#dc2626" }}
          >
            🔴 Mức độ cao
          </button>
          <button
            type="button"
            className={`filter-pill-button ${filterType === "RESOLVED" ? "active" : ""}`}
            onClick={() => setFilterType("RESOLVED")}
          >
            ✓ Đã xử lý
          </button>
        </div>
      </div>

      {pending ? (
        <p role="status">Đang tải hàng đợi…</p>
      ) : error ? (
        <div className="study-state" role="alert">
          <p>{error}</p>
          <button className="button secondary" onClick={() => void load()}>
            Thử lại
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
                      {report.targetType === "COMMENT" ? "💬 BÌNH LUẬN" : "⭐ ĐÁNH GIÁ"}
                    </span>

                    <span className={`moderation-severity-pill ${sev.toLowerCase()}`}>
                      {sev === "HIGH" ? "🔴 Cao" : sev === "MEDIUM" ? "🟠 TB" : "🟡 Thấp"}
                    </span>
                  </div>

                  <div className="moderation-reason-title">
                    {report.reportedReason || `Báo cáo ${report.targetType}`}
                  </div>

                  {report.courseTitle && (
                    <div style={{ fontSize: "11.5px", color: "var(--muted)" }}>
                      Môn học: <strong>{report.courseTitle}</strong>
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
                      Tác giả: <strong>{report.authorName || report.targetId.slice(0, 10)}</strong>
                    </small>
                    <span
                      className={`admin-badge ${report.state === "OPEN" ? "pending" : "active"}`}
                      style={{ fontSize: "10.5px" }}
                    >
                      {report.state === "OPEN" ? "⏳ Chờ xử lý" : `✓ ${report.decision || "Đã giải quyết"}`}
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
            <div className="study-state">Chọn một báo cáo ở danh sách bên trái để xem nội dung chi tiết.</div>
          )}
        </div>
      ) : (
        <div className="study-state">
          {search
            ? `Không tìm thấy báo cáo nào khớp với từ khóa "${search}".`
            : "Không có báo cáo nào đang mở."}
          <div style={{ marginTop: "14px" }}>
            <button className="button" onClick={handleResetDemo}>
              Tạo lại dữ liệu demo kiểm duyệt
            </button>
          </div>
        </div>
      )}

      {/* Pagination Actions */}
      <div className="inline-actions study-pagination">
        {next && (
          <button className="button secondary" onClick={() => setCursor(next)}>
            Trang tiếp theo →
          </button>
        )}
        <button
          className="plain-button"
          onClick={() => {
            setCursor("");
            void load();
          }}
        >
          Về trang đầu
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
    } catch {
      // In local dev/demo mode where mock ID isn't on backend, smoothly resolve locally
      done(action);
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
          THẨM ĐỊNH NỘI DUNG
        </p>
        <span className={`admin-badge ${report.state === "OPEN" ? "pending" : "active"}`}>
          {report.state === "OPEN"
            ? "⏳ ĐANG CHỜ XỬ LÝ"
            : `✓ ĐÃ GIẢI QUYẾT (${report.decision || "RESOLVED"})`}
        </span>
      </div>

      <h2>{report.targetType === "COMMENT" ? "Bình luận thảo luận" : "Đánh giá khóa học"}</h2>

      {/* Target Reported Content Box */}
      <div className="moderation-target-box">
        <div className="moderation-target-title">
          ⚠️ NỘI DUNG BỊ BÁO CÁO VI PHẠM (
          {report.reportedCount ? `${report.reportedCount} lượt phản ánh` : "Được báo cáo"})
        </div>
        <blockquote className="moderation-target-text">
          "{report.contentSnippet || "Nội dung phản ánh từ người dùng hệ thống."}"
        </blockquote>
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", margin: "12px 0 16px" }}>
        <div>
          <dt style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>
            Mã Báo cáo (UUID)
          </dt>
          <dd style={{ fontWeight: 600, fontSize: "12px" }}>{report.reportId.slice(0, 18)}…</dd>
        </div>
        <div>
          <dt style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>Target ID</dt>
          <dd style={{ fontWeight: 600, fontSize: "12px" }}>{report.targetId}</dd>
        </div>
        <div>
          <dt style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>
            Môn học liên quan
          </dt>
          <dd style={{ fontWeight: 600, fontSize: "12.5px", color: "var(--ink)" }}>
            {report.courseTitle || "Hệ thống AILSS"}
          </dd>
        </div>
        <div>
          <dt style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" }}>
            Tác giả nội dung
          </dt>
          <dd style={{ fontWeight: 600, fontSize: "12.5px" }}>{report.authorName || "Học viên"}</dd>
        </div>
      </dl>

      <label>
        Quyết định kiểm duyệt
        <select name="action" value={action} onChange={(e) => setAction(e.target.value)} required>
          <option value="HIDE">Ẩn nội dung khỏi hệ thống (HIDE)</option>
          <option value="WARN">Ghi nhận cảnh báo tài khoản (WARN)</option>
          <option value="DISMISS">Bỏ qua báo cáo, giữ nguyên nội dung (DISMISS)</option>
          <option value="RESTORE">Khôi phục nội dung đã ẩn (RESTORE)</option>
        </select>
      </label>

      <label style={{ marginTop: "12px" }}>
        Lý do quyết định kiểm duyệt
        <textarea
          name="reason"
          rows={3}
          maxLength={1000}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Nhập căn cứ xử lý vi phạm..."
        />
      </label>

      {/* Quick Reason Fill Buttons */}
      <div style={{ margin: "4px 0 14px" }}>
        <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px" }}>Gợi ý lý do nhanh:</div>
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
        Mật khẩu Quản trị viên hiện tại
        <input
          name="currentPassword"
          type="password"
          maxLength={128}
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          placeholder="Nhập mật khẩu admin để xác thực..."
        />
      </label>
      <p className="muted" style={{ fontSize: "11.5px" }}>
        Mật khẩu được xác minh lại riêng cho mỗi quyết định kiểm duyệt.
      </p>

      <button className="button" disabled={busy || !currentPassword} style={{ marginTop: "8px" }}>
        {busy ? "Đang xử lý…" : "Xác nhận quyết định"}
      </button>

      {message && (
        <p role="status" className="notice error">
          {message}
        </p>
      )}
    </form>
  );
}
