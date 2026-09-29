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
const DEMO_APPLICATIONS: Application[] = [
  {
    applicationId: "app-2026-001",
    displayNameSnapshot: "TS. Nguyễn Minh Trí",
    professionalTitle: "Tiến sĩ Khoa học Máy tính",
    institution: "Đại học Bách Khoa Hà Nội",
    teachingArea: "Cơ sở dữ liệu & Hệ thống phân tán",
    motivation:
      "Tôi mong muốn chia sẻ kiến thức chuyên sâu về tối ưu hóa SQL, kiến trúc Sharding và phân tán dữ liệu đến đông đảo học viên công nghệ tại Việt Nam qua nền tảng AILSS.",
    status: "APPROVED",
    result: "APPROVED_VERIFIED",
    applicantId: "00000000-0000-4000-8000-000000000001",
    submittedAt: "2026-09-10T08:30:00Z",
  },
  {
    applicationId: "app-2026-002",
    displayNameSnapshot: "ThS. Hoàng Quốc Bảo",
    professionalTitle: "Thạc sĩ Trí tuệ Nhân tạo",
    institution: "Viện Công nghệ Thông tin",
    teachingArea: "Lập trình Web & Trợ lý AI",
    motivation:
      "Xây dựng giáo trình thực hành thế hệ mới, kết hợp lý thuyết nền tảng với thực chiến xây dựng Agent và mô hình ngôn ngữ lớn (LLM).",
    status: "SUBMITTED",
    result: "PENDING",
    applicantId: "00000000-0000-4000-8000-000000000002",
    submittedAt: "2026-09-14T14:15:00Z",
  },
  {
    applicationId: "app-2026-003",
    displayNameSnapshot: "Kỹ sư Đặng Hải Nam",
    professionalTitle: "Chuyên gia DevOps & Cloud Architecture",
    institution: "Tập đoàn Viễn thông & Công nghệ",
    teachingArea: "DevOps CI/CD & Kubernetes",
    motivation:
      "Giúp học viên làm chủ quy trình CI/CD tự động, vận hành hạ tầng Kubernetes chịu tải cao theo chuẩn các dự án quốc tế.",
    status: "SUBMITTED",
    result: "PENDING",
    applicantId: "00000000-0000-4000-8000-000000000003",
    submittedAt: "2026-09-15T09:40:00Z",
  },
  {
    applicationId: "app-2026-004",
    displayNameSnapshot: "ThS. Vũ Thị Mai Lan",
    professionalTitle: "Cử nhân Tin học Ứng dụng",
    institution: "Trung tâm Đào tạo Kỹ thuật số",
    teachingArea: "Thiết kế Giao diện UI/UX",
    motivation: "Hồ sơ chưa đạt đủ điều kiện chứng chỉ giảng dạy sư phạm đại học theo quy chế hệ thống.",
    status: "REJECTED",
    result: "REJECTED",
    applicantId: "00000000-0000-4000-8000-000000000004",
    submittedAt: "2026-09-08T11:20:00Z",
  },
];

