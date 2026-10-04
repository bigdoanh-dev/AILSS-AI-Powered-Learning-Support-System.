import { useLanguage, useUiText } from "../lib/i18n";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useStudent, useCommand, monthNow, dateLabel, isUuid, type Notices } from "./api";
import { Heading, State, Empty, Status, NextPage } from "./ui";
export default function Notifications() {
  const uiText = useUiText();
  const [month, setMonth] = useState(monthNow());
  return (
    <>
      <Heading title={uiText("Thông báo")}>
        {uiText("Theo dõi những cập nhật liên quan đến việc học.")}
      </Heading>
      <label>
        {uiText("Tháng thông báo (UTC)")}
        <input
          type="month"
          value={month}
          required
          onChange={(e) => {
            if (e.target.value) setMonth(e.target.value);
          }}
        />
      </label>
      <NoticeList key={month} month={month} />
    </>
  );
}
function NoticeList({ month }: { month: string }) {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const [cursor, setCursor] = useState(""),
    query = useStudent<Notices>(
      "/notifications?" + new URLSearchParams({ month, limit: "20", ...(cursor ? { cursor } : {}) }),
    ),
    command = useCommand();
  return (
    <section className="study-card">
      <State query={query}>
        {query.data?.items.length ? (
          query.data.items.map((n) => (
            <article className={"study-notice " + (!n.readAt ? "unread" : "")} key={n.notificationId}>
              <span className="badge">{n.readAt ? uiText("Đã đọc") : uiText("Chưa đọc")}</span>
              <h2>{n.title}</h2>
              <p className="study-text">{n.body}</p>
              <p className="muted">{dateLabel(n.createdAt, undefined, uiLocale)} · Asia/Ho_Chi_Minh</p>
              <div className="inline-actions">
                {!n.readAt && (
                  <button
                    className="button secondary"
                    disabled={command.busy}
                    onClick={async () => {
                      if (
                        await command.run(
                          "/notifications/" + n.notificationId + "/read",
                          "PATCH",
                          {},
                          { "x-notification-locator": n.locator },
                        )
                      )
                        query.retry();
                    }}
                  >
                    {uiText("Đánh dấu đã đọc")}
                  </button>
                )}
                {n.source.type === "CLASS_ANNOUNCEMENT" && isUuid(n.source.contextId) && (
                  <Link to={"/app/classes/" + n.source.contextId}>{uiText("Xem lớp học →")}</Link>
                )}
              </div>
            </article>
          ))
        ) : (
          <Empty>{uiText("Không có thông báo trong tháng này. Bạn có thể chọn tháng khác.")}</Empty>
        )}
      </State>
      <Status command={command} />
      <NextPage
        cursor={query.data?.page.nextCursor}
        onNext={setCursor}
        onReset={() => {
          setCursor("");
          query.retry();
        }}
      />
    </section>
  );
}
