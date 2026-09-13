import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { lecturerError, lecturerRequest, useLecturer } from "./api";
import { CourseArtwork, categories } from "../components/CourseArtwork";
import { CatalogCourseSelect, Field, State } from "./ui";
import { Breadcrumbs, EmptyState, StateChip, stateLabel, useUnsavedChanges } from "../components/product";
type Course = {
  courseId: string;
  title: string;
  slug: string;
  categoryId: string;
  state?: string;
  publishedAt?: string;
  priceType: string;
  price: string;
  currency: string;
  ownerLecturerId?: string;
};
type Lesson = {
  lessonId: string;
  title: string;
  sectionTitle: string;
  state: string;
  preview: boolean;
  position: { sectionOrder: number; lessonOrder: number };
};
type Offering = {
  offeringId: string;
  courseId: string;
  title: string;
  offeringType: string;
  state: string;
  price: string;
  currency: string;
  classId?: string;
};
const values = (f: FormData) => Object.fromEntries(f.entries());
export function TeachingHome() {
  const [selectedCat, setSelectedCat] = useState<string>("all");
  const courses = useLecturer<Course[] | { items: Course[] }>("/courses?limit=50"),
    offerings = useLecturer<Offering[] | { items: Offering[] }>("/me/owned-offerings"),
    classes = useLecturer<{ classes?: unknown[] } | unknown[]>("/me/owned-classes");

  const coursesList = Array.isArray(courses.data) ? courses.data : courses.data?.items || [];
  const offeringsList = Array.isArray(offerings.data) ? offerings.data : offerings.data?.items || [];
  const classesList = Array.isArray(classes.data) ? classes.data : (classes.data as { classes?: unknown[] })?.classes || [];

  const displayedCourses = selectedCat === "all"
    ? coursesList
    : coursesList.filter((c) => c.categoryId === selectedCat);

  return (
    <>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">KHÔNG GIAN GIẢNG DẠY</p>
          <h1>Không gian giảng dạy của bạn.</h1>
          <p className="lead">Soạn nội dung, mở lớp, theo dõi đánh giá và duyệt bản nháp AI.</p>
        </div>
        <Link className="button" to="/app/teaching/courses/new">
          + Tạo khóa học mới
        </Link>
      </div>

      <div className="workspace-kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">📖</span>
            <span className="kpi-tag accent">Catalog</span>
          </div>
          <div className="kpi-value">{courses.pending ? "…" : `${coursesList.length} khóa`}</div>
          <div className="kpi-label">Khóa học trong hệ thống</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">🏷️</span>
            <span className="kpi-tag">Tuyển sinh</span>
          </div>
          <div className="kpi-value">{offerings.pending ? "…" : `${offeringsList.length} đợt`}</div>
          <div className="kpi-label">Đợt mở bán đang quản lý</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">👥</span>
            <span className="kpi-tag accent">Đang dạy</span>
          </div>
          <div className="kpi-value">{classes.pending ? "…" : `${classesList.length} lớp`}</div>
          <div className="kpi-label">Lớp học phụ trách</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-icon" aria-hidden="true">🤖</span>
            <span className="kpi-tag accent">AI Copilot</span>
          </div>
          <div className="kpi-value">Sẵn sàng</div>
          <div className="kpi-label">Soạn giáo trình & Quiz AI</div>
        </div>
      </div>

      <div className="workspace-quick-actions" role="toolbar" aria-label="Thao tác giảng dạy nhanh">
        <Link className="quick-action-chip" to="/app/teaching/courses/new">
          <span className="chip-icon" aria-hidden="true">➕</span>
          <span>Tạo khóa học mới</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/classes">
          <span className="chip-icon" aria-hidden="true">📅</span>
          <span>Lịch dạy & Điểm danh</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/offerings">
          <span className="chip-icon" aria-hidden="true">🎯</span>
          <span>Quản lý đợt mở bán</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/assessments">
          <span className="chip-icon" aria-hidden="true">📝</span>
          <span>Ngân hàng câu hỏi</span>
        </Link>
        <Link className="quick-action-chip" to="/app/teaching/ai">
          <span className="chip-icon" aria-hidden="true">🤖</span>
          <span>AI Studio</span>
        </Link>
      </div>

      <div className="workspace-cards">
        <article>
          <div className="card-kicker">ĐÀO TẠO & HỌC TẬP</div>
          <h2>Lớp học</h2>
          <State q={classes}>
            {(v) => <p>{Array.isArray(v) ? v.length : v.classes?.length || 0} lớp phụ trách. Điểm danh theo buổi và gửi thông báo.</p>}
          </State>
          <Link to="/app/teaching/classes">Mở lớp học →</Link>
        </article>
        <article>
          <div className="card-kicker">TUYỂN SINH & DOANH THU</div>
          <h2>Đợt mở bán</h2>
          <State q={offerings}>
            {(v) => <p>{Array.isArray(v) ? v.length : v.items?.length || 0} đợt mở bán đang quản lý. Cấu hình học phí và lịch mở.</p>}
          </State>
          <Link to="/app/teaching/offerings">Quản lý đợt mở bán →</Link>
        </article>
        <article>
          <div className="card-kicker">QUẢN LÝ NỘI DUNG</div>
          <h2>Khóa học</h2>
          <p>Catalog hiển thị khóa học đã xuất bản; quyền chỉnh sửa được kiểm tra trên từng khóa học.</p>
          <Link to="/app/teaching/courses/new">Tạo khóa học →</Link>
        </article>
      </div>

      <section className="catalog-section">
        <div className="catalog-header-wrap">
          <div className="catalog-header-title">
            <div>
              <h2>Catalog khóa học</h2>
              <p>Khám phá và biên soạn giáo trình theo từng chuyên ngành đào tạo.</p>
            </div>
            <Link className="button secondary small" to="/app/teaching/courses/new">
              + Soạn khóa học mới
            </Link>
          </div>
          <div className="catalog-filter-bar" role="tablist" aria-label="Lọc theo danh mục">
            <button
              type="button"
              className={`catalog-filter-pill ${selectedCat === "all" ? "active" : ""}`}
              onClick={() => setSelectedCat("all")}
            >
              Tất cả ({coursesList.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`catalog-filter-pill ${selectedCat === cat.id ? "active" : ""}`}
                onClick={() => setSelectedCat(cat.id)}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <State q={courses}>
          {() =>
            displayedCourses.length ? (
              <div className="workspace-cards">
                {displayedCourses.map((c) => (
                  <article key={c.courseId}>
                    <CourseArtwork title={c.title} categoryId={c.categoryId} />
                    <StateChip state={(c as { state?: string }).state || (c.publishedAt ? "PUBLISHED" : "ACTIVE")} />
                    <h3>{c.title}</h3>
                    <Link className="card-action-btn" to={`/app/teaching/courses/${c.courseId}`}>Chi tiết giáo trình →</Link>
                  </article>
                ))}
              </div>
            ) : (
              <div className="catalog-empty-hub">
                <span className="empty-hub-icon" aria-hidden="true">📖</span>
                <h3>Chưa có khóa học trong danh mục này</h3>
                <p>Bắt đầu tạo giáo trình hoặc chọn danh mục khác để xem tài liệu.</p>
                <Link className="button" to="/app/teaching/courses/new">
                  + Tạo khóa học mới
                </Link>
              </div>
            )
          }
        </State>
      </section>
    </>
  );
}
export function CourseCreate() {
  const nav = useNavigate(),
    [msg, setMsg] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      const v = values(new FormData(e.currentTarget));
      const r = await lecturerRequest<Course>("/courses", "POST", v);
      nav(`/app/teaching/courses/${r.data.courseId}`);
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <p className="eyebrow">COURSE AUTHORING</p>
      <h1>Tạo khóa học.</h1>
      <form className="form-panel form-grid" onSubmit={(e) => void submit(e)}>
        <Field label="Tên khóa học" name="title" required />
        <Field label="Đường dẫn khóa học" name="slug" required />
        <label>
          Chủ đề
          <select name="categoryId">
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hình thức
          <select name="priceType">
            <option value="FREE">Miễn phí</option>
            <option value="PAID">Có học phí</option>
          </select>
        </label>
        <Field label="Giá" name="price" defaultValue="0" required />
        <Field label="Tiền tệ" name="currency" defaultValue="VND" required />
        <button className="button">Tạo bản nháp</button>
        <p role="status">{msg}</p>
      </form>
    </>
  );
}
export function CourseDetail() {
  const { courseId: id = "" } = useParams(),
    q = useLecturer<Course>(`/courses/${id}`),
    lessons = useLecturer<Lesson[] | { lessons: Lesson[] }>(`/courses/${id}/lessons`),
    offerings = useLecturer<Offering[] | { items: Offering[] }>(`/courses/${id}/offerings?limit=50`),
    classes = useLecturer<
      | { classes?: { classId: string; name: string; linkedCourseId?: string }[] }
      | { classId: string; name: string; linkedCourseId?: string }[]
    >("/me/owned-classes"),
    [msg, setMsg] = useState(""),
    [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty, "Bạn có thay đổi khóa học chưa lưu. Rời trang và bỏ các thay đổi này?");
  async function command(path: string, body?: unknown) {
    try {
      await lecturerRequest(path, body ? "PATCH" : "POST", body);
      setMsg("Đã lưu thay đổi.");
      if (body) setDirty(false);
      q.retry();
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <State q={q}>
        {(c) => (
          <>
            <Breadcrumbs
              items={[{ label: "Giảng dạy", to: "/app/teaching" }, { label: "Khóa học" }, { label: c.title }]}
            />
            <StateChip state={c.state} />
            <h1>{c.title}</h1>
            <p>
              {c.slug} · {c.price} {c.currency}
            </p>
            <nav className="teaching-tabs" aria-label="Nội dung khóa học">
              <a href="#overview">Tổng quan</a>
              <Link to={`/app/teaching/courses/${id}/lessons`}>Bài học</Link>
              <a href="#offerings">Đợt mở đăng ký</a>
              <a href="#classes">Lớp liên quan</a>
              <Link to={`/app/teaching/discussion/COURSE/${id}`}>Thảo luận</Link>
              <Link to={`/app/teaching/assessments?course=${id}`}>Bài kiểm tra</Link>
            </nav>
            <section id="overview" className="form-panel">
              <h2>Việc cần hoàn thiện</h2>
              <ul className="readiness-list">
                <li>✓ Tên và hình thức khóa học</li>
                <li>
                  {(Array.isArray(lessons.data) ? lessons.data : lessons.data?.lessons || []).length
                    ? "✓ Có bài học"
                    : "○ Thêm ít nhất một bài học"}
                </li>
                <li>{c.state === "DRAFT" ? "○ Gửi duyệt" : `✓ ${stateLabel(c.state)}`}</li>
                <li>
                  {(Array.isArray(offerings.data) ? offerings.data : offerings.data?.items || []).length
                    ? "✓ Có đợt mở đăng ký"
                    : "○ Tạo đợt mở đăng ký sau khi khóa học đủ điều kiện"}
                </li>
              </ul>
              <p>Đây là hướng dẫn từ dữ liệu đang hiển thị, không phải phần trăm hoàn thành của máy chủ.</p>
            </section>
            <section id="offerings">
              <h2>Đợt mở đăng ký</h2>
              <State q={offerings}>
                {(v) => {
                  const items = Array.isArray(v) ? v : v.items || [];
                  return items.length ? (
                    <div className="workspace-cards">
                      {items.map((o) => (
                        <article key={o.offeringId}>
                          <StateChip state={o.state} />
                          <h3>{o.title}</h3>
                          <p>{stateLabel(o.offeringType)}</p>
                          <Link className="card-action-btn" to={`/app/teaching/offerings/${o.offeringId}`}>Mở đợt đăng ký →</Link>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="Chưa có đợt mở đăng ký"
                      action={
                        <Link className="button" to="/app/teaching/offerings">
                          Tạo đợt mở đăng ký
                        </Link>
                      }
                    >
                      Khóa học chưa tự động mở quyền đăng ký. Hãy tạo đợt mở bán khi nội dung đủ điều kiện.
                    </EmptyState>
                  );
                }}
              </State>
            </section>
            <section id="classes">
              <h2>Lớp học liên quan</h2>
              <State q={classes}>
                {(v) => {
                  const items = (Array.isArray(v) ? v : v.classes || []).filter(
                    (x) => x.linkedCourseId === id,
                  );
                  return items.length ? (
                    <div className="workspace-cards">
                      {items.map((x) => (
                        <article key={x.classId}>
                          <h3>{x.name}</h3>
                          <Link to={`/app/teaching/classes/${x.classId}`}>Mở lớp →</Link>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="Chưa có lớp liên kết"
                      action={<Link to="/app/teaching/classes">Tạo lớp</Link>}
                    >
                      Chỉ hiển thị lớp có linkedCourseId do Classroom trả về.
                    </EmptyState>
                  );
                }}
              </State>
            </section>
            <div className="mobile-primary">
              <Link className="button" to={`/app/teaching/courses/${id}/lessons`}>
                Bài học
              </Link>
              <Link to={`/app/teaching/courses/${id}/roster`}>Học viên</Link>
              <button
                className="button secondary"
                onClick={() => void command(`/courses/${id}/submit-review`)}
              >
                Nộp duyệt
              </button>
            </div>
            <form
              className="form-panel form-grid"
              onChange={() => setDirty(true)}
              onSubmit={(e) => {
                e.preventDefault();
                const v = values(new FormData(e.currentTarget));
                void command(`/courses/${id}`, v);
              }}
            >
              <h2>Sửa bản nháp</h2>
              <Field label="Tên" name="title" defaultValue={c.title} required />
              <Field label="Đường dẫn khóa học" name="slug" defaultValue={c.slug} required />
              <label>
                Chủ đề
                <select name="categoryId" defaultValue={c.categoryId}>
                  {!categories.some((x) => x.id === c.categoryId) && (
                    <option value={c.categoryId}>Chủ đề hiện tại</option>
                  )}
                  {categories.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hình thức
                <select name="priceType" defaultValue={c.priceType}>
                  <option value="FREE">Miễn phí</option>
                  <option value="PAID">Có học phí</option>
                </select>
              </label>
              <Field label="Giá" name="price" defaultValue={c.price} required />
              <Field label="Tiền tệ" name="currency" defaultValue={c.currency} required />
              <button className="button">Lưu</button>
            </form>
          </>
        )}
      </State>
      <p role="status">{msg}</p>
    </>
  );
}
export function Lessons() {
  const { courseId = "" } = useParams(),
    q = useLecturer<Lesson[] | { lessons: Lesson[] }>(`/courses/${courseId}/lessons`),
    [msg, setMsg] = useState("");
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = values(new FormData(e.currentTarget));
    try {
      await lecturerRequest(`/courses/${courseId}/lessons`, "POST", {
        title: v.title,
        sectionTitle: v.sectionTitle,
        position: { sectionOrder: Number(v.sectionOrder), lessonOrder: Number(v.lessonOrder) },
        preview: v.preview === "on",
      });
      q.retry();
      e.currentTarget.reset();
    } catch (x) {
      setMsg(lecturerError(x));
    }
  }
  return (
    <>
      <p className="eyebrow">LESSON AUTHORING</p>
      <h1>Bài học.</h1>
      <State q={q}>
        {(v) => (
          <div className="workspace-cards">
            {(Array.isArray(v) ? v : v.lessons || []).map((x) => (
              <article key={x.lessonId}>
                <span className="badge">{x.state}</span>
                <h2>{x.title}</h2>
                <p>{x.sectionTitle}</p>
                <Link to={`/app/teaching/lessons/${x.lessonId}`}>Sửa bài học →</Link>
              </article>
            ))}
          </div>
        )}
      </State>
      <form className="form-panel form-grid" onSubmit={(e) => void create(e)}>
        <h2>Thêm bài học</h2>
        <Field label="Tiêu đề" name="title" required />
        <Field label="Chương" name="sectionTitle" required />
        <Field label="Thứ tự chương" name="sectionOrder" type="number" defaultValue={1} required />
        <Field label="Thứ tự bài" name="lessonOrder" type="number" defaultValue={1} required />
        <label>
          <input name="preview" type="checkbox" /> Cho phép xem trước
        </label>
        <button className="button">Tạo bài học</button>
        <p role="status">{msg}</p>
      </form>
    </>
  );
}
export function LessonDetail() {
  const { lessonId = "" } = useParams(),
    q = useLecturer<Lesson>(`/lessons/${lessonId}`),
    [msg, setMsg] = useState("");
  return (
    <>
      <p className="eyebrow">LESSON</p>
      <State q={q}>
        {(x) => (
          <>
            <h1>{x.title}</h1>
            <form
              className="form-panel form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const v = values(new FormData(e.currentTarget));
                try {
                  await lecturerRequest(`/lessons/${lessonId}`, "PATCH", {
                    title: v.title,
                    sectionTitle: v.sectionTitle,
                    position: { sectionOrder: Number(v.sectionOrder), lessonOrder: Number(v.lessonOrder) },
                    preview: v.preview === "on",
                  });
                  setMsg("Đã lưu bài học.");
                  q.retry();
                } catch (y) {
                  setMsg(lecturerError(y));
                }
              }}
            >
              <Field label="Tiêu đề" name="title" defaultValue={x.title} />
              <Field label="Chương" name="sectionTitle" defaultValue={x.sectionTitle} />
              <Field
                label="Thứ tự chương"
                name="sectionOrder"
                type="number"
                defaultValue={x.position?.sectionOrder || 1}
              />
              <Field
                label="Thứ tự bài"
                name="lessonOrder"
                type="number"
                defaultValue={x.position?.lessonOrder || 1}
              />
              <label>
                <input name="preview" type="checkbox" defaultChecked={x.preview} /> Xem trước
              </label>
              <button className="button">Lưu</button>
            </form>
          </>
        )}
      </State>
      <p role="status">{msg}</p>
    </>
  );
}
export function CourseRoster() {
  const { courseId = "" } = useParams(),
    q = useLecturer<unknown>(`/courses/${courseId}/roster`);
  return (
    <>
      <h1>Học viên khóa học.</h1>
      <State q={q}>{(v) => <pre className="form-panel">{JSON.stringify(v, null, 2)}</pre>}</State>
    </>
  );
}
export function Offerings() {
  const q = useLecturer<Offering[] | { items: Offering[] }>("/me/owned-offerings");
  return (
    <>
      <p className="eyebrow">OFFERING</p>
      <h1>Đợt mở bán của bạn.</h1>
      <State q={q}>
        {(v) => (
          <div className="workspace-cards">
            {(Array.isArray(v) ? v : v.items || []).map((x) => (
              <article key={x.offeringId}>
                <span className="badge">{x.state}</span>
                <h2>{x.title}</h2>
                <p>
                  {x.offeringType} · {x.price} {x.currency}
                </p>
                <Link to={`/app/teaching/offerings/${x.offeringId}`}>Mở offering →</Link>
              </article>
            ))}
          </div>
        )}
      </State>
      <OfferingCreate onDone={q.retry} />
    </>
  );
}
function OfferingCreate({ onDone }: { onDone: () => void }) {
  const [msg, setMsg] = useState("");
  return (
    <form
      className="form-panel form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = values(new FormData(e.currentTarget));
        try {
          await lecturerRequest(`/courses/${v.courseId}/offerings`, "POST", {
            offeringType: v.offeringType,
            ...(v.classId ? { classId: v.classId } : {}),
            title: v.title,
            price: v.price,
            currency: v.currency,
          });
          onDone();
        } catch (x) {
          setMsg(lecturerError(x));
        }
      }}
    >
      <h2>Tạo offering</h2>
      <CatalogCourseSelect label="Khóa học" name="courseId" required />
      <label>
        Loại
        <select name="offeringType">
          <option value="SELF_PACED">Tự học theo tiến độ</option>
          <option value="LIVE_COHORT">Học theo lớp</option>
        </select>
      </label>
      <Field label="Mã lớp liên kết (khi học theo lớp)" name="classId" />
      <Field label="Tên" name="title" required />
      <Field label="Giá" name="price" defaultValue="0" required />
      <Field label="Tiền tệ" name="currency" defaultValue="VND" required />
      <button className="button">Tạo offering</button>
      <p role="status">{msg}</p>
    </form>
  );
}
export function OfferingDetail() {
  const { offeringId = "" } = useParams(),
    q = useLecturer<Offering>(`/offerings/${offeringId}`),
    [msg, setMsg] = useState("");
  return (
    <>
      <State q={q}>
        {(x) => (
          <>
            <p className="eyebrow">{x.state}</p>
            <h1>{x.title}</h1>
            <p>
              {x.offeringType} · {x.price} {x.currency}
            </p>
            <p>
              {x.state === "DRAFT"
                ? "Đợt mở đăng ký đang ở bản nháp."
                : x.state === "PUBLISHED"
                  ? "Học viên có thể nhận quyền truy cập theo quy tắc và thời gian của đợt mở đăng ký."
                  : "Đợt mở đăng ký đã đóng."}
            </p>
            {x.offeringType === "LIVE_COHORT" &&
              (x.classId ? (
                <Link to={`/app/teaching/classes/${x.classId}`}>Mở lớp gắn với đợt này →</Link>
              ) : (
                <p>
                  Cần chọn một lớp có lịch đã xuất bản. <Link to="/app/teaching/classes">Tạo lớp →</Link>
                </p>
              ))}
            <form
              className="form-panel form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                try {
                  await lecturerRequest(`/offerings/${offeringId}`, "PATCH", {
                    title: String(f.get("title")),
                    price: String(f.get("price")),
                    currency: String(f.get("currency")),
                  });
                  setMsg("Đã lưu offering.");
                  q.retry();
                } catch (error) {
                  setMsg(lecturerError(error));
                }
              }}
            >
              <Field label="Tên offering" name="title" defaultValue={x.title} required />
              <Field label="Giá" name="price" defaultValue={x.price} required />
              <Field label="Tiền tệ" name="currency" defaultValue={x.currency} required />
              <button className="button">Lưu offering</button>
            </form>
            <button
              className="button"
              onClick={async () => {
                try {
                  if (!window.confirm("Mở đăng ký offering này theo điều kiện hiện tại?")) return;
                  await lecturerRequest(`/offerings/${offeringId}/publish`, "POST", {});
                  setMsg("Đã xuất bản offering.");
                  q.retry();
                } catch (y) {
                  setMsg(lecturerError(y));
                }
              }}
            >
              Xuất bản offering
            </button>
          </>
        )}
      </State>
      <p role="status">{msg}</p>
    </>
  );
}
