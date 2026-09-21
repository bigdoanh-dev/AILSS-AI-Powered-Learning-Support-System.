import React, { useState } from "react";

export interface IntegrationStatusCard {
  name: string;
  type: string;
  status: "CONNECTED" | "DEGRADED" | "FAILED" | "NOT_CONFIGURED";
  latencyMs?: number;
  details: string;
}

export interface ConfigVersionItem {
  version: number;
  date: string;
  author: string;
  reason: string;
  isCurrent: boolean;
}

export function InstitutionWizardPage() {
  const [activeTab, setActiveTab] = useState<"WIZARD" | "TEST_CENTER" | "CONFIG_VERSIONS">("WIZARD");
  const [wizardStep, setWizardStep] = useState(1);
  const [lifecycleState, setLifecycleState] = useState<"DRAFT" | "VALIDATED" | "ACTIVATED">("DRAFT");

  // Form State
  const [name, setName] = useState("Trường Đại học Bách Khoa");
  const [domain, setDomain] = useState("polytech.edu.vn");
  const [email, setEmail] = useState("admin@polytech.edu.vn");
  const [protocol, setProtocol] = useState("OIDC");
  const [discoveryUrl, setDiscoveryUrl] = useState("https://sso.polytech.edu.vn/.well-known/openid-configuration");
  const [scimEnabled, setScimEnabled] = useState(true);
  const [ltiEnabled, setLtiEnabled] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(true);

  const [tests, setTests] = useState<IntegrationStatusCard[]>([
    {
      name: "OpenID Connect (OIDC / OAuth2 SSO)",
      type: "OIDC",
      status: "CONNECTED",
      latencyMs: 42,
      details: "Discovery URL phản hồi 200 OK, JWKS endpoint hợp lệ.",
    },
    {
      name: "SAML 2.0 Web SSO",
      type: "SAML",
      status: "NOT_CONFIGURED",
      details: "Chưa nạp tệp cấu hình SAML Metadata.",
    },
    {
      name: "SCIM 2.0 User & Group Provisioning",
      type: "SCIM",
      status: "CONNECTED",
      latencyMs: 38,
      details: "Token Bearer hợp lệ; tài nguyên /Users và /Groups đã đồng bộ.",
    },
    {
      name: "OneRoster 1.2 REST SIS Sync",
      type: "ONEROSTER",
      status: "CONNECTED",
      latencyMs: 51,
      details: "Xác thực OneRoster OAuth2 thành công; 12 lớp học đã liên kết.",
    },
    {
      name: "1EdTech LTI 1.3 Advantage Complete",
      type: "LTI",
      status: "CONNECTED",
      latencyMs: 29,
      details: "Core Launch, Deep Linking, AGS và NRPS sẵn sàng kết nối LMS.",
    },
    {
      name: "Dịch vụ Thư điện tử (SMTP / SES)",
      type: "EMAIL",
      status: "CONNECTED",
      latencyMs: 14,
      details: "DKIM và SPF được xác thực chính thức.",
    },
    {
      name: "AI Inference Provider Gateway",
      type: "AI_PROVIDER",
      status: "CONNECTED",
      latencyMs: 64,
      details: "Internal Gateway định tuyến an toàn; guardrails kích hoạt.",
    },
  ]);

  const [versions, setVersions] = useState<ConfigVersionItem[]>([
    {
      version: 3,
      date: "2026-09-21 16:30",
      author: "SuperAdmin (sec-ops@ailss.edu)",
      reason: "Bật cờ tính năng AI Tutor V2 và Teacher Copilot cho năm học mới",
      isCurrent: true,
    },
    {
      version: 2,
      date: "2026-09-18 10:15",
      author: "InstitutionAdmin (it@polytech.edu.vn)",
      reason: "Cấu hình LTI 1.3 Advantage Deployment ID và JWKS",
      isCurrent: false,
    },
    {
      version: 1,
      date: "2026-09-15 08:00",
      author: "System Initializer",
      reason: "Khởi tạo hồ sơ cơ sở đào tạo ban đầu",
      isCurrent: false,
    },
  ]);

  const handleValidate = () => {
    if (!domain || !email || !discoveryUrl) {
      alert("Vui lòng điền đầy đủ các thông tin bắt buộc!");
      return;
    }
    setLifecycleState("VALIDATED");
    alert("Xác thực thông tin tích hợp thành công! Trạng thái chuyển sang VALIDATED.");
  };

  const handleActivate = () => {
    if (lifecycleState !== "VALIDATED") {
      alert("Vui lòng xác thực cấu hình thành công trước khi kích hoạt!");
      return;
    }
    setLifecycleState("ACTIVATED");
    alert("Kích hoạt cơ sở đào tạo thành công! Nền tảng sẵn sàng phục vụ giảng viên & sinh viên.");
  };

  const handleRollback = (ver: number) => {
    if (confirm(`Bạn có chắc chắn muốn khôi phục cấu hình về phiên bản v${ver}?`)) {
      setVersions((prev) =>
        prev.map((v) => ({ ...v, isCurrent: v.version === ver })),
      );
      alert(`Đã khôi phục thành công về cấu hình v${ver}.`);
    }
  };

  return (
    <div className="institution-admin-container" style={{ padding: "var(--space-6) 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", margin: "0 0 var(--space-2) 0", color: "var(--ink)" }}>
            Quản trị Cơ sở Đào tạo & Tích hợp (Institutional Operations V2)
          </h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Quy trình khởi tạo tổ chức (Onboarding Wizard), Trung tâm Kiểm thử kết nối (Connection Test Center) và Quản lý phiên bản cấu hình.
          </p>
        </div>
        <div>
          <span
            style={{
              padding: "6px 16px",
              borderRadius: "20px",
              fontWeight: 700,
              fontSize: "0.85rem",
              background:
                lifecycleState === "ACTIVATED"
                  ? "#e8f5e9"
                  : lifecycleState === "VALIDATED"
                  ? "#e3f2fd"
                  : "#fff3cd",
              color:
                lifecycleState === "ACTIVATED"
                  ? "#2e7d32"
                  : lifecycleState === "VALIDATED"
                  ? "#1565c0"
                  : "#856404",
            }}
          >
            Trạng thái: {lifecycleState}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="module-segmented-bar" role="navigation" style={{ marginBottom: "var(--space-5)" }}>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "WIZARD" ? "active" : ""}`}
          onClick={() => setActiveTab("WIZARD")}
        >
          ⚙️ Quy trình khởi tạo (Onboarding Wizard)
        </button>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "TEST_CENTER" ? "active" : ""}`}
          onClick={() => setActiveTab("TEST_CENTER")}
        >
          🔌 Trung tâm Kiểm thử kết nối ({tests.filter((t) => t.status === "CONNECTED").length}/{tests.length})
        </button>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "CONFIG_VERSIONS" ? "active" : ""}`}
          onClick={() => setActiveTab("CONFIG_VERSIONS")}
        >
          📜 Lịch sử Phiên bản cấu hình ({versions.length})
        </button>
      </div>

      {/* WIZARD TAB */}
      {activeTab === "WIZARD" && (
        <section>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
              padding: "var(--space-5)",
              background: "var(--white)",
            }}
          >
            <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-5)" }}>
              {[
                { step: 1, label: "Hồ sơ & Tên miền" },
                { step: 2, label: "Định danh & SSO" },
                { step: 3, label: "Tiêu chuẩn SCIM & LTI" },
                { step: 4, label: "Chính sách AI & Cờ tính năng" },
              ].map((s) => (
                <button
                  key={s.step}
                  type="button"
                  onClick={() => setWizardStep(s.step)}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: "var(--radius-sm)",
                    border: wizardStep === s.step ? "2px solid var(--blue)" : "1px solid var(--line)",
                    background: wizardStep === s.step ? "#f0f7ff" : "var(--white)",
                    fontWeight: wizardStep === s.step ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  Bước {s.step}: {s.label}
                </button>
              ))}
            </div>

            {/* Step 1 */}
            {wizardStep === 1 && (
              <div>
                <h3 style={{ marginTop: 0 }}>Bước 1: Hồ sơ trường & Tên miền cơ sở đào tạo</h3>
                <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: "600px" }}>
                  <label>
                    Tên cơ sở đào tạo:
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      style={{ width: "100%", padding: "8px", marginTop: "4px" }}
                    />
                  </label>
                  <label>
                    Tên miền chính (Primary Domain):
                    <input
                      type="text"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      style={{ width: "100%", padding: "8px", marginTop: "4px" }}
                    />
                  </label>
                  <label>
                    Email liên hệ kỹ thuật:
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      style={{ width: "100%", padding: "8px", marginTop: "4px" }}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Step 2 */}
            {wizardStep === 2 && (
              <div>
                <h3 style={{ marginTop: 0 }}>Bước 2: Cổng định danh tập trung (Identity Provider)</h3>
                <div style={{ display: "grid", gap: "var(--space-3)", maxWidth: "600px" }}>
                  <label>
                    Giao thức SSO:
                    <select
                      value={protocol}
                      onChange={(e) => setProtocol(e.target.value)}
                      style={{ width: "100%", padding: "8px", marginTop: "4px" }}
                    >
                      <option value="OIDC">OpenID Connect (Khuyên dùng)</option>
                      <option value="SAML">SAML 2.0 Web SSO</option>
                    </select>
                  </label>
                  <label>
                    OIDC Discovery URL:
                    <input
                      type="text"
                      value={discoveryUrl}
                      onChange={(e) => setDiscoveryUrl(e.target.value)}
                      style={{ width: "100%", padding: "8px", marginTop: "4px" }}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Step 3 */}
            {wizardStep === 3 && (
              <div>
                <h3 style={{ marginTop: 0 }}>Bước 3: Tương thích giáo dục mở (SCIM, OneRoster, LTI)</h3>
                <div style={{ display: "grid", gap: "var(--space-3)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <input
                      type="checkbox"
                      checked={scimEnabled}
                      onChange={(e) => setScimEnabled(e.target.checked)}
                    />
                    Kích hoạt chuẩn đồng bộ người dùng SCIM 2.0 (/Users, /Groups)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <input
                      type="checkbox"
                      checked={ltiEnabled}
                      onChange={(e) => setLtiEnabled(e.target.checked)}
                    />
                    Kích hoạt 1EdTech LTI 1.3 Advantage Complete (Core Launch, Deep Linking, AGS, NRPS)
                  </label>
                </div>
              </div>
            )}

            {/* Step 4 */}
            {wizardStep === 4 && (
              <div>
                <h3 style={{ marginTop: 0 }}>Bước 4: Chính sách AI & Cờ tính năng (Feature Flags)</h3>
                <div style={{ display: "grid", gap: "var(--space-3)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <input
                      type="checkbox"
                      checked={aiEnabled}
                      onChange={(e) => setAiEnabled(e.target.checked)}
                    />
                    Bật trợ lý AI Tutor V2 và Teacher Copilot cho cơ sở này
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <input type="checkbox" defaultChecked disabled />
                    Bắt buộc giảng viên phê duyệt câu hỏi do AI tạo (Human Approval Required) [Khóa an toàn]
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <input type="checkbox" disabled />
                    Kích hoạt thanh toán thương mại thật (PILOT_BLOCKED - Chưa thông qua ASV scan)
                  </label>
                </div>
              </div>
            )}

            {/* Action Bar */}
            <div style={{ marginTop: "var(--space-5)", display: "flex", gap: "var(--space-3)" }}>
              <button
                type="button"
                onClick={() => alert("Đã lưu bản nháp cấu hình (DRAFT).")}
                style={{
                  padding: "10px 20px",
                  background: "transparent",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                💾 Lưu bản nháp (Save Draft)
              </button>
              <button
                type="button"
                onClick={handleValidate}
                style={{
                  padding: "10px 20px",
                  background: "#1565c0",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                🔍 Xác thực kết nối (Validate)
              </button>
              <button
                type="button"
                onClick={handleActivate}
                disabled={lifecycleState !== "VALIDATED"}
                style={{
                  padding: "10px 20px",
                  background: lifecycleState === "VALIDATED" ? "#2e7d32" : "#ccc",
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-sm)",
                  cursor: lifecycleState === "VALIDATED" ? "pointer" : "not-allowed",
                  fontWeight: 600,
                }}
              >
                🚀 Kích hoạt tổ chức (Activate)
              </button>
            </div>
          </div>
        </section>
      )}

      {/* TEST CENTER TAB */}
      {activeTab === "TEST_CENTER" && (
        <section>
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {tests.map((t) => (
              <div
                key={t.type}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius)",
                  padding: "var(--space-4)",
                  background: "var(--white)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <h3 style={{ margin: "0 0 var(--space-1) 0", fontSize: "1.1rem" }}>{t.name}</h3>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>{t.details}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span
                    style={{
                      padding: "4px 12px",
                      borderRadius: "12px",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      background:
                        t.status === "CONNECTED"
                          ? "#e8f5e9"
                          : t.status === "DEGRADED"
                          ? "#fff3cd"
                          : t.status === "FAILED"
                          ? "#ffebee"
                          : "#f5f5f5",
                      color:
                        t.status === "CONNECTED"
                          ? "#2e7d32"
                          : t.status === "DEGRADED"
                          ? "#856404"
                          : t.status === "FAILED"
                          ? "#c62828"
                          : "#616161",
                    }}
                  >
                    {t.status}
                  </span>
                  {t.latencyMs && (
                    <div style={{ marginTop: "4px", fontSize: "0.8rem", color: "var(--muted)" }}>
                      Độ trễ: {t.latencyMs} ms
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* CONFIG VERSIONS TAB */}
      {activeTab === "CONFIG_VERSIONS" && (
        <section>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
              padding: "var(--space-4)",
              background: "var(--white)",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                  <th style={{ padding: "10px", borderBottom: "2px solid var(--line)" }}>Phiên bản</th>
                  <th style={{ padding: "10px", borderBottom: "2px solid var(--line)" }}>Thời điểm thay đổi</th>
                  <th style={{ padding: "10px", borderBottom: "2px solid var(--line)" }}>Người thực hiện</th>
                  <th style={{ padding: "10px", borderBottom: "2px solid var(--line)" }}>Lý do thay đổi</th>
                  <th style={{ padding: "10px", borderBottom: "2px solid var(--line)" }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version}>
                    <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--line)" }}>
                      <strong>v{v.version}</strong> {v.isCurrent && <span style={{ color: "#2e7d32", fontWeight: 700 }}>(Hiện tại)</span>}
                    </td>
                    <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--line)", color: "var(--muted)" }}>{v.date}</td>
                    <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--line)" }}>{v.author}</td>
                    <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--line)" }}>{v.reason}</td>
                    <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--line)" }}>
                      {!v.isCurrent && (
                        <button
                          type="button"
                          onClick={() => handleRollback(v.version)}
                          style={{
                            padding: "4px 12px",
                            background: "transparent",
                            border: "1px solid var(--line)",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                          }}
                        >
                          Khôi phục về v{v.version}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
