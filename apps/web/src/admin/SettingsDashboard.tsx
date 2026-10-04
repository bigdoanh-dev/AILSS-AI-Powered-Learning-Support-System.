import { useUiText } from "../lib/i18n";
import { Link } from "react-router-dom";
export default function SettingsDashboard() {
  const uiText = useUiText();
  return (
    <div className="admin-dashboard-container">
      <div className="dashboard-heading">
        <p className="eyebrow">{uiText("CẤU HÌNH & BẢO MẬT")}</p>
        <h1>{uiText("Cài Đặt Hệ Thống & Quản Trị Bảo Mật")}</h1>
      </div>
      <section className="dashboard-section-card">
        <h2>{uiText("Chính sách đang áp dụng")}</h2>
        <p>
          {uiText(
            "Chính sách phiên, SMTP và thanh toán được quản lý trong cấu hình máy chủ. Trang này chưa có API đọc hoặc cập nhật các giá trị đó.",
          )}
        </p>
        <p>{uiText("Chưa có dữ liệu cấu hình từ máy chủ.")}</p>
        <p role="status">{uiText("Không thể lưu chính sách hoặc dọn cache máy chủ tại đây.")}</p>
        <Link className="button" to="/app/admin/users">
          {uiText("Quản lý tài khoản")}
        </Link>
        <Link className="button secondary" to="/app/admin/monitoring">
          {uiText("Theo dõi dịch vụ")}
        </Link>
      </section>
    </div>
  );
}
