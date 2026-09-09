import { useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
export function ResultAnimation({ success }: { success: boolean }) {
  return (
    <span className={`result-animation ${success ? "is-success" : "is-failure"}`} aria-hidden="true">
      <svg viewBox="0 0 120 120" fill="none">
        <circle className="result-halo" cx="60" cy="60" r="52" />
        <circle className="result-ring" cx="60" cy="60" r="40" pathLength="1" />
        {success ? (
          <path className="result-mark" pathLength="1" d="M40 61 54 75 81 46" />
        ) : (
          <g className="result-warning">
            <path className="result-mark" pathLength="1" d="M60 38V64" />
            <circle className="result-dot" cx="60" cy="79" r="3.5" />
          </g>
        )}
        {success && (
          <g className="result-sparks">
            <path d="M15 23l5 5M98 20l-4 7M107 83l-7-2M22 98l5-6" />
          </g>
        )}
      </svg>
    </span>
  );
}
export function OperationResult({
  success,
  title,
  children,
  action,
  onComplete,
}: {
  success: boolean;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  onComplete?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const callback = useRef(onComplete);
  callback.current = onComplete;
  const automatic = !!onComplete;
  useEffect(() => {
    if (!automatic) return;
    const timer = window.setTimeout(() => callback.current?.(), success ? 1600 : 2600);
    return () => window.clearTimeout(timer);
  }, [automatic, success, title]);
  useEffect(() => {
    heading.current?.focus();
  }, [title]);
  return (
    <section className={`study-card operation-result ${success ? "is-success" : "is-failure"}`}>
      <ResultAnimation key={`${success}-${title}`} success={success} />
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      <div role={success ? "status" : "alert"}>{children}</div>
      {automatic ? (
        <p className="result-redirect" role="status">
          Đang chuyển trang…
        </p>
      ) : (
        <div className="inline-actions">{action}</div>
      )}
    </section>
  );
}
export default function OperationResultPage() {
  const { state, key } = useLocation();
  const navigate = useNavigate();
  const result = state as {
    success?: boolean;
    title?: string;
    message?: string;
    to?: string;
    label?: string;
  } | null;
  const to = result?.to && /^\/(?!\/)/.test(result.to) && !/[\\\s]/.test(result.to) ? result.to : "/app";
  return (
    <OperationResult
      key={key}
      onComplete={result ? () => navigate(to, { replace: true }) : undefined}
      success={result?.success === true}
      title={result?.title || "Chưa có kết quả thao tác"}
      action={
        <Link className="button" to={to}>
          {result?.label || "Về tài khoản"}
        </Link>
      }
    >
      <p>{result?.message || "Hãy quay lại trang thao tác để kiểm tra trạng thái hiện tại."}</p>
    </OperationResult>
  );
}
