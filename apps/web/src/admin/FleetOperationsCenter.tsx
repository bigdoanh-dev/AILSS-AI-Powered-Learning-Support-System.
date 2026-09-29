import React, { useState } from "react";

export type ConfigDriftStatus = "IN_SYNC" | "DRIFTED" | "ERROR";

export function FleetOperationsCenter() {
  const [tenants, setTenants] = useState([
    {
      id: "tenant-polytech-hcm",
      name: "Đại học Bách Khoa ĐHQG-HCM",
      status: "IN_SYNC" as ConfigDriftStatus,
      template: "tpl-vietnam-higher-ed-v1",
      lastInspected: "Vừa xong",
    },
    {
      id: "tenant-vnu-hn",
      name: "Đại học Quốc gia Hà Nội",
      status: "DRIFTED" as ConfigDriftStatus,
      template: "tpl-vietnam-higher-ed-v1",
      lastInspected: "5 phút trước",
      driftDetail: "Tính năng AI_TUTOR_V2 đã bị tắt cục bộ",
    },
    {
      id: "tenant-danang-tech",
      name: "Đại học Bách Khoa Đà Nẵng",
      status: "IN_SYNC" as ConfigDriftStatus,
      template: "tpl-vietnam-higher-ed-v1",
      lastInspected: "10 phút trước",
    },
  ]);

  const [bulkPreviewOpen, setBulkPreviewOpen] = useState(false);
  const [bulkSuccessNotice, setBulkSuccessNotice] = useState<string | null>(null);

  const handleRemediateDrift = (tenantId: string) => {
    setTenants(
      tenants.map((t) =>
        t.id === tenantId
          ? { ...t, status: "IN_SYNC", driftDetail: undefined, lastInspected: "Vừa cập nhật" }
          : t,
      ),
    );
    alert(`Đã khôi phục cấu hình tenant '${tenantId}' về trạng thái IN_SYNC theo đúng mẫu chuẩn.`);
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          borderBottom: "1px solid #e2e8f0",
          paddingBottom: "16px",
        }}
      >
        <div>
          <h1 style={{ fontSize: "26px", fontWeight: "700", color: "#0f172a", margin: "0 0 6px 0" }}>
            Trung tâm Quản trị Cụm Cơ sở Giáo dục (Fleet Operations)
          </h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Quản lý mẫu chuẩn (Templates), triển khai hàng loạt (Bulk Operations) và giám sát sai lệch cấu
            hình (Config Drift).
          </p>
        </div>

        <button
          onClick={() => setBulkPreviewOpen(true)}
          style={{
            minHeight: "40px",
            padding: "8px 16px",
            backgroundColor: "#2563eb",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Triển khai Thay đổi Hàng loạt (Dry-Run)
        </button>
      </header>

      {bulkSuccessNotice && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#dcfce7",
            color: "#166534",
            borderRadius: "6px",
            marginBottom: "20px",
          }}
        >
          {bulkSuccessNotice}
        </div>
      )}

      {/* Tenants & Drift Table */}
      <section>
        <h2 style={{ fontSize: "18px", fontWeight: "600", color: "#1e293b", marginBottom: "16px" }}>
          Danh sách Cơ sở Đào tạo & Tình trạng Sai lệch Cấu hình
        </h2>

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            overflow: "hidden",
          }}
        >
          <thead>
            <tr style={{ backgroundColor: "#f8fafc", textAlign: "left", fontSize: "13px", color: "#475569" }}>
              <th style={{ padding: "12px 16px" }}>Mã Tenant</th>
              <th style={{ padding: "12px 16px" }}>Tên Cơ sở Đào tạo</th>
              <th style={{ padding: "12px 16px" }}>Mẫu Cấu hình</th>
              <th style={{ padding: "12px 16px" }}>Tình trạng Cấu hình</th>
              <th style={{ padding: "12px 16px" }}>Kiểm tra Lần cuối</th>
              <th style={{ padding: "12px 16px", textAlign: "right" }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} style={{ borderTop: "1px solid #e2e8f0", fontSize: "14px" }}>
                <td style={{ padding: "14px 16px", fontWeight: 600, color: "#1e293b" }}>{t.id}</td>
                <td style={{ padding: "14px 16px", color: "#334155" }}>{t.name}</td>
                <td style={{ padding: "14px 16px", color: "#64748b" }}>{t.template}</td>
                <td style={{ padding: "14px 16px" }}>
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      fontWeight: 700,
                      backgroundColor: t.status === "IN_SYNC" ? "#dcfce7" : "#fee2e2",
                      color: t.status === "IN_SYNC" ? "#166534" : "#991b1b",
                    }}
                  >
                    {t.status}
                  </span>
                  {t.driftDetail && (
                    <div style={{ fontSize: "12px", color: "#b91c1c", marginTop: "4px" }}>
                      {t.driftDetail}
                    </div>
                  )}
                </td>
                <td style={{ padding: "14px 16px", color: "#64748b" }}>{t.lastInspected}</td>
                <td style={{ padding: "14px 16px", textAlign: "right" }}>
                  {t.status === "DRIFTED" ? (
                    <button
                      onClick={() => handleRemediateDrift(t.id)}
                      style={{
                        minHeight: "32px",
                        padding: "4px 12px",
                        backgroundColor: "#dc2626",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Khắc phục sai lệch
                    </button>
                  ) : (
                    <span style={{ fontSize: "12px", color: "#16a34a", fontWeight: 600 }}>Chuẩn hóa</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Bulk Preview Modal */}
      {bulkPreviewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
        >
          <div style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "10px", width: "550px" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "18px", color: "#0f172a" }}>
              Xem trước Triển khai Hàng loạt (Dry-Run Preview)
            </h3>
            <p style={{ fontSize: "14px", color: "#475569" }}>
              Thao tác: <strong>Bật tính năng AI_TUTOR_V2 và STUDY_PLAN_V2</strong> cho 3 cơ sở đào tạo.
            </p>
            <div
              style={{
                padding: "12px",
                backgroundColor: "#f1f5f9",
                borderRadius: "6px",
                fontSize: "13px",
                color: "#334155",
                marginBottom: "16px",
              }}
            >
              <div>
                ✓ Kiểm tra tính tương thích cấu hình: <strong>ĐẠT (3/3)</strong>
              </div>
              <div>
                ✓ Kiểm tra quyền bảo mật và không sao chép khóa bí mật: <strong>ĐẠT</strong>
              </div>
              <div>✓ Không có xung đột hạ tầng D0.</div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={() => setBulkPreviewOpen(false)}
                style={{
                  minHeight: "36px",
                  padding: "0 14px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  cursor: "pointer",
                }}
              >
                Hủy
              </button>
              <button
                onClick={() => {
                  setBulkPreviewOpen(false);
                  setBulkSuccessNotice(
                    "Đã thực thi cập nhật chính sách thành công cho 3 tenant sau khi kiểm tra Dry-run đạt 100%!",
                  );
                }}
                style={{
                  minHeight: "36px",
                  padding: "0 16px",
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Xác nhận Áp dụng Chính sách
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
