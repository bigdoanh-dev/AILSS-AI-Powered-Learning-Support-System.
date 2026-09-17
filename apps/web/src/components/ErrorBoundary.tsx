import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught application error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          className="workspace-alert-box"
          style={{ margin: "3rem auto", maxWidth: "680px", padding: "1.5rem" }}
        >
          <span className="alert-icon" aria-hidden="true" style={{ fontSize: "1.75rem" }}>
            ⚠️
          </span>
          <div className="alert-body">
            <strong style={{ fontSize: "1.1rem", display: "block", marginBottom: "0.5rem" }}>
              Đã xảy ra sự cố khi hiển thị giao diện
            </strong>
            <p style={{ margin: "0 0 1rem 0", opacity: 0.85 }}>
              Một thành phần giao diện gặp lỗi bất ngờ. Bạn có thể thử tải lại trang hoặc quay về trang chủ.
            </p>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                className="button small"
                onClick={() => {
                  this.setState({ hasError: false });
                  window.location.reload();
                }}
              >
                ↺ Tải lại trang
              </button>
              <a href="/" className="button secondary small">
                Về trang chủ
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
