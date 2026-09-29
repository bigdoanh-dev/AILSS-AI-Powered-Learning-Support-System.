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
    <div className="admin-dashboard-container">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">TÀI CHÍNH &amp; THƯƠNG MẠI</p>
          <h1>Dashboard Doanh Thu &amp; Đối Soát SePay</h1>
          <p className="lead">
            Chỉ hiển thị số liệu đã được tổng hợp từ thanh toán và hoàn tiền có thể kiểm toán.
          </p>
        </div>
        <Link className="button button-subtle" to="/app">
          ← Tổng quan Admin
        </Link>
      </div>

      <section className="dashboard-section-card">
        <div className="section-card-header">
          <div>
            <h2>Chiết khấu nền tảng</h2>
            <p className="subtext">
              Tỷ lệ mới áp dụng cho các khoản thanh toán từ thời điểm lưu. Doanh thu và hoàn tiền của đơn cũ
              giữ tỷ lệ lúc mua.
            </p>
            {commission.data && (
              <p className="finance-data-note">
                Hiện tại: {commission.data.basisPoints / 100}% · Giảng viên nhận{" "}
                {100 - commission.data.basisPoints / 100}% · Hiệu lực từ{" "}
                {new Date(commission.data.effectiveAt).toLocaleString("vi-VN")}
              </p>
            )}
          </div>
          <div className="inline-actions">
            <label>
              Chiết khấu (%){" "}
              <input
                type="number"
                min="0"
                max="50"
                step="0.01"
                value={commissionPercent}
                onChange={(event) => setCommissionPercent(event.target.value)}
                disabled={!commission.data || savingCommission}
              />
            </label>
            <button
              className="button"
              type="button"
              disabled={!commission.data || savingCommission}
              onClick={() => void saveCommission()}
            >
              {savingCommission ? "Đang lưu…" : "Lưu tỷ lệ"}
            </button>
          </div>
        </div>
        {commission.error && <p role="alert">Không tải được tỷ lệ chiết khấu: {commission.error}</p>}
        {commissionMessage && <p role="status">{commissionMessage}</p>}
      </section>

      <div className="dashboard-toolbar-row">
        <div className="dashboard-filter-group" role="group" aria-label="Khoảng thời gian">
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
                Dữ liệu đã đối soát
                {lastUpdated ? ` · ${lastUpdated.toLocaleTimeString("vi-VN")}` : ""}
              </span>
            </>
          ) : (
            <>
              <span className="mock-dot" style={{ backgroundColor: "#D97706" }} />
              <span>Chưa có projection tài chính</span>
            </>
          )}
        </div>
      </div>

      {!hasAuthoritativeData ? (
        <section className="dashboard-section-card" role="status" aria-live="polite">
          <div className="section-card-header">
            <div>
              <h2>Chưa có báo cáo doanh thu có thẩm quyền</h2>
              <p className="subtext">
                Hệ thống không dùng KPI, giao dịch hoặc số liệu dự phòng giả. Báo cáo sẽ chỉ xuất hiện sau khi
                projection thanh toán và hoàn tiền đã sẵn sàng.
              </p>
              {error ? <p className="subtext">Máy chủ: {error}</p> : null}
            </div>
            <button className="button button-subtle" onClick={refresh} disabled={loading}>
              <Icon name="refresh" size={15} /> {loading ? "Đang kiểm tra…" : "Kiểm tra lại"}
            </button>
          </div>
        </section>
      ) : data ? (
        <>
          <p className="finance-data-note">
            Thanh toán và hoàn tiền đã đối soát đến{" "}
            {new Date(data.completeness.backfillThrough).toLocaleDateString("vi-VN")}
          </p>
          <div className="finance-kpis">
            <article>
              <span>Thanh toán</span>
              <strong>{money(data.grossMinor)}</strong>
              <small>{data.orderCount} đơn</small>
            </article>
            <article>
              <span>Hoàn tiền</span>
              <strong>{money(data.refundMinor)}</strong>
              <small>{data.refundCount} giao dịch</small>
            </article>
            <article>
              <span>Sau hoàn tiền</span>
              <strong>{money(data.netMinor)}</strong>
              <small>Trước phân chia</small>
            </article>
            <article>
              <span>Dự kiến trả giảng viên</span>
              <strong>
                {money(data.lecturers.reduce((sum, item) => sum + BigInt(item.estimatedEarningsMinor), 0n))}
              </strong>
              <small>Theo chính sách từng kỳ</small>
            </article>
          </div>
          <section className="dashboard-section-card">
            <h2>Doanh thu theo ngày</h2>
            <RevenueChart rows={data.dailyRevenue} />
          </section>
          <div className="finance-columns">
            <section className="dashboard-section-card">
              <h2>Khóa học doanh thu cao</h2>
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
              <h2>Phân bổ giảng viên</h2>
              <div className="revenue-course-list">
                {data.lecturers.map((item) => (
                  <div key={item.lecturerId}>
                    <span className="revenue-rank">♙</span>
                    <div>
                      <strong>
                        <LecturerLink id={item.lecturerId} />
                      </strong>
                      <small>
                        {item.orders} đơn · {item.courses.length} khóa học
                      </small>
                    </div>
                    <strong>{money(item.estimatedEarningsMinor)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
          <section className="dashboard-section-card">
            <div className="section-card-header">
              <div>
                <h2>Phiếu chi kỳ {payouts.data?.month ?? "trước"}</h2>
                <p className="finance-data-note">
                  Lập phiếu cho một người hoặc tất cả giảng viên đủ điều kiện. Phiếu đang chờ chuyển khoản thủ
                  công; nút này chưa chuyển tiền.
                </p>
              </div>
              <div className="inline-actions">
                <button
                  className="button"
                  type="button"
                  disabled={preparing || payouts.data?.canPrepare === false}
                  onClick={() => void prepare()}
                >
                  {preparing ? "Đang lập…" : "Lập phiếu chi tất cả"}
                </button>
                <button
                  className="button button-subtle"
                  type="button"
                  disabled={!payouts.data?.instructions.length}
                  onClick={exportPayouts}
                >
                  Tải bảng kê chuyển khoản
                </button>
              </div>
            </div>
            {payoutMessage && <p role="status">{payoutMessage}</p>}
            {payouts.data?.canPrepare === false && (
              <p>Phiếu kỳ trước có thể lập sau ngày 7 để chờ hết thời hạn hoàn tiền.</p>
            )}
            {payouts.error && <p role="alert">{payouts.error}</p>}
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
                            ? `Dự kiến ${money(item.estimatedEarningsMinor)} · Chưa có phiếu kỳ trước`
                            : "Giảng viên chưa cấu hình tài khoản nhận tiền"}
                      </small>
                    </div>
                    <span>{instruction ? money(instruction.amountMinor) : "—"}</span>
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
                        ? "Đã lập phiếu"
                        : item.accountConfigured
                          ? "Lập phiếu chi"
                          : "Thiếu tài khoản"}
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
