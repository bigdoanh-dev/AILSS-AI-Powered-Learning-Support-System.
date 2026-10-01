import { Link } from "react-router-dom";
export type ConfigDriftStatus = "IN_SYNC" | "DRIFTED" | "ERROR";
export function FleetOperationsCenter() {
  return (
    <section className="dashboard-section-card">
      <h1>Quản lý cơ sở đào tạo</h1>
      <p>Chưa có dữ liệu cơ sở đào tạo được kết nối cho chức năng này.</p>
      <Link className="button" to="/app/admin/monitoring">
        Giám sát hệ thống
      </Link>
    </section>
  );
}
