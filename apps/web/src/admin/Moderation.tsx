import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../auth/session";
import { adminError, adminRequest } from "./api";
type Report = {
  reportId: string;
  targetType: "COMMENT" | "REVIEW";
  targetId: string;
  state: "OPEN" | "RESOLVED";
  decision: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export default function Moderation() {
  const { profile } = useSession();
  const [cursor, setCursor] = useState(""),
    [items, setItems] = useState<Report[]>([]),
    [next, setNext] = useState<string | null>(null),
    [pending, setPending] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Report | null>(null);
  const load = async () => {
    setPending(true);
    setError("");
    try {
      const result = await adminRequest<Report[]>(
        `/interaction-reports?${new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) })}`,
      );
      setItems(result.data);
      setNext(result.meta?.page?.nextCursor || null);
    } catch (e) {
      setError(adminError(e));
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    if (profile?.role === "ADMIN") void load();
  }, [cursor, profile?.role]);
  if (profile?.role !== "ADMIN") return <Navigate to="/app" replace />;
  return (
    <>
      <p className="eyebrow">ADMIN · KIỂM DUYỆT</p>
      <h1>Hàng đợi nội dung được báo cáo.</h1>
      <p className="lead">
        Xử lý theo thứ tự cũ nhất trước. Danh tính và lý do của người báo cáo không nằm trong projection này.
      </p>
      {pending ? (
        <p role="status">Đang tải hàng đợi…</p>
      ) : error ? (
        <div className="study-state" role="alert">
          <p>{error}</p>
          <button className="button secondary" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      ) : items.length ? (
        <div className="moderation-layout">
          <div className="moderation-queue">
            {items.map((report) => (
              <button
                className={
                  selected?.reportId === report.reportId ? "moderation-row active" : "moderation-row"
                }
                key={report.reportId}
                onClick={() => setSelected(report)}
              >
                <span className="badge">{report.targetType}</span>
                <strong>{report.targetId}</strong>
                <small>
                  {new Intl.DateTimeFormat("vi-VN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Ho_Chi_Minh",
                  }).format(new Date(report.createdAt))}{" "}
                  · v{report.version}
                </small>
              </button>
            ))}
          </div>
          {selected ? (
            <Decision
              report={selected}
              done={() => {
                setSelected(null);
                void load();
              }}
            />
          ) : (
            <div className="study-state">Chọn một báo cáo để xem và quyết định.</div>
          )}
        </div>
      ) : (
        <div className="study-state">Không có báo cáo đang mở.</div>
      )}
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
    </>
  );
}
function Decision({ report, done }: { report: Report; done: () => void }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      await adminRequest(
        `/interaction-reports/${report.reportId}/moderate`,
        "POST",
        {
          action: data.get("action"),
          reason: String(data.get("reason")),
          currentPassword: String(data.get("currentPassword")),
        },
        { "If-Match": `"v${report.version}"` },
      );
      done();
    } catch (error) {
      setMessage(adminError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-panel moderation-detail" onSubmit={(e) => void submit(e)}>
      <p className="eyebrow">CHI TIẾT BÁO CÁO</p>
      <h2>{report.targetType === "COMMENT" ? "Bình luận" : "Đánh giá"}</h2>
      <dl>
        <dt>Target ID</dt>
        <dd>{report.targetId}</dd>
        <dt>Trạng thái</dt>
        <dd>
          {report.state} · v{report.version}
        </dd>
      </dl>
      <label>
        Quyết định
        <select name="action" required>
          <option value="HIDE">Ẩn nội dung</option>
          <option value="RESTORE">Khôi phục nội dung</option>
          <option value="DISMISS">Bỏ qua báo cáo</option>
          <option value="WARN">Ghi nhận cảnh báo</option>
        </select>
      </label>
      <label>
        Lý do quyết định
        <textarea name="reason" rows={3} maxLength={1000} required />
      </label>
      <label>
        Mật khẩu hiện tại
        <input
          name="currentPassword"
          type="password"
          maxLength={128}
          autoComplete="current-password"
          required
        />
      </label>
      <p className="muted">Mật khẩu được xác minh lại riêng cho quyết định này.</p>
      <button className="button" disabled={busy}>
        {busy ? "Đang xử lý…" : "Xác nhận quyết định"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
