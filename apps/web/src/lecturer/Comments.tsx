import { useLanguage } from "../lib/i18n";
import { useUiText } from "../lib/i18n";
import { useState, useMemo, type FormEvent } from "react";
import { useParams, Link } from "react-router-dom";
import { lecturerError, lecturerRequest, useLecturer } from "./api";
import { State } from "./ui";
import { Breadcrumbs } from "../components/product";
import { useSession } from "../auth/session";
import { Icon } from "../components/Icon";

type Comment = {
  commentId: string;
  authorId: string;
  body: string | null;
  version: number;
  state: string;
  createdAt?: string;
};

type Review = {
  reviewId: string;
  courseId: string;
  authorId: string;
  rating: number;
  body: string | null;
  state: string;
  version: number;
  createdAt: string;
};

type RatingSummary = {
  reviewCount: number;
  ratingSum: number;
  average: number;
};

type ReviewResponse = {
  items: Review[];
  ratingSummary?: RatingSummary;
};

export default function Comments() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { resourceType = "", resourceId = "" } = useParams();
  const session = useSession();
  const myUserId = session.profile?.userId;

  const [activeTab, setActiveTab] = useState<"reviews" | "comments">("reviews");
  const [selectedStar, setSelectedStar] = useState<number | "all">("all");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const commentsQuery = useLecturer<Comment[] | { items: Comment[] }>(
    `/resources/${resourceType}/${resourceId}/comments?limit=50`,
  );

  const reviewsQuery = useLecturer<ReviewResponse | Review[]>(
    resourceType === "COURSE" ? `/courses/${resourceId}/reviews?limit=50` : "/me/owned-classes",
  );

  const commentsList: Comment[] = useMemo(() => {
    if (!commentsQuery.data) return [];
    if (Array.isArray(commentsQuery.data)) return commentsQuery.data;
    return (commentsQuery.data as { items?: Comment[] }).items || [];
  }, [commentsQuery.data]);

  const rawReviews = reviewsQuery.data;
  const reviewsList: Review[] = useMemo(() => {
    if (resourceType !== "COURSE" || !rawReviews) return [];
    if (Array.isArray(rawReviews)) return rawReviews;
    return (rawReviews as ReviewResponse).items || [];
  }, [resourceType, rawReviews]);

  const ratingInfo: RatingSummary = useMemo(() => {
    if (resourceType !== "COURSE" || !rawReviews) return { reviewCount: 0, ratingSum: 0, average: 0 };
    if (!Array.isArray(rawReviews) && (rawReviews as ReviewResponse).ratingSummary) {
      return (rawReviews as ReviewResponse).ratingSummary!;
    }
    if (reviewsList.length > 0) {
      const sum = reviewsList.reduce((acc, r) => acc + (r.rating || 0), 0);
      return { reviewCount: reviewsList.length, ratingSum: sum, average: sum / reviewsList.length };
    }
    return { reviewCount: 0, ratingSum: 0, average: 0 };
  }, [resourceType, rawReviews, reviewsList]);

  // Star breakdown calculation
  const starCounts = useMemo(() => {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviewsList) {
      const star = Math.min(5, Math.max(1, Math.round(r.rating || 5))) as keyof typeof counts;
      counts[star] = (counts[star] || 0) + 1;
    }
    return counts;
  }, [reviewsList]);

  const filteredReviews = useMemo(() => {
    if (selectedStar === "all") return reviewsList;
    return reviewsList.filter((r) => Math.round(r.rating) === selectedStar);
  }, [reviewsList, selectedStar]);

  async function createComment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const bodyVal = String(new FormData(form).get("body") || "").trim();
    if (!bodyVal) return;

    setSubmitting(true);
    setMessage(null);
    try {
      await lecturerRequest(`/resources/${resourceType}/${resourceId}/comments`, "POST", {
        body: bodyVal,
      });
      form.reset();
      setMessage({ type: "success", text: "✓ Đã gửi phản hồi thành công." });
      commentsQuery.retry();
    } catch (error) {
      setMessage({ type: "error", text: lecturerError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteComment(item: Comment) {
    setDeletingId(item.commentId);
    setMessage(null);
    try {
      await lecturerRequest(`/comments/${item.commentId}`, "DELETE", undefined, {
        "If-Match": `"v${item.version}"`,
      });
      setMessage({ type: "success", text: "✓ Đã xóa phản hồi của bạn." });
      commentsQuery.retry();
    } catch (error) {
      setMessage({ type: "error", text: lecturerError(error) });
    } finally {
      setDeletingId(null);
    }
  }

  const breadcrumbItems =
    resourceType === "COURSE"
      ? [
          { label: uiText("Giảng dạy"), to: "/app/teaching" },
          { label: uiText("Khóa học"), to: `/app/teaching/courses/${resourceId}` },
          { label: uiText("Đánh giá & Thảo luận") },
        ]
      : [
          { label: uiText("Giảng dạy"), to: "/app/teaching" },
          { label: uiText("Lớp học"), to: `/app/teaching/classes/${resourceId}` },
          { label: uiText("Thảo luận lớp") },
        ];

  return (
    <div className="lecturer-discussion-container">
      <Breadcrumbs items={breadcrumbItems} />

      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">{uiText("TƯƠNG TÁC & PHẢN HỒI GIẢNG VIÊN")}</p>
          <h1>
            {resourceType === "COURSE"
              ? uiText("Đánh giá & Thảo luận Khóa học")
              : uiText("Thảo luận Lớp học")}
          </h1>
          <p className="lead">
            {resourceType === "COURSE"
              ? uiText("Lắng nghe đánh giá sao từ học viên, giải đáp câu hỏi và tương tác với người học.")
              : uiText(
                  "Trao đổi thắc mắc, thông báo bài tập và thảo luận chuyên đề cùng học viên trong lớp.",
                )}
          </p>
        </div>
        <div className="dashboard-header-actions">
          <Link
            className="button button-subtle"
            to={
              resourceType === "COURSE"
                ? `/app/teaching/courses/${resourceId}`
                : `/app/teaching/classes/${resourceId}`
            }
          >
            {uiText("← Về ")}
            {resourceType === "COURSE" ? uiText("Khóa học") : uiText("Lớp học")}
          </Link>
        </div>
      </div>

      {message && (
        <div
          className={`dashboard-banner-notice ${message.type === "error" ? "error" : ""}`}
          role="status"
          style={
            message.type === "error"
              ? { backgroundColor: "#fef2f2", borderColor: "#fecaca", color: "#b91c1c" }
              : undefined
          }
        >
          <span>{message.type === "error" ? "⚠️" : "✓"}</span>
          <span>{message.text}</span>
        </div>
      )}

      {resourceType === "COURSE" && (
        <div className="module-segmented-bar" role="tablist" style={{ marginBottom: "1.5rem" }}>
          <button
            className={`segmented-tab ${activeTab === "reviews" ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === "reviews"}
            onClick={() => setActiveTab("reviews")}
          >
            <Icon name="starFilled" size={15} /> {uiText(" Đánh giá của học viên (")}
            {reviewsList.length})
          </button>
          <button
            className={`segmented-tab ${activeTab === "comments" ? "active" : ""}`}
            role="tab"
            aria-selected={activeTab === "comments"}
            onClick={() => setActiveTab("comments")}
          >
            <Icon name="message" size={15} /> {uiText(" Thảo luận & Phản hồi (")}
            {commentsList.length})
          </button>
        </div>
      )}

      {/* REVIEWS TAB (Only for courses) */}
      {resourceType === "COURSE" && activeTab === "reviews" && (
        <section className="dashboard-section-card">
          <div className="section-card-header">
            <div>
              <h2>{uiText("Tổng Quan Đánh Giá Khóa Học")}</h2>
              <p className="subtext">
                {uiText("Phản hồi và mức độ hài lòng từ học viên đã tham gia khóa học.")}
              </p>
            </div>
            <span className="kpi-tag accent">
              {ratingInfo.reviewCount > 0
                ? uiText("{0} Đánh giá", [ratingInfo.reviewCount])
                : uiText("Chưa có đánh giá")}
            </span>
          </div>

          {/* Rating Summary Hero */}
          <div
            className="reviews-summary-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "1.5rem",
              marginBottom: "1.5rem",
              alignItems: "center",
            }}
          >
            <div
              className="rating-hero-box"
              style={{
                background: "var(--surface-soft, #f8fafc)",
                padding: "1.25rem",
                borderRadius: "10px",
                textAlign: "center",
                border: "1px solid var(--line, #e2e8f0)",
              }}
            >
              <div style={{ fontSize: "3rem", fontWeight: "800", color: "#f59e0b", lineHeight: 1 }}>
                {ratingInfo.reviewCount > 0 ? ratingInfo.average.toFixed(1) : uiText("Chưa có đánh giá")}
              </div>
              <div style={{ fontSize: "1.4rem", color: "#f59e0b", margin: "0.25rem 0" }}>
                {"★".repeat(Math.round(ratingInfo.average))}
                {"☆".repeat(5 - Math.round(ratingInfo.average))}
              </div>
              <div style={{ fontSize: "0.875rem", color: "var(--muted, #64748b)" }}>
                {uiText("Dựa trên ")}
                {ratingInfo.reviewCount} {uiText(" lượt đánh giá thực tế")}
              </div>
            </div>

            {/* Star Breakdown Bars */}
            <div
              className="rating-bars-box"
              style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
            >
              {[5, 4, 3, 2, 1].map((stars) => {
                const count = starCounts[stars as keyof typeof starCounts] || 0;
                const pct =
                  ratingInfo.reviewCount > 0 ? Math.round((count / ratingInfo.reviewCount) * 100) : 0;
                return (
                  <div
                    key={stars}
                    style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem" }}
                  >
                    <span style={{ width: "35px", fontWeight: "600", color: "#f59e0b" }}>{stars} ★</span>
                    <div
                      style={{
                        flex: 1,
                        height: "8px",
                        background: "var(--surface-soft, #e2e8f0)",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: "#f59e0b",
                          borderRadius: "4px",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        width: "50px",
                        textAlign: "right",
                        color: "var(--muted, #64748b)",
                        fontSize: "0.8rem",
                      }}
                    >
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Star Filter Pills */}
          <div className="dashboard-toolbar-row" style={{ marginTop: "1rem", marginBottom: "1rem" }}>
            <div className="dashboard-filter-group" role="group" aria-label={uiText("Lọc theo số sao")}>
              <button
                className={`filter-pill-button ${selectedStar === "all" ? "active" : ""}`}
                onClick={() => setSelectedStar("all")}
              >
                {uiText("Tất cả (")}
                {reviewsList.length})
              </button>
              {[5, 4, 3, 2, 1].map((s) => (
                <button
                  key={s}
                  className={`filter-pill-button ${selectedStar === s ? "active" : ""}`}
                  onClick={() => setSelectedStar(s)}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                    {s} <Icon name="starFilled" size={13} /> ({starCounts[s as keyof typeof starCounts] || 0})
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Reviews List */}
          <div
            className="reviews-list-cards"
            style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}
          >
            {filteredReviews.length === 0 ? (
              <div
                className="table-empty-row"
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  background: "var(--surface-soft, #f8fafc)",
                  borderRadius: "8px",
                }}
              >
                {reviewsList.length === 0
                  ? uiText("Khóa học chưa nhận được bài đánh giá nào từ học viên.")
                  : uiText("Không có đánh giá {0} sao.", [selectedStar])}
              </div>
            ) : (
              filteredReviews.map((r) => (
                <article
                  key={r.reviewId}
                  className="home-activity-card"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    padding: "1rem 1.25rem",
                    border: "1px solid var(--line, #e2e8f0)",
                    borderRadius: "8px",
                    background: "var(--surface, #fff)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ color: "#f59e0b", fontSize: "1.1rem", letterSpacing: "1px" }}>
                        {"★".repeat(r.rating)}
                        {"☆".repeat(5 - r.rating)}
                      </span>
                      <strong style={{ fontSize: "0.9rem" }}>
                        {uiText("Học viên: ")}
                        {r.authorId ? `${r.authorId.slice(0, 8)}…` : uiText("Ẩn danh")}
                      </strong>
                    </div>
                    <small style={{ color: "var(--muted, #64748b)" }}>
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleDateString(uiLocale, {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : uiText("Vừa xong")}
                    </small>
                  </div>
                  {r.body ? (
                    <p
                      style={{
                        margin: "0.25rem 0 0 0",
                        color: "var(--text, #1e293b)",
                        lineHeight: "1.5",
                      }}
                    >
                      {r.body}
                    </p>
                  ) : (
                    <p
                      style={{
                        margin: "0.25rem 0 0 0",
                        color: "var(--muted, #64748b)",
                        fontStyle: "italic",
                      }}
                    >
                      {uiText("Không có nhận xét bằng chữ.")}
                    </p>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      )}

      {/* COMMENTS TAB (Or for classroom) */}
      {(resourceType !== "COURSE" || activeTab === "comments") && (
        <>
          <section className="dashboard-section-card">
            <div className="section-card-header">
              <div>
                <h2>
                  {resourceType === "COURSE"
                    ? uiText("Thảo Luận & Câu Hỏi Của Học Viên")
                    : uiText("Kênh Thảo Luận Lớp Học")}
                </h2>
                <p className="subtext">
                  {uiText("Danh sách trao đổi, phản hồi và giải đáp chuyên môn của giảng viên.")}
                </p>
              </div>
              <span className="kpi-tag accent">
                {commentsList.length} {uiText(" bình luận")}
              </span>
            </div>

            <State q={commentsQuery}>
              {() => (
                <div
                  className="comments-thread-list"
                  style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
                >
                  {commentsList.length === 0 ? (
                    <div
                      className="table-empty-row"
                      style={{
                        padding: "2rem",
                        textAlign: "center",
                        background: "var(--surface-soft, #f8fafc)",
                        borderRadius: "8px",
                      }}
                    >
                      {uiText("Chưa có trao đổi nào. Hãy là người đầu tiên bắt đầu cuộc trò chuyện!")}
                    </div>
                  ) : (
                    commentsList.map((item) => {
                      const isMe = item.authorId === myUserId;
                      return (
                        <article
                          key={item.commentId}
                          className="comment-thread-card"
                          style={{
                            padding: "1rem 1.25rem",
                            borderRadius: "8px",
                            border: isMe ? "1.5px solid #bfdbfe" : "1px solid var(--line, #e2e8f0)",
                            background: isMe ? "#f0f7ff" : "var(--surface, #fff)",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              {isMe ? (
                                <span className="green-badge-pill">{uiText("👨‍🏫 Bạn (Giảng viên)")}</span>
                              ) : (
                                <span className="kpi-tag">
                                  {uiText("Học viên ")}
                                  {item.authorId ? `${item.authorId.slice(0, 8)}…` : ""}
                                </span>
                              )}
                              <span className="badge" style={{ fontSize: "0.75rem" }}>
                                {item.state}
                              </span>
                            </div>
                            {item.createdAt && (
                              <small style={{ color: "var(--muted, #64748b)" }}>
                                {new Date(item.createdAt).toLocaleDateString(uiLocale, {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </small>
                            )}
                          </div>

                          <p
                            style={{
                              margin: "0.25rem 0",
                              color: "var(--text, #1e293b)",
                              lineHeight: "1.5",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {item.body || "(Bình luận đã được xóa)"}
                          </p>

                          {isMe && (
                            <div style={{ alignSelf: "flex-end", marginTop: "0.25rem" }}>
                              <button
                                className="button button-subtle button-small"
                                style={{ color: "#dc2626", borderColor: "#fecaca" }}
                                onClick={() => void deleteComment(item)}
                                disabled={deletingId === item.commentId}
                              >
                                {deletingId === item.commentId
                                  ? uiText("Đang xóa…")
                                  : uiText("🗑️ Xóa phản hồi")}
                              </button>
                            </div>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              )}
            </State>
          </section>

          {/* Comment Composer */}
          <section className="dashboard-section-card" style={{ marginTop: "1.5rem" }}>
            <div className="section-card-header">
              <div>
                <h2>{uiText("Gửi Phản Hồi Giảng Viên")}</h2>
                <p className="subtext">
                  {uiText("Phản hồi trực tiếp thắc mắc của học viên hoặc đăng thông báo thảo luận mới.")}
                </p>
              </div>
            </div>
            <form
              className="form-panel"
              onSubmit={(e) => void createComment(e)}
              style={{ margin: 0, padding: 0, border: "none", background: "transparent" }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <span style={{ fontWeight: 600 }}>{uiText("Nội dung trao đổi / phản hồi:")}</span>
                <textarea
                  name="body"
                  rows={4}
                  required
                  placeholder={uiText(
                    "Nhập nội dung giải đáp chuyên môn hoặc hướng dẫn học tập cho học viên...",
                  )}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1rem",
                    borderRadius: "8px",
                    border: "1px solid var(--line, #cbd5e1)",
                    fontFamily: "inherit",
                    fontSize: "0.95rem",
                  }}
                />
              </label>
              <div style={{ marginTop: "1rem", display: "flex", justifyContent: "flex-end" }}>
                <button className="button" type="submit" disabled={submitting}>
                  {submitting ? uiText("Đang gửi…") : uiText("🚀 Gửi phản hồi ngay")}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
