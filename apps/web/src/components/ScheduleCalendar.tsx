import { useUiText, useLanguage } from "../lib/i18n";
import { Link, useSearchParams } from "react-router-dom";
export type CalendarSession = {
  sessionId: string;
  title: string;
  startAt: string;
  endAt: string;
  status?: string;
  className?: string;
  href: string;
};
export const localDay = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
export const addDays = (day: string, count: number) =>
  new Date(Date.parse(day + "T00:00:00Z") + count * 86400000).toISOString().slice(0, 10);
export function calendarWindow(day: string, view: string) {
  if (view === "day") {
    const start = day;
    const end = day;
    const from = addDays(start, -1);
    const to = addDays(end, 1);
    return { start, end, queries: [new URLSearchParams({ from, to }).toString()] };
  }
  const first = view === "week" ? day : day.slice(0, 7) + "-01";
  const weekday = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7;
  const start = view === "list" ? first : addDays(first, -weekday);
  const nextMonth = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1))
    .toISOString()
    .slice(0, 10);
  const end = view === "list" ? addDays(nextMonth, -1) : addDays(start, view === "week" ? 6 : 41);
  const from = addDays(start, -1);
  const firstEnd = addDays(from, 30) < end ? addDays(from, 30) : end;
  const queries = [new URLSearchParams({ from, to: firstEnd }).toString()];
  if (firstEnd < end) queries.push(new URLSearchParams({ from: addDays(firstEnd, 1), to: end }).toString());
  return { start, end, queries };
}
export function useCalendar() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("date") || "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : localDay();
  const view = ["day", "week", "month", "list"].includes(params.get("view") || "")
    ? params.get("view")!
    : "week";
  const update = (values: Record<string, string>) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [k, v] of Object.entries(values)) next.set(k, v);
      return next;
    });
  return { day, view, ...calendarWindow(day, view), update };
}
const time = (value: string, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
export function ScheduleCalendar({
  items,
  calendar,
}: {
  items: CalendarSession[];
  calendar: ReturnType<typeof useCalendar>;
}) {
  const uiText = useUiText();
  const { locale } = useLanguage();
  const { day, view, start, end, update } = calendar;
  const sorted = [...items]
    .filter((x) => {
      const d = localDay(new Date(x.startAt));
      return d >= start && d <= end;
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const move = (delta: number) =>
    update({
      date:
        view === "day"
          ? addDays(day, delta)
          : view === "week"
            ? addDays(day, delta * 7)
            : new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1 + delta, 1))
                .toISOString()
                .slice(0, 10),
    });
  const event = (x: CalendarSession) => (
    <Link
      className={`calendar-event ${x.status === "CANCELLED" ? "is-cancelled" : ""}`}
      to={x.href}
      key={x.sessionId}
    >
      <strong>
        {time(x.startAt, locale)}–{time(x.endAt, locale)}
      </strong>
      <span>{x.title}</span>
      {x.className && <small>{x.className}</small>}
      {x.status === "CANCELLED" && <small>{uiText("Đã hủy")}</small>}
    </Link>
  );
  return (
    <section className="schedule-panel">
      <div className="calendar-toolbar">
        <div className="inline-actions">
          <button
            className="button secondary small"
            aria-label={uiText("Khoảng trước")}
            onClick={() => move(-1)}
          >
            ←
          </button>
          <button className="button secondary small" onClick={() => update({ date: localDay() })}>
            {uiText("Hôm nay")}
          </button>
          <button
            className="button secondary small"
            aria-label={uiText("Khoảng sau")}
            onClick={() => move(1)}
          >
            →
          </button>
        </div>
        <label>
          {uiText("Ngày xem")}
          <input
            type="date"
            value={day}
            required
            onChange={(e) => {
              if (e.target.value) update({ date: e.target.value });
            }}
          />
        </label>
        <div className="calendar-views" role="group" aria-label={uiText("Chế độ xem lịch")}>
          {[
            ["day", "Ngày"],
            ["week", "Tuần"],
            ["month", "Tháng"],
            ["list", "Danh sách"],
          ].map(([v, label]) => (
            <button key={v} aria-pressed={view === v} onClick={() => update({ view: v })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        {view === "day"
          ? uiText("Ngày {0}/{1}/{2}", [day.slice(8, 10), day.slice(5, 7), day.slice(0, 4)])
          : view === "week"
            ? `${start} – ${end}`
            : uiText("Tháng {0}/{1}", [day.slice(5, 7), day.slice(0, 4)])}{" "}
        {uiText("· Giờ Việt Nam (UTC+7)")}
      </p>
      {!sorted.length && view !== "day" && (
        <p role="status">{uiText("Chưa có buổi học trong khoảng thời gian này.")}</p>
      )}
      {view === "day" ? (
        <div className="calendar-day-agenda">
          <div className="calendar-day-header">
            <h3>
              {uiText("Lịch học ngày ")}
              {day.slice(8, 10)}/{day.slice(5, 7)}/{day.slice(0, 4)}
            </h3>
            <span className="badge">
              {sorted.length} {uiText(" buổi học")}
            </span>
          </div>
          {!sorted.length ? (
            <div
              className="empty-day-box"
              style={{ padding: "32px 16px", textAlign: "center", color: "var(--muted)" }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>
                {uiText("Không có buổi học nào được xếp lịch vào ngày này.")}
              </p>
              <small>{uiText("Bạn có thể chọn ngày khác hoặc chuyển sang xem theo Tuần/Tháng.")}</small>
            </div>
          ) : (
            <div
              className="day-agenda-list"
              style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}
            >
              {sorted.map((x) => (
                <article key={x.sessionId} className="home-activity-card">
                  <div className="home-activity-card-top">
                    <span className="badge" style={{ fontWeight: 700 }}>
                      ⏰ {time(x.startAt, locale)} – {time(x.endAt, locale)}
                    </span>
                    <span className={x.status === "CANCELLED" ? "red-badge-pill" : "green-badge-pill"}>
                      {x.status === "CANCELLED" ? uiText("● Đã hủy") : uiText("● Sắp diễn ra")}
                    </span>
                  </div>
                  <h4 className="home-activity-card-title">{x.title}</h4>
                  <div className="home-activity-card-meta">
                    <span>
                      {x.className ? uiText("Lớp: {0}", [x.className]) : uiText("Lớp học chính khóa")}
                    </span>
                    <Link to={x.href} className="button small" style={{ textDecoration: "none" }}>
                      {uiText("Vào chi tiết →")}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : view === "list" ? (
        <div className="calendar-list">
          {sorted.map((x) => (
            <article key={x.sessionId}>
              <time dateTime={x.startAt}>{localDay(new Date(x.startAt))}</time>
              {event(x)}
            </article>
          ))}
        </div>
      ) : (
        <div className="calendar-scroll" tabIndex={0} aria-label={uiText("Lịch theo ngày")}>
          <div className="calendar-grid">
            {["Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy", "Chủ nhật"].map((d) => (
              <div className="calendar-weekday" key={d}>
                {uiText(d)}
              </div>
            ))}
            {Array.from({ length: view === "week" ? 7 : 42 }, (_, i) => addDays(start, i)).map((d) => (
              <section
                className={`calendar-day ${d === localDay() ? "is-today" : ""} ${d.slice(0, 7) !== day.slice(0, 7) ? "outside-month" : ""}`}
                key={d}
                aria-label={d}
              >
                <time dateTime={d}>
                  {Number(d.slice(-2))}/{Number(d.slice(5, 7))}
                </time>
                {sorted.filter((x) => localDay(new Date(x.startAt)) === d).map(event)}
              </section>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
