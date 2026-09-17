import { useEffect, useState, useCallback } from "react";
import { Text, View, TextInput, FlatList, StyleSheet, ActivityIndicator, Modal } from "react-native";
import { router } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { lecturerApplications, validatePassword, type LecturerApplication } from "../../../src/admin";
import { Page, Button, styles, tokens } from "../../../src/ui";

export default function AdminLecturerVerificationScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [applications, setApplications] = useState<LecturerApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Application Decision Modal State
  const [selectedApp, setSelectedApp] = useState<LecturerApplication | null>(null);
  const [decisionType, setDecisionType] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [decisionPassword, setDecisionPassword] = useState("");
  const [decisionBusy, setDecisionBusy] = useState(false);

  // Direct User Verification Section State
  const [directUserId, setDirectUserId] = useState("");
  const [directPassword, setDirectPassword] = useState("");
  const [directBusy, setDirectBusy] = useState(false);
  const [showDirectConfirm, setShowDirectConfirm] = useState(false);

  const loadApplications = useCallback(
    async (isRefresh = false) => {
      if (snapshot.user?.role !== "ADMIN") return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const currentMonth = new Date().toISOString().slice(0, 7);
        const res = await session.request(
          `/api/v1/admin/lecturer-applications?month=${currentMonth}&shard=0`,
        );
        const list = lecturerApplications(res);
        setApplications(list);
      } catch (e: unknown) {
        if (e instanceof ApiError) {
          setError(e.message);
        } else {
          setError("Không thể tải danh sách hồ sơ giảng viên.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, snapshot.user?.role],
  );

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  const handleDecisionSubmit = async () => {
    if (!selectedApp || !validatePassword(decisionPassword)) {
      setError("Vui lòng nhập mật khẩu quản trị viên.");
      return;
    }
    setDecisionBusy(true);
    setError("");
    setSuccessMessage("");

    try {
      const key = Crypto.randomUUID();
      await session.request(`/api/v1/admin/lecturer-applications/${selectedApp.applicationId}/decision`, {
        method: "POST",
        headers: {
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          decision: decisionType,
          currentPassword: decisionPassword,
        }),
      });
      setSelectedApp(null);
      setDecisionPassword("");
      setSuccessMessage(
        `Đã ${decisionType === "APPROVE" ? "phê duyệt" : "từ chối"} hồ sơ ứng tuyển giảng viên.`,
      );
      await loadApplications(true);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.message.includes("REAUTH") || e.status === 401) {
          setError("Mật khẩu quản trị viên không chính xác.");
        } else {
          setError(e.message);
        }
      } else {
        setError("Xử lý hồ sơ thất bại.");
      }
    } finally {
      setDecisionBusy(false);
    }
  };

  const handleDirectVerify = async () => {
    const trimmedId = directUserId.trim();
    if (!trimmedId || !validatePassword(directPassword)) {
      setError("Vui lòng điền đủ Mã người dùng và Mật khẩu.");
      return;
    }
    setDirectBusy(true);
    setError("");
    setSuccessMessage("");
    setShowDirectConfirm(false);

    try {
      const key = Crypto.randomUUID();
      await session.request(`/api/v1/admin/lecturers/${trimmedId}/verify`, {
        method: "POST",
        headers: {
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          currentPassword: directPassword,
        }),
      });
      setDirectUserId("");
      setDirectPassword("");
      setSuccessMessage("Xác minh giảng viên trực tiếp thành công.");
      await loadApplications(true);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.message.includes("REAUTH") || e.status === 401) {
          setError("Mật khẩu quản trị viên không chính xác.");
        } else {
          setError(e.message);
        }
      } else {
        setError("Xác minh trực tiếp thất bại.");
      }
    } finally {
      setDirectBusy(false);
    }
  };

  if (snapshot.user?.role !== "ADMIN") {
    return (
      <Page>
        <Text style={styles.title}>Xác minh giảng viên</Text>
        <Text style={styles.error}>Chức năng này yêu cầu quyền Quản trị viên (ADMIN).</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderApplication = ({ item }: { item: LecturerApplication }) => (
    <View style={ls.card}>
      <View style={ls.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={ls.cardTitle}>{item.displayName ?? `Người dùng ${item.userId.slice(0, 8)}...`}</Text>
          <Text style={ls.cardSub}>{item.emailMasked ?? `ID: ${item.userId}`}</Text>
        </View>
        <View
          style={[
            ls.badge,
            item.status === "APPROVED"
              ? ls.badgeApproved
              : item.status === "REJECTED"
                ? ls.badgeRejected
                : ls.badgePending,
          ]}
        >
          <Text style={ls.badgeText}>
            {item.status === "APPROVED" ? "ĐÃ DUYỆT" : item.status === "REJECTED" ? "TỪ CHỐI" : "CHỜ DUYỆT"}
          </Text>
        </View>
      </View>

      <Text style={ls.dateText}>
        Nộp lúc: {new Date(item.submittedAt).toLocaleDateString("vi-VN")}
        {item.decidedAt ? ` · Xử lý lúc: ${new Date(item.decidedAt).toLocaleDateString("vi-VN")}` : ""}
      </Text>

      {item.notes ? <Text style={ls.notesText}>Ghi chú: {item.notes}</Text> : null}

      {item.status === "PENDING" && (
        <View style={ls.cardActions}>
          <Button
            label="Phê duyệt hồ sơ"
            onPress={() => {
              setSelectedApp(item);
              setDecisionType("APPROVE");
            }}
          />
          <Button
            label="Từ chối hồ sơ"
            onPress={() => {
              setSelectedApp(item);
              setDecisionType("REJECT");
            }}
          />
        </View>
      )}
    </View>
  );

  return (
    <Page scroll={false}>
      <Text style={styles.title}>Xác minh giảng viên</Text>
      <Text style={styles.small}>Thẩm định hồ sơ chuyển vai trò và cấp quyền giảng dạy hệ thống</Text>

      {successMessage ? <Text style={ls.successText}>{successMessage}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Direct User Verification Accordion */}
      <View style={ls.directCard}>
        <Text style={ls.directHeading}>Xác minh nhanh theo Mã người dùng</Text>
        <TextInput
          placeholder="Mã người dùng (User ID / UUID)"
          value={directUserId}
          onChangeText={setDirectUserId}
          style={ls.input}
          autoCapitalize="none"
          accessibilityLabel="Mã người dùng cần xác minh giảng viên"
        />
        <TextInput
          secureTextEntry
          placeholder="Mật khẩu quản trị viên hiện tại"
          value={directPassword}
          onChangeText={setDirectPassword}
          style={ls.input}
          accessibilityLabel="Mật khẩu quản trị viên"
        />
        <Button
          label={directBusy ? "Đang xử lý..." : "Xác minh tư cách giảng viên"}
          onPress={() => setShowDirectConfirm(true)}
          disabled={directBusy || !directUserId.trim() || !directPassword.trim()}
        />
      </View>

      <Text style={[styles.text, { fontWeight: "700", marginTop: tokens.space.medium }]}>
        Hồ sơ ứng tuyển giảng viên
      </Text>

      {loading && !refreshing ? (
        <ActivityIndicator size="large" color={tokens.color.brand} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={applications}
          keyExtractor={(a) => a.applicationId}
          renderItem={renderApplication}
          refreshing={refreshing}
          onRefresh={() => void loadApplications(true)}
          ListEmptyComponent={
            <View style={ls.emptyContainer}>
              <Text style={ls.emptyText}>Hiện không có hồ sơ giảng viên chờ duyệt.</Text>
            </View>
          }
          contentContainerStyle={ls.listContent}
        />
      )}

      {/* Decision Modal */}
      <Modal
        visible={!!selectedApp}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedApp(null)}
      >
        <View style={ls.modalOverlay}>
          <View style={ls.modalContent}>
            <Text style={ls.modalTitle}>
              {decisionType === "APPROVE" ? "Phê duyệt giảng viên" : "Từ chối hồ sơ"}
            </Text>
            <Text style={ls.modalText}>
              Thao tác với hồ sơ của{" "}
              <Text style={{ fontWeight: "700" }}>{selectedApp?.displayName ?? selectedApp?.userId}</Text>.
              Nhập mật khẩu quản trị viên để xác nhận.
            </Text>

            <TextInput
              secureTextEntry
              placeholder="Mật khẩu quản trị viên hiện tại"
              value={decisionPassword}
              onChangeText={setDecisionPassword}
              style={ls.input}
              accessibilityLabel="Mật khẩu quản trị viên"
            />

            <View style={ls.modalActions}>
              <Button label="Hủy" onPress={() => setSelectedApp(null)} />
              <Button
                label={decisionBusy ? "Đang xử lý..." : "Xác nhận quyết định"}
                onPress={() => void handleDecisionSubmit()}
                disabled={decisionBusy || !decisionPassword.trim()}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Direct Verification Modal */}
      <Modal
        visible={showDirectConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDirectConfirm(false)}
      >
        <View style={ls.modalOverlay}>
          <View style={ls.modalContent}>
            <Text style={ls.modalTitle}>Xác nhận xác minh giảng viên</Text>
            <Text style={ls.modalText}>
              Bạn có chắc chắn muốn xác minh tư cách giảng viên cho ID{" "}
              <Text style={{ fontWeight: "700" }}>{directUserId}</Text>?
            </Text>
            <View style={ls.modalActions}>
              <Button label="Hủy" onPress={() => setShowDirectConfirm(false)} />
              <Button label="Xác nhận" onPress={() => void handleDirectVerify()} />
            </View>
          </View>
        </View>
      </Modal>
    </Page>
  );
}

const ls = StyleSheet.create({
  directCard: {
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: tokens.space.medium,
    marginTop: tokens.space.small,
  },
  directHeading: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
    marginBottom: tokens.space.small,
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
  listContent: {
    paddingBottom: tokens.space.large,
    marginTop: tokens.space.small,
  },
  card: {
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: tokens.space.medium,
    marginBottom: tokens.space.small,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  cardSub: {
    fontSize: 13,
    color: tokens.color.muted,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgePending: {
    backgroundColor: "#fef3c7",
  },
  badgeApproved: {
    backgroundColor: "#d1fae5",
  },
  badgeRejected: {
    backgroundColor: "#fee2e2",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  dateText: {
    fontSize: 12,
    color: tokens.color.muted,
    marginTop: tokens.space.small,
  },
  notesText: {
    fontSize: 12,
    color: tokens.color.ink,
    marginTop: 4,
    fontStyle: "italic",
  },
  cardActions: {
    flexDirection: "row",
    gap: tokens.space.small,
    marginTop: tokens.space.small,
  },
  emptyContainer: {
    padding: tokens.space.large,
    alignItems: "center",
  },
  emptyText: {
    color: tokens.color.muted,
    fontSize: 14,
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
