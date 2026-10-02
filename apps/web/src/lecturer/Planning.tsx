import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { lecturerRequest, useLecturer } from "./api";
import { State } from "./ui";
import { ScheduleCalendar, useCalendar, type CalendarSession } from "../components/ScheduleCalendar";
import { monthNow, rangeForMonth } from "../student/api";
import { Icon } from "../components/Icon";

type Class = { classId: string; name: string };
type Session = Omit<CalendarSession, "href"> & { classId?: string; className?: string; mode?: string; location?: string };

const classesOf = (v: Class[] | { classes: Class[] }) => (Array.isArray(v) ? v : v.classes || []);

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

  // Default to "ALL" so that all teaching sessions are visible by default,
  // matching the category behavior in Course Publishing Management
  const selected = params.get("class") || "ALL";
  const [search, setSearch] = useState("");
  const calendar = useCalendar();
  const raw = params.get("month") || "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : monthNow();

  const [sessionsData, setSessionsData] = useState<Session[]>([]);
  const [sessionsPending, setSessionsPending] = useState(false);
  const [sessionsError, setSessionsError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const update = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === "ALL" || !value) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });

  // Fetch sessions for all target classes (or single class if filtered)
  useEffect(() => {
    if (!classes.length) {
      setSessionsData([]);
      return;
    }
    const abort = new AbortController();
    setSessionsPending(true);
    setSessionsError(null);

    const targetClasses =
      selected === "ALL"
        ? classes
        : classes.filter((c) => c.classId === selected);

    const queriesToRun = attendance
      ? [new URLSearchParams(rangeForMonth(month)).toString()]
      : calendar.queries.filter(Boolean);

    const requests = targetClasses.flatMap((c) =>
      queriesToRun.map((qry) =>
        lecturerRequest<Session[] | { sessions: Session[] }>(
          `/classes/${c.classId}/sessions?${qry}`,
          "GET",
          undefined,
          {},
          abort.signal,
        ).then((res) => {
          const rawData = res.data;
          const items: Session[] = Array.isArray(rawData) ? rawData : (rawData as { sessions?: Session[] })?.sessions || [];
          return items.map((item) => ({
            ...item,
            classId: c.classId,
            className: c.name,
          }));
        }),
      ),
    );

    Promise.allSettled(requests)
      .then((results) => {
        if (abort.signal.aborted) return;
        const sessionMap = new Map<string, Session>();
        let successCount = 0;
        for (const res of results) {
          if (res.status === "fulfilled") {
            successCount++;
            for (const item of res.value) {
              sessionMap.set(item.sessionId, item);
            }
          }
        }
        setSessionsData([...sessionMap.values()]);
        setSessionsPending(false);
        if (results.length > 0 && successCount === 0) {
          setSessionsError(new Error("Không thể tải lịch dạy của các lớp"));
        }
      })
      .catch((err) => {
        if (!abort.signal.aborted) {
          setSessionsError(err);
          setSessionsPending(false);
        }
      });

    return () => abort.abort();
  }, [
    classes.map((c) => c.classId).join(","),
    selected,
    attendance,
    month,
    calendar.queries.join(";"),
    reloadKey,
  ]);

  // Client search filter
  const filteredSessions = useMemo(() => {
    if (!search.trim()) return sessionsData;
    const term = search.trim().toLowerCase();
    return sessionsData.filter(
      (s) =>
        s.title.toLowerCase().includes(term) ||
        (s.className && s.className.toLowerCase().includes(term)) ||
        (s.location && s.location.toLowerCase().includes(term)) ||
        (s.status && s.status.toLowerCase().includes(term)),
    );
  }, [sessionsData, search]);

  const sessionsState = {
    pending: sessionsPending || q.pending,
    error: sessionsError || q.error,
    retry: () => {
      q.retry();
      setReloadKey((k) => k + 1);
    },
    data: filteredSessions,
  };

  return (
    <>
      <div className="dashboard-heading" style={{ marginBottom: "1.25rem" }}>
        <div>
          <p className="eyebrow">{attendance ? "ĐIỂM DANH LỚP HỌC · GIẢNG DẠY" : "LỊCH GIẢNG DẠY · THỜI KHÓA BIỂU"}</p>
          <h1>{attendance ? "Điểm danh lớp học." : "Lịch dạy."}</h1>
          <p className="lead">
            {attendance
              ? "Chọn lớp và buổi học để theo dõi, cập nhật trạng thái có mặt của học viên."
              : "Xem tổng hợp lịch giảng dạy tất cả các lớp phụ trách theo danh sách, tuần hoặc tháng."}
          </p>
        </div>
      </div>

      <State q={q}>
        {() =>
          classes.length ? (
            <>
              {/* Filter, Search & Quick Actions Toolbar styled identically to Course Publishing Governance */}
              <div className="admin-governance-toolbar" style={{ marginBottom: "1.5rem" }}>
                <label className="admin-filter-label">
                  <span className="admin-filter-title">
                    <Icon name="layers" size={15} /> Lớp phụ trách
                  </span>
                  <div className="admin-select-wrapper" style={{ minWidth: "240px" }}>
                    <select
                      value={selected}
                      onChange={(e) => update("class", e.target.value)}
                      className="admin-governance-select"
                      aria-label="Chọn lớp hoặc tất cả lớp học"
                    >
                      <option value="ALL">Tất cả lớp phụ trách ({classes.length})</option>
                      {classes.map((c) => (
                        <option value={c.classId} key={c.classId}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>

                {attendance && (
                  <label className="admin-filter-label">
                    <span className="admin-filter-title">
                      <Icon name="calendar" size={15} /> Tháng (UTC)
                    </span>
                    <div className="admin-select-wrapper" style={{ minWidth: "150px" }}>
                      <input
                        type="month"
                        required
                        value={month}
                        onChange={(e) => {
                          if (e.target.value) update("month", e.target.value);
                        }}
                        className="admin-governance-select"
                        style={{ height: "auto" }}
                      />
                    </div>
                  </label>
                )}

                <div className="admin-search-wrapper">
                  <input
                    type="search"
                    placeholder="Tìm theo tên buổi học, lớp học..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="admin-search-input"
                    aria-label="Tìm kiếm buổi học"
                  />
                </div>

                <div className="admin-toolbar-actions">
                  <span className="kpi-tag accent">{filteredSessions.length} buổi học</span>
                  {selected !== "ALL" ? (
                    <Link
                      className="button button-subtle"
                      to={`/app/teaching/classes/${selected}/schedule`}
                      title="Quản lý chi tiết thời khóa biểu lớp này"
                    >
                      <Icon name="settings" size={14} />
                      <span>Quản lý buổi học</span>
                    </Link>
                  ) : (
                    <Link
                      className="button button-subtle"
                      to="/app/teaching/classes"
                      title="Mở danh sách tất cả lớp học"
                    >
                      <Icon name="class" size={14} />
                      <span>Quản lý các lớp</span>
                    </Link>
                  )}
                  <Link
                    className="button secondary"
                    to={`/app/teaching/${attendance ? "schedule" : "attendance"}${selected !== "ALL" ? `?class=${selected}` : ""}`}
                    title={attendance ? "Mở lịch dạy dạng tuần/tháng" : "Mở danh sách điểm danh theo lớp"}
                  >
                    <Icon name={attendance ? "calendar" : "check"} size={14} />
                    <span>{attendance ? "Xem lịch dạy" : "Xem điểm danh"}</span>
                  </Link>
                  <button
                    type="button"
                    className="button secondary admin-reload-btn"
                    onClick={() => setReloadKey((k) => k + 1)}
                    disabled={sessionsPending}
                    title="Tải lại lịch dạy"
                  >
                    <Icon name="refresh" size={14} />
                    <span>Tải lại</span>
                  </button>
                </div>
              </div>

              <State q={sessionsState}>
                {(v) =>
                  attendance ? (
                    <div className="attendance-scroll">
                      <table className="attendance-table">
                        <caption>Các buổi học tháng {month}</caption>
                        <thead>
                          <tr>
                            <th>STT</th>
                            {selected === "ALL" && <th>Lớp phụ trách</th>}
                            <th>Buổi học</th>
                            <th>Thời gian (giờ Việt Nam)</th>
                            <th>Điểm danh</th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.map((x, i) => (
                            <tr key={x.sessionId}>
                              <td>{i + 1}</td>
                              {selected === "ALL" && (
                                <td>
                                  <strong>{x.className || "Lớp phụ trách"}</strong>
                                </td>
                              )}
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
                                  className="button secondary button-small"
                                  to={`/app/teaching/sessions/${x.sessionId}/attendance?class=${x.classId || (selected !== "ALL" ? selected : "")}&month=${month}`}
                                >
                                  Xem bảng điểm danh
                                </Link>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!v.length && <p>Chưa có buổi học nào phù hợp trong tháng này.</p>}
                    </div>
                  ) : (
                    <ScheduleCalendar
                      calendar={calendar}
                      items={v.map((x) => ({
                        ...x,
                        className: x.className,
                        href: `/app/teaching/sessions/${x.sessionId}${x.classId ? `?class=${x.classId}` : ""}`,
                      }))}
                    />
                  )
                }
              </State>
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
