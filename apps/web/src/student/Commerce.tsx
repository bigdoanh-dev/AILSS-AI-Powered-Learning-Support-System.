import { useEffect, useRef, useState } from "react";
import { OperationResult } from "../components/OperationResult";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { studentRequest, useStudent, type LearningCourse } from "./api";
import { Heading } from "./ui";
import { Icon } from "../components/Icon";

type Offering = {
  offeringId: string;
  courseId: string;
  title: string;
  offeringType: "SELF_PACED" | "LIVE_COHORT";
  price: string;
  currency: string;
  state: string;
  salesStartAt?: string | null;
  salesEndAt?: string | null;
};

type Order = {
  orderId: string;
  courseId: string;
  offeringId: string;
  offeringType: string;
  state: "PENDING" | "PAYMENT_FAILED" | "PAID_PENDING_ENTITLEMENT" | "ENTITLED";
  fulfillmentState: string;
  price: string;
  currency: string;
  compensationReason?: string;
  paymentMode?: "simulation" | "sepay";
  payment?: { accountNumber: string; accountName: string; bank: string; content: string; qrUrl: string };
};

const offeringsOf = (v?: Offering[] | { items: Offering[] }) => (Array.isArray(v) ? v : v?.items || []);

type PaymentMethodType = "VIETQR_SEPAY" | "BANK_TRANSFER";

