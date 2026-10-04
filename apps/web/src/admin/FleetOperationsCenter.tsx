import { useUiText } from "../lib/i18n";
import { Link } from "react-router-dom";
export type ConfigDriftStatus = "IN_SYNC" | "DRIFTED" | "ERROR";
export function FleetOperationsCenter() {
  const uiText = useUiText();
  return (
    <section className="dashboard-section-card">
      <h1>{uiText("Quản lý cơ sở đào tạo")}</h1>
      <p>{uiText("Chưa có dữ liệu cơ sở đào tạo được kết nối cho chức năng này.")}</p>
      <Link className="button" to="/app/admin/monitoring">
        {uiText("Giám sát hệ thống")}
      </Link>
    </section>
  );
}
