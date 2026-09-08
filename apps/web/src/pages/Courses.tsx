import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PageHero, Section, TextLink, Picture, ButtonLink } from "../components/ui";
import { searchCourses, normalizeQuery, request, errorMessage, priceLabel, type Course } from "../lib/api";
export function CourseCard({ course }: { course: Course }) {
  return (
    <article className="course-card">
      <Picture name="students" alt="Minh họa không gian học tập, không phải ảnh riêng của khóa học" />
      <div>
        <small>Khóa học công khai · Ảnh minh họa</small>
        <h3>{course.title}</h3>
        <p>{priceLabel(course)}</p>
        <TextLink to={`/courses/${course.courseId}`}>Xem khóa học</TextLink>
      </div>
    </article>
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
  async function load(q: string, cursor?: string) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setState("loading");
    setMessage("");
    activeQuery.current = q;
    try {
      const result = await searchCourses(q, cursor, abort.signal);
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
    }
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
            placeholder="Ví dụ: Cassandra"
            aria-describedby="search-help"
            required
          />
          <button className="button" type="submit" disabled={state === "loading"}>
            {state === "loading" ? "Đang tìm…" : "Tìm khóa học"}
          </button>
        </div>
        <small id="search-help">Tìm theo tiền tố từ trong tên khóa học · 3–20 ký tự.</small>
      </form>
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
            <p>Thử tiền tố ngắn hơn hoặc một từ khóa khác. Chỉ khóa học đã xuất bản được hiển thị.</p>
          </div>
        )}
      </div>
      <div className="course-grid">
        {items.map((course) => (
          <CourseCard course={course} key={course.courseId} />
        ))}
      </div>
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
        label="COURSE DISCOVERY"
        title="Một điều mới. Một bước tiến mới."
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
          <Picture name="students" alt="Ảnh minh họa sinh viên học nhóm trong thư viện" />
        </div>
      </Section>
    </>
  );
}
export function CourseDetail() {
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
            <Picture name="students" alt="Ảnh minh họa học tập, không phải ảnh riêng của khóa học" />
            <div>
              <span className="eyebrow">{priceLabel(course)}</span>
              <h2>{course.title}</h2>
              <p>
                Thông tin khóa học được lấy từ danh mục công khai. Nội dung bài học và quyền tham gia được
                kiểm tra trong ứng dụng sau đăng nhập.
              </p>
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
                  course.priceType === "PAID"
                    ? `/app/purchase/${course.courseId}`
                    : `/app/learn/${course.courseId}`
                }
              >
                {course.priceType === "PAID" ? "Đăng nhập để đăng ký" : "Đăng nhập để học"}
              </ButtonLink>
              <small>Ảnh học tập là minh họa chung.</small>
            </div>
          </div>
        ) : (
          <p role="status">Đang tải thông tin khóa học…</p>
        )}
      </Section>
    </>
  );
}
