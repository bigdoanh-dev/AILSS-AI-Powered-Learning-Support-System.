import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, AppState, Image, Text, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../src/api";
import { isOrderPending, order as decodeOrder, type Order } from "../../src/commerce";
import { runtime } from "../../src/runtime";
import { Badge, Button, Page, ScreenHeader, styles, tokens } from "../../src/ui";

export default function CheckoutScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paymentKey, setPaymentKey] = useState(() => Crypto.randomUUID());

  const refresh = useCallback(async () => {
    if (!orderId || snapshot.state !== "AUTHENTICATED") return;
    try {
      const result = decodeOrder(await session.request(`/api/v1/orders/${encodeURIComponent(orderId)}`));
      if (result.orderId !== orderId) throw new ApiError("invalid");
      setOrder(result);
      setVerified(true);
      setError("");
    } catch (cause) {
      setVerified(false);
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Không thể xác minh đơn hàng. Vui lòng kiểm tra kết nối rồi thử lại.",
      );
    } finally {
      setLoading(false);
    }
  }, [orderId, session, snapshot.state]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!order || !isOrderPending(order)) return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [order?.orderId, order?.state, order?.fulfillmentState, refresh]);

  async function simulatePayment() {
    if (!order || order.paymentMode !== "simulation" || order.state !== "PENDING") return;
    setBusy(true);
    setError("");
    try {
      const result = decodeOrder(
        await session.request(`/api/v1/orders/${encodeURIComponent(order.orderId)}/simulate-payment`, {
          method: "POST",
          idempotencyKey: paymentKey,
          body: { outcome: "SUCCESS" },
        }),
      );
      setOrder(result);
      setPaymentKey(Crypto.randomUUID());
      await refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Không thể xác nhận thanh toán thử.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <ScreenHeader title="Thanh toán khóa học" onBack={() => router.back()} />
      {snapshot.state !== "AUTHENTICATED" || snapshot.user?.role !== "STUDENT" ? (
        <View style={styles.card}>
          <Text style={styles.text}>Đăng nhập bằng tài khoản học viên để xem đơn hàng.</Text>
          <Button label="Đăng nhập" onPress={() => router.push("/login")} />
        </View>
      ) : loading ? (
        <ActivityIndicator size="large" color={tokens.color.brand} />
      ) : !verified || !order ? (
        <View style={[styles.card, { gap: 12 }]}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error || "Không thể xác minh đơn hàng."}
          </Text>
          <Text style={styles.small}>Chỉ chuyển tiền khi thông tin đơn hàng được xác nhận từ máy chủ.</Text>
          <Button label="Kiểm tra lại" onPress={() => void refresh()} />
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          <View style={[styles.card, { gap: 8 }]}>
            <Text style={styles.title}>Đơn hàng</Text>
            <Text selectable style={styles.small}>
              Mã đơn: {order.orderId}
            </Text>
            <Text style={styles.text}>
              {order.offeringType === "SELF_PACED" ? "Khóa tự học" : "Lớp theo lịch"} · {order.price}{" "}
              {order.currency}
            </Text>
            <Badge
              label={
                order.state === "ENTITLED"
                  ? "ĐÃ CẤP QUYỀN HỌC"
                  : order.state === "PENDING"
                    ? "CHỜ THANH TOÁN"
                    : order.state === "PAYMENT_FAILED"
                      ? "THANH TOÁN THẤT BẠI"
                      : "ĐANG CẤP QUYỀN HỌC"
              }
              variant={order.state === "ENTITLED" ? "success" : "warning"}
            />
          </View>

          {order.state === "ENTITLED" ? (
            <View style={[styles.card, { gap: 12 }]}>
              <Text style={styles.text}>Thanh toán đã được ghi nhận và quyền học đã được cấp.</Text>
              <Button
                label="Bắt đầu học"
                onPress={() => router.replace(`/learn/${order.courseId}` as Href)}
              />
            </View>
          ) : order.fulfillmentState === "REFUND_REQUIRED" ? (
            <View style={styles.card}>
              <Text style={styles.error}>
                Đơn hàng cần được hỗ trợ hoàn tiền. Hãy liên hệ bộ phận hỗ trợ và cung cấp mã đơn ở trên.
              </Text>
            </View>
          ) : order.state === "PAYMENT_FAILED" ? (
            <View style={[styles.card, { gap: 12 }]}>
              <Text style={styles.error}>
                Thanh toán chưa thành công. Vui lòng tạo đơn mới nếu muốn thử lại.
              </Text>
              <Button
                label="Chọn khóa học"
                onPress={() => router.replace(`/courses/${order.courseId}` as Href)}
              />
            </View>
          ) : order.state === "PAID_PENDING_ENTITLEMENT" ? (
            <View style={[styles.card, { gap: 12 }]}>
              <Text style={styles.text}>Đã nhận thanh toán. Hệ thống đang cấp quyền học cho bạn.</Text>
              <Button label="Kiểm tra trạng thái" onPress={() => void refresh()} />
            </View>
          ) : order.paymentMode === "sepay" && order.payment ? (
            <View style={[styles.card, { gap: 10, alignItems: "center" }]}>
              <Text style={styles.title}>Chuyển khoản bằng VietQR</Text>
              <Image
                source={{ uri: order.payment.qrUrl }}
                style={{ width: 240, height: 240 }}
                resizeMode="contain"
                accessibilityLabel="Mã VietQR của đơn hàng"
              />
              <Text style={styles.small}>Ngân hàng: {order.payment.bank}</Text>
              <Text selectable style={styles.text}>
                Số tài khoản: {order.payment.accountNumber}
              </Text>
              <Text style={styles.text}>Chủ tài khoản: {order.payment.accountName}</Text>
              <Text style={styles.text}>
                Số tiền: {order.price} {order.currency}
              </Text>
              <Text selectable style={styles.text}>
                Nội dung: {order.payment.content}
              </Text>
              <Text style={styles.small}>
                Chuyển đúng số tiền và nội dung. Trạng thái đơn được tự động cập nhật sau khi ngân hàng xác
                nhận.
              </Text>
              <Button label="Tôi đã chuyển khoản · Kiểm tra" onPress={() => void refresh()} />
            </View>
          ) : order.paymentMode === "simulation" ? (
            <View style={[styles.card, { gap: 12 }]}>
              <Text style={styles.text}>
                Môi trường thử nghiệm: xác nhận thanh toán giả lập để kiểm tra luồng mua khóa học.
              </Text>
              <Button
                label={busy ? "Đang xác nhận…" : "Thanh toán thử"}
                disabled={busy}
                onPress={() => void simulatePayment()}
              />
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.error}>Chưa có thông tin chuyển khoản hợp lệ. Vui lòng thử lại sau.</Text>
            </View>
          )}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
        </View>
      )}
    </Page>
  );
}