export function AdminLecturerApplications() {
  const auth = useSession();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)),
    [shard, setShard] = useState(0),
    [items, setItems] = useState<Application[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [detail, setDetail] = useState<Application | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [toast, setToast] = useState<string | null>(null);

  const keys = useRef<Record<string, string>>({});

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleCopyId = (id: string) => {
    void navigator.clipboard?.writeText(id);
    showToast(`Đã sao chép mã đơn: ${id.slice(0, 8)}…`);
  };

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
    } catch {
      // Fallback from loaded or demo list
      const found = [...items, ...DEMO_APPLICATIONS].find((a) => a.applicationId === id);
      if (found) setDetail(found);
      else setMessage("Không thể tải chi tiết hồ sơ ứng viên.");
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
      const successMsg = "Đã ghi nhận quyết định phê duyệt. Xác minh Giảng viên là thao tác riêng.";
      setMessage(successMsg);
      showToast(successMsg);
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
      showToast("Đã xác minh tư cách Giảng viên thành công!");
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (auth.profile?.role !== "ADMIN") return <p>Chỉ Quản trị viên được xem và duyệt yêu cầu.</p>;

  // Display list: loaded items or demo applications if empty
  const displaySource = items.length > 0 ? items : DEMO_APPLICATIONS;

  const filteredApplications = displaySource.filter((a) => {
    const q = searchTerm.toLowerCase().trim();
    const matchSearch =
      !q ||
      a.displayNameSnapshot.toLowerCase().includes(q) ||
      a.teachingArea.toLowerCase().includes(q) ||
      a.professionalTitle.toLowerCase().includes(q) ||
      a.institution.toLowerCase().includes(q) ||
      a.applicationId.toLowerCase().includes(q);

    if (!matchSearch) return false;
    if (statusFilter === "SUBMITTED") return a.status === "SUBMITTED";
    if (statusFilter === "APPROVED") return a.status === "APPROVED";
    if (statusFilter === "REJECTED") return a.status === "REJECTED";
    return true;
  });

  return (
    <section className="application-admin">
      <p className="eyebrow">QUẢN TRỊ · GIẢNG VIÊN</p>
      <h1>Duyệt yêu cầu giảng dạy & Thẩm định hồ sơ.</h1>
      <p className="lead">
        Thẩm định đơn đăng ký trở thành giảng viên, rà soát học vị, đơn vị công tác và kích hoạt quyền mở lớp.
      </p>

      {/* Query Form by Month and Shard */}
      <form
        className="form-panel"
        style={{ marginBottom: "20px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void queue();
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-end" }}>
          <label style={{ flex: 1, minWidth: "160px" }}>
            Tháng nộp hồ sơ
            <input
              type="month"
              required
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setCursor(null);
              }}
              style={{ width: "100%", marginTop: "6px" }}
            />
          </label>
          <label style={{ width: "140px" }}>
            Phân vùng (Shard)
            <select
              value={shard}
              onChange={(e) => {
                setShard(Number(e.target.value));
                setCursor(null);
              }}
              style={{ width: "100%", marginTop: "6px" }}
            >
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  Phân vùng {i}
                </option>
              ))}
            </select>
          </label>
          <button className="button" disabled={busy} style={{ marginBottom: "2px" }}>
            {busy ? "Đang tải…" : "Tải danh sách chờ"}
          </button>
        </div>
      </form>

      {message && (
        <p role="status" className="notice error">
          {message}
        </p>
      )}

      {/* Toolbar: Search & Status Filter Pills */}
      <div className="admin-table-toolbar">
        <div className="admin-search-input-wrap">
          <span className="admin-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            placeholder="Tìm theo tên ứng viên, chuyên môn, viện/trường..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Tìm kiếm hồ sơ giảng viên"
          />
        </div>

        <div className="dashboard-filter-group" role="group" aria-label="Lọc trạng thái hồ sơ">
          <button
            type="button"
            className={`filter-pill-button ${statusFilter === "ALL" ? "active" : ""}`}
            onClick={() => setStatusFilter("ALL")}
          >
            Tất cả ({displaySource.length})
          </button>
          <button
            type="button"
            className={`filter-pill-button ${statusFilter === "SUBMITTED" ? "active" : ""}`}
            onClick={() => setStatusFilter("SUBMITTED")}
          >
            ⏳ Chờ duyệt
          </button>
          <button
            type="button"
            className={`filter-pill-button ${statusFilter === "APPROVED" ? "active" : ""}`}
            onClick={() => setStatusFilter("APPROVED")}
          >
            ✓ Đã duyệt
          </button>
          <button
            type="button"
            className={`filter-pill-button ${statusFilter === "REJECTED" ? "active" : ""}`}
            onClick={() => setStatusFilter("REJECTED")}
          >
            ✕ Đã từ chối
          </button>
        </div>
      </div>

      {/* DATA TABLE LIST VIEW */}
      <div className="table-responsive">
        <table className="dashboard-data-table" role="table">
          <thead>
            <tr>
              <th scope="col">Ứng viên</th>
              <th scope="col">Chức danh & Học vị</th>
              <th scope="col">Lĩnh vực giảng dạy</th>
              <th scope="col">Đơn vị công tác</th>
              <th scope="col">Trạng thái</th>
              <th scope="col" style={{ textAlign: "right" }}>
                Thao tác
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredApplications.map((a) => {
              const monogram = a.displayNameSnapshot
                ? a.displayNameSnapshot
                    .split(" ")
                    .slice(-2)
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()
                : "GV";
              return (
                <tr key={a.applicationId}>
                  <td>
                    <div className="user-avatar-cell">
                      <div className="user-monogram lecturer">{monogram}</div>
                      <div>
                        <div className="user-name-title">{a.displayNameSnapshot}</div>
                        <div className="user-id-code">
                          <span>Mã đơn: {a.applicationId.slice(0, 8)}…</span>
                          <button
                            type="button"
                            className="copy-id-btn"
                            title="Sao chép toàn bộ mã đơn"
                            onClick={() => handleCopyId(a.applicationId)}
                          >
                            📋
                          </button>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong>{a.professionalTitle}</strong>
                  </td>
                  <td>
                    <span className="course-category-tag">{a.teachingArea}</span>
                  </td>
                  <td>
                    <span className="muted" style={{ fontSize: "13px" }}>
                      {a.institution}
                    </span>
                  </td>
                  <td>
                    {a.status === "SUBMITTED" ? (
                      <span className="admin-badge pending">⏳ Chờ duyệt</span>
                    ) : a.status === "REJECTED" ? (
                      <span className="admin-badge rejected">✕ Từ chối</span>
                    ) : a.result === "APPROVED_VERIFIED" ? (
                      <span className="admin-badge verified">🛡️ Đã xác minh</span>
                    ) : (
                      <span className="admin-badge approved">✓ Đã duyệt</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      type="button"
                      className="button button-small"
                      disabled={busy}
                      onClick={() => void open(a.applicationId)}
                    >
                      Thẩm định hồ sơ →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredApplications.length === 0 && (
        <div className="study-state" style={{ marginTop: "20px" }}>
          Không tìm thấy hồ sơ giảng viên nào phù hợp với bộ lọc hiện tại.
        </div>
      )}

      {cursor && (
        <div style={{ marginTop: "18px" }}>
          <button className="button secondary" disabled={busy} onClick={() => void queue(cursor)}>
            Trang tiếp theo →
          </button>
        </div>
      )}

      {/* APPRAISAL MODAL / DRAWER */}
      {detail && (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="appraisal-title"
        >
          <div className="admin-modal-card large">
            <div className="admin-modal-header">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                  <span className="course-category-tag">{detail.teachingArea}</span>
                  <span
                    className={`admin-badge ${detail.status === "SUBMITTED" ? "pending" : detail.status === "APPROVED" ? "approved" : "rejected"}`}
                  >
                    {detail.status === "SUBMITTED"
                      ? "HỒ SƠ CHỜ DUYỆT"
                      : detail.status === "REJECTED"
                        ? "HỒ SƠ BỊ TỪ CHỐI"
                        : detail.result === "APPROVED_VERIFIED"
                          ? "ĐÃ DUYỆT & ĐÃ XÁC MINH"
                          : "ĐÃ DUYỆT (CHƯA XÁC MINH)"}
                  </span>
                </div>
                <h2 id="appraisal-title">{detail.displayNameSnapshot}</h2>
                <div className="user-id-code" style={{ marginTop: "4px" }}>
                  <span>ID Hồ sơ: {detail.applicationId}</span>
                  {detail.applicantId && <span> · ID Tài khoản: {detail.applicantId}</span>}
                </div>
              </div>

              <button
                type="button"
                className="admin-modal-close-btn"
                onClick={() => setDetail(null)}
                aria-label="Đóng cửa sổ thẩm định"
              >
                ✕
              </button>
            </div>

            {/* Profile Info Summary Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "14px",
                marginBottom: "22px",
              }}
            >
              <div
                style={{
                  padding: "14px",
                  background: "var(--surface-soft, rgba(0,0,0,0.03))",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>Chức danh chuyên môn</div>
                <div style={{ fontWeight: 700, fontSize: "14.5px", marginTop: "4px", color: "var(--ink)" }}>
                  {detail.professionalTitle}
                </div>
              </div>
              <div
                style={{
                  padding: "14px",
                  background: "var(--surface-soft, rgba(0,0,0,0.03))",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>Đơn vị công tác / Viện đào tạo</div>
                <div style={{ fontWeight: 700, fontSize: "14.5px", marginTop: "4px", color: "var(--ink)" }}>
                  {detail.institution}
                </div>
              </div>
              <div
                style={{
                  padding: "14px",
                  background: "var(--surface-soft, rgba(0,0,0,0.03))",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)" }}>Lĩnh vực đăng ký giảng dạy</div>
                <div style={{ fontWeight: 700, fontSize: "14.5px", marginTop: "4px", color: "var(--ink)" }}>
                  {detail.teachingArea}
                </div>
              </div>
            </div>

            {/* Motivation / Teaching Proposal */}
            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "15px", marginBottom: "8px" }}>Mong muốn & Kế hoạch giảng dạy</h3>
              <div
                style={{
                  padding: "16px",
                  background: "var(--surface-soft, rgba(0,0,0,0.02))",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                  lineHeight: "1.6",
                  fontSize: "13.5px",
                  color: "var(--ink)",
                }}
              >
                {detail.motivation}
              </div>
            </div>

            {/* Decision Forms */}
            {detail.status === "SUBMITTED" ? (
              <div
                style={{
                  padding: "20px",
                  background: "var(--surface-soft, rgba(0,0,0,0.03))",
                  borderRadius: "14px",
                  border: "1px solid var(--line)",
                }}
              >
                <h3 style={{ fontSize: "16px", margin: "0 0 8px" }}>Phê duyệt hoặc Từ chối hồ sơ</h3>
                <p style={{ fontSize: "13px", color: "var(--muted)", margin: "0 0 16px" }}>
                  <strong>Duyệt</strong>: Nâng cấp tài khoản Sinh viên lên Giảng viên; xác minh là bước riêng
                  biệt tiếp theo.
                  <strong>Từ chối</strong>: Giữ nguyên trạng thái tài khoản sinh viên.
                </p>

                <form onSubmit={decide}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "16px",
                      marginBottom: "16px",
                    }}
                  >
                    <label>
                      Quyết định thẩm định
                      <select name="decision" style={{ width: "100%", marginTop: "6px" }}>
                        <option value="APPROVE">Phê duyệt làm Giảng viên (APPROVE)</option>
                        <option value="REJECT">Từ chối hồ sơ này (REJECT)</option>
                      </select>
                    </label>

                    <label>
                      Mật khẩu quản trị viên hiện tại
                      <input
                        type="password"
                        name="currentPassword"
                        autoComplete="current-password"
                        required
                        maxLength={128}
                        placeholder="Nhập mật khẩu admin..."
                        style={{ width: "100%", marginTop: "6px" }}
                      />
                    </label>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setDetail(null)}
                    >
                      Đóng
                    </button>
                    <button className="button" disabled={busy}>
                      {busy ? "Đang xử lý…" : "Xác nhận quyết định"}
                    </button>
                  </div>
                </form>
              </div>
            ) : detail.status === "APPROVED" && detail.result !== "APPROVED_VERIFIED" ? (
              <div
                style={{
                  padding: "20px",
                  background: "var(--surface-soft, rgba(0,0,0,0.03))",
                  borderRadius: "14px",
                  border: "1px solid var(--line)",
                }}
              >
                <h3 style={{ fontSize: "16px", margin: "0 0 8px" }}>
                  Xác minh Giảng viên chính thức (Bước riêng biệt)
                </h3>
                <p style={{ fontSize: "13px", color: "var(--muted)", margin: "0 0 16px" }}>
                  Sau khi xác minh, giảng viên sẽ được cấp huy hiệu tin cậy và quyền xuất bản các khóa học có
                  thu phí.
                </p>

                <form onSubmit={verify}>
                  <div style={{ marginBottom: "16px" }}>
                    <label>
                      Mật khẩu quản trị viên hiện tại
                      <input
                        type="password"
                        name="currentPassword"
                        required
                        autoComplete="current-password"
                        maxLength={128}
                        placeholder="Nhập mật khẩu admin để xác minh..."
                        style={{ width: "100%", maxWidth: "380px", marginTop: "6px" }}
                      />
                    </label>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setDetail(null)}
                    >
                      Đóng
                    </button>
                    <button className="button" disabled={busy}>
                      {busy ? "Đang xử lý…" : "Xác minh Giảng viên"}
                    </button>
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Toast Notice */}
      {toast && (
        <div className="admin-toast-notice" role="status">
          <span>✓</span>
          <span>{toast}</span>
        </div>
      )}
    </section>
  );
}
