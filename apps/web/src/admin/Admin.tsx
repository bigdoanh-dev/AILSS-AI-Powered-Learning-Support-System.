import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, Outlet, useParams, useSearchParams } from "react-router-dom";
import { sessionRequest, useSession } from "../auth/session";
import { adminError, adminRequest } from "./api";

type Role = "STUDENT" | "LECTURER" | "ADMIN";
type Status = "ACTIVE" | "SUSPENDED";
type User = {
  userId: string;
  displayName: string;
  emailMasked?: string;
  role: Role;
  status: Status;
  lecturerVerified: boolean;
  profileVersion: number;
  createdAt?: string;
  updatedAt: string;
};

export function AdminGuard() {
  const { state, profile } = useSession();
  if (state !== "AUTHENTICATED" && state !== "REFRESHING") return <p role="status">Đang xác minh phiên…</p>;
  return profile?.role === "ADMIN" ? <Outlet /> : <Navigate to="/app" replace />;
}

export function AdminHome() {
  const { profile } = useSession();
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <h1>Chào {profile?.displayName}, cùng quản lý AILSS.</h1>
          <p>Quản lý thành viên, xác minh giảng viên và chăm sóc cộng đồng học tập.</p>
        </div>
        <Link className="button" to="/app/admin/users?role=LECTURER">
          Xác minh giảng viên
        </Link>
      </div>
      <div className="admin-overview">
        <section className="admin-welcome">
          <span className="admin-symbol" aria-hidden="true">
            ▦
          </span>
          <h2>Một không gian học tập được chăm sóc.</h2>
          <p>Bắt đầu từ hồ sơ giảng viên mới, nội dung cần duyệt hoặc một yêu cầu từ người học.</p>
          <Link to="/app/admin/moderation">Xem nội dung cần kiểm duyệt</Link>
        </section>
        <div className="workspace-cards">
          <Card title="Thành viên" to="/app/admin/users">
            Tra cứu học viên và giảng viên; quản lý trạng thái tài khoản.
          </Card>
          <Card title="Giảng viên mới" to="/app/admin/users?role=LECTURER">
            Xác minh tài khoản giảng viên đăng ký trực tiếp.
          </Card>
          <Card title="Khóa học" to="/app/admin/courses">
            Duyệt xuất bản và quản lý nội dung khóa học.
          </Card>
          <Card title="Hồ sơ chuyển vai trò" to="/app/admin/lecturer-applications">
            Xử lý yêu cầu trở thành giảng viên từ tài khoản học viên hiện có.
          </Card>
        </div>
      </div>
    </>
  );
}
function Card({ title, to, children }: { title: string; to: string; children: ReactNode }) {
  return (
    <article>
      <h2>{title}</h2>
      <p>{children}</p>
      <Link to={to}>Xem chi tiết</Link>
    </article>
  );
}

