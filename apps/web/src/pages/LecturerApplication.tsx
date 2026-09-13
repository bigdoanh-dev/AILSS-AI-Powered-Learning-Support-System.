import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { sessionRequest, useSession } from "../auth/session";
import { ApiError, errorMessage } from "../lib/api";
const fields = [
  { name: "professionalTitle", label: "Chức danh chuyên môn", min: 1, max: 120 },
  { name: "institution", label: "Đơn vị công tác", min: 1, max: 160 },
  { name: "teachingArea", label: "Lĩnh vực giảng dạy", min: 1, max: 160 },
  { name: "motivation", label: "Mong muốn giảng dạy", min: 20, max: 2000 },
] as const;
type Body = Record<(typeof fields)[number]["name"], string>;
type Application = Body & {
  applicationId: string;
  status: string;
  result: string;
  displayNameSnapshot: string;
  applicantId?: string;
  submittedAt: string;
};
export function LecturerApplication() {
  const auth = useSession(),
    location = useLocation(),
    navigate = useNavigate();
  const statusRoute = location.pathname.endsWith("/status");
  const [application, setApplication] = useState<Application | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [body, setBody] = useState<Body | null>(null);
  const key = useRef(crypto.randomUUID());
  async function load() {
    setLoading(true);
    setError("");
    try {
      setApplication(await sessionRequest<Application | null>("lecturer-application"));
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.status === 401) await auth.bootstrap();
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (auth.state === "AUTHENTICATED") void load();
    else setLoading(false);
  }, [auth.state, location.pathname]);
  function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = new FormData(e.currentTarget),
      next = {} as Body;
    for (const f of fields) {
      const v = String(values.get(f.name) || "")
        .normalize("NFC")
        .trim();
      if ([...v].length < f.min || [...v].length > f.max) {
        setError(`${f.label}: cần ${f.min}–${f.max} ký tự.`);
        return;
      }
      next[f.name] = v;
    }
    setError("");
    setBody(next);
  }
  async function submit() {
    if (!body || busy) return;
    setBusy(true);
    setError("");
    try {
      await sessionRequest("lecturer-application", "POST", body, key.current);
      navigate("/auth/register/lecturer/status");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-card lecturer-onboarding">
      <p className="eyebrow">NVD · GIẢNG VIÊN</p>
      <h1>Chia sẻ chuyên môn của bạn.</h1>
      <p>Đăng ký để tạo khóa học, tổ chức lớp học và sử dụng AI hỗ trợ chuẩn bị nội dung.</p>
      {error && <p role="alert">{error}</p>}
      {auth.state !== "AUTHENTICATED" ? (
        <>
          <p>
            Hãy đăng ký tài khoản Sinh viên và đăng nhập trước khi gửi yêu cầu. Nếu phiên vừa hết hạn sau khi
            duyệt, hãy đăng nhập lại để cập nhật vai trò.
          </p>
          <Link className="button" to="/auth/login?returnTo=%2Fauth%2Fregister%2Flecturer%2Fapplication">
            Đăng nhập
          </Link>
          <Link to="/auth/register/student?returnTo=%2Fauth%2Fregister%2Flecturer%2Fapplication">
            Tạo tài khoản
          </Link>
        </>
      ) : loading ? (
        <p role="status">Đang đọc yêu cầu…</p>
      ) : application ? (
        <>
          <p className="eyebrow">TRẠNG THÁI YÊU CẦU</p>
          <h2>
            {application.status === "SUBMITTED"
              ? "Yêu cầu của bạn đang được xem xét."
              : application.status === "REJECTED"
                ? "Yêu cầu chưa được chấp thuận."
                : application.result === "APPROVED_VERIFIED"
                  ? "Giảng viên đã được xác minh."
                  : "Tài khoản đã được chuyển sang Giảng viên."}
          </h2>
          <p>
            {application.result === "APPROVED_AWAITING_VERIFICATION"
              ? "Bạn vẫn cần được xác minh trước khi sử dụng các chức năng yêu cầu giảng viên đã xác minh."
              : application.status === "REJECTED"
                ? "Bạn vẫn có thể tiếp tục sử dụng tài khoản Sinh viên. Hiện chưa hỗ trợ gửi lại yêu cầu."
                : "Bạn có thể kiểm tra trạng thái tại đây."}
          </p>
          <button className="button secondary" onClick={() => void load()}>
            Cập nhật trạng thái
          </button>
          <Link to="/app">Về tài khoản</Link>
        </>
      ) : error ? (
        <button className="button" onClick={() => void load()}>
          Thử lại
        </button>
      ) : statusRoute ? (
        <>
          <p>Bạn chưa gửi yêu cầu.</p>
          <Link to="/auth/register/lecturer/application">Điền đơn</Link>
        </>
      ) : auth.profile?.role !== "STUDENT" ? (
        <p>Luồng đăng ký này dành cho tài khoản Sinh viên.</p>
      ) : (
        <>
          <ol className="application-steps" aria-label="Các bước đăng ký">
            <li aria-current={!body ? "step" : undefined}>Thông tin</li>
            <li aria-current={body ? "step" : undefined}>Xem lại</li>
            <li>Gửi yêu cầu</li>
          </ol>
          {body ? (
            <div className="application-panel">
              <h2>Xem lại yêu cầu</h2>
              <dl>
                {fields.map((f) => (
                  <div key={f.name}>
                    <dt>{f.label}</dt>
                    <dd>{body[f.name]}</dd>
                  </div>
                ))}
              </dl>
              <p>
                Gửi đơn chưa cấp quyền Giảng viên. Quản trị viên cần duyệt đơn; sau đó việc xác minh Giảng
                viên vẫn là bước riêng.
              </p>
              <p>
                Mỗi tài khoản chỉ gửi một đơn. Khi được duyệt, vai trò Sinh viên chuyển sang Giảng viên; các
                chức năng chỉ dành cho Sinh viên có thể không còn truy cập được.
              </p>
              <button className="button" disabled={busy} onClick={() => void submit()}>
                {busy ? "Đang gửi…" : "Gửi yêu cầu"}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setBody(null);
                  key.current = crypto.randomUUID();
                }}
              >
                Sửa thông tin
              </button>
            </div>
          ) : (
            <form onSubmit={review} className="application-panel">
              {fields.map((f) => (
                <label key={f.name}>
                  {f.label}
                  {f.name === "motivation" ? (
                    <textarea name={f.name} required rows={5} />
                  ) : (
                    <input name={f.name} required />
                  )}
                  <small>
                    {f.min}–{f.max} ký tự
                  </small>
                </label>
              ))}
              <button className="button">Xem lại yêu cầu</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
export function AdminLecturerApplications() {
  const auth = useSession();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [shard, setShard] = useState(0),
    [items, setItems] = useState<Application[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [detail, setDetail] = useState<Application | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const keys = useRef<Record<string, string>>({});
  async function queue(next?: string) {
    setBusy(true);
    setMessage("");
    try {
      const p = await sessionRequest<{ items: Application[]; nextCursor: string | null }>(
        `admin/lecturer-applications?month=${month}&shard=${shard}${next ? `&cursor=${encodeURIComponent(next)}` : ""}`,
      );
      setItems(p.items);
      setCursor(p.nextCursor);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    setBusy(true);
    try {
      setDetail(await sessionRequest<Application>(`admin/lecturer-applications/${id}`));
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function decide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detail || busy) return;
    const form = e.currentTarget,
      data = new FormData(form),
      decision = String(data.get("decision")),
      currentPassword = String(data.get("currentPassword"));
    form.reset();
    setBusy(true);
    setMessage("");
    const scope = `${detail.applicationId}:${decision}`;
    keys.current[scope] ??= crypto.randomUUID();
    try {
      await sessionRequest(
        `admin/lecturer-applications/${detail.applicationId}/decision`,
        "POST",
        { decision, currentPassword },
        keys.current[scope],
      );
      await open(detail.applicationId);
      setMessage("Đã ghi nhận quyết định. Xác minh Giảng viên là thao tác riêng.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!detail?.applicantId || busy) return;
    const form = e.currentTarget,
      currentPassword = String(new FormData(form).get("currentPassword"));
    form.reset();
    setBusy(true);
    const scope = `verify:${detail.applicantId}`;
    keys.current[scope] ??= crypto.randomUUID();
    try {
      await sessionRequest(
        `admin/lecturers/${detail.applicantId}/verify`,
        "POST",
        { currentPassword },
        keys.current[scope],
      );
      await open(detail.applicationId);
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (auth.profile?.role !== "ADMIN") return <p>Chỉ Quản trị viên được xem và duyệt yêu cầu.</p>;
  return (
    <section className="application-admin">
      <p className="eyebrow">QUẢN TRỊ · GIẢNG VIÊN</p>
      <h1>Duyệt yêu cầu giảng dạy</h1>
      <p>
        Mỗi lần tải xem một tháng và một phân vùng. Hãy chọn các phân vùng 0–15 để kiểm tra đầy đủ tháng đã
        chọn.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void queue();
        }}
      >
        <label>
          Tháng nộp
          <input
            type="month"
            required
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setCursor(null);
            }}
          />
        </label>
        <label>
          Phân vùng
          <select
            value={shard}
            onChange={(e) => {
              setShard(Number(e.target.value));
              setCursor(null);
            }}
          >
            {Array.from({ length: 16 }, (_, i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </label>
        <button className="button" disabled={busy}>
          Tải danh sách chờ
        </button>
      </form>
      <p role="status">{busy ? "Đang xử lý…" : message}</p>
      <ul>
        {items.map((a) => (
          <li key={a.applicationId}>
            <button onClick={() => void open(a.applicationId)} disabled={busy}>
              {a.displayNameSnapshot} · {a.teachingArea}
            </button>
          </li>
        ))}
      </ul>
      {cursor && (
        <button disabled={busy} onClick={() => void queue(cursor)}>
          Trang tiếp
        </button>
      )}
      {detail && (
        <article>
          <h2>{detail.displayNameSnapshot}</h2>
          <p>
            {detail.status === "SUBMITTED"
              ? "Đơn đang chờ duyệt"
              : detail.status === "REJECTED"
                ? "Đơn đã bị từ chối"
                : detail.result === "APPROVED_VERIFIED"
                  ? "Đơn đã duyệt · Giảng viên đã xác minh"
                  : "Đơn đã duyệt · Giảng viên chưa xác minh"}
          </p>
          <dl>
            {fields.map((f) => (
              <div key={f.name}>
                <dt>{f.label}</dt>
                <dd>{detail[f.name]}</dd>
              </div>
            ))}
          </dl>
          {detail.status === "SUBMITTED" ? (
            <form onSubmit={decide}>
              <p>
                Duyệt: chuyển vai trò Sinh viên sang Giảng viên; xác minh vẫn là bước riêng. Từ chối: tài
                khoản Sinh viên không thay đổi.
              </p>
              <label>
                Quyết định
                <select name="decision">
                  <option value="APPROVE">Duyệt</option>
                  <option value="REJECT">Từ chối</option>
                </select>
              </label>
              <label>
                Mật khẩu hiện tại
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
              <button className="button" disabled={busy}>
                Xác nhận quyết định
              </button>
            </form>
          ) : detail.status === "APPROVED" && detail.result !== "APPROVED_VERIFIED" ? (
            <form onSubmit={verify}>
              <h3>Xác minh Giảng viên — bước riêng</h3>
              <label>
                Mật khẩu hiện tại
                <input
                  type="password"
                  name="currentPassword"
                  required
                  autoComplete="current-password"
                  maxLength={128}
                />
              </label>
              <button className="button" disabled={busy}>
                Xác minh Giảng viên
              </button>
            </form>
          ) : null}
        </article>
      )}
    </section>
  );
}
