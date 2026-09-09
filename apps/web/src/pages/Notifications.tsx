import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSession, sessionRequest } from "../auth/session";
import { errorMessage } from "../lib/api";
import { monthNow, dateLabel, isUuid, type Notices } from "../student/api";
export default function Notifications() {
  const { profile } = useSession();
  const [month, setMonth] = useState(monthNow()),
    [cursor, setCursor] = useState(""),
    [data, setData] = useState<Notices>(),
    [error, setError] = useState(""),
    [pending, setPending] = useState(true),
    [rev, setRev] = useState(0),
    [busy, setBusy] = useState("");
  useEffect(() => {
    let active = true;
    setPending(true);
    setError("");
    setData(undefined);
    sessionRequest<Notices>(
      "notifications?" + new URLSearchParams({ month, limit: "20", ...(cursor ? { cursor } : {}) }),
    )
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [month, cursor, rev, profile?.userId]);
  async function read(id: string, locator: string) {
    setBusy(id);
    setError("");
    try {
      await sessionRequest(`notifications/${id}/read`, "PATCH", { locator });
      setRev((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <h1>Thông báo</h1>
          <p>Cập nhật dành cho tài khoản của bạn.</p>
        </div>
        <button className="button secondary" onClick={() => setRev((v) => v + 1)} disabled={pending}>
          Làm mới
        </button>
      </div>
      <label>
        Tháng thông báo (UTC)
        <input
          type="month"
          required
          value={month}
          onChange={(e) => {
            if (e.target.value) {
              setMonth(e.target.value);
              setCursor("");
            }
          }}
        />
      </label>
      {error && (
        <div role="alert" className="study-state">
          {error}
          <button className="button secondary" onClick={() => setRev((v) => v + 1)}>
            Thử lại
          </button>
        </div>
      )}
      {pending ? (
        <p role="status">Đang tải thông báo…</p>
      ) : (
        <section className="notification-list">
          {data?.items.length
            ? data.items.map((n) => (
                <article
                  key={n.notificationId}
                  className={`study-card study-notice ${n.readAt ? "" : "unread"}`}
                >
                  <span className="badge">{n.readAt ? "Đã đọc" : "Chưa đọc"}</span>
                  <h2>{n.title}</h2>
                  <p>{n.body}</p>
                  <small>{dateLabel(n.createdAt)}</small>
                  <div className="inline-actions">
                    {!n.readAt && (
                      <button
                        className="button secondary"
                        disabled={!!busy}
                        onClick={() => void read(n.notificationId, n.locator)}
                      >
                        {busy === n.notificationId ? "Đang cập nhật…" : "Đánh dấu đã đọc"}
                      </button>
                    )}
                    {n.source.type === "CLASS_ANNOUNCEMENT" &&
                      isUuid(n.source.contextId) &&
                      profile?.role !== "ADMIN" && (
                        <Link
                          className="button secondary"
                          to={
                            (profile?.role === "LECTURER" ? "/app/teaching/classes/" : "/app/classes/") +
                            n.source.contextId
                          }
                        >
                          Xem lớp học
                        </Link>
                      )}
                  </div>
                </article>
              ))
            : !error && <p className="study-state">Chưa có thông báo trong tháng này.</p>}
        </section>
      )}
      <div className="inline-actions">
        {cursor && (
          <button className="button secondary" onClick={() => setCursor("")}>
            Về đầu danh sách
          </button>
        )}
        {data?.page?.nextCursor && (
          <button className="button" disabled={pending} onClick={() => setCursor(data.page.nextCursor!)}>
            Thông báo tiếp theo
          </button>
        )}
      </div>
    </>
  );
}
