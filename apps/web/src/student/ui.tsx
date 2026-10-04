import { useUiText } from "../lib/i18n";
import { ResultAnimation } from "../components/OperationResult";
import type { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "../auth/session";
import { studentError, type Progress } from "./api";
export function StudentGuard() {
  const uiText = useUiText();
  const auth = useSession();
  if (auth.state !== "AUTHENTICATED" && auth.state !== "REFRESHING")
    return <p role="status">{uiText("Đang xác minh phiên…")}</p>;
  return (auth.state === "AUTHENTICATED" || auth.state === "REFRESHING") &&
    auth.profile?.role === "STUDENT" ? (
    <Outlet />
  ) : (
    <Navigate to="/app" replace />
  );
}
export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  const uiText = useUiText();
  return (
    <div className="study-heading">
      <p className="eyebrow">{uiText("KHÔNG GIAN HỌC TẬP")}</p>
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
  const uiText = useUiText();
  if (query.pending)
    return (
      <div className="study-state" role="status">
        {uiText("Đang tải nội dung…")}
      </div>
    );
  if (query.error)
    return (
      <div className="study-state" role="alert">
        <p>{uiText(studentError(query.error))}</p>
        <button className="button secondary" onClick={query.retry}>
          {uiText("Thử lại")}
        </button>
      </div>
    );
  return <>{children || <div className="study-state">{uiText(empty)}</div>}</>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="study-state">{children}</div>;
}
export function ProgressView({ value }: { value: Progress }) {
  const uiText = useUiText();
  return (
    <div className="study-progress">
      <div>
        <strong>{value.percent}%</strong>
        <span>
          {value.completedCount} / {value.publishedTotal} {uiText(" bài hoàn thành")}
        </span>
      </div>
      <progress max={100} value={value.percent} aria-label={uiText("Tiến độ {0}%", [value.percent])} />
      <p>
        {uiText("Còn ")}
        {Math.max(0, value.publishedTotal - value.completedCount)} {uiText(" bài để hoàn thành khóa học.")}
      </p>
    </div>
  );
}
export function Status({
  command,
}: {
  command: { busy: boolean; message: string; outcome?: "success" | "failure" | null; revision?: number };
}) {
  const uiText = useUiText();
  if (!command.busy && command.outcome && command.message)
    return (
      <div className="command-result" role={command.outcome === "failure" ? "alert" : "status"}>
        <ResultAnimation key={command.revision} success={command.outcome === "success"} />
        <span>{uiText(command.message)}</span>
      </div>
    );
  return (
    <p role="status" className="study-status">
      {command.busy ? uiText("Đang lưu…") : uiText(command.message)}
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
  const uiText = useUiText();
  return (
    <div className="inline-actions study-pagination">
      {cursor && (
        <button className="button secondary" onClick={() => onNext(cursor)}>
          {uiText("Trang tiếp theo →")}
        </button>
      )}
      <button className="plain-button" onClick={onReset}>
        {uiText("Về trang đầu")}
      </button>
    </div>
  );
}
