import { useEffect, useState, useCallback } from "react";
import { Text, TextInput, View, Pressable, StyleSheet, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import { lecturerCourse, type LecturerCourse, CONTRACT_LIMITED } from "../../../../src/teaching";
import { Page, Button, ScreenHeader, styles, tokens } from "../../../../src/ui";

const CATEGORY_PRESETS = [
  { id: "cat-web", name: "Web & AI" },
  { id: "cat-db", name: "Cơ sở dữ liệu" },
  { id: "cat-ai", name: "AI & ML" },
  { id: "cat-devops", name: "DevOps / Cloud" },
  { id: "cat-mobile", name: "Di động" },
  { id: "cat-security", name: "An ninh mạng" },
];

export default function CourseEdit() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [course, setCourse] = useState<LecturerCourse | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priceType, setPriceType] = useState<"FREE" | "PAID">("FREE");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("VND");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => Crypto.randomUUID());
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!courseId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setError("");
    void session
      .request(`/api/v1/courses/${courseId}`, { signal: abort.signal })
      .then((value) => {
        if (abort.signal.aborted) return;
        const c = lecturerCourse(value);
        setCourse(c);
        setTitle(c.title);
        setDescription(c.description ?? "");
        setCategoryId(c.categoryId ?? "");
        setPriceType(c.priceType === "PAID" ? "PAID" : "FREE");
        setPrice(c.price ?? "");
        setCurrency(c.currency ?? "VND");
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(e instanceof ApiError ? e.message : "Không thể tải khóa học.");
      });
    return () => abort.abort();
  }, [courseId, session, snapshot.user?.userId, retry]);

  const handleSave = useCallback(async () => {
    if (!courseId || !course) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body: Record<string, unknown> = {};
      if (title !== course.title) body.title = title;
      if (description !== (course.description ?? "")) body.description = description;
      if (categoryId !== (course.categoryId ?? "")) body.categoryId = categoryId;
      if (priceType !== (course.priceType ?? "")) body.priceType = priceType;
      if (price !== (course.price ?? "")) body.price = price;
      if (currency !== (course.currency ?? "")) body.currency = currency;

      if (Object.keys(body).length === 0) {
        setMessage("Không có thay đổi nào để lưu.");
        return;
      }

      await session.request(`/api/v1/courses/${courseId}`, {
        method: "PATCH",
        body,
        idempotencyKey,
      });
      setMessage("✓ Đã lưu thay đổi khóa học thành công!");
      setIdempotencyKey(Crypto.randomUUID());
      setRetry((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không thể lưu thay đổi.");
    } finally {
      setBusy(false);
    }
  }, [courseId, course, title, description, categoryId, priceType, price, currency, session, idempotencyKey]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <Page>
      <ScreenHeader
        title="Chỉnh sửa khóa học"
        subtitle="Cập nhật thông tin giảng dạy & thiết lập học phí"
        onBack={() => (router.canGoBack() ? router.back() : router.replace(`/teaching/courses/${courseId}`))}
      />

      {!course && !error && (
        <Text accessibilityRole="alert" style={styles.text}>
          Đang tải…
        </Text>
      )}

      {course && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>
          {/* Live Preview Card */}
          <View style={[styles.card, ed.previewBox]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={ed.previewTag}>👁️ XEM TRƯỚC HIỂN THỊ HỌC VIÊN</Text>
              <View style={[ed.badge, course.state === "PUBLISHED" ? ed.published : ed.draft]}>
                <Text style={ed.badgeText}>{course.state === "PUBLISHED" ? "ĐÃ XUẤT BẢN" : "BẢN NHÁP"}</Text>
              </View>
            </View>
            <Text style={ed.previewTitle} numberOfLines={2}>
              {title.trim() || "Tiêu đề khóa học"}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Text style={ed.previewPrice}>
                {priceType === "FREE" ? "Miễn phí" : `${price.trim() || "0"} ${currency}`}
              </Text>
              <Text style={ed.previewCat}>📁 {categoryId || "Chưa phân loại"}</Text>
            </View>
          </View>

          {/* Form Card 1: Thông tin cơ bản */}
          <View style={[styles.card, ed.formCard]}>
            <Text style={ed.cardHeading}>📝 Thông tin cơ bản</Text>

            <View style={ed.fieldGroup}>
              <View style={ed.labelRow}>
                <Text style={ed.fieldLabel}>Tên khóa học *</Text>
                <Text style={ed.charCount}>{title.length}/200</Text>
              </View>
              <TextInput
                accessibilityLabel="Tên khóa học"
                style={[styles.input, ed.input]}
                value={title}
                onChangeText={setTitle}
                maxLength={200}
                placeholder="Nhập tên khóa học rõ ràng, hấp dẫn..."
              />
            </View>

            <View style={ed.fieldGroup}>
              <View style={ed.labelRow}>
                <Text style={ed.fieldLabel}>Mô tả chi tiết</Text>
                <Text style={ed.charCount}>{description.length}/2000</Text>
              </View>
              <TextInput
                accessibilityLabel="Mô tả"
                style={[styles.input, ed.input, { minHeight: 96, textAlignVertical: "top" }]}
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={2000}
                placeholder="Giới thiệu mục tiêu, kiến thức đạt được và đối tượng học viên..."
              />
            </View>

            <View style={ed.fieldGroup}>
              <Text style={ed.fieldLabel}>Danh mục đào tạo</Text>
              {/* Quick Select Chips */}
              <View style={ed.chipsRow}>
                {CATEGORY_PRESETS.map((cat) => (
                  <Pressable
                    key={cat.id}
                    style={[ed.categoryChip, categoryId === cat.id && ed.categoryChipActive]}
                    onPress={() => setCategoryId(cat.id)}
                  >
                    <Text style={[ed.categoryChipText, categoryId === cat.id && ed.categoryChipTextActive]}>
                      {cat.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                accessibilityLabel="Mã danh mục"
                style={[styles.input, ed.input, { marginTop: 6 }]}
                value={categoryId}
                onChangeText={setCategoryId}
                placeholder="Nhập hoặc chỉnh sửa mã danh mục..."
              />
            </View>
          </View>

          {/* Form Card 2: Học phí & Thương mại */}
          <View style={[styles.card, ed.formCard]}>
            <Text style={ed.cardHeading}>💰 Chính sách học phí & Thương mại</Text>

            <View style={ed.priceTypeSelector}>
              <Pressable
                style={[ed.priceTypeButton, priceType === "FREE" && ed.priceTypeButtonActive]}
                onPress={() => {
                  setPriceType("FREE");
                  setPrice("0");
                }}
              >
                <Text style={[ed.priceTypeText, priceType === "FREE" && ed.priceTypeTextActive]}>
                  🆓 Khóa học Miễn Phí
                </Text>
              </Pressable>
              <Pressable
                style={[ed.priceTypeButton, priceType === "PAID" && ed.priceTypeButtonActive]}
                onPress={() => setPriceType("PAID")}
              >
                <Text style={[ed.priceTypeText, priceType === "PAID" && ed.priceTypeTextActive]}>
                  💳 Có Thu Phí (VNĐ)
                </Text>
              </Pressable>
            </View>

            {priceType === "PAID" && (
              <View style={{ gap: 10, marginTop: 10 }}>
                <View style={ed.fieldGroup}>
                  <Text style={ed.fieldLabel}>Học phí niêm yết</Text>
                  <TextInput
                    accessibilityLabel="Giá"
                    style={[styles.input, ed.input]}
                    value={price}
                    onChangeText={setPrice}
                    keyboardType="numeric"
                    placeholder="Ví dụ: 450000"
                  />
                </View>

                <View style={ed.fieldGroup}>
                  <Text style={ed.fieldLabel}>Đơn vị tiền tệ</Text>
                  <TextInput
                    accessibilityLabel="Đơn vị tiền tệ"
                    style={[styles.input, ed.input]}
                    value={currency}
                    onChangeText={setCurrency}
                    placeholder="VND"
                  />
                </View>
              </View>
            )}
          </View>

          {/* Form Card 3: Lưu ý nền tảng */}
          <View style={[styles.card, ed.policyCard]}>
            <Text style={[ed.cardHeading, { fontSize: 13, color: "#92400e" }]}>📌 Lưu ý phát hành</Text>
            <Text style={ed.policyText}>• {CONTRACT_LIMITED.coursePublish}</Text>
            <Text style={ed.policyText}>• {CONTRACT_LIMITED.courseImageUpload}</Text>
          </View>

          {message ? (
            <View style={ed.successBanner}>
              <Text style={ed.successBannerText}>{message}</Text>
            </View>
          ) : null}

          {/* Action Buttons */}
          <View style={{ gap: 10, marginTop: 4 }}>
            <Button
              label={busy ? "Đang lưu thay đổi…" : "💾 Lưu thay đổi khóa học"}
              disabled={busy || !title.trim()}
              onPress={() => {
                void handleSave();
              }}
            />
            <Button
              label="Quay lại chi tiết"
              variant="outline"
              onPress={() => (router.canGoBack() ? router.back() : router.replace(`/teaching/courses/${courseId}`))}
            />
          </View>
        </ScrollView>
      )}

      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {error && <Button label="Thử lại" onPress={() => setRetry((v) => v + 1)} />}
    </Page>
  );
}

const ed = StyleSheet.create({
  previewBox: {
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.brand,
    padding: 14,
    gap: 6,
  },
  previewTag: {
    fontSize: 10,
    fontWeight: "800",
    color: tokens.color.muted,
    letterSpacing: 0.5,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    lineHeight: 22,
  },
  previewPrice: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  previewCat: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  published: { backgroundColor: "#dcfce7" },
  draft: { backgroundColor: "#fef3c7" },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#166534" },
  formCard: {
    padding: 16,
    gap: 12,
  },
  cardHeading: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  fieldGroup: {
    gap: 4,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  charCount: {
    fontSize: 11,
    color: tokens.color.muted,
  },
  input: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginVertical: 4,
  },
  categoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  categoryChipActive: {
    backgroundColor: "#eff6ff",
    borderColor: tokens.color.brand,
  },
  categoryChipText: {
    fontSize: 12,
    color: "#475569",
  },
  categoryChipTextActive: {
    color: tokens.color.brand,
    fontWeight: "700",
  },
  priceTypeSelector: {
    flexDirection: "row",
    gap: 8,
  },
  priceTypeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 8,
  },
  priceTypeButtonActive: {
    backgroundColor: "#eff6ff",
    borderColor: tokens.color.brand,
  },
  priceTypeText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  priceTypeTextActive: {
    color: tokens.color.brand,
    fontWeight: "700",
  },
  policyCard: {
    backgroundColor: "#fffbeb",
    borderColor: "#fde68a",
    padding: 12,
    gap: 4,
  },
  policyText: {
    fontSize: 12,
    color: "#92400e",
    lineHeight: 18,
  },
  successBanner: {
    backgroundColor: "#f0fdf4",
    borderColor: "#bbf7d0",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
  },
  successBannerText: {
    color: "#166534",
    fontSize: 13,
    fontWeight: "600",
  },
});

