import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "../auth/session";
import { lecturerError } from "./api";
import { useLecturer } from "./api";
export function OwnedCourseSelect({ name, label, required = false }: { name: string; label: string; required?: boolean }) {
  const q = useLecturer<{courseId:string;title:string}[]>("/me/owned-courses");
  return <label>{label}<select name={name} required={required} disabled={q.pending || !!q.error}><option value="">{q.pending ? "Đang tải khóa học…" : "Chọn khóa học"}</option>{q.data?.map(c => <option key={c.courseId} value={c.courseId}>{c.title}</option>)}</select>{!!q.error && <span role="alert">{lecturerError(q.error)} <button type="button" className="plain-button" onClick={q.retry}>Thử lại</button></span>}</label>;
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
  if (q.pending) return <p role="status">Đang tải dữ liệu chính thức…</p>;
  if (q.error)
    return (
      <div className="form-panel" role="alert">
        <p>{lecturerError(q.error)}</p>
        <button className="button secondary" onClick={q.retry}>
          Thử lại
        </button>
      </div>
    );
  if (q.data === undefined) return <p>Chưa có dữ liệu.</p>;
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
