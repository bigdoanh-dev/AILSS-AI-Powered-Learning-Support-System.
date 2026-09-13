import { Fragment } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ScheduleCalendar, useCalendar } from "../components/ScheduleCalendar";
import { useStudent, monthNow, dateLabel, type ClassItem, type SessionItem, type Attendance } from "./api";
import { Heading, State, Empty } from "./ui";
export const attendanceLabel: Record<string, string> = {
  PRESENT: "Có mặt",
  EXCUSED: "Vắng có phép",
  ABSENT: "Vắng không phép",
  NOT_RECORDED: "Chưa ghi nhận",
};
export function StudentSchedule() {
  const calendar = useCalendar();
  const first = useStudent<SessionItem[]>("/me/schedule?" + calendar.queries[0]);
  const second = useStudent<SessionItem[]>(
    calendar.queries[1] ? "/me/schedule?" + calendar.queries[1] : null,
  );
  const q = {
    pending: first.pending || second.pending,
    error: first.error || second.error,
    retry: () => {
      first.retry();
      second.retry();
    },
    data: [
      ...new Map(
        [...(first.data || []), ...(calendar.queries[1] ? second.data || [] : [])].map((x) => [
          x.sessionId,
          x,
        ]),
      ).values(),
    ],
  };
  return (
    <>
      <Heading title="Lịch học">Theo dõi các buổi học theo danh sách, tuần hoặc tháng.</Heading>
      <div className="module-segmented-bar" role="navigation" aria-label="Phân hệ lịch trình & điểm danh">
        <Link to="/app/schedule" className="segmented-tab active">
          <span>📅 Lịch học theo tuần / tháng</span>
        </Link>
        <Link to="/app/attendance" className="segmented-tab">
          <span>📋 Bảng tổng hợp điểm danh</span>
        </Link>
      </div>
      <State query={q}>
        <ScheduleCalendar
          calendar={calendar}
          items={(q.data || []).map((x) => ({ ...x, href: "/app/classes/" + x.classId }))}
        />
      </State>
    </>
  );
}
export function StudentAttendance() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("month") || "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : monthNow();
  const q = useStudent<Attendance[]>("/me/attendance?month=" + month),
    classes = useStudent<ClassItem[]>("/me/classes");
  const rows = q.data || [];
  const groups = [...new Set(rows.map((x) => x.classId))];
  const count = (items: Attendance[], status: string) =>
    items.filter((x) => x.attendanceStatus === status).length;
  return (
    <>
      <Heading title="Thông tin điểm danh">
        Tổng hợp theo lớp, mở từng dòng để xem các buổi đã được ghi nhận.
      </Heading>
      <div className="module-segmented-bar" role="navigation" aria-label="Phân hệ lịch trình & điểm danh">
        <Link to="/app/schedule" className="segmented-tab">
          <span>📅 Lịch học theo tuần / tháng</span>
        </Link>
        <Link to="/app/attendance" className="segmented-tab active">
          <span>📋 Bảng tổng hợp điểm danh</span>
        </Link>
      </div>
      <div className="attendance-summary-bar">
        <div className="attendance-summary-pill">
          <span>Tổng số lượt ghi nhận: <strong>{rows.length}</strong></span>
        </div>
        <div className="attendance-summary-pill present">
          <span className="dot" aria-hidden="true" />
          <span>Có mặt: <strong>{count(rows, "PRESENT")}</strong></span>
        </div>
        <div className="attendance-summary-pill absent">
          <span className="dot" aria-hidden="true" />
          <span>Vắng không phép: <strong>{count(rows, "ABSENT")}</strong></span>
        </div>
        <div className="attendance-summary-pill excused">
          <span className="dot" aria-hidden="true" />
          <span>Vắng có phép: <strong>{count(rows, "EXCUSED")}</strong></span>
        </div>
      </div>
      <div className="calendar-toolbar">
        <label>
          Tháng điểm danh (UTC)
          <input
            type="month"
            value={month}
            required
            onChange={(e) => {
              if (e.target.value) setParams({ month: e.target.value });
            }}
          />
        </label>
      </div>
      <p className="muted">
        Đơn vị: buổi học. Chỉ tổng hợp bản ghi điểm danh đã có; chưa có bản ghi không có nghĩa là vắng học.
      </p>
      <State query={q}>
        {rows.length ? (
          <div className="attendance-scroll" tabIndex={0} aria-label="Bảng tổng hợp điểm danh">
            <table className="attendance-table">
              <caption>
                Điểm danh tháng {month.slice(5)}/{month.slice(0, 4)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">STT</th>
                  <th scope="col">Lớp học / mã lớp</th>
                  <th scope="col">Có mặt</th>
                  <th scope="col">Vắng có phép</th>
                  <th scope="col">Vắng không phép</th>
                  <th scope="col">Chưa ghi nhận</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((id, i) => {
                  const items = rows.filter((x) => x.classId === id);
                  const name = classes.data?.find((x) => x.classId === id)?.name || "Lớp học";
                  return (
                    <Fragment key={id}>
                      <tr>
                        <td>{i + 1}</td>
                        <th scope="row">
                          <Link to={"/app/classes/" + id}>{name}</Link>
                          <small className="attendance-id">{id}</small>
                        </th>
                        {["PRESENT", "EXCUSED", "ABSENT", "NOT_RECORDED"].map((s) => (
                          <td
                            key={s}
                            className={s === "ABSENT" && count(items, s) > 0 ? "attendance-alert" : ""}
                          >
                            {count(items, s)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td colSpan={6}>
                          <details>
                            <summary>
                              Chi tiết {items.length} buổi · {name}
                            </summary>
                            <ul className="attendance-details">
                              {[...items]
                                .sort((a, b) => b.startAt.localeCompare(a.startAt))
                                .map((x) => (
                                  <li key={x.sessionId}>
                                    <span>
                                      <strong>{x.title}</strong>
                                      <small>{dateLabel(x.startAt, "Asia/Ho_Chi_Minh")}</small>
                                    </span>
                                    <span
                                      className={`attendance-chip status-${x.attendanceStatus.toLowerCase()}`}
                                    >
                                      {attendanceLabel[x.attendanceStatus] || "Chưa ghi nhận"}
                                    </span>
                                  </li>
                                ))}
                            </ul>
                          </details>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={2} scope="row">
                    Tổng trong tháng
                  </th>
                  {["PRESENT", "EXCUSED", "ABSENT", "NOT_RECORDED"].map((s) => (
                    <td key={s}>{count(rows, s)}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <Empty>Chưa có dữ liệu điểm danh trong tháng này.</Empty>
        )}
      </State>
    </>
  );
}
