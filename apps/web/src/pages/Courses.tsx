import { CourseRating, FeaturedInstructors, CourseComments } from "../components/CourseCommunity";
import { useSession } from "../auth/session";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CourseArtwork, categories, courseSubject } from "../components/CourseArtwork";
import { PageHero, Section, TextLink, Picture, ButtonLink } from "../components/ui";
import { searchCourses, normalizeQuery, request, errorMessage, priceLabel, type Course } from "../lib/api";
import { TiltCard } from "../components/TiltCard";

export function CourseCard({ course }: { course: Course }) {
  const subject = courseSubject(course.title, course.categoryId);
  return (
    <TiltCard as="article" className="course-card" tiltOptions={{ maxTilt: 5, scale: 1.02 }}>
      <div className="course-artwork-container">
        <CourseArtwork title={course.title} categoryId={course.categoryId} />
        <span className="course-ai-badge" aria-hidden="true">
          <span>⚡</span> AI Hỗ trợ
        </span>
      </div>
      <div>
        <small>{subject.name}</small>
        <h3>{course.title}</h3>
        <p className={course.priceType === "FREE" ? "course-price free" : "course-price paid"}>
          {priceLabel(course)}
        </p>
        <CourseRating id={course.courseId} />
        <TextLink to={`/courses/${course.courseId}`}>Xem khóa học</TextLink>
      </div>
    </TiltCard>
  );
}
export function CourseSearch({ compact = false }: { compact?: boolean }) {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") || "");
  const [items, setItems] = useState<Course[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const activeQuery = useRef("");
  const category = params.get("category") || "all";
  const mode = params.get("mode") || "ALL";
  const price = params.get("price") || "ALL";
  async function load(q: string, cursor?: string) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState("loading");
    setMessage("");
    activeQuery.current = q;
    try {
      let result = q
        ? await searchCourses(q, cursor, abort.signal)
        : category === "all"
          ? {
              data: (
                await Promise.all(
                  categories.map((c) =>
                    request<import("../lib/api").Catalog>(
                      "/courses?" + new URLSearchParams({ categoryId: c.id, limit: "12" }),
                      { signal: abort.signal },
                    ),
                  ),
                )
              ).flatMap((r) => r.data),
              meta: { pagination: { hasMore: false, nextCursor: null } },
            }
          : await request<import("../lib/api").Catalog>(
              "/courses?" +
                new URLSearchParams({ categoryId: category, limit: "12", ...(cursor ? { cursor } : {}) }),
              { signal: abort.signal },
            );
      if (mode !== "ALL") {
        const options = await Promise.all(
          result.data.map(async (course) => {
            const offers = await request<{ data: { offeringType: string; state: string }[] }>(
              `/courses/${course.courseId}/offerings`,
              { signal: abort.signal },
            );
            return {
              course,
              matches: offers.data.some((o) => o.offeringType === mode && o.state === "PUBLISHED"),
            };
          }),
        );
        result = { ...result, data: options.filter((x) => x.matches).map((x) => x.course) };
      }
      if (price !== "ALL") result = { ...result, data: result.data.filter((c) => c.priceType === price) };
      if (abort.signal.aborted) return;
      setItems((previous) =>
        cursor
          ? [
              ...previous,
              ...result.data.filter((item) => !previous.some((p) => p.courseId === item.courseId)),
            ]
          : result.data,
      );
      setNext(result.meta.pagination.hasMore ? result.meta.pagination.nextCursor : null);
      activeQuery.current = q;
      setState("done");
    } catch (e) {
      if (abort.signal.aborted) return;
      setMessage(errorMessage(e));
      setState("error");
    }
  }
  useEffect(() => {
    const q = params.get("q");
    if (q) {
      setQuery(q);
      const normalized = normalizeQuery(q);
      if (normalized.length >= 3 && normalized.length <= 20) void load(normalized);
    } else void load("");
    return () => controller.current?.abort();
  }, [params]);
  function submit(e: FormEvent) {
    e.preventDefault();
    const q = normalizeQuery(query);
    if (q.length < 3 || q.length > 20) {
      setMessage("Nhập một từ khóa có 3–20 ký tự chữ hoặc số.");
      return;
    }
    setItems([]);
    setNext(null);
    if (compact) void load(q);
    else if (params.get("q") === q) void load(q);
    else setParams({ q });
  }
  return (
    <div className="course-search">
      <form onSubmit={submit} className="search-form">
        <label htmlFor={compact ? "home-search" : "course-search"}>Bạn muốn học điều gì?</label>
        <div>
          <input
            id={compact ? "home-search" : "course-search"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            maxLength={20}
            placeholder="Tìm lập trình, dữ liệu, trí tuệ nhân tạo…"
            aria-describedby="search-help"
          />
          <button className="button" type="submit" disabled={state === "loading"}>
            {state === "loading" ? "Đang tìm…" : "Tìm khóa học"}
          </button>
        </div>
        <small id="search-help">Nhập từ khóa từ 3 ký tự để tìm khóa học theo tên.</small>
      </form>
      <div className="subject-tabs" aria-label="Chủ đề khóa học">
        {[{ id: "all", name: "Tất cả chủ đề" }, ...categories].map((c) => (
          <button
            type="button"
            key={c.id}
            aria-pressed={!params.get("q") && category === c.id}
            onClick={() => {
              setQuery("");
              setParams({ category: c.id, mode, price });
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="catalog-filters">
        <label>
          Hình thức học
          <select value={mode} onChange={(e) => setParams({ category, price, mode: e.target.value })}>
            <option value="ALL">Tất cả hình thức</option>
            <option value="SELF_PACED">Tự học qua video và bài giảng</option>
            <option value="LIVE_COHORT">Trực tuyến theo lịch</option>
          </select>
        </label>
        <label>
          Học phí
          <select value={price} onChange={(e) => setParams({ category, mode, price: e.target.value })}>
            <option value="ALL">Miễn phí và có phí</option>
            <option value="FREE">Miễn phí</option>
            <option value="PAID">Có phí</option>
          </select>
        </label>
      </div>
      <div aria-live="polite">
        {message && (
          <div className="notice error" role="alert">
            <p>{message}</p>
            {state === "error" && (
              <button onClick={() => void load(activeQuery.current || normalizeQuery(query))}>Thử lại</button>
            )}
          </div>
        )}
        {state === "idle" && (
          <div className="search-empty">
            <span className="eyebrow">Khởi đầu từ một câu hỏi</span>
            <h2>Kiến thức tiếp theo bạn muốn khám phá?</h2>
            <p>Tìm khóa học đã xuất bản bằng một từ khóa. Kết quả sẽ xuất hiện tại đây.</p>
          </div>
        )}
        {state === "loading" && <p role="status">Đang kết nối danh mục khóa học…</p>}
        {state === "done" && items.length === 0 && (
          <div className="search-empty">
            <h3>Chưa tìm thấy khóa học phù hợp.</h3>
            <p>Thử một từ khóa khác hoặc chọn chủ đề bạn muốn học.</p>
          </div>
        )}
      </div>
      <div className="course-grid">
        {(compact
          ? [
              items.find((c) => c.slug === "python-video-doanh"),
              items.find((c) => c.slug === "demo-javascript"),
              ...categories.slice(1).map((category) => items.find((c) => c.categoryId === category.id)),
              ...items,
            ]
              .filter(
                (c, index, all): c is Course =>
                  !!c && all.findIndex((x) => x?.courseId === c.courseId) === index,
              )
              .slice(0, 6)
          : items
        ).map((course) => (
          <CourseCard course={course} key={course.courseId} />
        ))}
      </div>
      {!compact && <FeaturedInstructors courses={items} />}
      {next && (
        <button
          className="button secondary"
          disabled={state === "loading"}
          onClick={() => void load(activeQuery.current, next)}
        >
          Xem thêm khóa học
        </button>
      )}
    </div>
  );
}
export default function Courses() {
  return (
    <>
      <PageHero
        label="Khám phá khóa học"
        title="Điều bạn muốn học,
đang chờ bạn ở đây."
        description="Khám phá khóa học công khai và tìm điểm bắt đầu cho hành trình học tập của bạn."
      />
      <Section>
        <CourseSearch />
      </Section>
      <Section className="soft">
        <div className="split">
          <div>
            <h2>Tìm thấy khóa học phù hợp?</h2>
            <p>
              Đọc thông tin công khai trước khi đăng nhập. Quyền tham gia và học liệu được kiểm tra khi bạn
              bắt đầu học.
            </p>
            <ButtonLink to="/students">Trải nghiệm sinh viên</ButtonLink>
          </div>
          <Picture name="study" alt="Minh họa học viên thảo luận trong thư viện" />
        </div>
      </Section>
    </>
  );
}
export function CourseDetail() {
  const { profile } = useSession();
  const { id } = useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setError("");
    setCourse(null);
    const controller = new AbortController();
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      setError("Không tìm thấy khóa học công khai này.");
      return;
    }
    void request<{ data: Course }>(`/courses/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((r) => setCourse(r.data))
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [id, retry]);
  return (
    <>
      <PageHero
        label="KHÓA HỌC CÔNG KHAI"
        title={course?.title || "Thông tin khóa học"}
        description="Tìm hiểu khóa học trước khi bắt đầu."
      />
      <Section>
        {error ? (
          <div role="alert" className="notice">
            <p>{error}</p>
            <button onClick={() => setRetry(retry + 1)}>Thử lại</button>
            <TextLink to="/courses">Quay về danh mục</TextLink>
          </div>
        ) : course ? (
          <div className="split">
            <CourseArtwork title={course.title} categoryId={course.categoryId} eager />
            <div>
              <span className="eyebrow">{priceLabel(course)}</span>
              <h2>{course.title}</h2>
              <p>Học theo từng bài, thực hành và kiểm tra kiến thức ngay trong khóa học.</p>
              <CourseRating id={course.courseId} expanded />
              <CourseComments id={course.courseId} />
              <dl>
                <dt>Loại khóa học</dt>
                <dd>{course.priceType === "FREE" ? "Miễn phí" : "Có phí"}</dd>
                <dt>Cập nhật</dt>
                <dd>
                  {course.updatedAt
                    ? new Date(course.updatedAt).toLocaleDateString("vi-VN")
                    : "Chưa có thông tin"}
                </dd>
              </dl>
              <ButtonLink
                to={
                  profile && profile.role !== "STUDENT"
                    ? "/app"
                    : course.priceType === "PAID"
                      ? `/app/purchase/${course.courseId}`
                      : `/app/learn/${course.courseId}`
                }
              >
                {profile
                  ? "Mở khóa học"
                  : course.priceType === "PAID"
                    ? "Đăng nhập để đăng ký"
                    : "Đăng nhập để học"}
              </ButtonLink>
            </div>
          </div>
        ) : (
          <p role="status">Đang tải thông tin khóa học…</p>
        )}
      </Section>
    </>
  );
}
