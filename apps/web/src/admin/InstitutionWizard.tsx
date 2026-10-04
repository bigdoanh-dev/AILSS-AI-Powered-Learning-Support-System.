import { useUiText } from "../lib/i18n";
import { Link } from "react-router-dom";
export function InstitutionWizardPage() {
  const uiText = useUiText();
  return (
    <section className="dashboard-section-card">
      <h1>{uiText("Quản trị cơ sở đào tạo")}</h1>
      <p>{uiText("Chưa có API quản lý tổ chức hoặc kiểm tra kết nối. Chưa có dữ liệu tổ chức.")}</p>
      <Link to="/app/admin/users">{uiText("Quản lý tài khoản hiện có")}</Link>
    </section>
  );
}
