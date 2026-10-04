import { useLanguage } from "../lib/i18n";
import { useUiText } from "../lib/i18n";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request, type Course } from "../lib/api";
type Review = { reviewId: string; body: string | null; rating: number; state: string; createdAt?: string };
type Reviews = {
  data: Review[];
  ratingSummary: { reviewCount: number; averageRating: string | null };
  meta?: { page?: { hasMore: boolean; nextCursor: string | null } };
};
export function CourseRating({ id, expanded = false }: { id: string; expanded?: boolean }) {
  const uiText = useUiText();
  const [value, setValue] = useState<Reviews | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setValue(null);
    setError(false);
    void request<Reviews>(`/courses/${id}/reviews?limit=3`, { signal: c.signal })
      .then(setValue)
      .catch(() => {
        if (!c.signal.aborted) setError(true);
      });
    return () => c.abort();
  }, [id]);
  if (error) return <small>{uiText("Đánh giá tạm thời chưa tải được.")}</small>;
  if (!value) return <small>{uiText("Đang tải đánh giá…")}</small>;
  return (
    <div className="course-rating">
      <span aria-hidden="true">★</span>{" "}
      <strong>
        {value.ratingSummary.averageRating
          ? Number(value.ratingSummary.averageRating).toFixed(1)
          : uiText("Chưa có đánh giá")}
      </strong>
      {value.ratingSummary.reviewCount > 0 && (
        <small>
          {" "}
          / 5 · {value.ratingSummary.reviewCount} {uiText(" đánh giá")}
        </small>
      )}
      {expanded && (
        <div className="review-quotes">
          {value.data
            .filter((x) => x.state === "ACTIVE")
            .map((r) => (
              <blockquote key={r.reviewId}>
                <strong>
                  {r.rating}
                  {uiText("/5 — Học viên")}
                </strong>
                <p>{r.body}</p>
              </blockquote>
            ))}
          <Link to={`/courses/${id}`}>{uiText("Xem tất cả đánh giá của khóa học")}</Link>
        </div>
      )}
    </div>
  );
}
export function CourseReviews({ id }: { id: string }) {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const [items, setItems] = useState<Review[]>([]);
  const [summary, setSummary] = useState<Reviews["ratingSummary"] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setSummary(null);
    setCursor(null);
    setBusy(true);
    setError("");
    void request<Reviews>(`/courses/${id}/reviews?limit=20`, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setItems(value.data.filter((item) => item.state === "ACTIVE"));
        setSummary(value.ratingSummary);
        setCursor(value.meta?.page?.hasMore ? value.meta.page.nextCursor : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Chưa tải được đánh giá. Vui lòng thử lại sau.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [id]);
  async function more() {
    if (!cursor || busy) return;
    setBusy(true);
    setError("");
    try {
      const value = await request<Reviews>(
        `/courses/${id}/reviews?limit=20&cursor=${encodeURIComponent(cursor)}`,
      );
      setItems((before) => [
        ...before,
        ...value.data.filter(
          (item) => item.state === "ACTIVE" && !before.some((old) => old.reviewId === item.reviewId),
        ),
      ]);
      setCursor(value.meta?.page?.hasMore ? value.meta.page.nextCursor : null);
    } catch {
      setError("Không tải được thêm đánh giá.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="course-reviews" aria-labelledby="course-reviews-title">
      <h2 id="course-reviews-title">{uiText("Đánh giá chi tiết từ học viên")}</h2>
      {summary && (
        <p>
          <strong>{summary.averageRating ? Number(summary.averageRating).toFixed(1) : "—"}/5</strong> ·{" "}
          {summary.reviewCount} {uiText(" đánh giá")}
        </p>
      )}
      {busy && !summary && <p role="status">{uiText("Đang tải đánh giá…")}</p>}
      {error && <p role="alert">{uiText(error)}</p>}
      {summary?.reviewCount === 0 && <p>{uiText("Khóa học chưa có đánh giá của học viên.")}</p>}
      <div className="course-review-list">
        {items.map((item) => (
          <article key={item.reviewId}>
            <div>
              <strong aria-label={uiText("{0} trên 5 sao", [item.rating])}>
                {"★".repeat(item.rating)}
                {"☆".repeat(5 - item.rating)}
              </strong>
              {item.createdAt && (
                <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(uiLocale)}</time>
              )}
            </div>
            <p>{item.body?.trim() || "Học viên đã chấm điểm và không để lại bình luận."}</p>
          </article>
        ))}
      </div>
      {cursor && (
        <button className="button button-subtle" type="button" disabled={busy} onClick={() => void more()}>
          {busy ? uiText("Đang tải…") : uiText("Xem thêm đánh giá")}
        </button>
      )}
    </section>
  );
}
export function FeaturedInstructors({ courses }: { courses: Course[] }) {
  const uiText = useUiText();
  const [items, setItems] = useState<
    {
      id: string;
      name: string;
      avatarRef: string | null;
      count: number;
      rating: number;
      reviews: number;
      courseId: string;
    }[]
  >([]);
  useEffect(() => {
    const controller = new AbortController();
    const ids = [...new Set(courses.map((c) => c.lecturerId))].slice(0, 6);
    void Promise.all(
      ids.map(async (id) => {
        const owned = courses.filter((c) => c.lecturerId === id);
        const [p, reviews] = await Promise.all([
          request<{ data: { displayName: string; avatarRef: string | null } }>(`/lecturers/${id}`, {
            signal: controller.signal,
          }),
          Promise.all(
            owned.map((c) =>
              request<Reviews>(`/courses/${c.courseId}/reviews?limit=1`, { signal: controller.signal }),
            ),
          ),
        ]);
        const count = reviews.reduce((s, r) => s + r.ratingSummary.reviewCount, 0);
        return {
          id,
          name: p.data.displayName,
          avatarRef: p.data.avatarRef,
          count: owned.length,
          rating: count
            ? reviews.reduce(
                (s, r) => s + Number(r.ratingSummary.averageRating || 0) * r.ratingSummary.reviewCount,
                0,
              ) / count
            : 0,
          reviews: count,
          courseId: owned[0].courseId,
        };
      }),
    )
      .then((data) => {
        if (!controller.signal.aborted)
          setItems(data.sort((a, b) => b.rating - a.rating || b.reviews - a.reviews));
      })
      .catch(() => {
        if (!controller.signal.aborted) setItems([]);
      });
    return () => controller.abort();
  }, [courses]);
  if (!items.length) return null;
  return (
    <section className="featured-instructors">
      <h2>{uiText("Học cùng giảng viên được đánh giá tốt")}</h2>
      <p>
        {uiText(
          "Tổng hợp đánh giá từ các khóa học đang hiển thị. Phản hồi thử nghiệm được ghi rõ “Dữ liệu mẫu”.",
        )}
      </p>
      <div className="instructor-grid">
        {items.map((p) => (
          <article key={p.id}>
            {p.avatarRef ? (
              <img
                className="instructor-monogram"
                src={p.avatarRef}
                alt={uiText("Ảnh giảng viên {0}", [p.name])}
              />
            ) : (
              <span className="instructor-monogram" aria-hidden="true">
                {p.name
                  .split(" ")
                  .slice(-2)
                  .map((w) => w[0])
                  .join("")}
              </span>
            )}
            <div>
              <h3>{p.name}</h3>
              <p>
                {uiText("Giảng viên đã xác minh · ")}
                {p.count} {uiText(" khóa học trong danh mục")}
              </p>
              <p>
                {p.reviews
                  ? uiText("★ {0}/5 · {1} đánh giá", [p.rating.toFixed(1), p.reviews])
                  : uiText("Chưa có đánh giá")}
              </p>
              <Link to={`/lecturers/${p.id}`}>{uiText("Xem hồ sơ giảng viên")}</Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