export function Users() {
  const [params, setParams] = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "LECTURER" ? "LECTURER" : "STUDENT"),
    [status, setStatus] = useState<Status>("ACTIVE");
  const [cursor, setCursor] = useState(""),
    [items, setItems] = useState<User[]>([]),
    [next, setNext] = useState<string | null>(null);
  const [pending, setPending] = useState(true),
    [message, setMessage] = useState("");
  async function load() {
    setPending(true);
    setMessage("");
    try {
      const q = new URLSearchParams({ role, status, limit: "25", ...(cursor ? { cursor } : {}) });
      const r = await adminRequest<User[]>("/users?" + q);
      setItems(r.data);
      setNext(r.meta?.pagination?.nextCursor || null);
    } catch (e) {
      setMessage(adminError(e));
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    void load();
  }, [role, status, cursor]);
  return (
    <>
      <p className="eyebrow">ADMIN · DANH TÍNH</p>
      <h1>Tra cứu người dùng.</h1>
      <p className="lead">Hợp đồng tìm kiếm yêu cầu chọn chính xác vai trò và trạng thái.</p>
      <div className="admin-filters">
        <label>
          Vai trò
          <select
            value={role}
            onChange={(e) => {
              setCursor("");
              setRole(e.target.value as Role);
              setParams({ role: e.target.value });
            }}
          >
            <option value="STUDENT">Sinh viên</option>
            <option value="LECTURER">Giảng viên</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <label>
          Trạng thái
          <select
            value={status}
            onChange={(e) => {
              setCursor("");
              setStatus(e.target.value as Status);
            }}
          >
            <option value="ACTIVE">Đang hoạt động</option>
            <option value="SUSPENDED">Tạm khóa</option>
          </select>
        </label>
      </div>
      {pending ? (
        <p role="status">Đang tải người dùng…</p>
      ) : message ? (
        <div className="study-state" role="alert">
          <p>{message}</p>
          <button className="button secondary" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      ) : items.length ? (
        <div className="admin-list">
          {items.map((u) => (
            <article key={u.userId}>
              <span className="badge">
                {u.role} · {u.status}
              </span>
              <h2>{u.displayName}</h2>
              <p>{u.userId}</p>
              <Link to={"/app/admin/users/" + u.userId}>Xem chi tiết →</Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="study-state">Không có người dùng phù hợp.</div>
      )}
      <div className="inline-actions">
        {next && (
          <button className="button secondary" onClick={() => setCursor(next)}>
            Trang tiếp theo →
          </button>
        )}
        <button
          className="plain-button"
          onClick={() => {
            setCursor("");
            void load();
          }}
        >
          Tải lại trang đầu
        </button>
      </div>
    </>
  );
}

export function UserDetail() {
  const { userId = "" } = useParams();
  const [user, setUser] = useState<User | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setMessage("");
    try {
      setUser((await adminRequest<User>("/users/" + userId)).data);
    } catch (e) {
      setMessage(adminError(e));
    }
  }
  useEffect(() => {
    void load();
  }, [userId]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setMessage("");
    const data = new FormData(form);
    try {
      await adminRequest(`/users/${userId}/status`, "PATCH", {
        status: data.get("status"),
        currentPassword: String(data.get("currentPassword")),
        ...(String(data.get("reason")).trim() ? { reason: String(data.get("reason")).trim() } : {}),
      });
      form.reset();
      setMessage("Đã đổi trạng thái người dùng.");
      await load();
    } catch (error) {
      setMessage(adminError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link to="/app/admin/users">← Danh sách người dùng</Link>
      <p className="eyebrow">CHI TIẾT THÀNH VIÊN</p>
      <h1>{user?.displayName || "Đang tải người dùng…"}</h1>
      {message && <p role="status">{message}</p>}
      {user && (
        <div className="account-grid">
          <section className="study-card">
            <h2>Thông tin tài khoản</h2>
            <dl className="profile-facts">
              <dt>Email</dt>
              <dd>{user.emailMasked}</dd>
              <dt>Vai trò</dt>
              <dd>{{ STUDENT: "Học viên", LECTURER: "Giảng viên", ADMIN: "Quản trị viên" }[user.role]}</dd>
              <dt>Trạng thái</dt>
              <dd>{user.status === "ACTIVE" ? "Đang hoạt động" : "Tạm khóa"}</dd>
              <dt>Xác minh GV</dt>
              <dd>{user.lecturerVerified ? "Đã xác minh" : "Chưa xác minh"}</dd>
              <dt>Phiên bản</dt>
              <dd>{user.profileVersion}</dd>
              <dt>Mã thành viên</dt>
              <dd>{user.userId}</dd>
            </dl>
          </section>
          {user.role === "LECTURER" && !user.lecturerVerified && (
            <form
              className="form-panel"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                setBusy(true);
                setMessage("");
                try {
                  await sessionRequest(
                    `admin/lecturers/${userId}/verify`,
                    "POST",
                    { currentPassword: String(new FormData(form).get("currentPassword")) },
                    crypto.randomUUID(),
                  );
                  form.reset();
                  await load();
                  setMessage("Đã xác minh giảng viên. Tài khoản có thể bắt đầu giảng dạy.");
                } catch (error) {
                  setMessage(adminError(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h2>Xác minh giảng viên</h2>
              <p>Kiểm tra thông tin trước khi mở quyền tạo khóa học và lớp học.</p>
              <label>
                Mật khẩu quản trị viên
                <input
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                />
              </label>
              <button className="button" disabled={busy}>
                {busy ? "Đang xác minh…" : "Xác minh giảng viên"}
              </button>
            </form>
          )}
          <form className="form-panel" onSubmit={(e) => void submit(e)}>
            <h2>Đổi trạng thái tài khoản</h2>
            <label>
              Trạng thái mới
              <select name="status" defaultValue={user.status}>
                <option value="ACTIVE">Đang hoạt động</option>
                <option value="SUSPENDED">Tạm khóa</option>
              </select>
            </label>
            <label>
              Lý do (không bắt buộc)
              <input name="reason" maxLength={200} />
            </label>
            <label>
              Mật khẩu quản trị viên hiện tại
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <p className="muted">Hệ thống xác minh lại mật khẩu riêng cho thao tác này.</p>
            <button className="button" disabled={busy}>
              {busy ? "Đang xử lý…" : "Xác nhận đổi trạng thái"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export function CourseGovernance() {
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const form = e.currentTarget,
      data = new FormData(form),
      courseId = String(data.get("courseId")),
      action = String(data.get("action"));
    try {
      const r = await adminRequest<{ state?: string }>(`/courses/${courseId}/${action}`, "POST", {
        currentPassword: String(data.get("currentPassword")),
      });
      setMessage(
        `${action === "publish" ? "Đã xuất bản" : "Đã gửi yêu cầu lưu trữ"} khóa học${r.data.state ? ` · ${r.data.state}` : ""}.`,
      );
      form.querySelector<HTMLInputElement>('[name="currentPassword"]')!.value = "";
    } catch (e) {
      setMessage(adminError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">QUẢN LÝ KHÓA HỌC</p>
      <h1>Quản lý xuất bản khóa học.</h1>
      <p className="lead">Nhập mã khóa học do giảng viên gửi để xuất bản hoặc lưu trữ khóa học.</p>
      <form className="form-panel admin-action" onSubmit={(e) => void submit(e)}>
        <label>
          Mã khóa học
          <input
            name="courseId"
            type="text"
            pattern="[0-9a-fA-F-]{36}"
            required
            placeholder="00000000-0000-4000-8000-000000000000"
          />
        </label>
        <label>
          Thao tác
          <select name="action">
            <option value="publish">Phê duyệt và xuất bản</option>
            <option value="archive">Lưu trữ khóa học</option>
          </select>
        </label>
        <label>
          Mật khẩu quản trị viên hiện tại
          <input name="currentPassword" type="password" autoComplete="current-password" required />
        </label>
        <button className="button" disabled={busy}>
          {busy ? "Đang xử lý…" : "Xác nhận thao tác"}
        </button>
        <p role="status">{message}</p>
      </form>
    </>
  );
}
