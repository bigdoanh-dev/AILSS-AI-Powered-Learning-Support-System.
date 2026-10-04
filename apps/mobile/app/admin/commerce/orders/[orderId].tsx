import { useLanguage } from "../../../../src/use-language";
import { useUiText } from "../../../../src/use-language";
import { useEffect, useState, useCallback } from "react";
import { Text, View, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import {
  commerceOrder,
  formatVND,
  isOrderEntitled,
  isPaymentPendingEntitlement,
  CONTRACT_LIMITED,
  type CommerceOrder,
} from "../../../../src/admin";
import { Page, Button, Icon, styles, tokens } from "../../../../src/ui";

export default function AdminOrderDetailScreen() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [order, setOrder] = useState<CommerceOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrder = useCallback(async () => {
    if (!orderId || snapshot.user?.role !== "ADMIN") return;
    setLoading(true);
    setError("");

    try {
      const res = await session.request(`/api/v1/orders/${orderId}`);
      const parsed = commerceOrder(res);
      setOrder(parsed);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.status === 404) {
          setError("Không tìm thấy đơn hàng với mã định danh đã cung cấp.");
        } else if (e.status === 403) {
          setError("Tài khoản không có quyền truy cập thông tin đơn hàng này.");
        } else {
          setError(e.message);
        }
      } else {
        setError("Không thể tải thông tin đơn hàng.");
      }
    } finally {
      setLoading(false);
    }
  }, [session, orderId, snapshot.user?.role]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  if (snapshot.user?.role !== "ADMIN") {
    return (
      <Page>
        <Text style={styles.title}>{uiText("Chi tiết đơn hàng")}</Text>
        <Text style={styles.error}>{uiText("Chức năng này yêu cầu quyền Quản trị viên (ADMIN).")}</Text>
        <Button label={uiText("Về trang chủ")} onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const getStateBadgeStyle = (state: string) => {
    switch (state) {
      case "ENTITLED":
        return od.badgeEntitled;
      case "PAID_PENDING_ENTITLEMENT":
        return od.badgePendingEntitlement;
      case "PAYMENT_FAILED":
        return od.badgeFailed;
      default:
        return od.badgePending;
    }
  };

  const getStateLabel = (state: string) => {
    switch (state) {
      case "ENTITLED":
        return "ĐÃ CẤP QUYỀN HỌC (ENTITLED)";
      case "PAID_PENDING_ENTITLEMENT":
        return "ĐÃ NHẬN TIỀN · CHỜ CẤP QUYỀN";
      case "PAYMENT_FAILED":
        return "THANH TOÁN THẤT BẠI";
      case "PENDING":
        return "CHỜ THANH TOÁN (PENDING)";
      default:
        return state;
    }
  };

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Button label={uiText("← Tra cứu thương mại")} onPress={() => router.back()} />

        {loading ? (
          <ActivityIndicator size="large" color={tokens.color.brand} style={{ marginTop: 24 }} />
        ) : error && !order ? (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.error}>{uiText(error)}</Text>
            <Button label={uiText("Thử lại")} onPress={() => void loadOrder()} />
          </View>
        ) : order ? (
          <View style={{ marginTop: tokens.space.medium }}>
            <Text style={styles.title}>
              {uiText("Đơn hàng ")}
              {order.orderId.slice(0, 8)}...
            </Text>
            <Text style={styles.small}>
              {uiText("ID:")}
              {order.orderId}
            </Text>

            {/* State Status Banner */}
            <View style={[od.stateBanner, getStateBadgeStyle(order.state)]}>
              <Text style={od.stateBannerText}>{getStateLabel(order.state)}</Text>
            </View>

            {/* Facts Card */}
            <View style={od.card}>
              <Text style={od.cardHeading}>{uiText("Thông tin thanh toán & gói học")}</Text>

              <View style={od.factRow}>
                <Text style={od.factLabel}>{uiText("Số tiền:")}</Text>
                <Text style={od.factVal}>{formatVND(order.price, uiLocale)}</Text>
              </View>

              <View style={od.factRow}>
                <Text style={od.factLabel}>{uiText("Tiền tệ:")}</Text>
                <Text style={od.factVal}>{order.currency ?? "VND"}</Text>
              </View>

              <View style={od.factRow}>
                <Text style={od.factLabel}>{uiText("Hình thức học:")}</Text>
                <Text style={od.factVal}>{order.offeringType ?? "SELF_PACED"}</Text>
              </View>

              <View style={od.factRow}>
                <Text style={od.factLabel}>{uiText("Trạng thái xử lý cấp quyền:")}</Text>
                <Text style={od.factVal}>{order.fulfillmentState ?? "NOT_STARTED"}</Text>
              </View>

              {order.courseId ? (
                <View style={od.factRow}>
                  <Text style={od.factLabel}>{uiText("Mã khóa học:")}</Text>
                  <Text style={od.factVal}>{order.courseId}</Text>
                </View>
              ) : null}

              {order.offeringId ? (
                <View style={od.factRow}>
                  <Text style={od.factLabel}>{uiText("Mã gói học (Offering):")}</Text>
                  <Text style={od.factVal}>{order.offeringId}</Text>
                </View>
              ) : null}

              {order.createdAt ? (
                <View style={od.factRow}>
                  <Text style={od.factLabel}>{uiText("Thời điểm khởi tạo:")}</Text>
                  <Text style={od.factVal}>{new Date(order.createdAt).toLocaleString(uiLocale)}</Text>
                </View>
              ) : null}
            </View>

            {/* Entitlement Status Explanation */}
            {isPaymentPendingEntitlement(order.state) && (
              <View style={od.pendingBox}>
                <Text style={od.pendingTitle}>
                  {uiText("⏳ Đơn hàng đã nhận tiền, đang xử lý cấp quyền")}
                </Text>
                <Text style={od.pendingText}>
                  {uiText(
                    "Tiền đã vào tài khoản hệ thống nhưng tiến trình cấp quyền bất đồng bộ đang xử lý trong nền. Học viên chưa thể vào học ngay cho đến khi trạng thái chuyển sang ENTITLED.",
                  )}
                </Text>
              </View>
            )}

            {isOrderEntitled(order.state) && (
              <View style={od.entitledBox}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Icon name="check" size={16} color={tokens.color.success} />
                  <Text style={od.entitledTitle}>{uiText("Quyền học đã được xác nhận")}</Text>
                </View>
                <Text style={od.entitledText}>
                  {uiText(
                    "Khóa học đã xuất hiện trong danh sách khóa học của học viên và có thể bắt đầu học ngay.",
                  )}
                </Text>
              </View>
            )}

            {/* Administrative Operations Limitations */}
            <View style={od.noticeBox}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Icon name="scale" size={16} color={tokens.color.ink} />
                <Text style={od.noticeTitle}>{uiText("Thao tác quản trị")}</Text>
              </View>
              <Text style={od.noticeText}>
                • {CONTRACT_LIMITED.manualPaymentMutation}
                {"\n"}
                {uiText(
                  "• Để cập nhật trạng thái mới nhất từ dịch vụ xử lý nền, hãy nhấn nút Tải lại bên dưới.",
                )}
              </Text>
              <Button label={uiText("Tải lại trạng thái đơn hàng")} onPress={() => void loadOrder()} />
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Page>
  );
}

const od = StyleSheet.create({
  stateBanner: {
    padding: tokens.space.small,
    borderRadius: 8,
    marginVertical: tokens.space.small,
    alignItems: "center",
  },
  stateBannerText: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  badgePending: {
    backgroundColor: "#fef3c7",
  },
  badgePendingEntitlement: {
    backgroundColor: "#fed7aa",
  },
  badgeEntitled: {
    backgroundColor: "#d1fae5",
  },
  badgeFailed: {
    backgroundColor: "#fee2e2",
  },
  card: {
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: tokens.space.medium,
    marginBottom: tokens.space.medium,
  },
  cardHeading: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.ink,
    marginBottom: tokens.space.small,
  },
  factRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
  },
  factLabel: {
    fontSize: 14,
    color: tokens.color.muted,
  },
  factVal: {
    fontSize: 14,
    fontWeight: "500",
    color: tokens.color.ink,
    maxWidth: "60%",
    textAlign: "right",
  },
  pendingBox: {
    backgroundColor: "#fff7ed",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fdba74",
    padding: tokens.space.medium,
    marginBottom: tokens.space.medium,
  },
  pendingTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#c2410c",
    marginBottom: 4,
  },
  pendingText: {
    fontSize: 13,
    color: "#9a3412",
    lineHeight: 18,
  },
  entitledBox: {
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#86efac",
    padding: tokens.space.medium,
    marginBottom: tokens.space.medium,
  },
  entitledTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#15803d",
    marginBottom: 4,
  },
  entitledText: {
    fontSize: 13,
    color: "#166534",
    lineHeight: 18,
  },
  noticeBox: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.medium,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.large,
    gap: tokens.space.small,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  noticeText: {
    fontSize: 13,
    color: tokens.color.muted,
    lineHeight: 18,
  },
});
