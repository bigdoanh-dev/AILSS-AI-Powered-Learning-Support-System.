import { useEffect, useState, useSyncExternalStore } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { router, type Href } from "expo-router";
import { ApiError, record } from "../../../src/api";
import { userProfile, type UserProfile } from "../../../src/account";
import { runtime } from "../../../src/runtime";
import { Badge, Button, Icon, Page, ScreenHeader, styles, tokens } from "../../../src/ui";

type Details = {
  bio: string;
  experience: string;
  education: string;
  achievements: string;
  showPhoto: boolean;
};

const parse = (value: unknown): Details => {
  const r = record(value);
  return {
    bio: typeof r.bio === "string" ? r.bio : "",
    experience: typeof r.experience === "string" ? r.experience : "",
    education: typeof r.education === "string" ? r.education : "",
    achievements: typeof r.achievements === "string" ? r.achievements : "",
    showPhoto: r.showPhoto === true,
  };
};

export default function LecturerProfileEditor() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const isVerified = Boolean(profile?.lecturerVerified);

  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") return;
    let active = true;

    void session
      .request("/api/v1/me")
      .then((v) => {
        if (active) setProfile(userProfile(v));
      })
      .catch(() => {});

    void session
      .request("/api/v1/me/lecturer-profile")
      .then((value) => {
        if (active) setDetails(parse(value));
      })
      .catch((cause) => {
        if (active) {
          setDetails({
            bio: "",
            experience: "",
            education: "",
            achievements: "",
            showPhoto: false,
          });
          if (profile?.lecturerVerified) {
            setMessage(cause instanceof ApiError ? cause.message : "Không tải được hồ sơ.");
            setMessageType("error");
          }
        }
      });
    return () => {
      active = false;
    };
  }, [session, snapshot.user?.role, profile?.lecturerVerified]);

  async function save() {
    if (!details) return;
    setBusy(true);
    setMessage("");
    try {
      setDetails(
        parse(await session.request("/api/v1/me/lecturer-profile", { method: "PATCH", body: details })),
      );
      setMessageType("success");
      setMessage("✓ Đã lưu và cập nhật hồ sơ công khai thành công.");
    } catch (cause) {
      setMessageType("error");
      setMessage(cause instanceof ApiError ? cause.message : "Không thể cập nhật hồ sơ.");
    } finally {
      setBusy(false);
    }
  }

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <ScreenHeader title="Hồ sơ giảng viên" onBack={() => router.replace("/")} />
        <Text style={styles.error}>Chỉ giảng viên được cập nhật hồ sơ.</Text>
      </Page>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Hồ sơ &amp; Xác thực Giảng viên"
          subtitle="Thông tin chuyên môn và tiến trình thẩm định"
          onBack={() => router.replace("/teaching" as Href)}
        />

        {/* 1. Identity & Verification Status Card */}
        <View style={ds.card}>
          <View style={ds.identityRow}>
            <View style={ds.avatarPlaceholder}>
              <Text style={ds.avatarLetter}>
                {(snapshot.user.displayName?.trim()?.charAt(0) || "G").toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text style={ds.displayName}>{snapshot.user.displayName}</Text>
                <Badge
                  label={isVerified ? "Đã xác minh chính thức" : "Đang chờ duyệt xét"}
                  variant={isVerified ? "success" : "warning"}
                />
              </View>
              <Text style={styles.small}>{snapshot.user.emailMasked}</Text>
              <Text style={[styles.small, { fontSize: 11, color: tokens.color.muted }]}>
                Mã định danh: {snapshot.user.userId.slice(0, 14)}…
              </Text>
            </View>
          </View>
        </View>

        {/* 2. Verification Process Stepper Card */}
        <View style={ds.card}>
          <View style={ds.sectionHeaderRow}>
            <Icon name="shield" size={16} color={tokens.color.brand} />
            <Text style={ds.sectionHeaderTitle}>QUY TRÌNH XÁC THỰC GIẢNG VIÊN</Text>
          </View>

          <View style={ds.stepperList}>
            {/* Step 1 */}
            <View style={ds.stepRow}>
              <View style={[ds.stepDot, ds.stepDotSuccess]}>
                <Icon name="check" size={12} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ds.stepTitle}>1. Khởi tạo tài khoản Giảng viên</Text>
                <Text style={styles.small}>Đã hoàn thành đăng ký vai trò giảng viên AILSS.</Text>
              </View>
            </View>

            {/* Step 2 */}
            <View style={ds.stepRow}>
              <View
                style={[
                  ds.stepDot,
                  details?.bio || details?.experience ? ds.stepDotSuccess : ds.stepDotActive,
                ]}
              >
                <Icon
                  name={details?.bio || details?.experience ? "check" : "document"}
                  size={12}
                  color="#FFFFFF"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ds.stepTitle}>
                  2. Khai báo hồ sơ chuyên môn{" "}
                  {details?.bio || details?.experience ? "(Đã lưu)" : "(Đang cập nhật)"}
                </Text>
                <Text style={styles.small}>
                  Tiểu sử, học vị, kinh nghiệm giảng dạy và các chứng chỉ, bằng cấp.
                </Text>
              </View>
            </View>

            {/* Step 3 */}
            <View style={ds.stepRow}>
              <View style={[ds.stepDot, ds.stepDotActive]}>
                <Icon name="card" size={12} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ds.stepTitle}>3. Thiết lập tài khoản nhận doanh thu (Payout)</Text>
                <Text style={styles.small}>
                  Khai báo tài khoản ngân hàng để nhận chi trả tiền bán khóa học.
                </Text>
              </View>
            </View>

            {/* Step 4 */}
            <View style={ds.stepRow}>
              <View style={[ds.stepDot, isVerified ? ds.stepDotSuccess : ds.stepDotWarning]}>
                <Icon name={isVerified ? "checkCircle" : "alert"} size={12} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ds.stepTitle}>
                  4. Quản trị viên thẩm định &amp; Cấp quyền {isVerified ? "(Đã duyệt)" : "(Chờ duyệt)"}
                </Text>
                <Text style={styles.small}>
                  {isVerified
                    ? "Tài khoản có toàn quyền xuất bản khóa học và đối soát doanh thu."
                    : "Quản trị viên đối soát thông tin và cấp quyền giảng dạy chính thức."}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* 3. Public Profile Form */}
        <View style={ds.card}>
          <View style={ds.sectionHeaderRow}>
            <Icon name="people" size={16} color={tokens.color.brand} />
            <Text style={ds.sectionHeaderTitle}>HỒ SƠ CÔNG KHAI CHO HỌC VIÊN</Text>
          </View>

          <Text style={styles.small}>
            Thông tin này hiển thị trên trang khóa học và hồ sơ giảng viên công khai trước khi học viên đăng
            ký.
          </Text>

          {!details ? (
            <Text style={styles.small}>Đang tải thông tin hồ sơ…</Text>
          ) : (
            <>
              {(
                [
                  ["bio", "Giới thiệu & Phong cách giảng dạy", 2000],
                  ["experience", "Kinh nghiệm giảng dạy & Làm việc", 3000],
                  ["education", "Học vấn & Trình độ chuyên môn", 2000],
                  ["achievements", "Thành tựu, Chứng chỉ & Bằng cấp", 2000],
                ] as const
              ).map(([key, label, maxLength]) => (
                <View key={key} style={{ gap: 5 }}>
                  <Text style={[styles.small, { fontWeight: "700", color: tokens.color.ink }]}>{label}</Text>
                  <TextInput
                    accessibilityLabel={label}
                    style={[styles.input, { minHeight: 82, textAlignVertical: "top" }]}
                    multiline
                    maxLength={maxLength}
                    value={details[key]}
                    placeholder={`Nhập ${label.toLowerCase()}…`}
                    onChangeText={(value) =>
                      setDetails((current) => (current ? { ...current, [key]: value } : current))
                    }
                  />
                </View>
              ))}

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingVertical: 6,
                  backgroundColor: tokens.color.surfaceSubtle,
                  padding: 12,
                  borderRadius: tokens.radius.md,
                }}
              >
                <Switch
                  accessibilityLabel="Hiển thị ảnh thật công khai"
                  value={details.showPhoto}
                  onValueChange={(value) =>
                    setDetails((current) => (current ? { ...current, showPhoto: value } : current))
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.text, { fontWeight: "700", fontSize: 13 }]}>
                    Hiển thị ảnh chân dung thật
                  </Text>
                  <Text style={[styles.small, { fontSize: 11 }]}>
                    Sử dụng ảnh đại diện thật từ Tài khoản của bạn trên hồ sơ công khai.
                  </Text>
                </View>
              </View>

              <Button
                label={busy ? "Đang lưu…" : "Lưu hồ sơ công khai"}
                disabled={busy}
                onPress={() => void save()}
              />
            </>
          )}

          {message ? (
            <Text
              accessibilityRole="alert"
              style={[
                styles.small,
                {
                  color: messageType === "success" ? tokens.color.success : tokens.color.danger,
                  fontWeight: "600",
                },
              ]}
            >
              {message}
            </Text>
          ) : null}
        </View>

        {/* 4. Quick Actions */}
        <View style={{ gap: 8, marginTop: 4 }}>
          <Button
            label="Xem trang hồ sơ công khai"
            variant="outline"
            onPress={() => router.push(`/lecturers/${snapshot.user!.userId}` as Href)}
          />
          <Button
            label="Cài đặt tài khoản nhận tiền (Payout)"
            variant="outline"
            onPress={() => router.push("/teaching/revenue" as Href)}
          />
          <Button
            label="Đổi ảnh đại diện trong Tài khoản"
            variant="outline"
            onPress={() => router.push("/account" as Href)}
          />
        </View>
      </Page>
    </View>
  );
}

const ds = StyleSheet.create({
  card: {
    ...styles.card,
    gap: 12,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  displayName: {
    fontSize: 16,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
    paddingBottom: 8,
  },
  sectionHeaderTitle: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: tokens.color.brand,
  },
  stepperList: {
    gap: 12,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  stepDotSuccess: {
    backgroundColor: tokens.color.success,
  },
  stepDotActive: {
    backgroundColor: tokens.color.brand,
  },
  stepDotWarning: {
    backgroundColor: tokens.color.warning,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.ink,
  },
});
