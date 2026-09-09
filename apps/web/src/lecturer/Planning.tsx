import { Link, useSearchParams } from "react-router-dom";
import { useLecturer } from "./api";
import { State } from "./ui";
import { ScheduleCalendar, useCalendar, type CalendarSession } from "../components/ScheduleCalendar";
import { monthNow, rangeForMonth } from "../student/api";
type Class = { classId: string; name: string };
type Session = Omit<CalendarSession, "href">;
const classesOf = (v: Class[] | { classes: Class[] }) => (Array.isArray(v) ? v : v.classes || []);
const sessionsOf = (v: Session[] | { sessions: Session[] }) => (Array.isArray(v) ? v : v.sessions || []);
export function TeachingSchedule() {
  return <TeachingPlanning attendance={false} />;
}
export function TeachingAttendance() {
  return <TeachingPlanning attendance />;
}
function TeachingPlanning({ attendance }: { attendance: boolean }) {
  const q = useLecturer<Class[] | { classes: Class[] }>("/me/owned-classes");
  const [params, setParams] = useSearchParams();
  const classes = q.data ? classesOf(q.data) : [];
  const selected = params.get("class") || classes[0]?.classId || "";
  const calendar = useCalendar();
  const raw = params.get("month") || "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : monthNow();
  const query = attendance ? new URLSearchParams(rangeForMonth(month)).toString() : calendar.queries[0];
  const first = useLecturer<Session[] | { sessions: Session[] }>(
    classes.some((c) => c.classId === selected) ? `/classes/${selected}/sessions?${query}` : null,
  );
  const second = useLecturer<Session[] | { sessions: Session[] }>(
    !attendance && classes.some((c) => c.classId === selected) && calendar.queries[1]
      ? `/classes/${selected}/sessions?${calendar.queries[1]}`
      : null,
  );
  const sessions = {
    pending: first.pending || second.pending,
    error: first.error || second.error,
    retry: () => {
      first.retry();
      second.retry();
    },
    data: first.data
      ? [
          ...new Map(
            [
              ...sessionsOf(first.data),
              ...(!attendance && calendar.queries[1] && second.data ? sessionsOf(second.data) : []),
            ].map((x) => [x.sessionId, x]),
          ).values(),
        ]
      : undefined,
  };
  const update = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      return next;
    });
  return (
    <>
      <h1>{attendance ? "Điểm danh lớp học" : "Lịch dạy"}</h1>
      <p>
        {attendance
          ? "Chọn lớp và buổi học để xem, cập nhật điểm danh học viên."
          : "Xem lịch giảng dạy theo danh sách, tuần hoặc tháng."}
      </p>
      <State q={q}>
        {() =>
          classes.length ? (
            <>
              <div className="calendar-toolbar">
                <label>
                  Lớp phụ trách
                  <select value={selected} onChange={(e) => update("class", e.target.value)}>
                    <option value="" disabled>
                      Chọn lớp
                    </option>
                    {classes.map((c) => (
                      <option value={c.classId} key={c.classId}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {attendance ? (
                  <label>
                    Tháng điểm danh (UTC)
                    <input
                      type="month"
                      required
                      value={month}
                      onChange={(e) => {
                        if (e.target.value) update("month", e.target.value);
                      }}
                    />
                  </label>
                ) : (
                  <Link className="button secondary" to={`/app/teaching/classes/${selected}/schedule`}>
                    Quản lý buổi học
                  </Link>
                )}
                <Link to={`/app/teaching/${attendance ? "schedule" : "attendance"}?class=${selected}`}>
                  {attendance ? "Xem lịch dạy" : "Xem điểm danh"}
                </Link>
              </div>
              {!classes.some((c) => c.classId === selected) ? (
                <p>Hãy chọn một lớp trong danh sách.</p>
              ) : (
                <State q={sessions}>
                  {(v) =>
                    attendance ? (
                      <div className="attendance-scroll">
                        <table className="attendance-table">
                          <caption>Các buổi học tháng {month}</caption>
                          <thead>
                            <tr>
                              <th>STT</th>
                              <th>Buổi học</th>
                              <th>Thời gian (giờ Việt Nam)</th>
                              <th>Điểm danh</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sessionsOf(v).map((x, i) => (
                              <tr key={x.sessionId}>
                                <td>{i + 1}</td>
                                <th scope="row">
                                  {x.title}
                                  {x.status === "CANCELLED" && <small> · Đã hủy</small>}
                                </th>
                                <td>
                                  {new Date(x.startAt).toLocaleString("vi-VN", {
                                    timeZone: "Asia/Ho_Chi_Minh",
                                  })}
                                </td>
                                <td>
                                  <Link
                                    to={`/app/teaching/sessions/${x.sessionId}/attendance?class=${selected}&month=${month}`}
                                  >
                                    Xem bảng điểm danh
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!sessionsOf(v).length && <p>Chưa có buổi học trong tháng này.</p>}
                      </div>
                    ) : (
                      <ScheduleCalendar
                        calendar={calendar}
                        items={sessionsOf(v).map((x) => ({
                          ...x,
                          href: `/app/teaching/sessions/${x.sessionId}`,
                        }))}
                      />
                    )
                  }
                </State>
              )}
            </>
          ) : (
            <p>
              Bạn chưa có lớp phụ trách. <Link to="/app/teaching/classes">Mở trang lớp học</Link>
            </p>
          )
        }
      </State>
    </>
  );
}
