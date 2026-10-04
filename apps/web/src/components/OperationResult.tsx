import { useUiText } from "../lib/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  autoRedirect = false,
  redirectDelayMs = 2200,
}: {
  success: boolean;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  onComplete?: () => void;
  autoRedirect?: boolean;
  redirectDelayMs?: number;
}) {
  const uiText = useUiText();
  const heading = useRef<HTMLHeadingElement>(null);
  const hasAutoComplete = Boolean(onComplete);
  const completion = useRef(onComplete);
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(1, Math.ceil(redirectDelayMs / 1000)));

  useEffect(() => {
    heading.current?.focus();
  }, [title]);

  useEffect(() => {
    completion.current = onComplete;
  }, [onComplete]);

  // When autoRedirect is requested, or when failure has an onComplete callback:
  const shouldAutoNavigate = hasAutoComplete && (autoRedirect || !success);

  useEffect(() => {
    if (!shouldAutoNavigate) return;

    const interval = window.setInterval(() => {
      setSecondsLeft((s) => (s > 1 ? s - 1 : 1));
    }, 1000);

    const timer = window.setTimeout(() => {
      completion.current?.();
    }, redirectDelayMs);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timer);
    };
  }, [shouldAutoNavigate, redirectDelayMs, title]);

  return (
    <section className={`study-card operation-result ${success ? "is-success" : "is-failure"}`}>
      <ResultAnimation key={`${success}-${title}`} success={success} />
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      <div role={success ? "status" : "alert"}>{children}</div>

      {shouldAutoNavigate && (
        <div className="operation-result-progress-wrap">
          <div className="operation-result-progress-track">
            <div
              className="operation-result-progress-fill"
              style={{ animationDuration: `${redirectDelayMs}ms` }}
            />
          </div>
          <p className="operation-result-countdown">
            {success
              ? uiText("Tự động chuyển tiếp sau {0}s…", [secondsLeft])
              : uiText("Tự chuyển trang sau {0} giây.", [secondsLeft])}
          </p>
        </div>
      )}

      <div className="inline-actions">
        {action ||
          (onComplete && (
            <button className="button" onClick={onComplete}>
              {uiText("Tiếp tục")}
            </button>
          ))}
      </div>
    </section>
  );
}

export default function OperationResultPage() {
  const uiText = useUiText();
  const { state, key } = useLocation();
  const navigate = useNavigate();
  const result = state as {
    success?: boolean;
    title?: string;
    message?: string;
    to?: string;
    label?: string;
    autoRedirect?: boolean;
    redirectDelayMs?: number;
  } | null;

  const to = result?.to && /^\/(?!\/)/.test(result.to) && !/[\\\s]/.test(result.to) ? result.to : "/app";
  const isSuccess = result?.success === true;
  const delayMs = result?.redirectDelayMs ?? (isSuccess ? 2200 : 4500);

  return (
    <OperationResult
      key={key}
      autoRedirect={true}
      redirectDelayMs={delayMs}
      onComplete={result ? () => navigate(to, { replace: true }) : undefined}
      success={isSuccess}
      title={uiText(result?.title || (isSuccess ? "Thao tác thành công" : "Chưa có kết quả thao tác"))}
      action={
        <Link className="button" to={to}>
          {uiText(result?.label || (isSuccess ? "Tiếp tục" : "Quay lại"))}
        </Link>
      }
    >
      <p>{uiText(result?.message || "Hãy quay lại trang thao tác để kiểm tra trạng thái hiện tại.")}</p>
    </OperationResult>
  );
}
