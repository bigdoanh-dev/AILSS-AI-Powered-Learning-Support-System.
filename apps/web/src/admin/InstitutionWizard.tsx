import { Link } from "react-router-dom";
export function InstitutionWizardPage() {
  return (
    <section className="dashboard-section-card">
      <h1>Quản trị cơ sở đào tạo</h1>
      <p>Chưa có API quản lý tổ chức hoặc kiểm tra kết nối. Chưa có dữ liệu tổ chức.</p>
      <Link to="/app/admin/users">Quản lý tài khoản hiện có</Link>
    </section>
  );
}
