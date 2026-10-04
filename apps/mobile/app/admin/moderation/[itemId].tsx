import { useLanguage } from "../../../src/use-language";
import { useUiText } from "../../../src/use-language";
import { useEffect, useState, useCallback } from "react";
import {
  Text,
  View,
  TextInput,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Pressable,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import {
  moderationListResponse,
  validatePassword,
  validateReason,
  type ModerationReport,
  type ModerationAction,
} from "../../../src/admin";
import { Page, Button, PasswordInput, styles, tokens } from "../../../src/ui";

export default function AdminModerationDetailScreen() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [report, setReport] = useState<ModerationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Moderation Decision State
  const [action, setAction] = useState<ModerationAction>("HIDE");
  const [reason, setReason] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadReport = useCallback(async () => {
    if (!itemId || snapshot.user?.role !== "ADMIN") return;
    setLoading(true);
    setError("");

    try {
      const res = await session.request("/api/v1/admin/reports?limit=50");
      const list = moderationListResponse(res);
      const target = list.items.find((r) => r.reportId === itemId);
      if (target) {
        setReport(target);
      } else {
        setError("Không tìm thấy báo cáo hoặc báo cáo đã được giải quyết.");
      }
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Không thể tải thông tin báo cáo.");
      }
    } finally {
      setLoading(false);
    }
  }, [session, itemId, snapshot.user?.role]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleDecisionSubmit = async () => {
    if (!report) return;
    if (!validateReason(reason)) {
      setError("Vui lòng nhập lý do quyết định kiểm duyệt (tối đa 1000 ký tự).");
      return;
    }
    if (!validatePassword(currentPassword)) {
      setError("Vui lòng nhập mật khẩu quản trị viên.");
      return;
    }

    setBusy(true);
    setError("");
    setSuccessMessage("");
    setShowConfirm(false);

    try {
      const key = Crypto.randomUUID();
      await session.request(`/api/v1/admin/reports/${report.reportId}/moderate`, {
        method: "POST",
        headers: {
          "Idempotency-Key": key,
          "If-Match": `"v${report.version}"`,
        },
        body: {
          action,
          reason: reason.trim(),
          currentPassword,
        },
      });
      setCurrentPassword("");
      setReason("");
      setSuccessMessage("Đã xử lý quyết định kiểm duyệt thành công.");
      await loadReport();
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.status === 409 || e.message.includes("VERSION")) {
          setError("Dữ liệu báo cáo đã bị thay đổi hoặc đã được xử lý bởi phiên khác. Vui lòng tải lại.");
        } else if (e.message.includes("REAUTH") || e.status === 401) {
          setError("Mật khẩu quản trị viên không chính xác.");
        } else {
          setError(e.message);
        }
      } else {
        setError("Xử lý kiểm duyệt thất bại.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (snapshot.user?.role !== "ADMIN") {
    return (
      <Page>
        <Text style={styles.title}>{uiText("Chi tiết kiểm duyệt")}</Text>
        <Text style={styles.error}>{uiText("Chức năng này yêu cầu quyền Quản trị viên (ADMIN).")}</Text>
        <Button label={uiText("Về trang chủ")} onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Button label={uiText("← Hàng đợi kiểm duyệt")} onPress={() => router.back()} />

        {loading ? (
          <ActivityIndicator size="large" color={tokens.color.brand} style={{ marginTop: 24 }} />
        ) : error && !report ? (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.error}>{uiText(error)}</Text>
            <Button label={uiText("Thử lại")} onPress={() => void loadReport()} />
          </View>
        ) : report ? (
          <View style={{ marginTop: tokens.space.medium }}>
            <Text style={styles.title}>{uiText("Chi tiết báo cáo")}</Text>
            <Text style={styles.small}>
              {uiText("ID:")}
              {report.reportId}
            </Text>

            {successMessage ? <Text style={md.successText}>{uiText(successMessage)}</Text> : null}
            {error ? <Text style={styles.error}>{uiText(error)}</Text> : null}

            {/* Facts Card */}
            <View style={md.card}>
              <Text style={md.cardHeading}>{uiText("Thông tin nội dung")}</Text>
              <View style={md.factRow}>
                <Text style={md.factLabel}>{uiText("Loại nội dung:")}</Text>
                <Text style={md.factVal}>
                  {report.targetType === "COMMENT"
                    ? uiText("Bình luận (COMMENT)")
                    : uiText("Đánh giá (REVIEW)")}
                </Text>
              </View>
              <View style={md.factRow}>
                <Text style={md.factLabel}>{uiText("Mã mục tiêu (Target ID):")}</Text>
                <Text style={md.factVal}>{report.targetId}</Text>
              </View>
              <View style={md.factRow}>
                <Text style={md.factLabel}>{uiText("Trạng thái hiện tại:")}</Text>
                <Text style={md.factVal}>
                  {report.state === "OPEN" ? uiText("Đang mở (OPEN)") : uiText("Đã xử lý (RESOLVED)")}
                </Text>
              </View>
              <View style={md.factRow}>
                <Text style={md.factLabel}>{uiText("Phiên bản (Optimistic Version):")}</Text>
                <Text style={md.factVal}>v{report.version}</Text>
              </View>
              <View style={md.factRow}>
                <Text style={md.factLabel}>{uiText("Thời điểm báo cáo:")}</Text>
                <Text style={md.factVal}>{new Date(report.createdAt).toLocaleString(uiLocale)}</Text>
              </View>
              {report.decision ? (
                <View style={md.factRow}>
                  <Text style={md.factLabel}>{uiText("Quyết định đã lưu:")}</Text>
                  <Text style={md.factVal}>{report.decision}</Text>
                </View>
              ) : null}
            </View>

            {/* Decision Action Form */}
            <View style={md.card}>
              <Text style={md.cardHeading}>{uiText("Đưa ra quyết định kiểm duyệt")}</Text>
              <Text style={md.cardDesc}>
                {uiText(
                  "Chọn hành động xử lý, nhập lý do giải trình và xác thực bằng mật khẩu quản trị viên.",
                )}
              </Text>

              {/* Action Selector */}
              <View style={md.actionGrid}>
                {(
                  [
                    { key: "HIDE", label: uiText("Ẩn nội dung") },
                    { key: "RESTORE", label: uiText("Khôi phục") },
                    { key: "DISMISS", label: uiText("Bỏ qua báo cáo") },
                    { key: "WARN", label: uiText("Cảnh báo") },
                  ] as { key: ModerationAction; label: string }[]
                ).map((act) => (
                  <Pressable
                    key={act.key}
                    accessibilityRole="button"
                    accessibilityLabel={uiText("Chọn hành động {0}", [act.label])}
                    style={[md.actionChip, action === act.key && md.actionChipSelected]}
                    onPress={() => setAction(act.key)}
                  >
                    <Text style={[md.actionChipText, action === act.key && md.actionChipTextSelected]}>
                      {act.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                placeholder={uiText("Lý do xử lý kiểm duyệt (bắt buộc, tối đa 1000 ký tự)")}
                value={reason}
                onChangeText={setReason}
                multiline
                numberOfLines={3}
                maxLength={1000}
                style={[md.input, { minHeight: 80 }]}
                accessibilityLabel={uiText("Lý do xử lý kiểm duyệt")}
              />

              <PasswordInput
                placeholder={uiText("Mật khẩu quản trị viên hiện tại")}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                style={md.input}
                accessibilityLabel={uiText("Mật khẩu quản trị viên")}
              />

              <Button
                label={busy ? uiText("Đang gửi quyết định...") : uiText("Xác nhận quyết định")}
                onPress={() => setShowConfirm(true)}
                disabled={busy || !reason.trim() || !currentPassword.trim()}
              />
            </View>
          </View>
        ) : null}

        {/* High-Impact Confirmation Modal */}
        <Modal
          visible={showConfirm}
          transparent
          animationType="fade"
          onRequestClose={() => setShowConfirm(false)}
        >
          <View style={md.modalOverlay}>
            <View style={md.modalContent}>
              <Text style={md.modalTitle}>{uiText("Xác nhận kiểm duyệt")}</Text>
              <Text style={md.modalText}>
                {uiText("Bạn có chắc chắn muốn thực hiện hành động ")}
                <Text style={{ fontWeight: "700" }}>{action}</Text> {uiText("đối với mục ")}
                <Text style={{ fontWeight: "700" }}>{report?.targetId}</Text>
                {uiText("? Hành động sẽ có hiệu lực ngay lập tức và được lưu vào nhật ký kiểm toán.")}
              </Text>
              <View style={md.modalActions}>
                <Button label={uiText("Hủy")} onPress={() => setShowConfirm(false)} />
                <Button label={uiText("Xác nhận")} onPress={() => void handleDecisionSubmit()} />
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </Page>
  );
}

const md = StyleSheet.create({
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
  cardDesc: {
    fontSize: 13,
    color: tokens.color.muted,
    marginBottom: tokens.space.small,
    lineHeight: 18,
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
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.small,
    marginBottom: tokens.space.small,
  },
  actionChip: {
    flex: 1,
    minWidth: "45%",
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    minHeight: 48,
    justifyContent: "center",
  },
  actionChipSelected: {
    borderColor: tokens.color.brand,
    backgroundColor: tokens.color.brand,
  },
  actionChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  actionChipTextSelected: {
    color: "#ffffff",
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
  successText: {
    color: tokens.color.success,
    fontSize: 14,
    fontWeight: "600",
    marginVertical: tokens.space.small,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: tokens.space.large,
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: tokens.space.large,
    width: "100%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: tokens.color.ink,
    marginBottom: tokens.space.small,
  },
  modalText: {
    fontSize: 14,
    color: tokens.color.muted,
    lineHeight: 20,
    marginBottom: tokens.space.medium,
  },
  modalActions: {
    flexDirection: "row",
    gap: tokens.space.small,
    justifyContent: "flex-end",
  },
});
