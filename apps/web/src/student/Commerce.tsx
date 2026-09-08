import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
};
const offeringsOf = (v?: Offering[] | { items: Offering[] }) => (Array.isArray(v) ? v : v?.items || []);
const label: Record<Order["state"], string> = {
  PENDING: "Chờ thanh toán mô phỏng",
  PAYMENT_FAILED: "Thanh toán mô phỏng thất bại",
  PAID_PENDING_ENTITLEMENT: "Đã thanh toán, đang cấp quyền học",
  ENTITLED: "Đã cấp quyền học",
};

export default function Purchase() {
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
  useEffect(() => () => abort.current.abort(), []);
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
    } catch (e) {
      setMessage(studentError(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (order?.state !== "PAID_PENDING_ENTITLEMENT") return;
    const timer = window.setInterval(async () => {
      try {
        const r = await studentRequest<Order>(`/orders/${order.orderId}`, abort.current.signal);
        setOrder(r.data);
      } catch (e) {
        if (!(e instanceof DOMException)) setMessage(studentError(e));
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [order?.orderId, order?.state]);
  const available = offeringsOf(offerings.data).filter((o) => o.state === "PUBLISHED");
  return (
    <>
      <Link to="/app/learn">← Học tập</Link>
      <Heading title="Đăng ký khóa học có phí">
        Đây là môi trường mô phỏng; không có giao dịch tiền thật hoặc cổng thanh toán bên ngoài.
      </Heading>
      {entitled ? (
        <section className="study-card commerce-status">
          <p className="eyebrow">QUYỀN HỌC</p>
          <h2>Bạn đã có quyền truy cập khóa học này.</h2>
          <Link className="button" to={`/app/learn/${courseId}`}>
            Tiếp tục học →
          </Link>
        </section>
      ) : order ? (
        <section className="study-card commerce-status" aria-live="polite">
          <p className="eyebrow">TRẠNG THÁI ĐƠN</p>
          <h2>{label[order.state]}</h2>
          <dl className="profile-facts">
            <dt>Order ID</dt>
            <dd>{order.orderId}</dd>
            <dt>Giá mô phỏng</dt>
            <dd>
              {order.price} {order.currency}
            </dd>
            <dt>Cấp quyền</dt>
            <dd>{order.fulfillmentState}</dd>
          </dl>
          {order.state === "PENDING" && (
            <div className="inline-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void command(`/orders/${order.orderId}/simulate-payment`, { outcome: "SUCCESS" })
                }
              >
                Mô phỏng thanh toán thành công
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void command(`/orders/${order.orderId}/simulate-payment`, { outcome: "FAILURE" })
                }
              >
                Mô phỏng thất bại
              </button>
            </div>
          )}
          {order.state === "PAID_PENDING_ENTITLEMENT" && (
            <p role="status">Đang đối soát và cấp quyền học tự động…</p>
          )}
          {order.state === "ENTITLED" && (
            <Link className="button" to={`/app/learn/${courseId}`}>
              Bắt đầu học →
            </Link>
          )}
          {order.state === "PAYMENT_FAILED" && (
            <button className="button secondary" onClick={() => setOrder(null)}>
              Chọn lại offering
            </button>
          )}
          <p role="status">{busy ? "Đang xử lý…" : message}</p>
        </section>
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
                    Tạo đơn mô phỏng
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
