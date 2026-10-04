import { useLanguage } from "../lib/i18n";
import { useUiText } from "../lib/i18n";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useAdminData } from "./useAdminData";
import { adminError, adminRequest } from "./api";
import {
  RevenueChart,
  RevenueCourses,
  money,
  type LecturerRevenue,
  type RevenueDay,
} from "../components/RevenuePanels";
import { LecturerLink } from "../components/PublicLecturer";

interface RevenueData {
  dataSource: "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION";
  grossMinor: string;
  refundMinor: string;
  netMinor: string;
  orderCount: number;
  refundCount: number;
  dailyRevenue: RevenueDay[];
  lecturers: LecturerRevenue[];
  completeness: { backfillThrough: string };
}
type PayoutInstruction = {
  lecturerId: string;
  amountMinor: string;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
  status: string;
};
type Payouts = {
  month: string;
  canPrepare?: boolean;
  candidates?: Array<{ lecturerId: string; estimatedEarningsMinor: string; accountConfigured: boolean }>;
  instructions: PayoutInstruction[];
  skipped?: Array<{ lecturerId: string; reason: string }>;
};

const TIME_RANGES = [
  { id: "today", label: "Hôm nay" },
  { id: "7d", label: "7 ngày" },
  { id: "30d", label: "30 ngày" },
];

