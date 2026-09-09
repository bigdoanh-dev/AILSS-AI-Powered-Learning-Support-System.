import { useEffect, useRef, useState } from "react";
import { OperationResult } from "../components/OperationResult";
import { Link, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { studentError, studentRequest, useStudent, type LearningCourse } from "./api";
import { Heading, State, Empty } from "./ui";

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
  payment?: { accountNumber: string; accountName: string; bank: string; content: string; qrUrl: string };
};
const offeringsOf = (v?: Offering[] | { items: Offering[] }) => (Array.isArray(v) ? v : v?.items || []);
const label: Record<Order["state"], string> = {
  PENDING: "Chờ xác nhận chuyển khoản",
  PAYMENT_FAILED: "Thanh toán chưa thành công",
  PAID_PENDING_ENTITLEMENT: "Đã thanh toán, đang cấp quyền học",
  ENTITLED: "Đã cấp quyền học",
};

export default function Purchase() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const savedOrderId = params.get("order");
  const { courseId = "" } = useParams(),
    own = useStudent<LearningCourse[]>("/me/courses"),
    entitled = own.data?.some((course) => course.courseId === courseId),
    offerings = useStudent<Offering[] | { items: Offering[] }>(
      entitled ? null : `/courses/${courseId}/offerings`,
    );
  const [order, setOrder] = useState<Order | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const abort = useRef(new AbortController()),
    keys = useRef(new Map<string, string>());
  useEffect(() => {
    abort.current = new AbortController();
    return () => abort.current.abort();
  }, []);
  useEffect(() => {
    if (!savedOrderId) return;
    const controller = new AbortController();
    studentRequest<Order>(`/orders/${savedOrderId}`, controller.signal)
      .then((r) => {
        setOrder(r.data);
        setMessage("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setMessage(studentError(e));
      });
    return () => controller.abort();
  }, [savedOrderId]);
  async function command(path: string, body: unknown) {
    const fingerprint = path + JSON.stringify(body),
      key = keys.current.get(fingerprint) || crypto.randomUUID();
    keys.current.set(fingerprint, key);
    setBusy(true);
    setMessage("");
    try {
      const r = await studentRequest<Order>(path, abort.current.signal, "POST", body, key);
      keys.current.delete(fingerprint);
      setOrder(r.data);
      setParams({ order: r.data.orderId }, { replace: true });
    } catch (e) {
      setMessage(studentError(e));
    } finally {
      setBusy(false);
    }
  }
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
      } catch (e) {
        if (!controller.signal.aborted) setMessage(studentError(e));
      } finally {
        polling = false;
      }
    }, 1500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [order?.orderId, order?.state, order?.fulfillmentState]);
  const available = offeringsOf(offerings.data).filter((o) => o.state === "PUBLISHED");
  return (
    <>
      <Link to="/app/learn">← Học tập</Link>
      <Heading title="Đăng ký khóa học có phí">
        Chuyển khoản đúng thông tin bên dưới. Hệ thống tự động xác nhận khi nhận được giao dịch.
      </Heading>
      {entitled ? (
        <section className="study-card commerce-status">
          <p className="eyebrow">QUYỀN HỌC</p>
          <h2>Bạn đã có quyền truy cập khóa học này.</h2>
          <Link className="button" to={`/app/learn/${courseId}`}>
            Tiếp tục học →
          </Link>
        </section>
      ) : order?.fulfillmentState === "REFUND_REQUIRED" ? (
        <OperationResult
          success={false}
          title="Đã nhận tiền, cần hỗ trợ cấp quyền"
          onComplete={() => navigate("/contact", { state: { orderId: order.orderId } })}
          action={
            <Link className="button" to="/contact">
              Liên hệ hỗ trợ
            </Link>
          }
        >
          <p>
            Đơn {order.orderId} chưa thể cấp quyền học. Vui lòng cung cấp mã đơn để được xử lý hoặc hoàn tiền.
            Không chuyển khoản lại.
          </p>
        </OperationResult>
      ) : order?.state === "ENTITLED" ? (
        <OperationResult
          success
          title="Thanh toán thành công"
          onComplete={() => navigate(`/app/learn/${order.courseId}`, { replace: true })}
          action={
            <Link className="button" to={`/app/learn/${order.courseId}`}>
              Bắt đầu học →
            </Link>
          }
        >
          <p>
            Đã nhận {order.price} {order.currency} và cấp quyền học cho đơn {order.orderId}.
          </p>
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
              Quay lại chọn khóa học
            </button>
          }
        >
          <p>
            Nếu tài khoản đã bị trừ tiền, hãy liên hệ hỗ trợ kèm mã đơn {order.orderId} trước khi thanh toán
            lại.
          </p>
        </OperationResult>
      ) : order ? (
        <section className="study-card commerce-status" aria-live="polite">
          <p className="eyebrow">TRẠNG THÁI ĐƠN</p>
          <h2>{label[order.state]}</h2>
          <dl className="profile-facts">
            <dt>Order ID</dt>
            <dd>{order.orderId}</dd>
            <dt>Số tiền</dt>
            <dd>
              {order.price} {order.currency}
            </dd>
            <dt>Cấp quyền</dt>
            <dd>{order.fulfillmentState}</dd>
          </dl>
          {order.state === "PENDING" &&
            (order.payment ? (
              <div className="payment-instructions">
                <img
                  src={order.payment.qrUrl}
                  alt="Mã QR chuyển khoản đúng số tiền và nội dung đơn hàng"
                  width="240"
                  height="240"
                />
                <dl className="profile-facts">
                  <dt>Ngân hàng</dt>
                  <dd>{order.payment.bank}</dd>
                  <dt>Chủ tài khoản</dt>
                  <dd>{order.payment.accountName}</dd>
                  <dt>Số tài khoản</dt>
                  <dd>{order.payment.accountNumber}</dd>
                  <dt>Nội dung chuyển khoản</dt>
                  <dd>
                    <strong>{order.payment.content}</strong>
                  </dd>
                </dl>
                <p>
                  Giữ nguyên số tiền và nội dung. Không chuyển lại nếu đã bị trừ tiền; xác nhận có thể mất vài
                  phút.
                </p>
              </div>
            ) : (
              <p role="alert">
                Chưa có hướng dẫn chuyển khoản. Vui lòng liên hệ hỗ trợ kèm mã đơn, không tự chuyển tiền.
              </p>
            ))}
          {order.state === "PAID_PENDING_ENTITLEMENT" && (
            <p role="status">Đang đối soát và cấp quyền học tự động…</p>
          )}
          <p role="status">{busy ? "Đang xử lý…" : message}</p>
        </section>
      ) : savedOrderId ? (
        message ? (
          <OperationResult
            success={false}
            title="Chưa thể tải đơn hàng"
            onComplete={() => navigate("/app/learn")}
            action={
              <button className="button" onClick={() => window.location.reload()}>
                Kiểm tra lại
              </button>
            }
          >
            <p>{message}</p>
          </OperationResult>
        ) : (
          <p role="status">Đang tải đơn hàng…</p>
        )
      ) : message ? (
        <OperationResult
          success={false}
          title="Chưa thể tạo đơn hàng"
          onComplete={() => setMessage("")}
          action={
            <button className="button" onClick={() => setMessage("")}>
              Quay lại thử lại
            </button>
          }
        >
          <p>{message}</p>
        </OperationResult>
      ) : (
        <State query={offerings}>
          {available.length ? (
            <div className="study-grid">
              {available.map((o) => (
                <article className="study-card" key={o.offeringId}>
                  <span className="badge">
                    {o.offeringType === "SELF_PACED" ? "Tự học" : "Lớp theo lịch"}
                  </span>
                  <h2>{o.title}</h2>
                  <p>
                    <strong>
                      {o.price} {o.currency}
                    </strong>
                  </p>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void command("/orders", { offeringId: o.offeringId })}
                  >
                    Tạo đơn thanh toán
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <Empty>Khóa học chưa có offering công khai để đăng ký.</Empty>
          )}
        </State>
      )}
      {!order && <p role="status">{busy ? "Đang tạo đơn…" : message}</p>}
    </>
  );
}
