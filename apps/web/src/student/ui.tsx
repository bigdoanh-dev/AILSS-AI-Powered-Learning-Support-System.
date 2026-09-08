import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "../auth/session";
import { studentError, type Progress } from "./api";
export function StudentGuard() {
  const auth = useSession();
  if (auth.state !== "AUTHENTICATED" && auth.state !== "REFRESHING") return <p role="status">Đang xác minh phiên…</p>;
  return (auth.state === "AUTHENTICATED" || auth.state === "REFRESHING") && auth.profile?.role === "STUDENT" ? (
    <Outlet />
  ) : (
    <Navigate to="/app" replace />
  );
}
export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="study-heading">
      <p className="eyebrow">KHÔNG GIAN HỌC TẬP</p>
      <h1>{title}</h1>
      {children && <p className="lead">{children}</p>}
    </div>
  );
}
export function State({
  query,
  children,
  empty = "Chưa có nội dung.",
}: {
  query: { pending: boolean; error?: unknown; retry: () => void };
  children: ReactNode;
  empty?: string;
}) {
  if (query.pending)
    return (
      <div className="study-state" role="status">
        Đang tải nội dung…
      </div>
    );
  if (query.error)
    return (
      <div className="study-state" role="alert">
        <p>{studentError(query.error)}</p>
        <button className="button secondary" onClick={query.retry}>
          Thử lại
        </button>
      </div>
    );
  return <>{children || <div className="study-state">{empty}</div>}</>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="study-state">{children}</div>;
}
export function ProgressView({ value }: { value: Progress }) {
  return (
    <div className="study-progress">
      <div>
        <strong>{value.percent}%</strong>
        <span>
          {value.completedCount} / {value.publishedTotal} bài hoàn thành
        </span>
      </div>
      <progress max={100} value={value.percent} aria-label={`Tiến độ ${value.percent}%`} />
      <p>Còn {Math.max(0, value.publishedTotal - value.completedCount)} bài để hoàn thành khóa học.</p>
    </div>
  );
}
export function Status({ command }: { command: { busy: boolean; message: string } }) {
  return (
    <p role="status" className="study-status">
      {command.busy ? "Đang lưu…" : command.message}
    </p>
  );
}
export function NextPage({
  cursor,
  onNext,
  onReset,
}: {
  cursor?: string | null;
  onNext: (cursor: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="inline-actions study-pagination">
      {cursor && (
        <button className="button secondary" onClick={() => onNext(cursor)}>
          Trang tiếp theo →
        </button>
      )}
      <button className="plain-button" onClick={onReset}>
        Về trang đầu
      </button>
    </div>
  );
}