export default function RevenueDashboard() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const [range, setRange] = useState("30d");
  const { data, loading, error, isLive, refresh, lastUpdated } = useAdminData<RevenueData>(
    `/dashboard/revenue?range=${range}`,
    { fallback: null, intervalMs: 30_000 },
  );
  const hasAuthoritativeData = isLive && data?.dataSource === "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION";
  const payouts = useAdminData<Payouts>("/payouts", { intervalMs: 0 });
  const commission = useAdminData<{ basisPoints: number; effectiveAt: string; updatedBy: string | null }>(
    "/commission",
    { intervalMs: 0 },
  );
  const [commissionPercent, setCommissionPercent] = useState("");
  const [savingCommission, setSavingCommission] = useState(false);
  const [commissionMessage, setCommissionMessage] = useState("");
  useEffect(() => {
    if (commission.data) setCommissionPercent(String(commission.data.basisPoints / 100));
  }, [commission.data]);
  async function saveCommission() {
    const value = Number(commissionPercent);
    const basisPoints = Math.round(value * 100);
    if (!commission.data) return;
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > 50 ||
      Math.abs(value * 100 - basisPoints) > 0.000001
    ) {
      setCommissionMessage("Nhập tỷ lệ từ 0% đến 50%, tối đa hai chữ số thập phân.");
      return;
    }
    setSavingCommission(true);
    setCommissionMessage("");
    try {
      const result = await adminRequest<{ basisPoints: number }>("/commission", "POST", {
        basisPoints,
        expectedEffectiveAt: commission.data.effectiveAt,
      });
      setCommissionMessage(`Đã áp dụng mức ${result.data.basisPoints / 100}% cho đơn hàng mới.`);
      commission.refresh();
    } catch (error) {
      setCommissionMessage(adminError(error));
      commission.refresh();
    } finally {
      setSavingCommission(false);
    }
  }
  const [preparing, setPreparing] = useState(false);
  const [payoutMessage, setPayoutMessage] = useState("");
  async function prepare(lecturerId?: string) {
    setPreparing(true);
    setPayoutMessage("");
    try {
      const result = await adminRequest<Payouts>(
        "/payouts/prepare",
        "POST",
        lecturerId ? { lecturerId } : {},
      );
      payouts.refresh();
      setPayoutMessage(
        `Đã lập phiếu kỳ ${result.data.month}. ${result.data.skipped?.length ? `${result.data.skipped.length} giảng viên chưa đủ điều kiện hoặc thiếu tài khoản nhận tiền. ` : ""}Cần chuyển khoản và đối chiếu riêng.`,
      );
    } catch (error) {
      setPayoutMessage(adminError(error));
    } finally {
      setPreparing(false);
    }
  }
  function exportPayouts() {
    const value = payouts.data;
    if (!value?.instructions.length) return;
    const rows = [
      ["Ky", "Ma giang vien", "Ngan hang", "So tai khoan", "Chu tai khoan", "So tien VND", "Trang thai"],
      ...value.instructions.map((item) => [
        value.month,
        item.lecturerId,
        item.bankName,
        item.accountNumber,
        item.accountHolder,
        item.amountMinor,
        item.status,
      ]),
    ];
    const csv =
      "\ufeff" +
      rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ailss-payout-${value.month}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <div className="admin-dashboard-container animate-fade-in">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">{uiText("TÀI CHÍNH & THƯƠNG MẠI")}</p>
          <h1>{uiText("Dashboard Doanh Thu & Đối Soát SePay")}</h1>
          <p className="lead">
            {uiText("Chỉ hiển thị số liệu đã được tổng hợp từ thanh toán và hoàn tiền có thể kiểm toán.")}
          </p>
        </div>
        <div className="dashboard-header-actions">
          <Link className="button button-subtle" to="/app">
            {uiText("← Tổng quan Admin")}
          </Link>
        </div>
      </div>

      <section className="dashboard-section-card admin-commission-card">
        <div className="section-card-header">
          <div className="admin-commission-header-text">
            <div className="admin-commission-title-row">
              <div className="admin-commission-icon-box">
                <Icon name="card" size={20} />
              </div>
              <h2>{uiText("Chiết khấu nền tảng")}</h2>
            </div>
            <p className="subtext">
              {uiText(
                "Tỷ lệ mới áp dụng cho các khoản thanh toán từ thời điểm lưu. Doanh thu và hoàn tiền của đơn cũ giữ tỷ lệ lúc mua.",
              )}
            </p>
            {commission.data && (
              <p className="finance-data-note">
                {uiText("Hiện tại: ")}
                {commission.data.basisPoints / 100}
                {uiText("% · Giảng viên nhận")} {100 - commission.data.basisPoints / 100}
                {uiText("% · Hiệu lực từ")} {new Date(commission.data.effectiveAt).toLocaleString(uiLocale)}
              </p>
            )}
          </div>
          <div className="inline-actions admin-commission-actions">
            <label className="admin-commission-label">
              <span className="admin-commission-label-title">{uiText("Chiết khấu (%)")}</span>
              <div className="admin-commission-input-wrap">
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="0.01"
                  value={commissionPercent}
                  onChange={(event) => setCommissionPercent(event.target.value)}
                  disabled={!commission.data || savingCommission}
                  className="admin-commission-input"
                  placeholder="0.00"
                />
                <span className="admin-commission-suffix">%</span>
              </div>
            </label>
            <button
              className="button admin-save-commission-btn"
              type="button"
              disabled={!commission.data || savingCommission}
              onClick={() => void saveCommission()}
            >
              {savingCommission ? uiText("Đang lưu…") : uiText("Lưu tỷ lệ")}
            </button>
          </div>
        </div>
        {commission.error && (
          <div className="admin-notice-callout warning" role="alert">
            <Icon name="alert" size={16} />
            <span>
              {uiText("Không tải được tỷ lệ chiết khấu: ")}
              {uiText(commission.error)}
            </span>
          </div>
        )}
        {commissionMessage && (
          <div className="admin-notice-callout success" role="status">
            <Icon name="checkCircle" size={16} />
            <span>{commissionMessage}</span>
          </div>
        )}
      </section>

      <div className="dashboard-toolbar-row">
        <div className="dashboard-filter-group" role="group" aria-label={uiText("Khoảng thời gian")}>
          {TIME_RANGES.map((item) => (
            <button
              key={item.id}
              className={`filter-pill-button ${range === item.id ? "active" : ""}`}
              onClick={() => setRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="dashboard-status-indicator">
          {hasAuthoritativeData ? (
            <>
              <span className="live-dot" />
              <span>
                {uiText("Dữ liệu đã đối soát")}
                {lastUpdated ? ` · ${lastUpdated.toLocaleTimeString(uiLocale)}` : ""}
              </span>
            </>
          ) : (
            <>
              <span className="mock-dot" style={{ backgroundColor: "#D97706" }} />
              <span>{uiText("Chưa có projection tài chính")}</span>
            </>
          )}
        </div>
      </div>

      {!hasAuthoritativeData ? (
        <section className="dashboard-section-card admin-finance-empty-card" role="status" aria-live="polite">
          <div className="admin-finance-empty-body">
            <div className="admin-finance-empty-icon-wrap">
              <Icon name="shield" size={32} />
            </div>
            <div className="admin-finance-empty-content">
              <div className="admin-finance-badge-row">
                <span className="badge">{uiText("KIỂM TOÁN TÀI CHÍNH")}</span>
                <span className="status-pill status-pending">{uiText("Đang chờ đối soát")}</span>
              </div>
              <h2>{uiText("Chưa có báo cáo doanh thu có thẩm quyền")}</h2>
              <p className="subtext">
                {uiText(
                  "Hệ thống không dùng KPI, giao dịch hoặc số liệu dự phòng giả. Báo cáo sẽ chỉ xuất hiện sau khi projection thanh toán và hoàn tiền đã sẵn sàng.",
                )}
              </p>
              {error ? (
                <p className="admin-server-error-text">
                  {uiText("Máy chủ: ")}
                  {uiText(error)}
                </p>
              ) : null}
            </div>
            <button
              className="button button-subtle admin-retry-finance-btn"
              onClick={refresh}
              disabled={loading}
            >
              <Icon name="refresh" size={15} />
              <span>{loading ? uiText("Đang kiểm tra…") : uiText("Kiểm tra lại")}</span>
            </button>
          </div>
        </section>
      ) : data ? (
        <>
          <p className="finance-data-note">
            {uiText("Thanh toán và hoàn tiền đã đối soát đến")}{" "}
            {new Date(data.completeness.backfillThrough).toLocaleDateString(uiLocale)}
          </p>
          <div className="finance-kpis">
            <article>
              <span>{uiText("Thanh toán")}</span>
              <strong>{money(data.grossMinor, uiLocale)}</strong>
              <small>
                {data.orderCount} {uiText(" đơn")}
              </small>
            </article>
            <article>
              <span>{uiText("Hoàn tiền")}</span>
              <strong>{money(data.refundMinor, uiLocale)}</strong>
              <small>
                {data.refundCount} {uiText(" giao dịch")}
              </small>
            </article>
            <article>
              <span>{uiText("Sau hoàn tiền")}</span>
              <strong>{money(data.netMinor, uiLocale)}</strong>
              <small>{uiText("Trước phân chia")}</small>
            </article>
            <article>
              <span>{uiText("Dự kiến trả giảng viên")}</span>
              <strong>
                {money(
                  data.lecturers.reduce((sum, item) => sum + BigInt(item.estimatedEarningsMinor), 0n),
                  uiLocale,
                )}
              </strong>
              <small>{uiText("Theo chính sách từng kỳ")}</small>
            </article>
          </div>
          <section className="dashboard-section-card">
            <h2>{uiText("Doanh thu theo ngày")}</h2>
            <RevenueChart rows={data.dailyRevenue} />
          </section>
          <div className="finance-columns">
            <section className="dashboard-section-card">
              <h2>{uiText("Khóa học doanh thu cao")}</h2>
              <RevenueCourses
                rows={data.lecturers
                  .flatMap((item) => item.courses)
                  .sort((a, b) =>
                    BigInt(b.netMinor) > BigInt(a.netMinor)
                      ? 1
                      : BigInt(b.netMinor) < BigInt(a.netMinor)
                        ? -1
                        : 0,
                  )
                  .slice(0, 8)}
              />
            </section>
            <section className="dashboard-section-card">
              <h2>{uiText("Phân bổ giảng viên")}</h2>
              <div className="revenue-course-list">
                {data.lecturers.map((item) => (
                  <div key={item.lecturerId}>
                    <span className="revenue-rank">♙</span>
                    <div>
                      <strong>
                        <LecturerLink id={item.lecturerId} />
                      </strong>
                      <small>
                        {item.orders} {uiText(" đơn · ")}
                        {item.courses.length} {uiText(" khóa học")}
                      </small>
                    </div>
                    <strong>{money(item.estimatedEarningsMinor, uiLocale)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="dashboard-section-card">
            <div className="section-card-header">
              <div>
                <h2>
                  {uiText("Phiếu chi kỳ ")}
                  {payouts.data?.month ?? "trước"}
                </h2>
                <p className="finance-data-note">
                  {uiText(
                    "Lập phiếu cho một người hoặc tất cả giảng viên đủ điều kiện. Phiếu đang chờ chuyển khoản thủ công; nút này chưa chuyển tiền.",
                  )}
                </p>
              </div>
              <div className="inline-actions">
                <button
                  className="button"
                  type="button"
                  disabled={preparing || payouts.data?.canPrepare === false}
                  onClick={() => void prepare()}
                >
                  {preparing ? uiText("Đang lập…") : uiText("Lập phiếu chi tất cả")}
                </button>
                <button
                  className="button button-subtle"
                  type="button"
                  disabled={!payouts.data?.instructions.length}
                  onClick={exportPayouts}
                >
                  {uiText("Tải bảng kê chuyển khoản")}
                </button>
              </div>
            </div>
            {payoutMessage && <p role="status">{payoutMessage}</p>}
            {payouts.data?.canPrepare === false && (
              <p>{uiText("Phiếu kỳ trước có thể lập sau ngày 7 để chờ hết thời hạn hoàn tiền.")}</p>
            )}
            {payouts.error && <p role="alert">{uiText(payouts.error)}</p>}
            <div className="revenue-course-list">
              {payouts.data?.candidates?.map((item) => {
                const instruction = payouts.data?.instructions.find(
                  (entry) => entry.lecturerId === item.lecturerId,
                );
                return (
                  <div key={item.lecturerId}>
                    <div>
                      <strong>
                        <LecturerLink id={item.lecturerId} />
                      </strong>
                      <small>
                        {instruction
                          ? `${instruction.bankName} · ${instruction.accountNumber} · ${instruction.accountHolder}`
                          : item.accountConfigured
                            ? uiText("Dự kiến {0} · Chưa có phiếu kỳ trước", [
                                money(item.estimatedEarningsMinor, uiLocale),
                              ])
                            : uiText("Giảng viên chưa cấu hình tài khoản nhận tiền")}
                      </small>
                    </div>
                    <span>{instruction ? money(instruction.amountMinor, uiLocale) : "—"}</span>
                    <button
                      className="button button-subtle"
                      disabled={
                        preparing ||
                        payouts.data?.canPrepare === false ||
                        !!instruction ||
                        !item.accountConfigured
                      }
                      onClick={() => void prepare(item.lecturerId)}
                    >
                      {instruction
                        ? uiText("Đã lập phiếu")
                        : item.accountConfigured
                          ? uiText("Lập phiếu chi")
                          : uiText("Thiếu tài khoản")}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
