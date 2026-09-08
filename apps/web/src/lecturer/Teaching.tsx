import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { lecturerError, lecturerRequest, useLecturer } from "./api";
import { Field, State } from "./ui";
import { Breadcrumbs, EmptyState, StateChip, stateLabel, useUnsavedChanges } from "../components/product";
type Course = {
  courseId: string;
  title: string;
  slug: string;
  categoryId: string;
  state: string;
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
  const courses = useLecturer<Course[] | { items: Course[] }>("/courses?limit=12"),
    offerings = useLecturer<Offering[] | { items: Offering[] }>("/me/owned-offerings"),
    classes = useLecturer<{ classes?: unknown[] } | unknown[]>("/me/owned-classes");
  return (
    <>
      <p className="eyebrow">KHÔNG GIAN GIẢNG DẠY</p>
      <h1>Điều hành khóa học từ dữ liệu thật.</h1>
      <p className="lead">Soạn nội dung, mở lớp, theo dõi đánh giá và duyệt bản nháp AI.</p>
      <div className="workspace-cards">
        <article>
          <h2>Khóa học</h2>
          <p>Catalog không phải danh sách sở hữu; quyền sửa được backend xác nhận ở từng khóa.</p>
          <Link to="/app/teaching/courses/new">Tạo khóa học →</Link>
        </article>
        <article>
          <h2>Offering</h2>
          <State q={offerings}>
            {(v) => <p>{Array.isArray(v) ? v.length : v.items?.length || 0} offering đang quản lý.</p>}
          </State>
          <Link to="/app/teaching/offerings">Quản lý offering →</Link>
        </article>
        <article>
          <h2>Lớp học</h2>
          <State q={classes}>
            {(v) => <p>{Array.isArray(v) ? v.length : v.classes?.length || 0} lớp phụ trách.</p>}
          </State>
          <Link to="/app/teaching/classes">Mở lớp học →</Link>
        </article>
      </div>
      <section>
        <h2>Catalog khóa học</h2>
        <State q={courses}>
          {(v) => (
            <div className="workspace-cards">
              {(Array.isArray(v) ? v : v.items || []).map((c) => (
                <article key={c.courseId}>
                  <span className="badge">{c.state}</span>
                  <h3>{c.title}</h3>
                  <Link to={`/app/teaching/courses/${c.courseId}`}>Mở chi tiết →</Link>
                </article>
              ))}
            </div>
          )}
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
        <Field label="Slug" name="slug" required />
        <Field label="Category ID" name="categoryId" required />
        <label>
          Hình thức
          <select name="priceType">
            <option>FREE</option>
            <option>PAID</option>
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
      setMsg("Đã cập nhật từ backend.");
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
                          <Link to={`/app/teaching/offerings/${o.offeringId}`}>Mở đợt đăng ký →</Link>
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
                      Khóa học chưa tự động mở quyền đăng ký. Hãy tạo Offering khi nội dung đủ điều kiện.
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
              <Field label="Slug" name="slug" defaultValue={c.slug} required />
              <Field label="Category ID" name="categoryId" defaultValue={c.categoryId} required />
              <label>
                Hình thức
                <select name="priceType" defaultValue={c.priceType}>
                  <option>FREE</option>
                  <option>PAID</option>
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
      <h1>Offering đang quản lý.</h1>
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
      <Field label="Course ID" name="courseId" required />
      <label>
        Loại
        <select name="offeringType">
          <option>SELF_PACED</option>
          <option>LIVE_COHORT</option>
        </select>
      </label>
      <Field label="Class ID (LIVE_COHORT)" name="classId" />
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
