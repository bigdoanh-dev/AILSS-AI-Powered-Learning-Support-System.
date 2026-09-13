import { safeReturnTo, sessionRequest, useSession } from "../auth/session";
import { useNavigate } from "react-router-dom";
import { useRef, useState, type FormEvent } from "react";
import { useLocation, Link } from "react-router-dom";
import { PageHero, Section, TextLink, Dialog, Picture } from "../components/ui";
import { Faq } from "../components/Faq";
import { VideoStory } from "../components/VideoStory";
import { errorMessage } from "../lib/api";
export function FaqPage() {
  return (
    <>
      <PageHero
        label="FAQ"
        title="Câu hỏi của bạn. Câu trả lời rõ ràng."
        description="Tìm hiểu tài khoản, khóa học, lớp học, đánh giá, AI và cách dữ liệu được bảo vệ."
      />
      <Section>
        <Faq />
      </Section>
    </>
  );
}
export function Help() {
  const topics = [
    [
      "Bắt đầu",
      "Khám phá trang Courses, tìm theo một tiền tố trong tên khóa học, rồi xem thông tin công khai.",
      "/courses",
    ],
    [
      "Tài khoản",
      "Đăng ký với email và mật khẩu từ 12–128 ký tự. Chọn tài khoản học viên hoặc giảng viên khi đăng ký.",
      "/auth/register",
    ],
    [
      "Khóa học",
      "Chỉ khóa học đã xuất bản xuất hiện công khai. Nếu không có kết quả, thử từ khóa ngắn hơn có ít nhất 3 ký tự.",
      "/courses",
    ],
    [
      "Lớp học",
      "Kiểm tra mã tham gia và điều kiện truy cập với người tổ chức lớp. Lịch và điểm danh thuộc không gian ứng dụng.",
      "/classroom",
    ],
    [
      "Đánh giá",
      "Kiểm tra quyền làm bài và tình trạng lượt làm trước khi nộp; xem kết quả sau khi hệ thống xử lý.",
      "/assessment",
    ],
    [
      "Trợ lý giảng dạy AI",
      "Tải tài liệu bạn có quyền sử dụng. Kiểm tra nội dung và đáp án bản nháp trước khi phê duyệt.",
      "/ai-learning",
    ],
    [
      "Khắc phục sự cố",
      "Khi dịch vụ tạm thời gián đoạn, kiểm tra kết nối và thử lại. Không gửi mật khẩu hoặc tài liệu riêng tư để mô tả lỗi.",
      "/contact",
    ],
  ];
  return (
    <>
      <PageHero
        label="Trợ giúp"
        title="Tìm đúng bước tiếp theo."
        description="Hướng dẫn ngắn gọn giúp bạn bắt đầu và hiểu các hành trình trong AILSS."
      />
      <Section>
        <div className="help-grid">
          {topics.map(([title, body, to]) => (
            <article key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
              <TextLink to={to}>Xem hướng dẫn liên quan</TextLink>
            </article>
          ))}
        </div>
      </Section>
      <Section className="soft">
        <h2>Vẫn chưa tìm được câu trả lời?</h2>
        <TextLink to="/faq">Tìm trong câu hỏi thường gặp</TextLink>
      </Section>
    </>
  );
}
export function Contact() {
  const [status, setStatus] = useState("");
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const blob = new Blob(
      [
        `AILSS — bản nháp liên hệ\nTên: ${data.get("name")}\nEmail: ${data.get("email")}\nChủ đề: ${data.get("topic")}\n\n${data.get("message")}\n`,
      ],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ailss-contact-draft.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Đã tạo bản nháp để tải xuống. Nội dung chưa được gửi đến AILSS.");
  }
  return (
    <>
      <PageHero
        label="CONTACT"
        title="Bắt đầu một cuộc trao đổi có ý nghĩa."
        description="Trao đổi về sản phẩm, việc học hoặc nghiên cứu hệ thống phân tán. Chuẩn bị nội dung để gửi qua kênh chính thức của đơn vị triển khai."
      />
      <Section>
        <div className="contact-grid">
          <div>
            <p className="eyebrow">CHÚNG TÔI CÓ THỂ CÙNG TÌM HIỂU</p>
            <h2>
              Một câu hỏi.
              <br />
              Nhiều khả năng.
            </h2>
            <div className="contact-option">
              <h3>Hỗ trợ sử dụng</h3>
              <p>Tài khoản, khóa học, lớp học và đánh giá.</p>
              <TextLink to="/help">Mở trung tâm trợ giúp</TextLink>
            </div>
            <div className="contact-option">
              <h3>Dự án & nghiên cứu</h3>
              <p>Cassandra, kiến trúc dịch vụ và AI có giảng viên duyệt.</p>
              <TextLink to="/research">Tìm hiểu hướng nghiên cứu</TextLink>
            </div>
            <div className="notice">
              <strong>Trạng thái kênh liên hệ</strong>
              <p>
                Chưa có kênh nhận biểu mẫu được cấu hình. Bản nháp chỉ được tải về thiết bị của bạn; chúng tôi
                chưa nhận được nội dung và chưa thể hẹn thời gian phản hồi.
              </p>
            </div>
          </div>
          <form className="form-panel" onSubmit={save}>
            <h2>Chuẩn bị lời nhắn</h2>
            <p>Không nhập mật khẩu hoặc dữ liệu học tập riêng tư.</p>
            <label>
              Họ và tên
              <input name="name" autoComplete="name" required maxLength={100} />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required maxLength={254} />
            </label>
            <label>
              Chủ đề
              <select name="topic">
                <option>Hỗ trợ sử dụng</option>
                <option>Dự án & hợp tác</option>
                <option>Nghiên cứu</option>
                <option>Phản hồi sản phẩm</option>
              </select>
            </label>
            <label>
              Nội dung
              <textarea name="message" required minLength={10} maxLength={4000} rows={6} />
            </label>
            <button className="button" type="submit">
              Tải bản nháp liên hệ
            </button>
            <p className="form-status" role="status">
              {status || "Biểu mẫu này chưa gửi dữ liệu lên máy chủ."}
            </p>
          </form>
        </div>
      </Section>
    </>
  );
}
export function Auth() {
  const location = useLocation();
  const path = location.pathname;
  const navigate = useNavigate();
  const auth = useSession();
  const register = path.endsWith("register/student") || path.endsWith("register/lecturer");
  const choose = path.endsWith("/register");
  const lecturer = path.endsWith("register/lecturer");
  const forgot = path.endsWith("forgot-password");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const session = auth.profile;
  const [show, setShow] = useState(false);
  const key = useRef<string | null>(null);
  const fingerprint = useRef("");
  const title = forgot
    ? "Tìm lại lối vào việc học."
    : register
      ? lecturer
        ? "Mang tri thức của bạn đến gần người học."
        : "Hành trình mới bắt đầu ở đây."
      : "Chào mừng bạn trở lại.";
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setStatus("");
    try {
      if (register) {
        const body = {
          email: String(data.get("email")).trim().toLowerCase(),
          password: data.get("password"),
          displayName: String(data.get("displayName")).trim(),
          ...(lecturer ? { role: "LECTURER" } : {}),
        };
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body))),
          ),
        ).join(",");
        if (fingerprint.current !== digest) {
          key.current = crypto.randomUUID();
          fingerprint.current = digest;
        }
        key.current ??= crypto.randomUUID();
        await sessionRequest("register", "POST", body, key.current);
        key.current = null;
        form.reset();
        navigate("/auth/result", {
          replace: true,
          state: {
            success: true,
            title: "Đăng ký thành công",
            message: lecturer
              ? "Tài khoản giảng viên đã được tạo. Đăng nhập để hoàn thiện hồ sơ."
              : "Tài khoản học viên đã được tạo. Bạn có thể đăng nhập.",
            to: lecturer ? "/auth/login?returnTo=%2Fauth%2Fregister%2Flecturer" : "/auth/login",
            label: "Đăng nhập",
          },
        });
      } else {
        await auth.login({
          email: String(data.get("email")).trim().toLowerCase(),
          password: data.get("password"),
        });
        navigate("/auth/result", {
          replace: true,
          state: {
            success: true,
            title: "Đăng nhập thành công",
            message: "Tài khoản đã sẵn sàng. Bạn có thể tiếp tục công việc của mình.",
            to: safeReturnTo(new URLSearchParams(location.search).get("returnTo")),
            label: "Tiếp tục",
          },
        });
        form.reset();
      }
    } catch (error) {
      if (register)
        navigate("/auth/result", {
          state: {
            success: false,
            title: "Đăng ký chưa thành công",
            message: errorMessage(error),
            to: location.pathname + location.search,
            label: "Quay lại đăng ký",
          },
        });
      else
        navigate("/auth/result", {
          state: {
            success: false,
            title: "Đăng nhập chưa thành công",
            message: errorMessage(error),
            to: location.pathname + location.search,
            label: "Quay lại đăng nhập",
          },
        });
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (!session) return;
    setBusy(true);
    try {
      await auth.logout();
      navigate("/auth/result", {
        replace: true,
        state: {
          success: true,
          title: "Đăng xuất thành công",
          message: "Phiên đăng nhập đã kết thúc.",
          to: "/auth/login",
          label: "Đăng nhập lại",
        },
      });
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const isRegister = register || choose;
  const isLogin = !isRegister && !forgot;

  return (
    <section className="focused-auth">
      <div
        className={`auth-motion-panel ${
          forgot
            ? "auth-slide-bottom auth-slide-up"
            : isRegister
              ? "auth-slide-right"
              : "auth-slide-left"
        }`}
      >
        <p className="eyebrow">
          {choose
            ? "BƯỚC TIẾP THEO CỦA BẠN"
            : register
              ? lecturer
                ? "TÀI KHOẢN GIẢNG VIÊN"
                : "TÀI KHOẢN HỌC VIÊN"
              : forgot
                ? "HỖ TRỢ TRUY CẬP AN TOÀN"
                : lecturer
                  ? "DÀNH CHO GIẢNG VIÊN"
                  : "CHÀO MỪNG ĐẾN AILSS"}
        </p>
        <h1>
          {choose ? "Bạn muốn bắt đầu thế nào?" : lecturer ? "Mang tri thức của bạn đến gần người học." : title}
        </h1>
        <div className="auth-panel">
          {choose ? (
            <div className="auth-card-motion auth-form-card">
              <p className="auth-role-header">Tôi muốn tham gia AILSS với vai trò…</p>
              <div className="auth-choices">
                <Link to="/auth/register/student" className="choice-card">
                  <span className="choice-icon">01</span>
                  <div>
                    <div className="choice-title-row">
                      <span className="role-emoji" aria-hidden="true">🎓</span>
                      <h2>Học viên</h2>
                    </div>
                    <p>Tham gia khóa học, làm bài kiểm tra và nhìn thấy từng bước tiến bộ.</p>
                    <span className="choice-action-btn">Đăng ký học viên →</span>
                  </div>
                  <span aria-hidden="true" className="choice-arrow">↗</span>
                </Link>
                <Link to="/auth/register/lecturer" className="choice-card">
                  <span className="choice-icon">02</span>
                  <div>
                    <div className="choice-title-row">
                      <span className="role-emoji" aria-hidden="true">👨‍🏫</span>
                      <h2>Giảng viên</h2>
                    </div>
                    <p>Tổ chức lớp học, tạo khóa học và chuẩn bị bản nháp câu hỏi cùng AI.</p>
                    <span className="choice-action-btn">Đăng ký giảng viên →</span>
                  </div>
                  <span aria-hidden="true" className="choice-arrow">↗</span>
                </Link>
              </div>
              <p className="auth-switch-prompt">
                Đã có tài khoản? <Link to="/auth/login">Đăng nhập ngay</Link>
              </p>
            </div>
          ) : forgot ? (
            <div className="forgot-password-card auth-form-card">
              <div className="forgot-header-badge">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Xác thực &amp; Bảo mật</span>
              </div>
              <h2>Quên mật khẩu?</h2>
              <div className="forgot-notice-box">
                <p>
                  Phiên bản hiện tại chưa hỗ trợ gửi email đặt lại mật khẩu trực tuyến để đảm bảo an toàn tài khoản
                  học thuật và chính sách xác minh danh tính tập trung. Không có yêu cầu khôi phục nào được gửi từ trang này.
                </p>
              </div>
              <div className="forgot-steps-list">
                <div className="forgot-step-item">
                  <span className="step-badge">1</span>
                  <div>
                    <strong>Kiểm tra lại email</strong>
                    <p>Hãy đảm bảo bạn đang dùng đúng email đã dùng khi đăng ký (email cơ quan hoặc sinh viên).</p>
                  </div>
                </div>
                <div className="forgot-step-item">
                  <span className="step-badge">2</span>
                  <div>
                    <strong>Thử lại với mật khẩu cũ</strong>
                    <p>Nếu còn nhớ mật khẩu, hãy thử đăng nhập lại hoặc kiểm tra trình quản lý mật khẩu của thiết bị.</p>
                  </div>
                </div>
                <div className="forgot-step-item">
                  <span className="step-badge">3</span>
                  <div>
                    <strong>Liên hệ Quản trị viên</strong>
                    <p>
                      Nếu không thể đăng nhập, liên hệ người quản trị của đơn vị triển khai qua kênh bạn đã được
                      cung cấp để được cấp mã truy cập mới.
                    </p>
                  </div>
                </div>
              </div>
              <div className="forgot-support-contacts">
                <p>
                  <strong>Hỗ trợ kỹ thuật:</strong> support@ailss.edu.vn · Hotline: 1900-6888 (08:00 - 18:00)
                </p>
              </div>
              <div className="forgot-card-actions">
                <Link to="/auth/login" className="button auth-submit-btn">
                  Quay lại đăng nhập
                </Link>
                <TextLink to="/help">Trợ giúp tài khoản</TextLink>
              </div>
            </div>
          ) : session ? (
            <div className="auth-card-motion auth-form-card">
              <span className="eyebrow">ĐÃ XÁC THỰC</span>
              <h2>Xin chào, {session.displayName}.</h2>
              <p>Phiên của bạn đã được xác thực. Mở không gian cá nhân để xem hồ sơ tài khoản.</p>
              <TextLink to="/app">Mở không gian cá nhân</TextLink>
              <button className="button" disabled={busy} onClick={() => void logout()}>
                Đăng xuất
              </button>
              <p role="status">{status}</p>
            </div>
          ) : (
            <form aria-busy={busy} onSubmit={(e) => void submit(e)} className="auth-card-motion auth-form-card">
              <h2 className="sr-only">{register ? "Tạo tài khoản" : "Đăng nhập"}</h2>

              {register && (
                <div className="auth-role-subswitcher" role="tablist" aria-label="Đối tượng đăng ký">
                  <Link
                    to="/auth/register/student"
                    className={`role-subpill ${!lecturer ? "active" : ""}`}
                    role="tab"
                    aria-selected={!lecturer}
                  >
                    <span aria-hidden="true">🎓</span>
                    <span>Học viên</span>
                  </Link>
                  <Link
                    to="/auth/register/lecturer"
                    className={`role-subpill ${lecturer ? "active" : ""}`}
                    role="tab"
                    aria-selected={lecturer}
                  >
                    <span aria-hidden="true">👨‍🏫</span>
                    <span>Giảng viên</span>
                  </Link>
                </div>
              )}

              <p className="auth-form-subtext">
                {register
                  ? lecturer
                    ? "Đăng ký trực tiếp tài khoản giảng viên. Quyền giảng dạy sẽ mở sau khi quản trị viên xác minh."
                    : "Tạo tài khoản để bắt đầu học."
                  : "Tiếp tục với tài khoản AILSS của bạn."}
              </p>
              {register && (
                <label className="auth-field-label">
                  <span className="label-text">
                    <span className="label-icon" aria-hidden="true">👤</span> Họ và tên
                  </span>
                  <input
                    aria-label="Họ và tên"
                    name="displayName"
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={100}
                    className="auth-text-input"
                    placeholder={lecturer ? "VD: TS. Nguyễn Văn A" : "VD: Trần Hoàng Nam"}
                  />
                </label>
              )}
              <label className="auth-field-label">
                <span className="label-text">
                  <span className="label-icon" aria-hidden="true">✉️</span> Email
                </span>
                <input
                  aria-label="Email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  className="auth-text-input"
                  placeholder="name@domain.edu.vn"
                />
              </label>
              <label className="auth-field-label">
                <span className="label-text">
                  <span className="label-icon" aria-hidden="true">🔒</span> Mật khẩu
                </span>
                <div className="password-field">
                  <input
                    id="auth-password"
                    aria-label="Mật khẩu"
                    name="password"
                    type={show ? "text" : "password"}
                    autoComplete={register ? "new-password" : "current-password"}
                    required
                    minLength={register ? 12 : 1}
                    maxLength={128}
                    className="auth-text-input"
                    placeholder={register ? "Tối thiểu 12 ký tự" : "••••••••••••"}
                    aria-describedby={register ? "password-help" : undefined}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShow(!show)}
                    aria-pressed={show}
                    aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  >
                    {show ? "Ẩn" : "Hiện"}
                  </button>
                </div>
              </label>
              {register ? (
                <>
                  <div id="password-help" className="password-req-badge">
                    <span aria-hidden="true">🛡️</span> Dùng 12–128 ký tự. Không chia sẻ mật khẩu.
                  </div>
                  <label className="checkbox auth-terms-checkbox">
                    <input type="checkbox" required />
                    <span>
                      Tôi đã đọc <Link to="/legal/terms">điều khoản</Link> và{" "}
                      <Link to="/legal/privacy">quyền riêng tư</Link>.
                    </span>
                  </label>
                </>
              ) : (
                <div className="auth-forgot-row">
                  <Link className="forgot-link" to="/auth/forgot-password">
                    Quên mật khẩu?
                  </Link>
                </div>
              )}
              <button className="button auth-submit-btn" disabled={busy} type="submit">
                {busy ? "Đang xử lý…" : register ? "Tạo tài khoản" : "Đăng nhập"}
              </button>
              <p className="form-status" role="status">
                {status || auth.message}
              </p>
              <p className="auth-switch-prompt">
                {register ? "Đã có tài khoản?" : "Chưa có tài khoản?"}{" "}
                <Link to={register ? "/auth/login" : "/auth/register"}>
                  {register ? "Đăng nhập ngay" : "Đăng ký ngay"}
                </Link>
              </p>
              <small className="auth-secure-note">
                <span aria-hidden="true">🔒</span> Thông tin đăng nhập được mã hóa đầu cuối và bảo vệ an toàn.
              </small>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
export function Media() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <PageHero
        label="MEDIA / GALLERY"
        title="Nhìn gần hơn vào thế giới AILSS."
        description="Hình ảnh minh họa gốc, nhận diện NVD và câu chuyện sản phẩm. Các hình ảnh không đại diện cho khách hàng hoặc lớp học thực tế."
      />
      <Section>
        <div className="media-grid">
          {[
            ["students", "Học tập cùng nhau"],
            ["knowledge", "Vũ trụ tri thức"],
          ].map(([name, title]) => (
            <button className="gallery-item" key={name} onClick={() => setSelected(name)}>
              <Picture name={name} alt={title + " — ảnh minh họa tạo bằng AI"} />
              <span>
                {title}
                <small>Mở ảnh · Minh họa tạo bằng AI</small>
              </span>
            </button>
          ))}
          <button className="gallery-item brand-gallery" onClick={() => setSelected("brand")}>
            <img
              src="/assets/brand/nvd-horizontal.svg"
              width="620"
              height="180"
              alt="NVD / AILSS nhận diện nguyên bản"
            />
            <span>
              Một biểu tượng, ba ý tưởng<small>SVG gốc · NVD</small>
            </span>
          </button>
          <div className="gallery-copy">
            <h2>Thiết kế để giải thích.</h2>
            <p>Tài liệu, câu hỏi, tiến độ và kiến trúc được thể hiện bằng những hình ảnh có mục đích.</p>
            <TextLink to="/architecture">Tương tác với kiến trúc</TextLink>
            <a className="text-link" href="/assets/media/ATTRIBUTION.md">
              Nguồn & ghi chú sử dụng media
            </a>
          </div>
        </div>
        <Dialog open={selected !== null} onClose={() => setSelected(null)} title="Xem hình ảnh AILSS">
          {selected === "brand" ? (
            <img src="/assets/brand/nvd-horizontal.svg" alt="NVD / AILSS" width="620" height="180" />
          ) : (
            selected && <Picture name={selected} alt="Minh họa AILSS tạo bằng AI" />
          )}
        </Dialog>
      </Section>
      <Section className="soft">
        <h2>Câu chuyện AI và giảng viên.</h2>
        <VideoStory />
      </Section>
    </>
  );
}
