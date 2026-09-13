import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "../auth/session";
import { lecturerError } from "./api";
import { useLecturer } from "./api";
export function CatalogCourseSelect({
  name,
  label,
  required = false,
}: {
  name: string;
  label: string;
  required?: boolean;
}) {
  const q = useLecturer<
    { courseId: string; title: string }[] | { items: { courseId: string; title: string }[] }
  >("/courses?limit=50");
  return (
    <label>
      {label}
      <select name={name} required={required} disabled={q.pending || !!q.error}>
        <option value="">{q.pending ? "Đang tải khóa học…" : "Chọn khóa học"}</option>
        {(Array.isArray(q.data) ? q.data : q.data?.items)?.map((c) => (
          <option key={c.courseId} value={c.courseId}>
            {c.title}
          </option>
        ))}
      </select>
      <small>Catalog khóa học đã xuất bản. Quyền sử dụng được kiểm tra khi gửi.</small>
      {!!q.error && (
        <span role="alert">
          {lecturerError(q.error)}{" "}
          <button type="button" className="plain-button" onClick={q.retry}>
            Thử lại
          </button>
        </span>
      )}
    </label>
  );
}
export function LecturerGuard() {
  const { profile } = useSession();
  if (!profile) return null;
  if (profile.role !== "LECTURER") return <Navigate to="/app" replace />;
  if (!profile.lecturerVerified)
    return (
      <section className="form-panel">
        <p className="eyebrow">GIẢNG VIÊN</p>
        <h1>Cần xác minh tài khoản.</h1>
        <p className="lead">
          Không gian giảng dạy sẽ mở sau khi hồ sơ Giảng viên được quản trị viên xác minh.
        </p>
        <p>Kiểm tra trạng thái hồ sơ trong tài khoản của bạn hoặc liên hệ đơn vị quản trị.</p>
      </section>
    );
  return <Outlet />;
}
export function State<T>({
  q,
  children,
}: {
  q: { pending: boolean; error?: unknown; data?: T; retry: () => void };
  children: (v: T) => React.ReactNode;
}) {
  if (q.pending)
    return (
      <div className="workspace-status-card" role="status">
        <span className="live-pulsing-dot" aria-hidden="true" />
        <span>Đang đồng bộ dữ liệu từ hệ thống…</span>
      </div>
    );
  if (q.error)
    return (
      <div className="workspace-alert-box" role="alert">
        <span className="alert-icon" aria-hidden="true">⚠️</span>
        <div className="alert-details">
          <strong>Chưa thể tải dữ liệu</strong>
          <p>{lecturerError(q.error) || "Hệ thống đang đồng bộ dữ liệu. Vui lòng thử lại sau giây lát."}</p>
        </div>
        <button type="button" className="button secondary small" onClick={q.retry}>
          Thử lại
        </button>
      </div>
    );
  if (q.data === undefined)
    return (
      <div className="workspace-status-card">
        <span>Chưa có dữ liệu.</span>
      </div>
    );
  return <>{children(q.data)}</>;
}
export const Field = ({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
}) => (
  <label>
    {label}
    <input name={name} type={type} required={required} defaultValue={defaultValue} />
  </label>
);