export default function Purchase() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const savedOrderId = params.get("order");
  const { courseId = "" } = useParams();

  const own = useStudent<LearningCourse[]>("/me/courses");
  const entitled = own.data?.some((course) => course.courseId === courseId);
  const offerings = useStudent<Offering[] | { items: Offering[] }>(
    entitled ? null : `/courses/${courseId}/offerings`,
  );

  const course = useStudent<{ title: string }>(`/courses/${courseId}`);
  const courseTitle = course.data?.title ?? "Khóa học";

  const available: Offering[] = offeringsOf(offerings.data).filter((o) => o.state === "PUBLISHED");

  const [order, setOrder] = useState<Order | null>(null);
  const [selectedOfferingId, setSelectedOfferingId] = useState<string>(available[0]?.offeringId || "");
  const [method, setMethod] = useState<PaymentMethodType>("VIETQR_SEPAY");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const abort = useRef(new AbortController());
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    abort.current = new AbortController();
    return () => abort.current.abort();
  }, []);

  // Update selectedOfferingId when available items load
  useEffect(() => {
    if (available.length > 0 && !selectedOfferingId) {
      setSelectedOfferingId(available[0].offeringId);
    }
  }, [available, selectedOfferingId]);

  // Load existing order from URL param
  useEffect(() => {
    if (!savedOrderId) return;
    const controller = new AbortController();
    studentRequest<Order>(`/orders/${savedOrderId}`, controller.signal)
      .then((r) => {
        setOrder(r.data);
        setMessage("");
      })
      .catch(() => {
        setOrder(null);
        setMessage(
          "Không thể xác minh đơn hàng. Không thực hiện chuyển khoản khi chưa có đơn hợp lệ từ máy chủ.",
        );
      });
    return () => controller.abort();
  }, [savedOrderId]);

  // Polling check for order status
  useEffect(() => {
    if (
      !order ||
      !["PENDING", "PAID_PENDING_ENTITLEMENT"].includes(order.state) ||
      order.fulfillmentState === "REFUND_REQUIRED"
    )
      return;

    const controller = new AbortController();
    let polling = false;
    const timer = window.setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const r = await studentRequest<Order>(`/orders/${order.orderId}`, controller.signal);
        setOrder(r.data);
        setMessage("");
      } catch {
        setMessage(
          "Mất kết nối khi xác minh đơn hàng. Vui lòng không chuyển khoản cho đến khi kết nối được khôi phục.",
        );
      } finally {
        polling = false;
      }
    }, 2000);

    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [order?.orderId, order?.state, order?.fulfillmentState]);

  function copyToClipboard(text: string, fieldName: string) {
    void navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  }

  async function handleCreateOrder(offeringIdToBuy?: string) {
    const targetOfferingId = offeringIdToBuy || selectedOfferingId || available[0]?.offeringId;
    if (!targetOfferingId) {
      setMessage("Khóa học này chưa có gói học được mở bán từ backend.");
      return;
    }
    const path = "/orders";
    const body = { offeringId: targetOfferingId };
    const fingerprint = path + JSON.stringify(body);
    const key = keys.current.get(fingerprint) || crypto.randomUUID();
    keys.current.set(fingerprint, key);

    setBusy(true);
    setMessage("");

    try {
      const r = await studentRequest<Order>(path, abort.current.signal, "POST", body, key);
      keys.current.delete(fingerprint);
      setOrder(r.data);
      setParams({ order: r.data.orderId }, { replace: true });
    } catch {
      setOrder(null);
      setMessage(
        "Không thể tạo đơn hàng có thẩm quyền. Hệ thống chưa phát sinh mã chuyển khoản hoặc yêu cầu thanh toán.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSimulateSuccess() {
    if (!order || order.paymentMode !== "simulation") return;
    setBusy(true);
    try {
      if (order) {
        // Try calling real API simulation endpoint if order was created on server
        const response = await studentRequest<Order>(
          `/orders/${order.orderId}/simulate-payment`,
          abort.current.signal,
          "POST",
          { outcome: "SUCCESS" },
        );
        setOrder(response.data);
      }
    } catch {
      setMessage("Máy chủ chưa xác nhận thanh toán; quyền học không được kích hoạt.");
    } finally {
      setBusy(false);
    }
  }

  async function checkPayment() {
    if (!order) return;
    setBusy(true);
    try {
      const response = await studentRequest<Order>(`/orders/${order.orderId}`, abort.current.signal);
      setOrder(response.data);
      setMessage(
        response.data.state === "PENDING"
          ? "Chưa nhận được xác nhận thanh toán từ ngân hàng. Hệ thống tiếp tục đối soát tự động."
          : "Đã cập nhật trạng thái từ máy chủ.",
      );
    } catch {
      setMessage("Không thể kiểm tra thanh toán. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  const selectedOffering = available.find((item) => item.offeringId === selectedOfferingId) ?? available[0];
  const cleanNumericPrice = (order?.price ?? selectedOffering?.price ?? "").replace(/[^\d]/g, "");
  const formattedDisplayPrice = Number(cleanNumericPrice).toLocaleString("vi-VN") + " ₫";
  const paymentContent = order?.payment?.content || "";
  const vietQrOfficialUrl = order?.payment?.qrUrl || "";
  const sepayQrUrl = order?.payment?.qrUrl || "";
  const [qrSrc, setQrSrc] = useState<string>("");

  useEffect(() => {
    setQrSrc(vietQrOfficialUrl);
  }, [vietQrOfficialUrl]);

  return (
    <>
      <Link className="checkout-back-link" to="/app/learn">
        ← Quay lại danh mục khóa học
      </Link>
      <Heading title="Thanh toán khóa học">
        Thanh toán chuyển khoản bằng mã VietQR hoặc thông tin ngân hàng từ đơn hàng.
      </Heading>

      {/* Already Entitled */}
      {entitled && !order ? (
        <section className="study-card commerce-status">
          <p className="eyebrow">QUYỀN HỌC HỢP LỆ</p>
          <h2>Bạn đã sở hữu khóa học này!</h2>
          <p className="subtext">
            Tài khoản của bạn đã được kích hoạt toàn bộ nội dung video, bài tập và trợ lý AI.
          </p>
          <div style={{ marginTop: 16 }}>
            <Link className="button" to={`/app/learn/${courseId}`}>
              Tiếp tục học ngay →
            </Link>
          </div>
        </section>
      ) : order?.state === "ENTITLED" ? (
        /* Payment Success & Entitled */
        <OperationResult
          success
          title="Thanh toán thành công!"
          onComplete={() => navigate(`/app/learn/${order.courseId}`, { replace: true })}
          action={
            <div style={{ display: "flex", gap: 12 }}>
              <Link className="button" to={`/app/learn/${order.courseId}`}>
                Bắt đầu học ngay →
              </Link>
              <Link className="button button-subtle" to="/app/learn">
                Về danh mục khóa học
              </Link>
            </div>
          }
        >
          <div style={{ display: "grid", gap: 8 }}>
            <p>
              Hệ thống đã nhận thanh toán{" "}
              <strong>
                {order.price} {order.currency}
              </strong>{" "}
              cho đơn hàng <code>{order.orderId}</code>.
            </p>
            <p style={{ color: "#16a34a", fontWeight: 600 }}>
              ✓ Giao dịch đã được đối soát tự động và cấp quyền truy cập khóa học hoàn tất!
            </p>
          </div>
        </OperationResult>
      ) : order?.state === "PAYMENT_FAILED" ? (
        <OperationResult
          success={false}
          title="Thanh toán chưa thành công"
          onComplete={() => {
            setOrder(null);
            setParams({});
          }}
          action={
            <button
              className="button"
              onClick={() => {
                setOrder(null);
                setParams({});
              }}
            >
              Chọn lại phương thức thanh toán
            </button>
          }
        >
          <p>
            Nếu tài khoản đã bị trừ tiền, vui lòng liên hệ ban hỗ trợ kèm mã đơn <code>{order.orderId}</code>.
          </p>
        </OperationResult>
      ) : order ? (
        /* Pending Payment Order View */
        <div className="checkout-layout">
          <section className="checkout-panel">
            <div className="payment-tabs-bar" role="tablist" aria-label="Phương thức thanh toán">
              <button
                type="button"
                className={`payment-tab-btn ${method === "VIETQR_SEPAY" ? "active" : ""}`}
                onClick={() => setMethod("VIETQR_SEPAY")}
              >
                <Icon name="zap" size={16} />
                <span>VietQR (Tự động 24/7)</span>
                <span className="payment-method-badge">24/7</span>
              </button>
              <button
                type="button"
                className={`payment-tab-btn ${method === "BANK_TRANSFER" ? "active" : ""}`}
                onClick={() => setMethod("BANK_TRANSFER")}
              >
                <Icon name="receipt" size={16} />
                <span>Chuyển khoản Ngân hàng</span>
              </button>
            </div>

            {/* VietQR SePay View */}
            {method === "VIETQR_SEPAY" && (
              <div className="payment-instructions" style={{ marginTop: 0 }}>
                <div className="sepay-qr-card">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      width: "100%",
                      paddingBottom: 8,
                      marginBottom: 8,
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong style={{ color: "#0284c7", fontSize: 13, letterSpacing: 0.5 }}>VIETQR</strong>
                      <span
                        style={{
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 4,
                          border: "1px solid #bfdbfe",
                        }}
                      >
                        NAPAS 24/7
                      </span>
                    </div>
                    <span
                      style={{
                        background: "#002b49",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 800,
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {order.payment?.bank}
                    </span>
                  </div>
                  <img
                    className="sepay-qr-img"
                    src={qrSrc || vietQrOfficialUrl}
                    onError={() => {
                      if (qrSrc !== sepayQrUrl) {
                        setQrSrc(sepayQrUrl);
                      }
                    }}
                    alt="Mã VietQR thanh toán tự động 24/7"
                    width="270"
                    height="270"
                  />
                  <div className="sepay-timer-pill">
                    <span className="pulse-dot-blue" />
                    <span>Đang chờ xác nhận từ ngân hàng</span>
                  </div>
                  <small style={{ marginTop: 8, color: "var(--muted)", textAlign: "center" }}>
                    Quét bằng ứng dụng ngân hàng
                  </small>
                  <a
                    href={qrSrc || vietQrOfficialUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="button button-subtle button-small"
                    style={{ marginTop: 8, fontSize: 11.5, padding: "4px 8px" }}
                  >
                    🔍 Mở ảnh QR phóng to
                  </a>
                </div>

                <div>
                  <div style={{ marginBottom: 16 }}>
                    <p className="eyebrow" style={{ color: "var(--blue)" }}>
                      CHUYỂN KHOẢN VIETQR 24/7
                    </p>
                    <h3 style={{ margin: "4px 0 8px" }}>Thông Tin Chuyển Khoản Ngân Hàng</h3>
                    <p style={{ fontSize: "0.88rem", color: "var(--muted)" }}>
                      Hệ thống tự động kiểm tra biến động số dư và kích hoạt khóa học trong vòng 1-3 giây.
                    </p>
                  </div>

                  <div
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: 14,
                      padding: "12px 16px",
                      marginBottom: 16,
                    }}
                  >
                    <div className="bank-copy-row">
                      <span className="bank-copy-label">Ngân hàng thụ hưởng</span>
                      <div className="bank-copy-value-wrap">
                        <span className="bank-copy-value">{order.payment?.bank}</span>
                        <button
                          type="button"
                          className={`copy-btn-mini ${copiedField === "bank" ? "copied" : ""}`}
                          onClick={() => copyToClipboard(order.payment?.bank || "", "bank")}
                        >
                          {copiedField === "bank" ? "✓ Đã chép" : "Sao chép"}
                        </button>
                      </div>
                    </div>
                    <div className="bank-copy-row">
                      <span className="bank-copy-label">Số tài khoản</span>
                      <div className="bank-copy-value-wrap">
                        <span className="bank-copy-value" style={{ color: "var(--blue)" }}>
                          {order.payment?.accountNumber}
                        </span>
                        <button
                          type="button"
                          className={`copy-btn-mini ${copiedField === "stk" ? "copied" : ""}`}
                          onClick={() => copyToClipboard(order.payment?.accountNumber || "", "stk")}
                        >
                          {copiedField === "stk" ? "✓ Đã chép" : "Sao chép"}
                        </button>
                      </div>
                    </div>
                    <div className="bank-copy-row">
                      <span className="bank-copy-label">Chủ tài khoản</span>
                      <div className="bank-copy-value-wrap">
                        <span className="bank-copy-value">{order.payment?.accountName}</span>
                        <button
                          type="button"
                          className={`copy-btn-mini ${copiedField === "name" ? "copied" : ""}`}
                          onClick={() => copyToClipboard(order.payment?.accountName || "", "name")}
                        >
                          {copiedField === "name" ? "✓ Đã chép" : "Sao chép"}
                        </button>
                      </div>
                    </div>
                    <div className="bank-copy-row">
                      <span className="bank-copy-label">Số tiền chính xác</span>
                      <div className="bank-copy-value-wrap">
                        <span className="bank-copy-value" style={{ color: "#16a34a" }}>
                          {order.price} {order.currency}
                        </span>
                        <button
                          type="button"
                          className={`copy-btn-mini ${copiedField === "amount" ? "copied" : ""}`}
                          onClick={() => copyToClipboard(cleanNumericPrice, "amount")}
                        >
                          {copiedField === "amount" ? "✓ Đã chép" : "Sao chép"}
                        </button>
                      </div>
                    </div>
                    <div className="bank-copy-row bank-copy-memo-row">
                      <div className="bank-copy-memo-header">
                        <span className="bank-copy-label">
                          <strong>Nội dung chuyển khoản</strong> (chính xác)
                        </span>
                        <button
                          type="button"
                          className={`copy-btn-mini ${copiedField === "content" ? "copied" : ""}`}
                          onClick={() => copyToClipboard(paymentContent, "content")}
                        >
                          {copiedField === "content" ? "✓ Đã chép" : "Sao chép"}
                        </button>
                      </div>
                      <div className="bank-copy-memo-box">
                        <strong className="bank-copy-memo-code">{paymentContent}</strong>
                      </div>
                      <small className="bank-copy-memo-hint">
                        ⚠️ Vui lòng giữ nguyên nội dung chuyển khoản để hệ thống tự động kích hoạt ngay lập
                        tức.
                      </small>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="button button-subtle button-small"
                    style={{ width: "100%", justifyContent: "center", marginBottom: 16 }}
                    onClick={() => {
                      const allInfo = `Ngân hàng: ${order.payment?.bank || ""}\nSố tài khoản: ${order.payment?.accountNumber || ""}\nChủ tài khoản: ${order.payment?.accountName || ""}\nSố tiền: ${order.price} ${order.currency}\nNội dung chuyển khoản: ${paymentContent}`;
                      copyToClipboard(allInfo, "all");
                    }}
                  >
                    <Icon name="receipt" size={14} />
                    <span>
                      {copiedField === "all"
                        ? "✓ Đã sao chép toàn bộ thông tin CK"
                        : "📋 Sao chép toàn bộ thông tin chuyển khoản"}
                    </span>
                  </button>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button
                      type="button"
                      className="button"
                      style={{ width: "100%", justifyContent: "center" }}
                      disabled={busy}
                      onClick={order.paymentMode === "simulation" ? handleSimulateSuccess : checkPayment}
                    >
                      {busy
                        ? "Đang kiểm tra…"
                        : order.paymentMode === "simulation"
                          ? "Mô phỏng thanh toán thành công (local)"
                          : "Kiểm tra thanh toán"}
                    </button>
                    <button
                      type="button"
                      className="button button-subtle"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={() => {
                        setOrder(null);
                        setParams({});
                      }}
                    >
                      ← Đổi gói học khác
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Bank Transfer View */}
            {method === "BANK_TRANSFER" && (
              <div style={{ padding: "8px 0" }}>
                <p className="eyebrow" style={{ color: "var(--blue)" }}>
                  CHUYỂN KHOẢN TRỰC TIẾP
                </p>
                <h3 style={{ margin: "4px 0 16px" }}>Hướng Dẫn Chuyển Khoản Internet Banking</h3>

                <div className="bank-transfer-steps-list">
                  <div className="bank-transfer-step-item">
                    <span className="step-number-badge">1</span>
                    <div className="step-content">
                      <strong>Mở ứng dụng ngân hàng</strong>
                      <p>Mở ứng dụng Mobile Banking của ngân hàng bạn đang sử dụng trên điện thoại.</p>
                    </div>
                  </div>

                  <div className="bank-transfer-step-item">
                    <span className="step-number-badge">2</span>
                    <div className="step-content">
                      <strong>Chọn chuyển tiền nhanh Napas 24/7</strong>
                      <p>
                        Chọn tính năng Chuyển tiền nhanh liên ngân hàng 24/7 để giao dịch được xử lý ngay lập
                        tức.
                      </p>
                    </div>
                  </div>

                  <div className="bank-transfer-step-item">
                    <span className="step-number-badge">3</span>
                    <div className="step-content">
                      <strong>Nhập số tài khoản &amp; Ngân hàng nhận</strong>
                      <p>
                        Ngân hàng <strong>{order.payment?.bank}</strong> · STK:{" "}
                        <strong style={{ color: "var(--blue)" }}>{order.payment?.accountNumber}</strong>
                      </p>
                      <button
                        type="button"
                        className="copy-btn-mini"
                        style={{ marginTop: 6 }}
                        onClick={() => copyToClipboard(order.payment?.accountNumber || "", "stk")}
                      >
                        {copiedField === "stk" ? "✓ Đã chép STK" : "Sao chép STK"}
                      </button>
                    </div>
                  </div>

                  <div className="bank-transfer-step-item">
                    <span className="step-number-badge">4</span>
                    <div className="step-content">
                      <strong>Nhập chính xác số tiền</strong>
                      <p>
                        Số tiền:{" "}
                        <strong style={{ color: "#16a34a" }}>
                          {order.price} {order.currency}
                        </strong>
                      </p>
                      <button
                        type="button"
                        className="copy-btn-mini"
                        style={{ marginTop: 6 }}
                        onClick={() => copyToClipboard(cleanNumericPrice, "amount")}
                      >
                        {copiedField === "amount" ? "✓ Đã chép số tiền" : "Sao chép số tiền"}
                      </button>
                    </div>
                  </div>

                  <div className="bank-transfer-step-item highlight">
                    <span className="step-number-badge accent">5</span>
                    <div className="step-content">
                      <strong>Điền đúng nội dung chuyển khoản</strong>
                      <p>
                        Nội dung:{" "}
                        <strong
                          style={{
                            background: "#fef3c7",
                            color: "#92400e",
                            padding: "2px 6px",
                            borderRadius: 6,
                          }}
                        >
                          {paymentContent}
                        </strong>
                      </p>
                      <button
                        type="button"
                        className="copy-btn-mini"
                        style={{ marginTop: 6 }}
                        onClick={() => copyToClipboard(paymentContent, "content")}
                      >
                        {copiedField === "content" ? "✓ Đã chép nội dung" : "Sao chép nội dung"}
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="button"
                    style={{ flex: 1, minWidth: 200, justifyContent: "center" }}
                    disabled={busy}
                    onClick={order.paymentMode === "simulation" ? handleSimulateSuccess : checkPayment}
                  >
                    {busy
                      ? "Đang kiểm tra…"
                      : order.paymentMode === "simulation"
                        ? "Mô phỏng thanh toán thành công (local)"
                        : "Kiểm tra thanh toán"}
                  </button>
                  <button
                    type="button"
                    className="button button-subtle"
                    onClick={() => setMethod("VIETQR_SEPAY")}
                  >
                    Xem mã VietQR
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Right Summary Panel for Active Order */}
          <section className="checkout-summary">
            <p className="eyebrow">TỔNG KẾT ĐƠN HÀNG</p>
            <h2 style={{ fontSize: "1.25rem", margin: "4px 0 12px" }}>{courseTitle}</h2>
            <dl className="profile-facts" style={{ margin: "16px 0" }}>
              <dt>Mã đơn</dt>
              <dd>
                <code className="order-id-code">{order.orderId}</code>
              </dd>
              <dt>Gói học</dt>
              <dd>{order.offeringType === "SELF_PACED" ? "Tự học AI" : "Live Cohort"}</dd>
              <dt>Tổng tiền</dt>
              <dd>
                <strong style={{ color: "var(--blue)", fontSize: "1.1rem" }}>
                  {order.price} {order.currency}
                </strong>
              </dd>
            </dl>
            <div className="sepay-assurance" style={{ marginTop: 16 }}>
              <strong>Bảo đảm an toàn giao dịch</strong>
              <span>
                Biến động số dư tài khoản được đối soát tức thì. Không chuyển tiền lại khi đã bị trừ tiền
                trong tài khoản.
              </span>
            </div>
            <button
              type="button"
              className="button button-subtle"
              style={{ marginTop: 12, width: "100%" }}
              onClick={() => {
                setOrder(null);
                setParams({});
              }}
            >
              ← Chọn lại gói học / phương thức khác
            </button>
          </section>
        </div>
      ) : offerings.pending && !available.length ? (
        <div className="study-state" role="status">
          Đang tải thông tin khóa học &amp; gói học…
        </div>
      ) : (
        /* Package Selection & Method Selection Screen (No Active Order Yet) */
        <div className="checkout-layout">
          <section className="checkout-panel">
            <p className="eyebrow">BƯỚC 1: PHƯƠNG THỨC THANH TOÁN</p>
            <h2>Chọn hình thức thanh toán</h2>
            <div className="payment-method-list" role="radiogroup" aria-label="Phương thức thanh toán">
              <label className={method === "VIETQR_SEPAY" ? "payment-method selected" : "payment-method"}>
                <input
                  type="radio"
                  name="payment-method"
                  checked={method === "VIETQR_SEPAY"}
                  onChange={() => setMethod("VIETQR_SEPAY")}
                />
                <span className="payment-method-icon">⚡</span>
                <span>
                  <strong>Chuyển khoản VietQR (Tự động 24/7)</strong>
                  <small>Quét mã bằng ứng dụng ngân hàng · Chờ máy chủ xác nhận</small>
                </span>
                <span className="recommended-chip">Nhanh nhất</span>
              </label>

              <label className={method === "BANK_TRANSFER" ? "payment-method selected" : "payment-method"}>
                <input
                  type="radio"
                  name="payment-method"
                  checked={method === "BANK_TRANSFER"}
                  onChange={() => setMethod("BANK_TRANSFER")}
                />
                <span className="payment-method-icon">🏦</span>
                <span>
                  <strong>Chuyển khoản Ngân hàng thủ công</strong>
                  <small>Xem số tài khoản MB Bank và nội dung để chuyển khoản</small>
                </span>
              </label>
            </div>

            <div className="sepay-assurance">
              <strong>Hệ thống thanh toán đối soát tự động</strong>
              <span>
                Khóa học sẽ được kích hoạt quyền học tự động ngay khi tài khoản nhận được thanh toán.
              </span>
            </div>
          </section>

          <section className="checkout-summary">
            <p className="eyebrow">BƯỚC 2: CHỌN GÓI HỌC</p>
            <h2>{selectedOffering?.title ?? courseTitle}</h2>
            <p className="subtext" style={{ marginBottom: 16 }}></p>

            <div style={{ display: "grid", gap: 12 }}>
              {available.map((o) => {
                const isSelected = selectedOfferingId === o.offeringId;
                const cleanPrice = o.price.replace(/[^\d]/g, "");
                const formattedPrice = Number(cleanPrice).toLocaleString("vi-VN") + " ₫";
                return (
                  <article
                    className={`checkout-offering ${isSelected ? "selected-offering-box" : ""}`}
                    key={o.offeringId}
                    style={{
                      padding: 16,
                      border: isSelected ? "2px solid var(--blue)" : "1px solid var(--line)",
                      borderRadius: 14,
                      background: isSelected
                        ? "color-mix(in srgb, var(--blue) 5%, var(--surface))"
                        : "var(--surface)",
                      cursor: "pointer",
                    }}
                    onClick={() => setSelectedOfferingId(o.offeringId)}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <span className="badge">
                        {o.offeringType === "SELF_PACED" ? "Tự học AI" : "Live Cohort"}
                      </span>
                      <strong style={{ color: "var(--blue)", fontSize: "1.1rem" }}>{formattedPrice}</strong>
                    </div>
                    <h4 style={{ margin: "4px 0 6px", fontSize: "0.95rem" }}>{o.title}</h4>
                    <small style={{ color: "var(--muted)" }}>
                      {o.offeringType === "SELF_PACED"
                        ? "Quyền truy cập vĩnh viễn, học liệu số & AI Tutor"
                        : "Tham gia lớp học trực tiếp kèm Mentor và chứng nhận"}
                    </small>
                  </article>
                );
              })}
            </div>

            <div style={{ marginTop: 20 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 12,
                  fontWeight: 700,
                }}
              >
                <span>Tổng thanh toán:</span>
                <span style={{ color: "var(--blue)", fontSize: "1.2rem" }}>{formattedDisplayPrice}</span>
              </div>
              <button
                type="button"
                className="button checkout-pay-button"
                disabled={busy || !selectedOffering}
                onClick={() => handleCreateOrder(selectedOfferingId)}
              >
                {busy
                  ? "Đang tạo đơn hàng..."
                  : `Tiếp tục thanh toán (${method === "VIETQR_SEPAY" ? "VietQR" : "Chuyển khoản"})`}
              </button>
              {!offerings.pending && !selectedOffering ? (
                <p role="alert" style={{ marginTop: 10, color: "var(--danger)" }}>
                  Khóa học này không tồn tại hoặc chưa có gói học được mở bán trên backend.
                </p>
              ) : null}
            </div>

            <p className="checkout-terms" style={{ marginTop: 12 }}>
              Bằng việc tiếp tục, bạn đồng ý với điều khoản thanh toán và chính sách hoàn tiền của AILSS.
            </p>
          </section>
        </div>
      )}

      {message && (
        <p role="status" style={{ marginTop: 12, color: "var(--danger)" }}>
          {message}
        </p>
      )}
    </>
  );
}
