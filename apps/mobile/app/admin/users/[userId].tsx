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
  adminUser,
  validatePassword,
  CONTRACT_LIMITED,
  type AdminUser,
  type AdminUserStatus,
} from "../../../src/admin";
import { Page, Button, PasswordInput, styles, tokens } from "../../../src/ui";

export default function AdminUserDetailScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Status Change State
  const [newStatus, setNewStatus] = useState<AdminUserStatus>("ACTIVE");
  const [reason, setReason] = useState("");
  const [statusPassword, setStatusPassword] = useState("");
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  // Lecturer Verify State
  const [verifyPassword, setVerifyPassword] = useState("");
  const [showVerifyConfirm, setShowVerifyConfirm] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);

  const loadUser = useCallback(async () => {
    if (!userId || snapshot.user?.role !== "ADMIN") return;
    setLoading(true);
    setError("");
    try {
      const res = await session.request(`/api/v1/admin/users/${userId}`);
      const parsed = adminUser(res);
      setUser(parsed);
      setNewStatus(parsed.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE");
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Không thể tải thông tin người dùng.");
      }
    } finally {
      setLoading(false);
    }
  }, [session, userId, snapshot.user?.role]);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const handleStatusSubmit = async () => {
    if (!validatePassword(statusPassword)) {
      setError("Vui lòng nhập mật khẩu quản trị viên hợp lệ.");
      return;
    }
    setStatusBusy(true);
    setError("");
    setSuccessMessage("");
    setShowStatusConfirm(false);

    try {
      const key = Crypto.randomUUID();
      await session.request(`/api/v1/admin/users/${userId}/status`, {
        method: "PATCH",
        headers: {
          "Idempotency-Key": key,
        },
        body: {
          status: newStatus,
          currentPassword: statusPassword,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      setStatusPassword("");
      setReason("");
      setSuccessMessage("Cập nhật trạng thái người dùng thành công.");
      await loadUser();
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.message.includes("REAUTH") || e.status === 401) {
          setError("Mật khẩu quản trị viên không chính xác.");
        } else {
          setError(e.message);
        }
      } else {
        setError("Đổi trạng thái thất bại.");
      }
    } finally {
      setStatusBusy(false);
    }
  };

  const handleVerifyLecturer = async () => {
    if (!validatePassword(verifyPassword)) {
      setError("Vui lòng nhập mật khẩu quản trị viên hợp lệ.");
      return;
    }
    setVerifyBusy(true);
    setError("");
    setSuccessMessage("");
    setShowVerifyConfirm(false);

    try {
      const key = Crypto.randomUUID();
      await session.request(`/api/v1/admin/lecturers/${userId}/verify`, {
        method: "POST",
        headers: {
          "Idempotency-Key": key,
        },
        body: {
          currentPassword: verifyPassword,
        },
      });
      setVerifyPassword("");
      setSuccessMessage("Xác minh giảng viên thành công. Tài khoản có thể bắt đầu giảng dạy.");
      await loadUser();
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.message.includes("REAUTH") || e.status === 401) {
          setError("Mật khẩu quản trị viên không chính xác.");
        } else {
          setError(e.message);
        }
      } else {
        setError("Xác minh giảng viên thất bại.");
      }
    } finally {
      setVerifyBusy(false);
    }
  };

  if (snapshot.user?.role !== "ADMIN") {
    return (
      <Page>
        <Text style={styles.title}>Chi tiết người dùng</Text>
        <Text style={styles.error}>Chức năng này yêu cầu quyền Quản trị viên (ADMIN).</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Button label="← Danh sách người dùng" onPress={() => router.back()} />

        {loading ? (
          <ActivityIndicator size="large" color={tokens.color.brand} style={{ marginTop: 24 }} />
        ) : error && !user ? (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.error}>{error}</Text>
            <Button label="Thử lại" onPress={() => void loadUser()} />
          </View>
        ) : user ? (
          <View style={{ marginTop: tokens.space.medium }}>
            <Text style={styles.title}>{user.displayName}</Text>
            <Text style={styles.small}>ID: {user.userId}</Text>

            {successMessage ? <Text style={ud.successText}>{successMessage}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {/* Profile Info Facts */}
            <View style={ud.card}>
              <Text style={ud.cardHeading}>Thông tin tài khoản</Text>
              <View style={ud.factRow}>
                <Text style={ud.factLabel}>Email:</Text>
                <Text style={ud.factVal}>{user.emailMasked ?? "—"}</Text>
              </View>
              <View style={ud.factRow}>
                <Text style={ud.factLabel}>Vai trò:</Text>
                <Text style={ud.factVal}>
                  {user.role === "LECTURER"
                    ? "Giảng viên"
                    : user.role === "ADMIN"
                      ? "Quản trị viên"
                      : "Sinh viên"}
                </Text>
              </View>
              <View style={ud.factRow}>
                <Text style={ud.factLabel}>Trạng thái:</Text>
                <Text style={ud.factVal}>
                  {user.status === "ACTIVE" ? "Đang hoạt động" : "Tạm khóa (SUSPENDED)"}
                </Text>
              </View>
              <View style={ud.factRow}>
                <Text style={ud.factLabel}>Xác minh GV:</Text>
                <Text style={ud.factVal}>{user.lecturerVerified ? "Đã xác minh" : "Chưa xác minh"}</Text>
              </View>
              <View style={ud.factRow}>
                <Text style={ud.factLabel}>Phiên bản hồ sơ:</Text>
                <Text style={ud.factVal}>v{user.profileVersion}</Text>
              </View>
              {user.createdAt ? (
                <View style={ud.factRow}>
                  <Text style={ud.factLabel}>Ngày tạo:</Text>
                  <Text style={ud.factVal}>{new Date(user.createdAt).toLocaleDateString("vi-VN")}</Text>
                </View>
              ) : null}
            </View>

            {/* Lecturer Verification Action Card */}
            {user.role === "LECTURER" && !user.lecturerVerified && (
              <View style={ud.card}>
                <Text style={ud.cardHeading}>Xác minh giảng viên</Text>
                <Text style={ud.cardDesc}>
                  Thẩm định quyền hạn giảng dạy cho người dùng này. Thao tác yêu cầu nhập mật khẩu quản trị
                  viên.
                </Text>
                <PasswordInput
                  placeholder="Mật khẩu quản trị viên"
                  value={verifyPassword}
                  onChangeText={setVerifyPassword}
                  style={ud.input}
                  accessibilityLabel="Mật khẩu quản trị viên để xác minh giảng viên"
                />
                <Button
                  label={verifyBusy ? "Đang xử lý..." : "Xác minh giảng viên"}
                  onPress={() => setShowVerifyConfirm(true)}
                  disabled={verifyBusy || !verifyPassword.trim()}
                />
              </View>
            )}

            {/* Change Account Status Form */}
            <View style={ud.card}>
              <Text style={ud.cardHeading}>Đổi trạng thái tài khoản</Text>
              <Text style={ud.cardDesc}>
                Chuyển trạng thái giữa Hoạt động (ACTIVE) và Tạm khóa (SUSPENDED).
              </Text>

              <View style={ud.statusSelector}>
                {(["ACTIVE", "SUSPENDED"] as AdminUserStatus[]).map((st) => (
                  <Pressable
                    key={st}
                    accessibilityRole="button"
                    accessibilityLabel={`Chọn trạng thái ${st}`}
                    style={[ud.statusOption, newStatus === st && ud.statusOptionSelected]}
                    onPress={() => setNewStatus(st)}
                  >
                    <Text style={[ud.statusOptionText, newStatus === st && ud.statusOptionTextSelected]}>
                      {st === "ACTIVE" ? "Hoạt động (ACTIVE)" : "Tạm khóa (SUSPENDED)"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                placeholder="Lý do thay đổi (không bắt buộc)"
                value={reason}
                onChangeText={setReason}
                maxLength={200}
                style={ud.input}
                accessibilityLabel="Lý do thay đổi trạng thái"
              />

              <PasswordInput
                placeholder="Mật khẩu quản trị viên hiện tại"
                value={statusPassword}
                onChangeText={setStatusPassword}
                style={ud.input}
                accessibilityLabel="Mật khẩu quản trị viên hiện tại"
              />

              <Button
                label={statusBusy ? "Đang cập nhật..." : "Xác nhận đổi trạng thái"}
                onPress={() => setShowStatusConfirm(true)}
                disabled={statusBusy || !statusPassword.trim()}
              />
            </View>

            {/* Contract Limited Role Change Note */}
            <View style={ud.noticeBox}>
              <Text style={ud.noticeTitle}>ℹ️ Chuyển vai trò</Text>
              <Text style={ud.noticeText}>{CONTRACT_LIMITED.userRoleChange}</Text>
            </View>
          </View>
        ) : null}

        {/* Confirmation Modal for Status Change */}
        <Modal
          visible={showStatusConfirm}
          transparent
          animationType="fade"
          onRequestClose={() => setShowStatusConfirm(false)}
        >
          <View style={ud.modalOverlay}>
            <View style={ud.modalContent}>
              <Text style={ud.modalTitle}>Xác nhận đổi trạng thái</Text>
              <Text style={ud.modalText}>
                Bạn có chắc chắn muốn đổi trạng thái của người dùng{" "}
                <Text style={{ fontWeight: "700" }}>{user?.displayName}</Text> sang{" "}
                <Text style={{ fontWeight: "700" }}>{newStatus === "ACTIVE" ? "Hoạt động" : "Tạm khóa"}</Text>
                ?
              </Text>
              <View style={ud.modalActions}>
                <Button label="Hủy" onPress={() => setShowStatusConfirm(false)} />
                <Button label="Xác nhận" onPress={() => void handleStatusSubmit()} />
              </View>
            </View>
          </View>
        </Modal>

        {/* Confirmation Modal for Lecturer Verification */}
        <Modal
          visible={showVerifyConfirm}
          transparent
          animationType="fade"
          onRequestClose={() => setShowVerifyConfirm(false)}
        >
          <View style={ud.modalOverlay}>
            <View style={ud.modalContent}>
              <Text style={ud.modalTitle}>Xác minh giảng viên</Text>
              <Text style={ud.modalText}>
                Bạn có chắc chắn muốn xác minh tư cách giảng viên cho{" "}
                <Text style={{ fontWeight: "700" }}>{user?.displayName}</Text>? Giảng viên sẽ có quyền tạo
                khóa học và mở lớp sau khi xác minh.
              </Text>
              <View style={ud.modalActions}>
                <Button label="Hủy" onPress={() => setShowVerifyConfirm(false)} />
                <Button label="Xác nhận cấp quyền" onPress={() => void handleVerifyLecturer()} />
              </View>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </Page>
  );
}

const ud = StyleSheet.create({
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
  statusSelector: {
    flexDirection: "row",
    gap: tokens.space.small,
    marginBottom: tokens.space.small,
  },
  statusOption: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    minHeight: 48,
    justifyContent: "center",
  },
  statusOptionSelected: {
    borderColor: tokens.color.brand,
    backgroundColor: tokens.color.brand,
  },
  statusOptionText: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  statusOptionTextSelected: {
    color: "#ffffff",
  },
  successText: {
    color: tokens.color.success,
    fontSize: 14,
    fontWeight: "600",
    marginVertical: tokens.space.small,
  },
  noticeBox: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.medium,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.large,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
    marginBottom: 4,
  },
  noticeText: {
    fontSize: 13,
    color: tokens.color.muted,
    lineHeight: 18,
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
