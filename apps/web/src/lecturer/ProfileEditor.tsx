import { useUiText } from "../lib/i18n";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { sessionRequest, useSession } from "../auth/session";
import { useAvatar } from "../components/Preferences";
import { lecturerRequest } from "./api";
import { errorMessage } from "../lib/api";
import { Icon } from "../components/Icon";

export type LecturerProfileDetails = {
  bio: string;
  experience: string;
  education: string;
  achievements: string;
  showPhoto: boolean;
};

interface PayoutAccountData {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  updatedAt: string;
}

interface LecturerApplicationData {
  applicationId: string;
  professionalTitle?: string;
  institution?: string;
  teachingArea?: string;
  status: string;
  result?: string;
  submittedAt?: string;
}

export function LecturerProfileEditor({ lecturerId }: { lecturerId: string }) {
  const uiText = useUiText();
  const auth = useSession();
  const avatar = useAvatar();
  const p = auth.profile;

  const [value, setValue] = useState<LecturerProfileDetails | null>(null);
  const [payout, setPayout] = useState<PayoutAccountData | null>(null);
  const [appData, setAppData] = useState<LecturerApplicationData | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [busy, setBusy] = useState(false);

  const isVerified = Boolean(p?.lecturerVerified);

  useEffect(() => {
    let active = true;

    // 1. Fetch public profile details
    void sessionRequest<LecturerProfileDetails>("lecturer-profile")
      .then((result) => {
        if (active) setValue(result);
      })
      .catch((error) => {
        if (active) {
          setValue({
            bio: "",
            experience: "",
            education: "",
            achievements: "",
            showPhoto: false,
          });
          if (isVerified) {
            setMessage(errorMessage(error));
            setMessageType("error");
          }
        }
      });

    // 2. Fetch payout account details if verified
    if (isVerified) {
      void lecturerRequest<PayoutAccountData | null>("/me/payout-account", "GET")
        .then((res) => {
          if (active && res?.data) setPayout(res.data);
        })
        .catch(() => {
          // ignore if not configured yet
        });
    }

    // 3. Fetch lecturer application status
    void sessionRequest<LecturerApplicationData | null>("lecturer-application")
      .then((res) => {
        if (active && res) setAppData(res);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isVerified]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const next: LecturerProfileDetails = {
        bio: String(data.get("bio") ?? "").trim(),
        experience: String(data.get("experience") ?? "").trim(),
        education: String(data.get("education") ?? "").trim(),
        achievements: String(data.get("achievements") ?? "").trim(),
        showPhoto: data.has("showPhoto"),
      };
      const updated = await sessionRequest<LecturerProfileDetails>("lecturer-profile", "PATCH", next);
      setValue(updated);
      setMessageType("success");
      setMessage("✓ Đã lưu và cập nhật hồ sơ công khai thành công.");
    } catch (error) {
      setMessageType("error");
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const initialLetter = (p?.displayName?.trim()?.charAt(0) || "G").toUpperCase();

  return (
    <div className="lecturer-profile-page-wrapper">
      {/* 1. Header Card with Identity & Verification Status */}
      <section className="lecturer-identity-banner-card">
        <div className="lecturer-identity-header-content">
          <div className="lecturer-avatar-container">
            {avatar.url ? (
              <img
                src={avatar.url}
                alt={p?.displayName ?? "Giảng viên"}
                className="lecturer-profile-avatar-img"
              />
            ) : (
              <div className="lecturer-profile-avatar-placeholder" aria-hidden="true">
                {initialLetter}
              </div>
            )}
            <div className={`avatar-status-pip ${isVerified ? "verified" : "pending"}`} />
          </div>

          <div className="lecturer-identity-text">
            <div className="lecturer-role-row">
              <span className="eyebrow" style={{ margin: 0 }}>
                {uiText("HỒ SƠ GIẢNG VIÊN AILSS")}
              </span>
              {isVerified ? (
                <span className="lecturer-verification-pill verified">
                  <Icon name="checkCircle" size={13} />
                  <span>{uiText("Đã xác minh chính thức")}</span>
                </span>
              ) : (
                <span className="lecturer-verification-pill pending">
                  <Icon name="clock" size={13} />
                  <span>{uiText("Đang chờ duyệt xét")}</span>
                </span>
              )}
            </div>

            <h1 className="lecturer-display-title">{p?.displayName ?? "Giảng viên"}</h1>
            <p className="lecturer-meta-sub">
              <span>{p?.emailMasked ?? ""}</span>
              <span>•</span>
              <span>
                {uiText("Mã ID: ")}
                <code>{lecturerId.slice(0, 13)}…</code>
              </span>
              {appData?.institution && (
                <>
                  <span>•</span>
                  <span>{appData.institution}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="lecturer-identity-actions">
          <Link
            to={`/lecturers/${lecturerId}`}
            className="button button-small"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
          >
            <Icon name="eye" size={14} />
            <span>{uiText("Xem hồ sơ công khai")}</span>
          </Link>
          <Link
            to="/app/teaching/revenue"
            className="button button-subtle button-small"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
          >
            <Icon name="card" size={14} />
            <span>Doanh thu &amp; Payout</span>
          </Link>
        </div>
      </section>

      {/* 2. Verification Process Stepper */}
      <section className="lecturer-verification-stepper-card">
        <div className="stepper-header-row">
          <div>
            <h2>{uiText("Quy Trình Xác Thực Giảng Viên")}</h2>
            <p className="subtext">
              {uiText(
                "Lộ trình 4 mốc tiêu chuẩn từ đăng ký tài khoản đến xuất bản khóa học và nhận thanh toán doanh thu.",
              )}
            </p>
          </div>
          <span className={`kpi-tag ${isVerified ? "accent" : ""}`}>
            {isVerified ? uiText("4/4 Mốc Đã Hoàn Thành") : uiText("Đang Trong Tiến Trình Xác Thực")}
          </span>
        </div>

        <div className="verification-steps-grid">
          {/* Step 1 */}
          <div className="verification-step-item completed">
            <div className="step-icon-badge">
              <Icon name="check" size={16} strokeWidth={2.5} />
            </div>
            <div className="step-content">
              <div className="step-tag">{uiText("Bước 1 · Đã xong")}</div>
              <div className="step-title">{uiText("Khởi tạo vai trò")}</div>
              <p className="step-desc">
                {uiText("Tài khoản được đăng ký định danh Giảng viên trong hệ thống AILSS.")}
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div
            className={`verification-step-item ${value?.bio || value?.experience ? "completed" : "active"}`}
          >
            <div className="step-icon-badge">
              {value?.bio || value?.experience ? (
                <Icon name="check" size={16} strokeWidth={2.5} />
              ) : (
                <Icon name="assignment" size={16} />
              )}
            </div>
            <div className="step-content">
              <div className="step-tag">
                {uiText("Bước 2 · ")}
                {value?.bio || value?.experience ? uiText("Đã cập nhật") : uiText("Cần hoàn thiện")}
              </div>
              <div className="step-title">{uiText("Hồ sơ chuyên môn")}</div>
              <p className="step-desc">
                {uiText(
                  "Cập nhật tiểu sử, học vị, kinh nghiệm giảng dạy và các chứng chỉ, bằng cấp liên quan.",
                )}
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className={`verification-step-item ${payout ? "completed" : "pending"}`}>
            <div className="step-icon-badge">
              {payout ? <Icon name="check" size={16} strokeWidth={2.5} /> : <Icon name="card" size={16} />}
            </div>
            <div className="step-content">
              <div className="step-tag">
                {uiText("Bước 3 · ")}
                {payout ? uiText("Đã liên kết") : uiText("Cần thiết lập")}
              </div>
              <div className="step-title">{uiText("Tài khoản nhận tiền")}</div>
              <p className="step-desc">
                {payout
                  ? `${payout.bankName} (${payout.accountNumber})`
                  : uiText("Cung cấp tài khoản ngân hàng để nhận đối soát chi trả doanh thu hàng tháng.")}
              </p>
            </div>
          </div>

          {/* Step 4 */}
          <div className={`verification-step-item ${isVerified ? "completed" : "active"}`}>
            <div className="step-icon-badge">
              {isVerified ? <Icon name="shield" size={16} /> : <Icon name="clock" size={16} />}
            </div>
            <div className="step-content">
              <div className="step-tag">
                {uiText("Bước 4 · ")}
                {isVerified ? uiText("Đã phê duyệt") : uiText("Chờ quản trị viên")}
              </div>
              <div className="step-title">{uiText("Thẩm định & Cấp quyền")}</div>
              <p className="step-desc">
                {isVerified
                  ? uiText("Đã kích hoạt toàn quyền tạo khóa học, điều hành lớp và mở bán đợt tuyển sinh.")
                  : uiText("Quản trị viên đối soát thông tin hồ sơ và kích hoạt cờ xác minh chính thức.")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Public Profile Form Editor */}
      <section className="lecturer-profile-form-card">
        <div className="profile-form-header">
          <div>
            <h2>{uiText("Thông Tin Hồ Sơ Giảng Viên Công Khai")}</h2>
            <p className="subtext">
              {uiText(
                "Học viên sẽ xem thông tin này trên trang giới thiệu khóa học trước khi đăng ký hoặc mua học phí.",
              )}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link to="/app/account" className="button button-subtle button-small" style={{ fontSize: 12 }}>
              {uiText("Đổi ảnh đại diện")}
            </Link>
          </div>
        </div>

        {message && (
          <div
            className={`profile-notice-banner ${messageType === "success" ? "success" : "error"}`}
            role="status"
          >
            <Icon name={messageType === "success" ? "checkCircle" : "alert"} size={16} />
            <span>{uiText(message)}</span>
          </div>
        )}

        {value ? (
          <form className="form-panel form-grid" onSubmit={(event) => void save(event)}>
            <label>
              <strong>{uiText("Tiểu sử & Giới thiệu ngắn")}</strong>
              <span className="field-hint">
                {uiText("Tóm tắt ngắn gọn phong cách giảng dạy và chuyên môn nổi bật (tối đa 2.000 ký tự).")}
              </span>
              <textarea
                name="bio"
                rows={3}
                maxLength={2000}
                defaultValue={value.bio}
                placeholder={uiText(
                  "Ví dụ: Giảng viên chuyên ngành Khoa học máy tính với hơn 10 năm kinh nghiệm nghiên cứu AI...",
                )}
              />
            </label>

            <label>
              <strong>{uiText("Kinh nghiệm giảng dạy & Làm việc")}</strong>
              <span className="field-hint">
                {uiText(
                  "Các dự án thực chiến, vị trí công tác hoặc số năm kinh nghiệm sư phạm (tối đa 3.000 ký tự).",
                )}
              </span>
              <textarea
                name="experience"
                rows={4}
                maxLength={3000}
                defaultValue={value.experience}
                placeholder={uiText(
                  "Ví dụ: Nguyên Trưởng nhóm Kỹ thuật tại..., Giảng dạy hơn 1.200 sinh viên tại Đại học...",
                )}
              />
            </label>

            <label>
              <strong>{uiText("Học vấn & Bằng cấp chuyên môn")}</strong>
              <span className="field-hint">
                {uiText(
                  "Trường đại học, viện nghiên cứu, học vị (Thạc sĩ, Tiến sĩ, Kỹ sư...) (tối đa 2.000 ký tự).",
                )}
              </span>
              <textarea
                name="education"
                rows={3}
                maxLength={2000}
                defaultValue={value.education}
                placeholder={uiText(
                  "Ví dụ: Thạc sĩ Công nghệ Thông tin - Đại học Bách Khoa Hà Nội (2018)...",
                )}
              />
            </label>

            <label>
              <strong>{uiText("Thành tựu, Chứng chỉ & Giải thưởng")}</strong>
              <span className="field-hint">
                {uiText(
                  "Chứng chỉ quốc tế (AWS, Google Cloud, Microsoft...) hoặc giải thưởng khoa học (tối đa 2.000 ký tự).",
                )}
              </span>
              <textarea
                name="achievements"
                rows={3}
                maxLength={2000}
                defaultValue={value.achievements}
                placeholder={uiText(
                  "Ví dụ: AWS Certified Solutions Architect, Tác giả bài báo khoa học xuất bản tại IEEE...",
                )}
              />
            </label>

            <label className="profile-photo-consent-box">
              <input type="checkbox" name="showPhoto" defaultChecked={value.showPhoto} />
              <div>
                <strong>{uiText("Hiển thị ảnh đại diện thật trên hồ sơ công khai")}</strong>
                <p>
                  {uiText(
                    "Khi bật, ảnh chân dung thật trong Tài khoản của bạn sẽ xuất hiện trên trang khóa học và trang cá nhân giảng viên để tăng độ tin cậy với học viên.",
                  )}
                </p>
              </div>
            </label>

            <div className="profile-form-footer-actions">
              <button className="button" type="submit" disabled={busy}>
                {busy ? uiText("Đang lưu thay đổi…") : uiText("Lưu hồ sơ công khai")}
              </button>
              <Link
                to={`/lecturers/${lecturerId}`}
                className="button button-subtle"
                style={{ textDecoration: "none" }}
              >
                {uiText("Xem trước trang hồ sơ →")}
              </Link>
            </div>
          </form>
        ) : (
          <div className="profile-loading-state">
            <span className="live-pulsing-dot" aria-hidden="true" />
            <span>{uiText("Đang tải thông tin hồ sơ giảng viên…")}</span>
          </div>
        )}
      </section>

      {/* 4. Financial & Payout Account Integration */}
      <section className="lecturer-payout-summary-card">
        <div className="payout-summary-header">
          <div className="payout-icon-wrap" aria-hidden="true">
            <Icon name="card" size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <h3>{uiText("Tài Khoản Ngân Hàng Nhận Doanh Thu (Payout)")}</h3>
            <p className="subtext">
              {uiText(
                "Doanh thu bán khóa học sau khi trừ tỷ lệ chiết khấu nền tảng sẽ được tổng hợp và đối soát để chi trả theo định kỳ.",
              )}
            </p>
          </div>
          <Link
            to="/app/teaching/revenue"
            className="button button-subtle button-small"
            style={{ textDecoration: "none" }}
          >
            {payout ? uiText("Chỉnh sửa tài khoản") : uiText("Cấu hình tài khoản")}
          </Link>
        </div>

        {payout ? (
          <div className="payout-details-row">
            <div className="payout-detail-block">
              <span className="detail-label">{uiText("Ngân hàng")}</span>
              <strong className="detail-value">{payout.bankName}</strong>
            </div>
            <div className="payout-detail-block">
              <span className="detail-label">{uiText("Số tài khoản")}</span>
              <strong className="detail-value">{payout.accountNumber}</strong>
            </div>
            <div className="payout-detail-block">
              <span className="detail-label">{uiText("Chủ tài khoản")}</span>
              <strong className="detail-value">{payout.accountHolder}</strong>
            </div>
            <div className="payout-detail-block">
              <span className="detail-label">{uiText("Trạng thái")}</span>
              <span className="payout-verified-badge">{uiText("✓ Sẵn sàng nhận chi trả")}</span>
            </div>
          </div>
        ) : (
          <div className="payout-empty-banner">
            <p>
              {uiText(
                "Bạn chưa liên kết tài khoản ngân hàng. Hãy cấu hình để sẵn sàng nhận tiền bán khóa học khi quản trị viên lập phiếu chi.",
              )}
            </p>
            <Link
              to="/app/teaching/revenue"
              className="button button-small"
              style={{ textDecoration: "none" }}
            >
              {uiText("+ Thêm tài khoản ngân hàng ngay")}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

export function LecturerProfilePage() {
  const auth = useSession();
  const lecturerId = auth.profile?.userId ?? "";

  return (
    <div className="teaching-container">
      <LecturerProfileEditor lecturerId={lecturerId} />
    </div>
  );
}
