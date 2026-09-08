import { useEffect } from "react";
import { Link } from "react-router-dom";
const labels: Record<string, string> = {
  DRAFT: "Bản nháp",
  IN_REVIEW: "Đang chờ duyệt",
  PUBLISHED: "Đã xuất bản",
  ARCHIVED: "Đã lưu trữ",
  CLOSED: "Đã đóng",
  READY: "Sẵn sàng",
  INCOMPLETE: "Chưa đủ nội dung",
  ACTIVE: "Đang hoạt động",
  PENDING: "Đang chờ",
  SCHEDULED: "Đã lên lịch",
  COMPLETED: "Đã hoàn thành",
  CANCELLED: "Đã hủy",
  NOT_RECORDED: "Chưa ghi nhận",
  PRESENT: "Có mặt",
  ABSENT: "Vắng",
  EXCUSED: "Vắng có phép",
  SELF_PACED: "Tự học",
  LIVE_COHORT: "Lớp học theo lịch",
  PRIVATE: "Lớp riêng",
  INSTITUTIONAL: "Lớp tổ chức",
};
export const stateLabel = (state: string) => labels[state] || state;
export function StateChip({ state }: { state: string }) {
  return (
    <span className={`product-status state-${state.toLowerCase()}`}>
      <span aria-hidden="true">●</span>
      {stateLabel(state)}
    </span>
  );
}
export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="product-breadcrumbs" aria-label="Đường dẫn">
      <ol>
        {items.map((x, i) => (
          <li key={`${x.label}-${i}`}>
            {x.to ? (
              <Link to={x.to}>{x.label}</Link>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined}>{x.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="product-empty">
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </section>
  );
}
export function ScheduleTime({ start, end, timezone }: { start: string; end: string; timezone: string }) {
  const fmt = (v: string) =>
    new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(
      new Date(v),
    );
  return (
    <>
      <time dateTime={start}>{fmt(start)}</time> – <time dateTime={end}>{fmt(end)}</time>
      <small>Múi giờ {timezone}; giờ hiển thị theo múi giờ của lớp.</small>
    </>
  );
}
export function useUnsavedChanges(dirty: boolean, message: string) {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    const guard = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0) return;
      const link = (event.target as Element | null)?.closest("a[href]");
      if (link && !window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", guard, true);
    return () => document.removeEventListener("click", guard, true);
  }, [dirty, message]);
}
