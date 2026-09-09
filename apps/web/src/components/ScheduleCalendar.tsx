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
  const view = ["list", "week", "month"].includes(params.get("view") || "") ? params.get("view")! : "week";
  const update = (values: Record<string, string>) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [k, v] of Object.entries(values)) next.set(k, v);
      return next;
    });
  return { day, view, ...calendarWindow(day, view), update };
}
const time = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
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
        view === "week"
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
        {time(x.startAt)}–{time(x.endAt)}
      </strong>
      <span>{x.title}</span>
      {x.className && <small>{x.className}</small>}
      {x.status === "CANCELLED" && <small>Đã hủy</small>}
    </Link>
  );
  return (
    <section className="schedule-panel">
      <div className="calendar-toolbar">
        <div className="inline-actions">
          <button className="button secondary small" aria-label="Khoảng trước" onClick={() => move(-1)}>
            ←
          </button>
          <button className="button secondary small" onClick={() => update({ date: localDay() })}>
            Hôm nay
          </button>
          <button className="button secondary small" aria-label="Khoảng sau" onClick={() => move(1)}>
            →
          </button>
        </div>
        <label>
          Ngày xem
          <input
            type="date"
            value={day}
            required
            onChange={(e) => {
              if (e.target.value) update({ date: e.target.value });
            }}
          />
        </label>
        <div className="calendar-views" role="group" aria-label="Chế độ xem lịch">
          {[
            ["list", "Danh sách"],
            ["week", "Tuần"],
            ["month", "Tháng"],
          ].map(([v, label]) => (
            <button key={v} aria-pressed={view === v} onClick={() => update({ view: v })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        {view === "week" ? `${start} – ${end}` : `Tháng ${day.slice(5, 7)}/${day.slice(0, 4)}`} · Giờ Việt Nam
        (UTC+7)
      </p>
      {!sorted.length && <p role="status">Chưa có buổi học trong khoảng thời gian này.</p>}
      {view === "list" ? (
        <div className="calendar-list">
          {sorted.map((x) => (
            <article key={x.sessionId}>
              <time dateTime={x.startAt}>{localDay(new Date(x.startAt))}</time>
              {event(x)}
            </article>
          ))}
        </div>
      ) : (
        <div className="calendar-scroll" tabIndex={0} aria-label="Lịch theo ngày">
          <div className="calendar-grid">
            {["Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy", "Chủ nhật"].map((d) => (
              <div className="calendar-weekday" key={d}>
                {d}
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
