import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request, type Course } from "../lib/api";
type Review = { reviewId: string; body: string | null; rating: number; state: string };
type Reviews = { data: Review[]; ratingSummary: { reviewCount: number; averageRating: string | null } };
export function CourseRating({ id, expanded = false }: { id: string; expanded?: boolean }) {
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
  if (error) return <small>Đánh giá tạm thời chưa tải được.</small>;
  if (!value) return <small>Đang tải đánh giá…</small>;
  return (
    <div className="course-rating">
      <span aria-hidden="true">★</span>{" "}
      <strong>
        {value.ratingSummary.averageRating
          ? Number(value.ratingSummary.averageRating).toFixed(1)
          : "Chưa có đánh giá"}
      </strong>
      {value.ratingSummary.reviewCount > 0 && (
        <small> / 5 · {value.ratingSummary.reviewCount} đánh giá</small>
      )}
      {expanded && (
        <div className="review-quotes">
          {value.data
            .filter((x) => x.state === "ACTIVE")
            .map((r) => (
              <blockquote key={r.reviewId}>
                <strong>{r.rating}/5 — Học viên</strong>
                <p>{r.body}</p>
              </blockquote>
            ))}
          <Link to={`/app/learn/${id}`}>Tham gia khóa học để bình luận và đánh giá</Link>
        </div>
      )}
    </div>
  );
}
export function FeaturedInstructors({ courses }: { courses: Course[] }) {
  const [items, setItems] = useState<
    { id: string; name: string; count: number; rating: number; reviews: number; courseId: string }[]
  >([]);
  useEffect(() => {
    const controller = new AbortController();
    const ids = [...new Set(courses.map((c) => c.lecturerId))].slice(0, 6);
    void Promise.all(
      ids.map(async (id) => {
        const owned = courses.filter((c) => c.lecturerId === id);
        const [p, reviews] = await Promise.all([
          request<{ data: { displayName: string } }>(`/lecturers/${id}`, { signal: controller.signal }),
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
      <h2>Học cùng giảng viên được đánh giá tốt</h2>
      <p>Tổng hợp đánh giá từ các khóa học đang hiển thị. Phản hồi thử nghiệm được ghi rõ “Dữ liệu mẫu”.</p>
      <div className="instructor-grid">
        {items.map((p) => (
          <article key={p.id}>
            <span className="instructor-monogram" aria-hidden="true">
              {p.name
                .split(" ")
                .slice(-2)
                .map((w) => w[0])
                .join("")}
            </span>
            <div>
              <h3>{p.name}</h3>
              <p>Giảng viên đã xác minh · {p.count} khóa học trong danh mục</p>
              <p>{p.reviews ? `★ ${p.rating.toFixed(1)}/5 · ${p.reviews} đánh giá` : "Chưa có đánh giá"}</p>
              <Link to={`/courses/${p.courseId}`}>Khám phá khóa học của giảng viên</Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CourseComments({ id }: { id: string }) {
  const [items, setItems] = useState<{ commentId: string; body: string | null; state: string }[]>([]);
  useEffect(() => {
    const c = new AbortController();
    void request<{ data: { commentId: string; body: string | null; state: string }[] }>(
      `/resources/COURSE/${id}/comments?limit=3`,
      { signal: c.signal },
    )
      .then((r) => setItems(r.data))
      .catch(() => {});
    return () => c.abort();
  }, [id]);
  if (!items.length) return null;
  return (
    <section className="public-comments">
      <h3>Trao đổi về khóa học</h3>
      {items
        .filter((x) => x.state === "ACTIVE")
        .map((x) => (
          <blockquote key={x.commentId}>{x.body}</blockquote>
        ))}
    </section>
  );
}
