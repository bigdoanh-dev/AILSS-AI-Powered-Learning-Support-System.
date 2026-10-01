import { useState, useMemo, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { RevenueChart, RevenueCourses, money, type LecturerRevenue } from "../components/RevenuePanels";
import { lecturerError, lecturerRequest, useLecturer } from "./api";
import { Icon } from "../components/Icon";
import "./lecturer-revenue.css";

type Report = {
  dataSource: string;
  currency: string;
  lecturer: LecturerRevenue;
  completeness: { backfillThrough: string };
};

const RANGES = [
  { id: "today", label: "Hôm nay" },
  { id: "7d", label: "7 ngày qua" },
  { id: "30d", label: "30 ngày gần nhất" },
];

const EMPTY_REVENUE: LecturerRevenue = {
  lecturerId: "",
  grossMinor: "0",
  refundMinor: "0",
  netMinor: "0",
  estimatedPlatformMinor: "0",
  estimatedEarningsMinor: "0",
  orders: 0,
  dailyRevenue: [],
  courses: [],
};

export default function LecturerRevenueDashboard() {
  const [range, setRange] = useState("30d");
  const report = useLecturer<Report>(`/me/dashboard/revenue?range=${range}`);
  const account = useLecturer<{
    bankName: string;
    accountNumber: string;
    accountHolder: string;
    updatedAt: string;
  } | null>("/me/payout-account");

  const [accountMessage, setAccountMessage] = useState("");
  const [accountStatusType, setAccountStatusType] = useState<"success" | "error">("success");
  const [savingAccount, setSavingAccount] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showEditBank, setShowEditBank] = useState(false);

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSavingAccount(true);
    setAccountMessage("");
    try {
      await lecturerRequest("/me/payout-account", "POST", {
        bankName: String(form.get("bankName") ?? "").trim(),
        accountNumber: String(form.get("accountNumber") ?? "").trim(),
        accountHolder: String(form.get("accountHolder") ?? "")
          .trim()
          .toUpperCase(),
      });
      account.retry();
      setAccountStatusType("success");
      setAccountMessage("✓ Đã lưu tài khoản nhận doanh thu.");
      setShowEditBank(false);
    } catch (error) {
      setAccountStatusType("error");
      setAccountMessage(lecturerError(error));
    } finally {
      setSavingAccount(false);
    }
  }

  const isLive = Boolean(report.data?.lecturer);
  const data = report.data?.lecturer ?? EMPTY_REVENUE;

  const backfillDate = useMemo(() => {
    if (report.data?.completeness?.backfillThrough) {
      return new Date(report.data.completeness.backfillThrough).toLocaleDateString("vi-VN");
    }
    return "chưa xác định";
  }, [report.data]);

  const refundRate = useMemo(() => {
    const gross = Number(data.grossMinor) || 1;
    const refund = Number(data.refundMinor) || 0;
    return ((refund / gross) * 100).toFixed(1);
  }, [data.grossMinor, data.refundMinor]);

  const handleExportCsv = () => {
    setIsExporting(true);
    try {
      const rows = ["Ngày,Doanh thu gốc (VND),Hoàn tiền (VND),Thu nhập ròng (VND),Số đơn"];
      data.dailyRevenue.forEach((r) => {
        rows.push(`${r.day},${r.grossMinor},${r.refundMinor},${r.netMinor},${r.orders ?? 0}`);
      });
      rows.push("");
      rows.push("Khóa học,Doanh thu gốc (VND),Hoàn tiền (VND),Thu nhập ròng (VND),Lượt mua");
      data.courses.forEach((c) => {
        rows.push(`"${c.title}",${c.grossMinor},${c.refundMinor},${c.netMinor},${c.orders}`);
      });

      const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ailss-lecturer-revenue-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setTimeout(() => setIsExporting(false), 800);
    }
  };

  const maskedBankNumber = useMemo(() => {
    const raw = account.data?.accountNumber;
    if (!raw) return "Chưa cấu hình";
    if (raw.length <= 4) return raw;
    return `•••• •••• •••• ${raw.slice(-4)}`;
  }, [account.data?.accountNumber]);

  if (!isLive || report.error)
    return (
      <section className="dashboard-section-card">
        <h1>Doanh Thu &amp; Quyền Lợi Giảng Viên</h1>
        <p role={report.error ? "alert" : "status"}>
          {report.error ? lecturerError(report.error) : "Đang tải báo cáo doanh thu…"}
        </p>
        <button className="button" onClick={report.retry} disabled={report.pending}>
          Kiểm tra lại
        </button>
      </section>
    );
  return (
    <div className="lecturer-revenue-container">
      {/* 1. Header & Navigation */}
      <header className="rev-header-row">
        <div className="rev-header-left">
          <div className="rev-eyebrow">
            <Icon name="trending" size={14} />
            <span>TÀI CHÍNH &amp; ĐỐI SOÁT DOANH THU</span>
          </div>
          <h1>Doanh Thu &amp; Quyền Lợi Giảng Viên</h1>
          <p className="rev-lead">
            Theo dõi dòng tiền bán khóa học, tỷ lệ đối soát ngân hàng tự động, hoàn tiền và thu nhập thực nhận
            sau phân chia nền tảng.
          </p>
        </div>
        <div className="rev-header-actions">
          <Link className="button button-subtle button-small" to="/app/teaching">
            <Icon name="chevronLeft" size={14} />
            <span>Khóa học</span>
          </Link>
          <button
            type="button"
            className="button button-small"
            onClick={handleExportCsv}
            disabled={isExporting}
          >
            <Icon name="download" size={14} />
            <span>{isExporting ? "Đang xuất CSV…" : "Xuất báo cáo"}</span>
          </button>
        </div>
      </header>

      {/* 2. Reconciliation Status Banner */}
      <section className="rev-reconcile-banner" aria-label="Thông tin đối soát">
        <div className="rev-reconcile-left">
          <span className="rev-reconcile-tag">
            <Icon name="checkCircle" size={13} />
            <span>Đã đối soát</span>
          </span>
          <span>
            Dữ liệu thanh toán và hoàn tiền được tổng hợp đến <strong>{backfillDate}</strong>
          </span>
        </div>
        <div className="rev-reconcile-right">
          <span>Phí nền tảng được tính theo chính sách của từng giao dịch.</span>
        </div>
      </section>

      {/* 3. Toolbar: Range Switcher & Live Status */}
      <div className="rev-toolbar-row">
        <div className="rev-range-pills" role="group" aria-label="Khoảng thời gian báo cáo">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`rev-range-btn ${range === item.id ? "active" : ""}`}
              aria-pressed={range === item.id}
              onClick={() => setRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="rev-data-status-badge">
          {isLive ? (
            <>
              <span className="rev-live-dot" />
              <span>Dữ liệu thực từ hệ thống</span>
            </>
          ) : (
            <>
              <span className="rev-mock-dot" />
              <span>Chưa có dữ liệu</span>
            </>
          )}
          <button
            type="button"
            className="button button-subtle button-small"
            onClick={report.retry}
            disabled={report.pending}
            title="Làm mới báo cáo"
            style={{ marginLeft: 6, padding: "4px 8px", minHeight: 28 }}
          >
            <Icon name="refresh" size={13} />
          </button>
        </div>
      </div>

      {report.pending && (
        <div className="dashboard-section-card" role="status" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ margin: 0, color: "var(--muted)" }}>Đang đồng bộ và đối soát dữ liệu doanh thu…</p>
        </div>
      )}

      {Boolean(report.error) && (
        <section className="dashboard-section-card" role="alert" style={{ borderLeft: "4px solid #dc2626" }}>
          <h2 style={{ fontSize: "1.1rem", margin: "0 0 6px 0" }}>Chưa có báo cáo đã đối soát</h2>
          <p style={{ color: "var(--muted)", margin: "0 0 12px 0" }}>{lecturerError(report.error)}</p>
          <button className="button button-subtle button-small" onClick={report.retry}>
            Thử lại
          </button>
        </section>
      )}

      {/* 4. Bento KPI Grid */}
      <div className="rev-kpi-grid">
        {/* KPI 1: Doanh thu bán khóa học */}
        <article className="rev-kpi-card">
          <div className="rev-kpi-header">
            <span className="rev-kpi-icon-box blue">
              <Icon name="dollar" size={18} />
            </span>
            <span className="rev-kpi-tag">{data.orders} đơn hoàn tất</span>
          </div>
          <div className="rev-kpi-value">{money(data.grossMinor)}</div>
          <div className="rev-kpi-label">Doanh thu bán khóa học</div>
          <p className="rev-kpi-subtext">Tổng giá trị thanh toán học viên đăng ký thành công</p>
        </article>

        {/* KPI 2: Hoàn tiền & Điều chỉnh */}
        <article className="rev-kpi-card">
          <div className="rev-kpi-header">
            <span className="rev-kpi-icon-box amber">
              <Icon name="refresh" size={18} />
            </span>
            <span className="rev-kpi-tag">Tỷ lệ {refundRate}%</span>
          </div>
          <div className="rev-kpi-value">{money(data.refundMinor)}</div>
          <div className="rev-kpi-label">Hoàn tiền &amp; Điều chỉnh</div>
          <p className="rev-kpi-subtext">Giao dịch hoàn trả theo chính sách cam kết chất lượng 7 ngày</p>
        </article>

        {/* KPI 3: Phí nền tảng dự kiến */}
        <article className="rev-kpi-card">
          <div className="rev-kpi-header">
            <span className="rev-kpi-icon-box purple">
              <Icon name="receipt" size={18} />
            </span>
            <span className="rev-kpi-tag">Theo giao dịch</span>
          </div>
          <div className="rev-kpi-value">{money(data.estimatedPlatformMinor)}</div>
          <div className="rev-kpi-label">Phí nền tảng dự kiến</div>
          <p className="rev-kpi-subtext">Hạ tầng đám mây, băng thông video 4K và hạn ngạch AI Studio</p>
        </article>

        {/* KPI 4: Thu nhập thực nhận (Hero Highlight Card) */}
        <article className="rev-kpi-card hero-card">
          <div className="rev-kpi-header">
            <span className="rev-kpi-icon-box">
              <Icon name="sparkles" size={18} />
            </span>
            <span className="rev-kpi-tag">Thu nhập dự kiến</span>
          </div>
          <div className="rev-kpi-value">{money(data.estimatedEarningsMinor)}</div>
          <div className="rev-kpi-label">Thu nhập thực nhận dự kiến</div>
          <p className="rev-kpi-subtext">Ước tính sau phí nền tảng; trạng thái chi trả được quản lý riêng</p>
        </article>
      </div>

      {/* 5. Interactive Area Chart */}
      <section className="rev-chart-card">
        <div className="rev-chart-header">
          <div>
            <h2>Xu Hướng Doanh Thu &amp; Thu Nhập Ròng</h2>
            <p className="subtext">Biểu đồ biến động thanh toán khóa học theo mốc thời gian đối soát.</p>
          </div>
        </div>
        <RevenueChart rows={data.dailyRevenue} />
      </section>

      {/* 6. Two-Column Split (Course Distribution vs Payout Account) */}
      <div className="rev-split-grid">
        {/* Left Column: Phân Bổ Doanh Thu Từng Khóa Học */}
        <section className="rev-sub-card">
          <div>
            <h2>Hiệu Quả Doanh Thu Từng Khóa Học</h2>
            <p className="subtext">Tỷ trọng đóng góp dòng tiền và số lượng học viên của từng khóa.</p>
          </div>
          <RevenueCourses rows={data.courses} />
          <div style={{ marginTop: 8, borderTop: "1px solid var(--line, #e2e8f0)", paddingTop: 14 }}>
            <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>Khảo sát học viên:</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {data.courses.map((course) => (
                <div
                  key={course.courseId}
                  style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}
                >
                  <span style={{ color: "var(--ink)", fontWeight: 500 }}>{course.title}</span>
                  <Link
                    to={`/courses/${course.courseId}`}
                    style={{ color: "var(--blue, #0284c7)", fontWeight: 600 }}
                  >
                    Xem đánh giá →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right Column: Tài Khoản Nhận Doanh Thu & Visual Bank Card */}
        <section className="rev-sub-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2>Tài Khoản Nhận Doanh Thu</h2>
              <p className="subtext">Tài khoản ngân hàng nhận chi trả của bạn.</p>
            </div>
            <button
              type="button"
              className="button button-subtle button-small"
              onClick={() => setShowEditBank(!showEditBank)}
            >
              {showEditBank ? "Đóng form" : "Chỉnh sửa"}
            </button>
          </div>

          {/* Visual Metallic Bank Card */}
          <div className="rev-bank-card-preview" role="region" aria-label="Thẻ thông tin ngân hàng thụ hưởng">
            <div className="rev-card-top">
              <span className="rev-card-bank-name">
                {account.data?.bankName ? account.data.bankName : "Chưa cấu hình ngân hàng"}
              </span>
              <div className="rev-card-chip" aria-hidden="true" />
            </div>

            <div className="rev-card-number">{maskedBankNumber}</div>

            <div className="rev-card-bottom">
              <div>
                <div className="rev-card-holder-label">Chủ tài khoản thụ hưởng</div>
                <div className="rev-card-holder-name">
                  {account.data?.accountHolder ? account.data.accountHolder : "Chưa cấu hình"}
                </div>
              </div>
              <span className="rev-card-status-verified">
                <Icon name="checkCircle" size={13} />
                <span>{account.data ? "Đã lưu" : "Chưa cấu hình"}</span>
              </span>
            </div>
          </div>

          {/* Edit Form */}
          {showEditBank && (
            <form
              className="rev-bank-form"
              onSubmit={(event) => void saveAccount(event)}
              key={account.data?.updatedAt ?? account.data?.accountNumber ?? "new"}
            >
              <label>
                Tên Ngân hàng thụ hưởng
                <input
                  name="bankName"
                  maxLength={100}
                  minLength={2}
                  defaultValue={account.data?.bankName ?? ""}
                  placeholder="VD: Vietcombank, Techcombank, MB Bank..."
                  required
                />
              </label>
              <label>
                Số tài khoản ngân hàng
                <input
                  name="accountNumber"
                  inputMode="numeric"
                  pattern="[0-9]{6,24}"
                  defaultValue={account.data?.accountNumber ?? ""}
                  placeholder="VD: 1048829102"
                  required
                />
              </label>
              <label>
                Họ và tên chủ tài khoản (Viết in hoa không dấu)
                <input
                  name="accountHolder"
                  maxLength={100}
                  minLength={2}
                  defaultValue={account.data?.accountHolder ?? ""}
                  placeholder="VD: NGUYEN VAN A"
                  required
                />
              </label>
              <button className="button" type="submit" disabled={savingAccount} style={{ marginTop: 4 }}>
                {savingAccount ? "Đang lưu và xác thực…" : "Lưu tài khoản nhận tiền"}
              </button>
            </form>
          )}

          {accountMessage && (
            <div className={`rev-form-status-alert ${accountStatusType}`} role="status">
              <Icon name={accountStatusType === "success" ? "checkCircle" : "alert"} size={14} />
              <span>{accountMessage}</span>
            </div>
          )}

          <p
            style={{
              fontSize: 12,
              color: "var(--muted)",
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name="shield" size={13} />
            <span>Thông tin tài khoản được dùng để nhận chi trả doanh thu của bạn.</span>
          </p>
        </section>
      </div>
    </div>
  );
}
