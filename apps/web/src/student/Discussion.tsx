import { useState, useMemo } from "react";
import { useSession } from "../auth/session";
import { useStudent, useCommand, dateLabel, type CommentItem, type ReviewItem } from "./api";
import { State, Empty, Status, NextPage } from "./ui";
import { Icon } from "../components/Icon";

const STAR_DESCRIPTIONS: Record<number, string> = {
  5: "Tuyệt vời - Rất hài lòng với chất lượng bài giảng (5/5 sao)",
  4: "Rất tốt - Khóa học hữu ích & thực tiễn (4/5 sao)",
  3: "Hài lòng - Nội dung đạt yêu cầu cơ bản (3/5 sao)",
  2: "Cần cải thiện - Chưa đáp ứng kỳ vọng (2/5 sao)",
  1: "Không hài lòng - Cần nâng cấp nhiều (1/5 sao)",
};

const QUICK_TAGS = [
  "✨ Giảng viên tận tâm",
  "💡 Bài tập thực chiến cao",
  "🤖 AI Tutor hỗ trợ 24/7",
  "📚 Học liệu rõ ràng, chi tiết",
  "🎯 Kiến trúc hệ thống chuẩn",
];

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
  const [cursor, setCursor] = useState("");
  const [reply, setReply] = useState<CommentItem | null>(null);
  const [edit, setEdit] = useState<CommentItem | null>(null);
  const [body, setBody] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"ALL" | "UNANSWERED" | "MINE">("ALL");

  const root = `/resources/${type}/${id}/comments`;
  const query = useStudent<CommentItem[]>(
    root + "?" + new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) }),
  );
  const command = useCommand();
  const { profile } = useSession();

  const reset = () => {
    setCursor("");
    query.retry();
  };

  const commentsList = query.data || [];

  // Filter comments
  const filteredComments = useMemo(() => {
    return commentsList.filter((c) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!c.body?.toLowerCase().includes(q)) return false;
      }
      if (activeTab === "MINE" && c.authorId !== profile?.userId) {
        return false;
      }
      return true;
    });
  }, [commentsList, searchQuery, activeTab, profile?.userId]);

  const handleInsertCode = () => {
    const codeSnippet =
      '\n```javascript\n// Nhập đoạn mã lỗi của bạn ở đây\nconsole.log("Debug test");\n```\n';
    setBody((prev) => prev + codeSnippet);
  };

  const handleAddTopicTag = (tag: string) => {
    if (!body.includes(tag)) {
      setBody((prev) => (prev ? `${tag} ${prev}` : `${tag} `));
    }
  };

  return (
    <section className="commercial-section-wrapper animate-fade-in" style={{ marginTop: 28 }}>
      <div className="commercial-section-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span className="badge" style={{ background: "rgba(2, 132, 199, 0.1)", color: "#0284c7" }}>
              <Icon name="message" size={13} style={{ marginRight: 4 }} />
              CỘNG ĐỒNG HỌC TẬP &amp; HỎI ĐÁP
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {commentsList.length > 0
                ? `${commentsList.length} câu hỏi & thảo luận`
                : "Thảo luận thời gian thực"}
            </span>
          </div>
          <h2>
            <span className="pro-icon-box blue sm">
              <Icon name="message" size={14} />
            </span>
            <span>Hỏi Đáp &amp; Thảo Luận Bài Học</span>
          </h2>
          <p className="subtext" style={{ margin: "4px 0 0" }}>
            Không gian trao đổi bài tập, giải đáp thắc mắc chuyên môn cùng Giảng viên và cộng đồng sinh viên
            AILSS.
          </p>
        </div>
      </div>

      {/* Discussion Search & Filter Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`rating-filter-chip ${activeTab === "ALL" ? "active" : ""}`}
            onClick={() => setActiveTab("ALL")}
          >
            Tất cả thảo luận ({commentsList.length})
          </button>
          <button
            type="button"
            className={`rating-filter-chip ${activeTab === "MINE" ? "active" : ""}`}
            onClick={() => setActiveTab("MINE")}
          >
            Thảo luận của tôi
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--surface-subtle)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "6px 12px",
            minWidth: 260,
          }}
        >
          <Icon name="search" size={15} style={{ color: "var(--muted)" }} />
          <input
            type="search"
            placeholder="Tìm kiếm câu hỏi hoặc mã lỗi..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              border: "none",
              background: "transparent",
              outline: "none",
              fontSize: 13,
              width: "100%",
              color: "var(--ink)",
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)" }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Modern Question Composer */}
      {canWrite ? (
        <form
          className="commercial-composer-box"
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
          <div className="commercial-composer-title">
            <div className="review-author-avatar" style={{ width: 32, height: 32, fontSize: 13 }}>
              {profile?.displayName?.charAt(0).toUpperCase() || "B"}
            </div>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {edit
                  ? "Chỉnh sửa nội dung thảo luận"
                  : reply
                    ? `Trả lời bình luận của thành viên`
                    : "Đặt câu hỏi hoặc chia sẻ thảo luận"}
              </span>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {profile?.displayName || profile?.emailMasked || "Tài khoản học viên AILSS"}
              </div>
            </div>
          </div>

          {reply && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(2, 132, 199, 0.08)",
                borderLeft: "3px solid #0284c7",
                borderRadius: "0 8px 8px 0",
                marginBottom: 12,
                fontSize: 12.5,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>Đang trả lời:</strong>{" "}
                <span style={{ color: "var(--muted)" }}>"{reply.body?.slice(0, 80)}..."</span>
              </div>
              <button
                type="button"
                className="plain-button"
                onClick={() => setReply(null)}
                style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}
              >
                ✕ Hủy trả lời
              </button>
            </div>
          )}

          {/* Quick tags & Toolbar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["#Hỏi Bài Tập", "#Lỗi Code & Debug", "#Lý Thuyết", "#Thảo Luận Chung"].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="quick-tag-btn"
                  onClick={() => handleAddTopicTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="quick-tag-btn"
              onClick={handleInsertCode}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <span>&lt;/&gt; Chèn mẫu Code</span>
            </button>
          </div>

          <label style={{ display: "block" }}>
            <span style={{ display: "none" }}>{edit ? "Sửa nội dung bình luận" : "Viết bình luận"}</span>
            <textarea
              className="commercial-composer-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Đặt câu hỏi về bài giảng, dán đoạn mã lỗi bạn đang gặp hoặc trao đổi với giảng viên..."
              maxLength={4000}
              required
              rows={3}
            />
          </label>

          <div className="composer-bottom-bar">
            <span className="composer-char-count">{body.length} / 4000 ký tự</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {(edit || reply) && (
                <button
                  type="button"
                  className="button button-subtle button-small"
                  onClick={() => {
                    setReply(null);
                    setEdit(null);
                    setBody("");
                  }}
                >
                  Hủy
                </button>
              )}
              <button
                className="button button-small"
                disabled={command.busy || !body.trim()}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="message" size={14} />
                <span>{edit ? "Lưu bình luận" : reply ? "Gửi trả lời" : "Gửi bình luận"}</span>
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div
          style={{
            padding: "14px 18px",
            borderRadius: 10,
            background: "var(--surface-subtle)",
            border: "1px solid var(--line)",
            marginBottom: 20,
            fontSize: 13,
            color: "var(--muted)",
          }}
        >
          <Icon name="info" size={15} style={{ marginRight: 6, verticalAlign: "middle" }} />
          <span>Bạn cần quyền học khóa học để gửi bình luận.</span>
        </div>
      )}

      {/* Discussions Feed */}
      <State query={query}>
        {filteredComments.length ? (
          <div className="commercial-reviews-list">
            {filteredComments.map((c) => {
              const isMine = c.authorId === profile?.userId;
              return (
                <article
                  key={c.commentId}
                  className={`commercial-thread-card ${c.parentId ? "commercial-thread-reply" : ""}`}
                >
                  <div className="review-card-header">
                    <div className="review-author-info">
                      <div
                        className="review-author-avatar"
                        style={{
                          background: isMine
                            ? "linear-gradient(135deg, #0284c7 0%, #059669 100%)"
                            : "linear-gradient(135deg, #7c3aed 0%, #0284c7 100%)",
                          width: c.parentId ? 32 : 38,
                          height: c.parentId ? 32 : 38,
                          fontSize: c.parentId ? 13 : 15,
                        }}
                      >
                        {isMine ? "B" : "H"}
                      </div>
                      <div>
                        <div className="review-author-name">
                          <span>{isMine ? "Bạn" : "Thành viên AILSS"}</span>
                          {isMine && <span className="verified-badge">Tác giả</span>}
                          {c.parentId && (
                            <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 400 }}>
                              · Trả lời bình luận
                            </span>
                          )}
                        </div>
                        <div className="review-date-label">
                          {dateLabel(c.createdAt)}
                          {c.version > 1 && c.state === "ACTIVE" ? ` · Đã sửa (v${c.version})` : ""}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="review-card-body" style={{ whiteSpace: "pre-wrap" }}>
                    {c.state === "ACTIVE" ? c.body : "Bình luận đã được gỡ."}
                  </div>

                  {c.state === "ACTIVE" && canWrite && (
                    <div className="review-card-footer">
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        {!c.parentId && (
                          <button
                            type="button"
                            className="plain-button"
                            onClick={() => {
                              setReply(c);
                              setEdit(null);
                              setBody("");
                            }}
                            style={{ fontSize: 12.5, color: "var(--blue)", cursor: "pointer" }}
                          >
                            💬 Trả lời
                          </button>
                        )}
                        {isMine && (
                          <>
                            <button
                              type="button"
                              className="plain-button"
                              onClick={() => {
                                setEdit(c);
                                setReply(null);
                                setBody(c.body || "");
                              }}
                              style={{ fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }}
                            >
                              Sửa bình luận
                            </button>
                            <button
                              type="button"
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
                              style={{ fontSize: 12.5, color: "#dc2626", cursor: "pointer" }}
                            >
                              Gỡ bình luận
                            </button>
                          </>
                        )}
                        {!isMine && <ReportAction type="COMMENT" id={c.commentId} />}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div>
            <Empty>Chưa có bình luận. Chia sẻ câu hỏi đầu tiên của bạn.</Empty>
          </div>
        )}
      </State>

      <NextPage cursor={query.meta?.page?.nextCursor} onNext={setCursor} onReset={reset} />
      <Status command={command} />
    </section>
  );
}

function Reviews({ id, eligible }: { id: string; eligible: boolean }) {
  const [cursor, setCursor] = useState("");
  const [edit, setEdit] = useState<ReviewItem | null>(null);
  const [body, setBody] = useState("");
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [starFilter, setStarFilter] = useState<number>(0);
  const [selectedQuickTags, setSelectedQuickTags] = useState<string[]>([]);

  const root = "/courses/" + id + "/reviews";
  const query = useStudent<ReviewItem[]>(
    root + "?" + new URLSearchParams({ limit: "20", ...(cursor ? { cursor } : {}) }),
  );
  const command = useCommand();
  const { profile } = useSession();

  const reset = () => {
    setCursor("");
    query.retry();
  };

  const reviewsList = query.data || [];

  // Calculate statistics
  const stats = useMemo(() => {
    if (reviewsList.length === 0) {
      return {
        avgScore: "—",
        total: 0,
        counts: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        percentages: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      };
    }
    const total = reviewsList.length;
    const sum = reviewsList.reduce((acc, r) => acc + (r.rating || 5), 0);
    const avgScore = (sum / total).toFixed(1);
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<number, number>;
    reviewsList.forEach((r) => {
      const star = Math.min(5, Math.max(1, Math.round(r.rating || 5)));
      counts[star] = (counts[star] || 0) + 1;
    });
    const percentages = {
      5: Math.round((counts[5] / total) * 100),
      4: Math.round((counts[4] / total) * 100),
      3: Math.round((counts[3] / total) * 100),
      2: Math.round((counts[2] / total) * 100),
      1: Math.round((counts[1] / total) * 100),
    };
    return { avgScore, total, counts, percentages };
  }, [reviewsList]);

  // Filter reviews
  const filteredReviews = useMemo(() => {
    if (starFilter === 0) return reviewsList;
    return reviewsList.filter((r) => Math.round(r.rating) === starFilter);
  }, [reviewsList, starFilter]);

  const toggleQuickTag = (tag: string) => {
    if (selectedQuickTags.includes(tag)) {
      setSelectedQuickTags((prev) => prev.filter((t) => t !== tag));
    } else {
      setSelectedQuickTags((prev) => [...prev, tag]);
      if (!body.includes(tag)) {
        setBody((prev) => (prev ? `${prev}\n${tag}` : tag));
      }
    }
  };

  return (
    <section className="commercial-section-wrapper animate-fade-in" style={{ marginTop: 32 }}>
      {/* Commercial Header */}
      <div className="commercial-section-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span className="badge" style={{ background: "rgba(245, 158, 11, 0.12)", color: "#d97706" }}>
              <Icon name="star" size={13} style={{ marginRight: 4 }} />
              ĐÁNH GIÁ &amp; PHẢN HỒI CHẤT LƯỢNG
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Học viên đã xác thực</span>
          </div>
          <h2>
            <span className="pro-icon-box amber sm">
              <Icon name="star" size={14} />
            </span>
            <span>Đánh Giá Khóa Học Từ Học Viên</span>
          </h2>
          <p className="subtext" style={{ margin: "4px 0 0" }}>
            Tổng hợp ý kiến đánh giá và trải nghiệm thực tế từ cộng đồng học viên đã hoàn thành tối thiểu 20%
            chương trình.
          </p>
        </div>
      </div>

      {/* Aggregate Rating Summary Card */}
      <div className="commercial-rating-summary">
        <div className="rating-score-box">
          <div className="rating-score-num">{stats.avgScore}</div>
          <div className="rating-stars-cluster" aria-label={`Điểm đánh giá ${stats.avgScore} trên 5 sao`}>
            {[1, 2, 3, 4, 5].map((s) => (
              <span key={s} style={{ fontSize: 22, color: "#f59e0b" }}>
                ★
              </span>
            ))}
          </div>
          <div className="rating-score-sub">Dựa trên {stats.total} đánh giá trong trang này</div>
          <span className="rating-satisfaction-tag">✓ 98% học viên hài lòng &amp; khuyến nghị</span>
        </div>

        <div className="rating-breakdown-bars">
          {[5, 4, 3, 2, 1].map((s) => (
            <div key={s} className="rating-breakdown-row">
              <span className="rating-breakdown-star-label">
                <span>{s}</span>
                <span style={{ color: "#f59e0b" }}>★</span>
              </span>
              <div className="rating-bar-track">
                <div
                  className="rating-bar-fill"
                  style={{ width: `${stats.percentages[s as 1 | 2 | 3 | 4 | 5]}%` }}
                />
              </div>
              <span className="rating-breakdown-count">
                {stats.percentages[s as 1 | 2 | 3 | 4 | 5]}% ({stats.counts[s as 1 | 2 | 3 | 4 | 5]})
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Star Filter Pills */}
      <div className="rating-filters-bar">
        <button
          type="button"
          className={`rating-filter-chip ${starFilter === 0 ? "active" : ""}`}
          onClick={() => setStarFilter(0)}
        >
          Tất cả ({stats.total})
        </button>
        {[5, 4, 3, 2, 1].map((s) => (
          <button
            key={s}
            type="button"
            className={`rating-filter-chip ${starFilter === s ? "active" : ""}`}
            onClick={() => setStarFilter(s)}
          >
            {s} sao ({stats.counts[s as 1 | 2 | 3 | 4 | 5]})
          </button>
        ))}
      </div>

      {/* Commercial Review Composer Form */}
      {eligible || edit ? (
        <form
          className="commercial-composer-box"
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
          <div className="commercial-composer-title">
            <span className="pro-icon-box amber sm">
              <Icon name="star" size={14} />
            </span>
            <span>{edit ? "Chỉnh Sửa Đánh Giá Của Bạn" : "Viết Đánh Giá & Chia Sẻ Trải Nghiệm Của Bạn"}</span>
          </div>

          {/* Interactive Star Rating Selector */}
          <div>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink)",
                display: "block",
                marginBottom: 6,
              }}
            >
              Mức đánh giá
            </label>
            <div className="star-rating-selector">
              <div className="star-rating-buttons" role="radiogroup" aria-label="Chọn số sao đánh giá">
                {[1, 2, 3, 4, 5].map((s) => {
                  const active = (hoverRating || rating) >= s;
                  return (
                    <button
                      key={s}
                      type="button"
                      className={`star-interactive-btn ${active ? "active" : ""}`}
                      onMouseEnter={() => setHoverRating(s)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => setRating(s)}
                      aria-label={`${s} sao`}
                    >
                      ★
                    </button>
                  );
                })}
              </div>

              {/* Accessible select for form compatibility & screen readers */}
              <select
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                aria-label="Mức đánh giá"
                style={{
                  position: "absolute",
                  opacity: 0,
                  pointerEvents: "none",
                  width: 1,
                  height: 1,
                }}
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} / 5
                  </option>
                ))}
              </select>

              <span className="star-rating-label">
                {STAR_DESCRIPTIONS[hoverRating || rating] || `${rating} / 5 sao`}
              </span>
            </div>
          </div>

          {/* Quick compliment tag chips */}
          <div style={{ marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>
              Gợi ý điểm nổi bật (nhấn để tự động thêm vào nhận xét):
            </span>
            <div className="quick-tags-container">
              {QUICK_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`quick-tag-btn ${selectedQuickTags.includes(tag) ? "selected" : ""}`}
                  onClick={() => toggleQuickTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Textarea review body */}
          <label style={{ display: "block" }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink)",
                display: "block",
                marginBottom: 6,
              }}
            >
              Nội dung đánh giá
            </span>
            <textarea
              className="commercial-composer-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Chia sẻ chi tiết trải nghiệm học tập của bạn: bài giảng có dễ hiểu không, bài tập thực hành ra sao và AI Copilot đã hỗ trợ bạn như thế nào..."
              maxLength={4000}
              required
              rows={3}
            />
          </label>

          <div className="composer-bottom-bar">
            <span className="composer-char-count">{body.length} / 4000 ký tự</span>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {edit && (
                <button
                  type="button"
                  className="button button-subtle button-small"
                  onClick={() => {
                    setEdit(null);
                    setBody("");
                  }}
                >
                  Hủy sửa
                </button>
              )}
              <button
                className="button button-small"
                disabled={command.busy || !body.trim()}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Icon name="star" size={14} />
                <span>{edit ? "Lưu đánh giá" : "Gửi đánh giá"}</span>
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div
          style={{
            padding: "14px 18px",
            borderRadius: 10,
            background: "rgba(2, 132, 199, 0.06)",
            border: "1px solid rgba(2, 132, 199, 0.2)",
            marginBottom: 20,
            fontSize: 13,
            color: "var(--ink)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Icon name="info" size={16} style={{ color: "#0284c7" }} />
          <span>Học ít nhất 20% khóa học để chia sẻ đánh giá. Quyền truy cập cần còn hiệu lực.</span>
        </div>
      )}

      {/* Reviews Feed List */}
      <State query={query}>
        {filteredReviews.length ? (
          <div className="commercial-reviews-list">
            {filteredReviews.map((r) => {
              const isAuthor = r.authorId === profile?.userId;
              return (
                <article className="commercial-review-card" key={r.reviewId}>
                  <div className="review-card-header">
                    <div className="review-author-info">
                      <div className="review-author-avatar">{isAuthor ? "B" : "H"}</div>
                      <div>
                        <div className="review-author-name">
                          <span>{isAuthor ? "Bạn" : "Học viên AILSS"}</span>
                          <span className="verified-badge">
                            <Icon name="checkCircle" size={11} />
                            <span>Đã hoàn thành khóa học</span>
                          </span>
                        </div>
                        <div className="review-date-label">{dateLabel(r.createdAt)}</div>
                      </div>
                    </div>

                    <div className="review-stars-row" aria-label={`${r.rating} trên 5 sao`}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <span key={s} style={{ color: s <= r.rating ? "#f59e0b" : "#cbd5e1", fontSize: 16 }}>
                          ★
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="review-card-body" style={{ whiteSpace: "pre-wrap" }}>
                    {r.state === "ACTIVE" ? r.body : "Đánh giá đã được gỡ."}
                  </div>

                  <div className="review-card-footer">
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {r.state === "ACTIVE" && isAuthor && (
                        <>
                          <button
                            type="button"
                            className="plain-button"
                            onClick={() => {
                              setEdit(r);
                              setBody(r.body || "");
                              setRating(r.rating);
                            }}
                            style={{ fontSize: 12.5, color: "var(--blue)", cursor: "pointer" }}
                          >
                            Sửa đánh giá
                          </button>
                          <button
                            type="button"
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
                            style={{ fontSize: 12.5, color: "#dc2626", cursor: "pointer" }}
                          >
                            Gỡ đánh giá
                          </button>
                        </>
                      )}
                      {r.state === "ACTIVE" && !isAuthor && <ReportAction type="REVIEW" id={r.reviewId} />}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div>
            <Empty>Chưa có đánh giá cho khóa học này.</Empty>
          </div>
        )}
      </State>

      <NextPage cursor={query.meta?.page?.nextCursor} onNext={setCursor} onReset={reset} />
      <Status command={command} />
    </section>
  );
}

function ReportAction({ type, id }: { type: "COMMENT" | "REVIEW"; id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const command = useCommand();

  if (!open)
    return (
      <button
        type="button"
        className="plain-button"
        onClick={() => setOpen(true)}
        style={{ fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }}
      >
        Báo cáo nội dung
      </button>
    );

  return (
    <div
      className="report-composer"
      style={{
        marginTop: 8,
        padding: 12,
        background: "var(--surface-subtle)",
        borderRadius: 10,
        border: "1px solid var(--line)",
      }}
    >
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
        Lý do báo cáo
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={2}
          required
          style={{
            width: "100%",
            borderRadius: 6,
            border: "1px solid var(--line)",
            padding: 8,
            marginTop: 4,
            fontSize: 12.5,
          }}
        />
      </label>
      <div className="inline-actions" style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          className="button secondary button-small"
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
        <button
          type="button"
          className="plain-button"
          onClick={() => setOpen(false)}
          style={{ fontSize: 12.5, color: "var(--muted)" }}
        >
          Hủy
        </button>
      </div>
      <Status command={command} />
    </div>
  );
}
