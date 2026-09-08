import { useState } from "react";
import { useSession } from "../auth/session";
import { useStudent, useCommand, dateLabel, type CommentItem, type ReviewItem } from "./api";
import { State, Empty, Status, NextPage } from "./ui";
export default function Discussion({
  type,
  id,
  canWrite,
  canReview = false,
}: {
  type: "COURSE" | "CLASS";
  id: string;
  canWrite: boolean;
  canReview?: boolean;
}) {
  return (
    <>
      <Thread type={type} id={id} canWrite={canWrite} />
      {type === "COURSE" && <Reviews id={id} eligible={canReview} />}
    </>
  );
}
function Thread({ type, id, canWrite }: { type: string; id: string; canWrite: boolean }) {
  const [cursor, setCursor] = useState(""),
    [reply, setReply] = useState<CommentItem | null>(null),
    [edit, setEdit] = useState<CommentItem | null>(null),
    [body, setBody] = useState("");
  const root = `/resources/${type}/${id}/comments`;
  const query = useStudent<CommentItem[]>(
    root + "?" + new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) }),
  );
  const command = useCommand(),
    { profile } = useSession();
  const reset = () => {
    setCursor("");
    query.retry();
  };
  return (
    <section className="study-card">
      <h2>Thảo luận</h2>
      <State query={query}>
        {query.data?.length ? (
          <div className="study-thread">
            {query.data.map((c) => (
              <article key={c.commentId} className={c.parentId ? "study-reply" : ""}>
                <p className="muted">
                  {c.authorId === profile?.userId ? "Bạn" : "Thành viên"} · {dateLabel(c.createdAt)}
                  {c.parentId ? " · Trả lời bình luận" : ""}
                  {c.version > 1 && c.state === "ACTIVE" ? ` · Đã sửa (v${c.version})` : ""}
                </p>
                <p className="study-text">{c.state === "ACTIVE" ? c.body : "Bình luận đã được gỡ."}</p>
                {c.state === "ACTIVE" && canWrite && (
                  <div className="inline-actions">
                    {!c.parentId && (
                      <button
                        className="plain-button"
                        onClick={() => {
                          setReply(c);
                          setEdit(null);
                          setBody("");
                        }}
                      >
                        Trả lời
                      </button>
                    )}
                    {c.authorId === profile?.userId && (
                      <>
                        <button
                          className="plain-button"
                          onClick={() => {
                            setEdit(c);
                            setReply(null);
                            setBody(c.body || "");
                          }}
                        >
                          Sửa bình luận
                        </button>
                        <button
                          className="plain-button"
                          disabled={command.busy}
                          onClick={async () => {
                            if (
                              (await command.run(
                                "/comments/" + c.commentId,
                                "DELETE",
                                {},
                                { "If-Match": `"v${c.version}"` },
                              )) !== undefined
                            )
                              reset();
                          }}
                        >
                          Gỡ bình luận
                        </button>
                      </>
                    )}
                    {c.authorId !== profile?.userId && <ReportAction type="COMMENT" id={c.commentId} />}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty>Chưa có bình luận. Chia sẻ câu hỏi đầu tiên của bạn.</Empty>
        )}
      </State>
      <NextPage cursor={query.meta?.page?.nextCursor} onNext={setCursor} onReset={reset} />
      {canWrite ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await command.run(
              edit ? "/comments/" + edit.commentId : root,
              edit ? "PATCH" : "POST",
              edit ? { body } : { body, ...(reply ? { parentId: reply.commentId } : {}) },
              edit ? { "If-Match": `"v${edit.version}"` } : undefined,
            );
            if (result !== undefined) {
              setBody("");
              setReply(null);
              setEdit(null);
              reset();
            }
          }}
        >
          {reply && <blockquote>Trả lời: {reply.body}</blockquote>}
          <label>
            {edit ? "Sửa nội dung bình luận" : "Viết bình luận"}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              required
              rows={3}
            />
          </label>
          <div className="inline-actions">
            <button className="button" disabled={command.busy || !body.trim()}>
              {edit ? "Lưu bình luận" : reply ? "Gửi trả lời" : "Gửi bình luận"}
            </button>
            {(edit || reply) && (
              <button
                className="plain-button"
                type="button"
                onClick={() => {
                  setReply(null);
                  setEdit(null);
                  setBody("");
                }}
              >
                Hủy
              </button>
            )}
          </div>
        </form>
      ) : (
        <p>Bạn cần quyền học khóa học để gửi bình luận.</p>
      )}
      <Status command={command} />
    </section>
  );
}
function Reviews({ id, eligible }: { id: string; eligible: boolean }) {
  const [cursor, setCursor] = useState(""),
    [edit, setEdit] = useState<ReviewItem | null>(null),
    [body, setBody] = useState(""),
    [rating, setRating] = useState(5);
  const root = "/courses/" + id + "/reviews",
    query = useStudent<ReviewItem[]>(
      root + "?" + new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) }),
    ),
    command = useCommand(),
    { profile } = useSession();
  const reset = () => {
    setCursor("");
    query.retry();
  };
  return (
    <section className="study-card">
      <h2>Đánh giá khóa học</h2>
      <State query={query}>
        {query.data?.length ? (
          query.data.map((r) => (
            <article className="study-review" key={r.reviewId}>
              <p>
                {r.authorId === profile?.userId ? "Bạn" : "Học viên"} · {r.rating}/5
              </p>
              <p className="study-text">{r.state === "ACTIVE" ? r.body : "Đánh giá đã được gỡ."}</p>
              {r.state === "ACTIVE" && r.authorId === profile?.userId && (
                <div className="inline-actions">
                  <button
                    className="plain-button"
                    onClick={() => {
                      setEdit(r);
                      setBody(r.body || "");
                      setRating(r.rating);
                    }}
                  >
                    Sửa đánh giá
                  </button>
                  <button
                    className="plain-button"
                    disabled={command.busy}
                    onClick={async () => {
                      if (
                        (await command.run(
                          "/reviews/" + r.reviewId,
                          "DELETE",
                          {},
                          { "If-Match": `"v${r.version}"` },
                        )) !== undefined
                      )
                        reset();
                    }}
                  >
                    Gỡ đánh giá
                  </button>
                </div>
              )}
              {r.state === "ACTIVE" && r.authorId !== profile?.userId && (
                <ReportAction type="REVIEW" id={r.reviewId} />
              )}
            </article>
          ))
        ) : (
          <Empty>Chưa có đánh giá cho khóa học này.</Empty>
        )}
      </State>
      <NextPage cursor={query.meta?.page?.nextCursor} onNext={setCursor} onReset={reset} />
      {eligible || edit ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              (await command.run(
                edit ? "/reviews/" + edit.reviewId : root,
                edit ? "PATCH" : "POST",
                { rating, body },
                edit ? { "If-Match": `"v${edit.version}"` } : undefined,
              )) !== undefined
            ) {
              setBody("");
              setEdit(null);
              reset();
            }
          }}
        >
          <label>
            Mức đánh giá
            <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} / 5
                </option>
              ))}
            </select>
          </label>
          <label>
            Nội dung đánh giá
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              required
              rows={3}
            />
          </label>
          <button className="button" disabled={command.busy || !body.trim()}>
            {edit ? "Lưu đánh giá" : "Gửi đánh giá"}
          </button>
          {edit && (
            <button
              type="button"
              className="plain-button"
              onClick={() => {
                setEdit(null);
                setBody("");
              }}
            >
              Hủy sửa
            </button>
          )}
        </form>
      ) : (
        <p>Học ít nhất 20% khóa học để chia sẻ đánh giá. Quyền truy cập cần còn hiệu lực.</p>
      )}
      <Status command={command} />
    </section>
  );
}
function ReportAction({ type, id }: { type: "COMMENT" | "REVIEW"; id: string }) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState("");
  const command = useCommand();
  if (!open)
    return (
      <button className="plain-button" onClick={() => setOpen(true)}>
        Báo cáo nội dung
      </button>
    );
  return (
    <div className="report-composer">
      <label>
        Lý do báo cáo
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={2}
          required
        />
      </label>
      <div className="inline-actions">
        <button
          className="button secondary"
          disabled={command.busy || !reason.trim()}
          onClick={async () => {
            if (
              (await command.run("/reports", "POST", { targetType: type, targetId: id, reason })) !==
              undefined
            ) {
              setReason("");
              setOpen(false);
            }
          }}
        >
          Gửi báo cáo
        </button>
        <button className="plain-button" onClick={() => setOpen(false)}>
          Hủy
        </button>
      </div>
      <Status command={command} />
    </div>
  );
}
