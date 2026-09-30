import { useState } from "react";
import { Text, View, TextInput, ScrollView, StyleSheet } from "react-native";
import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { runtime } from "../../../src/runtime";
import { CONTRACT_LIMITED } from "../../../src/admin";
import { Page, Button, Icon, styles, tokens } from "../../../src/ui";

export default function AdminCommerceScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [orderIdInput, setOrderIdInput] = useState("");
  const [error, setError] = useState("");

  const handleLookup = () => {
    const trimmed = orderIdInput.trim();
    if (!trimmed) {
      setError("Vui lòng nhập mã đơn hàng (Order ID).");
      return;
    }
    setError("");
    router.push(`/admin/commerce/orders/${trimmed}` as Href);
  };

  if (snapshot.user?.role !== "ADMIN") {
    return (
      <Page>
        <Text style={styles.title}>Giám sát thương mại</Text>
        <Text style={styles.error}>Chức năng này yêu cầu quyền Quản trị viên (ADMIN).</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Giám sát thương mại</Text>
        <Text style={styles.small}>Giám sát vòng đời đơn hàng, đối soát thanh toán và đảm bảo quyền học</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Order Lookup Card */}
        <View style={cs.card}>
          <Text style={cs.cardHeading}>Tra cứu đơn hàng</Text>
          <Text style={cs.cardDesc}>
            Nhập mã định danh đơn hàng (UUID) để kiểm tra chi tiết trạng thái thanh toán và cấp quyền học
            viên.
          </Text>
          <TextInput
            placeholder="Ví dụ: 00000000-0000-4000-8000-000000000005"
            value={orderIdInput}
            onChangeText={setOrderIdInput}
            style={cs.input}
            autoCapitalize="none"
            accessibilityLabel="Mã đơn hàng cần tra cứu"
          />
          <Button
            label="Tra cứu chi tiết đơn hàng →"
            onPress={handleLookup}
            disabled={!orderIdInput.trim()}
          />
        </View>

        {/* Canonical State Model Architecture Box */}
        <View style={cs.card}>
          <Text style={cs.cardHeading}>Quy trình vòng đời đơn hàng chuẩn</Text>
          <Text style={cs.cardDesc}>
            Hệ thống AILSS tuân thủ nghiêm ngặt mô hình trạng thái bất biến của máy chủ:
          </Text>

          <View style={cs.flowBox}>
            <Text style={cs.flowStep}>1. PENDING (Khởi tạo, chờ thanh toán)</Text>
            <Text style={cs.flowBranch}> ├── Thất bại → PAYMENT_FAILED</Text>
            <Text style={cs.flowBranch}> └── Thành công → PAID_PENDING_ENTITLEMENT</Text>
            <Text style={cs.flowStep}>2. PAID_PENDING_ENTITLEMENT (Đã nhận tiền, chờ cấp quyền)</Text>
            <Text style={cs.flowBranch}> └── Hoàn tất xử lý bất đồng bộ → ENTITLED</Text>
            <Text style={cs.flowStep}>3. ENTITLED (Học viên chính thức có quyền học)</Text>
          </View>

          <View style={[cs.ruleNotice, { flexDirection: "row", alignItems: "flex-start", gap: 8 }]}>
            <Icon name="alert" size={16} color={tokens.color.warning} style={{ marginTop: 2 }} />
            <Text style={[cs.ruleText, { flex: 1 }]}>
              <Text style={{ fontWeight: "700" }}>Phân tách độc lập:</Text> Trạng thái thanh toán (Paid) và
              trạng thái cấp quyền (Entitled) là hai bước hoàn toàn tách biệt. Không bao giờ hiển thị
              PAID_PENDING_ENTITLEMENT thành ENTITLED.
            </Text>
          </View>
        </View>

        {/* Security & Boundary Box */}
        <View style={cs.noticeBox}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Icon name="shield" size={16} color={tokens.color.brand} />
            <Text style={cs.noticeTitle}>Ranh giới bảo mật & Cổng thanh toán</Text>
          </View>
          <Text style={cs.noticeText}>
            • Ứng dụng di động đóng vai trò giám sát, không lưu trữ chứng thư bảo mật hoặc khóa bí mật của
            cổng thanh toán.{"\n"}• Mọi giao dịch đối soát và xác nhận thanh toán do dịch vụ Learning/Commerce
            thực hiện.{"\n"}• {CONTRACT_LIMITED.manualPaymentMutation}
            {"\n"}• {CONTRACT_LIMITED.orderList}
          </Text>
        </View>
      </ScrollView>
    </Page>
  );
}

const cs = StyleSheet.create({
  card: {
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: tokens.space.medium,
    marginTop: tokens.space.small,
    marginBottom: tokens.space.small,
  },
  cardHeading: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.ink,
    marginBottom: tokens.space.small,
  },
  cardDesc: {
    fontSize: 13,
    color: tokens.color.muted,
    marginBottom: tokens.space.small,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    backgroundColor: "#ffffff",
    marginBottom: tokens.space.small,
    minHeight: 48,
  },
  flowBox: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: tokens.space.small,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  flowStep: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.ink,
    fontFamily: "monospace",
  },
  flowBranch: {
    fontSize: 12,
    color: tokens.color.muted,
    fontFamily: "monospace",
    marginVertical: 2,
  },
  ruleNotice: {
    backgroundColor: "#fffbeb",
    borderRadius: 8,
    padding: tokens.space.small,
    borderWidth: 1,
    borderColor: "#fde68a",
    marginTop: 4,
  },
  ruleText: {
    fontSize: 12,
    color: "#92400e",
    lineHeight: 18,
  },
  noticeBox: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.medium,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginTop: 4,
    marginBottom: tokens.space.large,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
    marginBottom: 6,
  },
  noticeText: {
    fontSize: 13,
    color: tokens.color.muted,
    lineHeight: 20,
  },
});
