import { Link } from "react-router-dom";
export default function SettingsDashboard() {
  return (
    <div className="admin-dashboard-container">
      <div className="dashboard-heading">
        <p className="eyebrow">CẤU HÌNH & BẢO MẬT</p>
        <h1>Cài Đặt Hệ Thống & Quản Trị Bảo Mật</h1>
      </div>
      <section className="dashboard-section-card">
        <h2>Chính sách đang áp dụng</h2>
        <p>
          Chính sách phiên, SMTP và thanh toán được quản lý trong cấu hình máy chủ. Trang này chưa có API đọc
          hoặc cập nhật các giá trị đó.
        </p>
        <p>Chưa có dữ liệu cấu hình từ máy chủ.</p>
        <p role="status">Không thể lưu chính sách hoặc dọn cache máy chủ tại đây.</p>
        <Link className="button" to="/app/admin/users">
          Quản lý tài khoản
        </Link>
        <Link className="button secondary" to="/app/admin/monitoring">
          Theo dõi dịch vụ
        </Link>
      </section>
    </div>
  );
}
