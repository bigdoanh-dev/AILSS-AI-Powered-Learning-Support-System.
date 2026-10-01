import { useEffect, useState, useCallback } from "react";
import { Alert, Image, Text, TextInput, View, StyleSheet } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import {
  ownedClass,
  classMembers,
  isNewClassStudent,
  type OwnedClass,
  type ClassMember,
} from "../../../../src/teaching";
import { Page, Button, ScreenHeader, Icon, NonVirtualizedList, styles, tokens } from "../../../../src/ui";
import { ScalePressable, FadeSlideIn } from "../../../../src/motion";

export default function ClassDetail() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [cls, setCls] = useState<OwnedClass | null>(null);
  const [members, setMembers] = useState<ClassMember[] | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [joinCode, setJoinCode] = useState("");
  const [warningStudentId, setWarningStudentId] = useState("");
  const [warningReason, setWarningReason] = useState("");

  useEffect(() => {
    if (!classId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setError("");

    // Class detail (CLS-02)
    void session
      .request(`/api/v1/classes/${classId}`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setCls(ownedClass(value));
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setCls(null);
          setError(e instanceof ApiError ? e.message : "Không thể tải thông tin lớp.");
        }
      });

    // Members (CLS-07)
    void session
      .request(`/api/v1/classes/${classId}/members`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setMembers(classMembers(value));
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setMembers(null);
          setError(e instanceof ApiError ? e.message : "Không thể tải danh sách thành viên.");
        }
      });

    return () => abort.abort();
  }, [classId, session, snapshot.user?.userId, retry]);

  const handleRetry = useCallback(() => setRetry((v) => v + 1), []);

  async function resetCode() {
    if (!classId || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const value = await session.request(`/api/v1/classes/${classId}/join-code/reset`, {
        method: "POST",
        idempotencyKey: Crypto.randomUUID(),
        body: {},
      });
      if (
        !value ||
        typeof value !== "object" ||
        typeof (value as { joinCode?: unknown }).joinCode !== "string"
      )
        throw new ApiError("invalid");
      setJoinCode((value as { joinCode: string }).joinCode);
      setMsg("✓ Mã cũ đã hết hiệu lực. Hãy chia sẻ mã mới với học viên.");
    } catch (cause) {
      setMsg(cause instanceof ApiError ? cause.message : "Không thể tạo mã lớp mới.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(kind: "photoDataUrl" | "coverDataUrl") {
    if (!classId || busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return setMsg("Cần cấp quyền truy cập ảnh để chọn ảnh lớp.");
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: kind === "coverDataUrl" ? [16, 9] : [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setBusy(true);
    try {
      let base64: string | undefined;
      for (const width of [1200, 960, 720, 560]) {
        const context = ImageManipulator.ImageManipulator.manipulate(asset.uri);
        context.resize({ width, height: null });
        const image = await context.renderAsync();
        const saved = await image.saveAsync({
          format: ImageManipulator.SaveFormat.JPEG,
          compress: 0.65,
          base64: true,
        });
        if (saved.base64 && Math.floor((saved.base64.length * 3) / 4) <= 256 * 1024) {
          base64 = saved.base64;
          break;
        }
      }
      if (!base64) throw new Error("IMAGE_TOO_LARGE");
      await session.request(`/api/v1/classes/${classId}`, {
        method: "PATCH",
        idempotencyKey: Crypto.randomUUID(),
        body: { [kind]: `data:image/jpeg;base64,${base64}` },
      });
      setMsg("Đã lưu ảnh lớp.");
      setRetry((value) => value + 1);
    } catch (cause) {
      setMsg(cause instanceof ApiError ? cause.message : "Không thể xử lý hoặc lưu ảnh. Hãy chọn ảnh khác.");
    } finally {
      setBusy(false);
    }
  }
  function confirmDeleteClass() {
    if (!classId || busy) return;
    Alert.alert(
      "Xóa lớp",
      "Chỉ xóa được lớp nháp chưa có học viên, buổi học hoặc khóa học liên kết. Tiếp tục?",
      [
        { text: "Hủy", style: "cancel" },
        {
          text: "Xóa lớp",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void session
              .request(`/api/v1/classes/${classId}`, {
                method: "DELETE",
                idempotencyKey: Crypto.randomUUID(),
                body: {},
              })
              .then(() => router.replace("/teaching/classes"))
              .catch((cause: unknown) =>
                setMsg(cause instanceof ApiError ? cause.message : "Không thể xóa lớp."),
              )
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

  async function warnStudent(item: ClassMember) {
    if (!classId || busy || warningReason.trim().length < 5 || warningReason.trim().length > 500) {
      setMsg("Nội dung cảnh báo cần từ 5 đến 500 ký tự.");
      return;
    }
    setBusy(true);
    try {
      await session.request(`/api/v1/classes/${classId}/members/${item.studentId}/warnings`, {
        method: "POST",
        idempotencyKey: Crypto.randomUUID(),
        body: { reason: warningReason.trim() },
      });
      setWarningStudentId("");
      setWarningReason("");
      setMsg(`Đã gửi cảnh báo cho ${item.displayName}.`);
    } catch (cause) {
      setMsg(cause instanceof ApiError ? cause.message : "Không thể gửi cảnh báo.");
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(item: ClassMember) {
    if (!classId) return;
    Alert.alert("Xóa học viên khỏi lớp", `Xóa ${item.displayName} khỏi lớp này?`, [
      { text: "Hủy", style: "cancel" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void session
            .request(`/api/v1/classes/${classId}/members/${item.studentId}`, {
              method: "DELETE",
              idempotencyKey: Crypto.randomUUID(),
              body: {},
            })
            .then(() => {
              setMsg(`Đã xóa ${item.displayName} khỏi lớp.`);
              setRetry((value) => value + 1);
            })
            .catch((cause: unknown) => {
              setMsg(cause instanceof ApiError ? cause.message : "Không thể xóa học viên.");
            })
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  const handlePublishSchedule = useCallback(async () => {
    if (!classId) return;
    setBusy(true);
    setMsg("");
    try {
      await session.request(`/api/v1/classes/${classId}/schedule/publish`, {
        method: "POST",
      });
      setMsg("✓ Đã xuất bản lịch học thành công.");
      setRetry((v) => v + 1);
    } catch (e: unknown) {
      setMsg(e instanceof ApiError ? e.message : "Không thể xuất bản lịch.");
    } finally {
      setBusy(false);
    }
  }, [classId, session]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderMember = ({ item }: { item: ClassMember }) => {
    const isNew = isNewClassStudent(item.createdAt);
    const initial = (item.displayName || "H").slice(0, 1).toUpperCase();
    return (
      <View style={[cd.memberCard, { borderLeftColor: isNew ? tokens.color.success : tokens.color.border }]}>
        <View style={cd.memberTopRow}>
          <View style={[cd.avatarCircle, { backgroundColor: isNew ? "#D1FAE5" : "#F1F5F9" }]}>
            <Text style={[cd.avatarText, { color: isNew ? "#065F46" : tokens.color.ink }]}>{initial}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={cd.memberName}>{item.displayName}</Text>
              <View style={[cd.newBadge, { backgroundColor: isNew ? "#ECFDF5" : "#F8FAFC" }]}>
                <Text style={[cd.newBadgeText, { color: isNew ? "#047857" : tokens.color.muted }]}>
                  {isNew ? "Mới" : "Cũ"}
                </Text>
              </View>
            </View>
            <Text style={cd.memberEmail}>{item.emailMasked}</Text>
          </View>
        </View>

        <View style={cd.memberMetaRow}>
          <Text style={cd.metaText}>Đăng ký: {new Date(item.createdAt).toLocaleDateString("vi-VN")}</Text>
          <Text style={cd.metaText}>Vào lớp: {new Date(item.joinedAt).toLocaleDateString("vi-VN")}</Text>
        </View>

        <View style={cd.memberActions}>
          <Button
            label="Cảnh báo"
            size="sm"
            variant="outline"
            icon={<Icon name="alert" size={13} color={tokens.color.ink} />}
            disabled={busy}
            onPress={() => {
              setWarningStudentId(item.studentId);
              setWarningReason("");
            }}
          />
          {cls?.scheduleState !== "PUBLISHED" && item.source === "JOIN_CODE" && (
            <Button
              label="Xóa khỏi lớp"
              size="sm"
              variant="outline"
              disabled={busy}
              onPress={() => confirmRemove(item)}
            />
          )}
        </View>

        {warningStudentId === item.studentId && (
          <View style={cd.warningBox}>
            <TextInput
              style={styles.input}
              value={warningReason}
              onChangeText={setWarningReason}
              maxLength={500}
              multiline
              placeholder="Nội dung cảnh báo gửi cho học viên"
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button label="Gửi cảnh báo" size="sm" disabled={busy} onPress={() => void warnStudent(item)} />
              <Button label="Hủy" size="sm" variant="outline" onPress={() => setWarningStudentId("")} />
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <Page>
      <ScreenHeader
        title={cls ? cls.name : "Chi tiết lớp học"}
        subtitle="Quản lý buổi học, điểm danh & thành viên"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/classes"))}
      />

      {!cls && !error && (
        <View style={{ alignItems: "center", paddingVertical: 30 }}>
          <Text accessibilityRole="alert" style={styles.text}>
            Đang tải thông tin lớp học…
          </Text>
        </View>
      )}

      {cls && (
        <FadeSlideIn duration={320}>
          {cls.coverDataUrl && (
            <Image
              source={{ uri: cls.coverDataUrl }}
              style={{ width: "100%", height: 180, borderRadius: 16 }}
              resizeMode="cover"
            />
          )}
          {/* Hero Classroom Card */}
          <View style={cd.hero}>
            {cls.photoDataUrl && (
              <Image
                source={{ uri: cls.photoDataUrl }}
                style={{ width: 84, height: 84, borderRadius: 14 }}
                resizeMode="cover"
              />
            )}
            <View style={cd.heroAccentStripe} />
            <View style={cd.heroTopRow}>
              <View style={cd.heroIconBox}>
                <Icon name="class" size={26} color="#FFFFFF" />
              </View>
              <View style={cd.heroTitleContainer}>
                <View style={cd.badgeRow}>
                  <View style={cd.classBadge}>
                    <Text style={cd.classBadgeText}>
                      {cls.classKind === "LIVE_COHORT"
                        ? "Lớp trực tiếp"
                        : cls.classKind === "PRIVATE"
                          ? "Lớp riêng"
                          : "Lớp học"}
                    </Text>
                  </View>
                  <View style={[cd.stateBadge, cls.state !== "ACTIVE" && cd.stateBadgeNeutral]}>
                    <View
                      style={[
                        cd.stateDot,
                        { backgroundColor: cls.state === "ACTIVE" ? tokens.color.success : "#94A3B8" },
                      ]}
                    />
                    <Text style={[cd.stateBadgeText, cls.state !== "ACTIVE" && cd.stateBadgeTextNeutral]}>
                      {cls.state === "ACTIVE"
                        ? "Đang hoạt động"
                        : cls.state === "CLOSED"
                          ? "Đã đóng"
                          : cls.state}
                    </Text>
                  </View>
                </View>
                <Text style={cd.title}>{cls.name}</Text>
              </View>
            </View>

            {/* Quick Metrics */}
            <View style={cd.metricsStrip}>
              <View style={cd.metricItem}>
                <Text style={cd.metricIcon}>👥</Text>
                <View>
                  <Text style={cd.metricLabel}>Sức chứa</Text>
                  <Text style={cd.metricValue}>
                    {cls.maxMembers != null ? `${cls.maxMembers} bạn` : "Tự do"}
                  </Text>
                </View>
              </View>

              <View style={cd.metricDivider} />

              <View style={cd.metricItem}>
                <Text style={cd.metricIcon}>🎓</Text>
                <View>
                  <Text style={cd.metricLabel}>Thành viên</Text>
                  <Text style={cd.metricValue}>{members?.length ?? 0} bạn</Text>
                </View>
              </View>

              <View style={cd.metricDivider} />

              <View style={cd.metricItem}>
                <Text style={cd.metricIcon}>📅</Text>
                <View>
                  <Text style={cd.metricLabel}>Lịch học</Text>
                  <Text style={cd.metricValue}>
                    {cls.scheduleState === "PUBLISHED" ? "Đã duyệt" : "Bản nháp"}
                  </Text>
                </View>
              </View>
            </View>

            {/* Join Code Box */}
            <View style={cd.joinCodeBox}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={cd.joinCodeLabel}>MÃ THAM GIA LỚP</Text>
                <Text style={cd.joinCodeText}>{joinCode ? joinCode : "Bấm để tạo mã tham gia mới"}</Text>
              </View>
              <Button
                label={busy ? "Đang tạo…" : "Tạo mã mới"}
                size="sm"
                variant="outline"
                icon={<Icon name="refresh" size={13} color={tokens.color.brand} />}
                disabled={busy}
                onPress={() => void resetCode()}
              />
            </View>

            {cls.linkedCourseId ? (
              <View style={cd.linkedCourseRow}>
                <Icon name="book" size={14} color={tokens.color.brand} />
                <Text style={cd.linkedCourseText}>Khóa học liên kết: {cls.linkedCourseId.slice(0, 8)}…</Text>
              </View>
            ) : null}
            <View style={{ gap: 8, marginTop: 12 }}>
              <Button
                label={busy ? "Đang lưu…" : "Tải ảnh lớp"}
                variant="outline"
                disabled={busy}
                onPress={() => void uploadImage("photoDataUrl")}
              />
              <Button
                label={busy ? "Đang lưu…" : "Tải ảnh bìa"}
                variant="outline"
                disabled={busy}
                onPress={() => void uploadImage("coverDataUrl")}
              />
              <Button label="Xóa lớp" variant="outline" disabled={busy} onPress={confirmDeleteClass} />
            </View>
          </View>

          {msg ? (
            <View style={cd.toastBox}>
              <Icon name="checkCircle" size={16} color="#065F46" />
              <Text style={cd.toastText}>{msg}</Text>
            </View>
          ) : null}

          {/* Studio Navigation Grid */}
          <Text style={cd.sectionHeading}>Quản Trị Lớp Học</Text>
          <View style={cd.actionGrid}>
            <ScalePressable
              style={cd.actionTile}
              onPress={() => router.push(`/teaching/classes/${classId}/announcements` as Href)}
            >
              <View style={[cd.actionIconBox, { backgroundColor: "#E6F7F7" }]}>
                <Icon name="megaphone" size={22} color={tokens.color.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={cd.actionTitle}>Thông báo lớp học</Text>
                <Text style={cd.actionSub}>Đăng tin & thông điệp</Text>
              </View>
              <Icon name="chevronRight" size={16} color={tokens.color.muted} />
            </ScalePressable>

            <ScalePressable
              style={cd.actionTile}
              onPress={() => router.push(`/teaching/classes/${classId}/sessions` as const)}
            >
              <View style={[cd.actionIconBox, { backgroundColor: "#CCFBF1" }]}>
                <Icon name="calendar" size={22} color="#0D9488" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={cd.actionTitle}>Lịch giảng dạy & Buổi học</Text>
                <Text style={cd.actionSub}>Xếp lịch, phòng & điểm danh</Text>
              </View>
              <Icon name="chevronRight" size={16} color={tokens.color.muted} />
            </ScalePressable>

            {cls.scheduleState === "DRAFT" ? (
              <ScalePressable
                style={[cd.actionTile, { borderColor: "#A7F3D0", backgroundColor: "#F0FDF4" }]}
                onPress={handlePublishSchedule}
              >
                <View style={[cd.actionIconBox, { backgroundColor: "#D1FAE5" }]}>
                  <Icon name="checkCircle" size={22} color="#059669" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[cd.actionTitle, { color: "#065F46" }]}>
                    {busy ? "Đang xuất bản…" : "Xuất bản lịch học"}
                  </Text>
                  <Text style={cd.actionSub}>Công bố cho tất cả học viên</Text>
                </View>
                <Icon name="chevronRight" size={16} color="#059669" />
              </ScalePressable>
            ) : null}
          </View>

          {/* Members List */}
          <View style={cd.membersHeaderRow}>
            <View>
              <Text style={cd.sectionHeading}>Thành Viên Lớp ({members?.length ?? 0})</Text>
              <Text style={cd.metaGuideText}>● Xanh: Tài khoản mới (≤21 ngày) · ● Xám: Học viên cũ</Text>
            </View>
          </View>

          {members && members.length === 0 && (
            <View style={cd.emptyMemberCard}>
              <View style={cd.emptyMemberIconRing}>
                <Icon name="people" size={26} color={tokens.color.brand} />
              </View>
              <Text style={cd.emptyMemberTitle}>Chưa có thành viên nào</Text>
              <Text style={cd.emptyMemberSub}>
                Chia sẻ mã tham gia lớp với học viên để các bạn có thể ghi danh vào lớp học.
              </Text>
            </View>
          )}

          {members && members.length > 0 && (
            <NonVirtualizedList
              data={members}
              keyExtractor={(item) => item.studentId}
              renderItem={renderMember}
              contentContainerStyle={{ gap: 8 }}
            />
          )}
        </FadeSlideIn>
      )}

      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {error && <Button label="Thử lại" onPress={handleRetry} />}
      <View style={{ marginTop: 12 }}>
        <Button
          label="Quay lại"
          variant="outline"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />
      </View>
    </Page>
  );
}

const cd = StyleSheet.create({
  hero: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 16,
    gap: 12,
    position: "relative",
    overflow: "hidden",
    ...tokens.shadow.card,
  },
  heroAccentStripe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: tokens.color.brand,
  },
  heroTopRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    paddingTop: 2,
  },
  heroIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
    ...tokens.shadow.subtle,
  },
  heroTitleContainer: {
    flex: 1,
    gap: 4,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  classBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: tokens.color.brandLight,
  },
  classBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: tokens.color.brandDark,
  },
  stateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: tokens.color.successLight,
  },
  stateDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  stateBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#065F46",
  },
  stateBadgeNeutral: {
    backgroundColor: "#F1F5F9",
  },
  stateBadgeTextNeutral: {
    color: tokens.color.inkSecondary,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: tokens.color.ink,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  metricsStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: tokens.color.surfaceSubtle,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  metricItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  metricIcon: { fontSize: 16 },
  metricLabel: { color: tokens.color.muted, fontSize: 11 },
  metricValue: { color: tokens.color.ink, fontSize: 13, fontWeight: "700" },
  metricDivider: { width: 1, height: 24, backgroundColor: tokens.color.border, marginHorizontal: 4 },
  joinCodeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#F0FDFA",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  joinCodeLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#0D9488",
    letterSpacing: 0.5,
  },
  joinCodeText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F766E",
  },
  linkedCourseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 2,
  },
  linkedCourseText: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  toastBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#D1FAE5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    marginVertical: 4,
  },
  toastText: {
    color: "#065F46",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: "800",
    color: tokens.color.ink,
    marginTop: 10,
    marginBottom: 6,
  },
  actionGrid: {
    gap: 8,
    marginBottom: 8,
  },
  actionTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.subtle,
  },
  actionIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  actionSub: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  membersHeaderRow: {
    marginTop: 6,
    marginBottom: 8,
  },
  metaGuideText: {
    fontSize: 11,
    color: tokens.color.muted,
    marginTop: 2,
  },
  memberCard: {
    gap: 8,
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderLeftWidth: 4,
    ...tokens.shadow.subtle,
  },
  memberTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 15,
    fontWeight: "800",
  },
  memberName: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  newBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  memberEmail: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  memberMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 2,
  },
  metaText: {
    fontSize: 11,
    color: tokens.color.muted,
  },
  memberActions: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 4,
  },
  warningBox: {
    gap: 8,
    marginTop: 6,
    padding: 10,
    backgroundColor: tokens.color.surfaceSubtle,
    borderRadius: 8,
  },
  emptyMemberCard: {
    alignItems: "center",
    padding: 24,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 8,
    ...tokens.shadow.subtle,
  },
  emptyMemberIconRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyMemberTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  emptyMemberSub: {
    fontSize: 12,
    color: tokens.color.muted,
    textAlign: "center",
    lineHeight: 18,
  },
});
