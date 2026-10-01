import { useState, useCallback, useSyncExternalStore } from "react";
import {
  Text,
  TextInput,
  View,
  Image,
  Pressable,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { Page, Button, ScreenHeader, Icon, BottomNavBar, styles, tokens } from "../../../src/ui";
import { ScalePressable } from "../../../src/motion";
import { RevenueQuote } from "../../../src/RevenueQuote";

const PRICE_PRESETS = [
  { label: "199.000 ₫", value: "199000" },
  { label: "399.000 ₫", value: "399000" },
  { label: "599.000 ₫", value: "599000" },
  { label: "999.000 ₫", value: "999000" },
];

function generateSlug(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "khoa-hoc"}-${Date.now().toString(36)}`;
}

export default function CreateCourse() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  // Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [priceType, setPriceType] = useState<"FREE" | "PAID">("FREE");
  const [price, setPrice] = useState("0");
  const [currency, setCurrency] = useState("VND");

  // Cover Image State
  const [coverUri, setCoverUri] = useState<string | null>(null);
  const [coverLoading, setCoverLoading] = useState(false);

  // Action State
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => Crypto.randomUUID());

  const selectedCategory = {
    name: categoryName.trim() || "Chưa nhập danh mục",
    icon: "book" as const,
    color: tokens.color.brand,
  };

  const handlePickCover = async () => {
    try {
      setCoverLoading(true);
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Cần cấp quyền truy cập",
          "Vui lòng cho phép ứng dụng truy cập thư viện ảnh để tải lên ảnh bìa khóa học.",
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const context = ImageManipulator.manipulate(result.assets[0].uri);
        context.resize({ width: 960 });
        const image = await context.renderAsync();
        const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.65, base64: true });
        const dataUrl = `data:image/jpeg;base64,${saved.base64}`;
        if (!saved.base64 || dataUrl.length > 350000) throw new Error("Ảnh quá lớn");
        setCoverUri(dataUrl);
      }
    } catch {
      Alert.alert("Lỗi", "Không thể chọn ảnh từ thiết bị. Vui lòng thử lại.");
    } finally {
      setCoverLoading(false);
    }
  };

  const handleRemoveCover = () => {
    setCoverUri(null);
  };

  const handleCreate = useCallback(async () => {
    if (!title.trim()) {
      setError("Vui lòng nhập tên khóa học.");
      return;
    }
    if (categoryName.trim().length < 2) {
      setError("Danh mục cần từ 2 đến 80 ký tự.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const slug = generateSlug(title.trim());
      await session.request("/api/v1/courses", {
        method: "POST",
        body: {
          description: description.trim(),
          coverDataUrl: coverUri,
          title: title.trim(),
          slug,
          categoryName: categoryName.trim(),
          priceType: priceType || "FREE",
          price: priceType === "FREE" ? "0" : price.trim() || "0",
          currency: currency.trim() || "VND",
        },
        idempotencyKey,
      });

      setMessage("Đã tạo khóa học thành công!");
      setIdempotencyKey(Crypto.randomUUID());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không thể tạo khóa học. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }, [title, description, coverUri, categoryName, priceType, price, currency, session, idempotencyKey]);

  const handleResetForm = () => {
    setTitle("");
    setDescription("");
    setCoverUri(null);
    setPriceType("FREE");
    setPrice("0");
    setMessage("");
    setError("");
  };

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập trang này.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Tạo khóa học mới"
          subtitle="Thiết lập nội dung & hình ảnh quảng bá khóa học"
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/courses"))}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 16, paddingBottom: 110 }}
        >
          {/* Success Banner */}
          {message ? (
            <View style={cs.successBanner}>
              <View style={cs.successIconCircle}>
                <Icon name="checkCircle" size={28} color="#059669" />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={cs.successTitle}>{message}</Text>
                <Text style={cs.successSub}>
                  Khóa học <Text style={{ fontWeight: "700" }}>"{title}"</Text> đã được khởi tạo trong hệ
                  thống.
                </Text>
                <View style={cs.successActions}>
                  <Button
                    label="Danh sách khóa học"
                    size="sm"
                    onPress={() => router.replace("/teaching/courses" as Href)}
                  />
                  <Button label="+ Tạo thêm khóa học" size="sm" variant="outline" onPress={handleResetForm} />
                </View>
              </View>
            </View>
          ) : null}

          {/* Error Alert */}
          {error ? (
            <View style={cs.errorBanner} accessibilityRole="alert">
              <Icon name="alert" size={20} color="#DC2626" />
              <Text style={cs.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Live Preview Card */}
          <View style={cs.previewCard}>
            <View style={cs.previewHeaderRow}>
              <View style={cs.previewLiveTag}>
                <View style={cs.liveDot} />
                <Text style={cs.previewLiveText}>XEM TRƯỚC HIỂN THỊ (LIVE PREVIEW)</Text>
              </View>
              <View style={cs.previewRoleBadge}>
                <Text style={cs.previewRoleText}>{priceType === "FREE" ? "🎁 MIỄN PHÍ" : "💳 CÓ PHÍ"}</Text>
              </View>
            </View>

            {/* Course Card Preview with Cover */}
            <View style={cs.previewInnerCard}>
              {coverUri ? (
                <View style={cs.previewImageContainer}>
                  <Image source={{ uri: coverUri }} style={cs.previewImage} resizeMode="cover" />
                  <View style={cs.previewImageBadge}>
                    <Icon name="check" size={12} color="#FFFFFF" />
                    <Text style={cs.previewImageBadgeText}>Ảnh bìa 16:9</Text>
                  </View>
                </View>
              ) : (
                <View style={cs.previewImagePlaceholder}>
                  <Icon name="image" size={32} color={tokens.color.muted} />
                  <Text style={cs.previewPlaceholderText}>Chưa có ảnh bìa khóa học</Text>
                </View>
              )}

              <View style={cs.previewContent}>
                <View style={cs.previewMetaRow}>
                  <View style={[cs.categoryPill, { backgroundColor: `${selectedCategory.color}15` }]}>
                    <Icon name={selectedCategory.icon} size={12} color={selectedCategory.color} />
                    <Text style={[cs.categoryPillText, { color: selectedCategory.color }]}>
                      {selectedCategory.name}
                    </Text>
                  </View>
                  <Text style={cs.previewPriceHighlight}>
                    {priceType === "FREE"
                      ? "Miễn phí"
                      : `${Number(price || 0).toLocaleString("vi-VN")} ${currency}`}
                  </Text>
                </View>

                <Text style={cs.previewTitleText} numberOfLines={2}>
                  {title.trim() || "Tiêu đề khóa học của bạn sẽ hiển thị ở đây"}
                </Text>

                {description.trim() ? (
                  <Text style={cs.previewDescText} numberOfLines={2}>
                    {description.trim()}
                  </Text>
                ) : null}

                <View style={cs.previewLecturerRow}>
                  <View style={cs.previewAvatarMini}>
                    <Text style={cs.previewAvatarInitial}>
                      {(snapshot.user?.displayName || "G").charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={cs.previewLecturerName}>
                    {snapshot.user?.displayName || "Giảng viên AILSS"}
                  </Text>
                  <View style={cs.previewVerifiedBadge}>
                    <Icon name="shield" size={10} color="#0A7E85" />
                    <Text style={cs.previewVerifiedText}>Đã xác minh</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* Section 1: Ảnh bìa khóa học (Cover Image) */}
          <View style={[styles.card, cs.sectionCard]}>
            <View style={cs.sectionHeader}>
              <View style={cs.sectionIconBadge}>
                <Icon name="image" size={20} color={tokens.color.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={cs.sectionTitle}>Hình ảnh đại diện & Ảnh bìa</Text>
                <Text style={cs.sectionSubtitle}>
                  Khuyên dùng tỉ lệ chuẩn 16:9 (1280×720px), hỗ trợ JPG, PNG hoặc WebP
                </Text>
              </View>
            </View>

            {coverUri ? (
              <View style={cs.coverSelectedWrapper}>
                <View style={cs.coverImageFrame}>
                  <Image source={{ uri: coverUri }} style={cs.coverImagePreview} resizeMode="cover" />
                  <View style={cs.coverBadgeOverlay}>
                    <Icon name="checkCircle" size={14} color="#FFFFFF" />
                    <Text style={cs.coverBadgeText}>Ảnh đã chọn · lưu khi tạo khóa</Text>
                  </View>
                </View>
                <View style={cs.coverActionRow}>
                  <ScalePressable style={cs.coverActionBtn} onPress={handlePickCover} disabled={coverLoading}>
                    <Icon name="camera" size={14} color={tokens.color.ink} />
                    <Text style={cs.coverActionBtnText}>
                      {coverLoading ? "Đang chọn..." : "Đổi ảnh khác"}
                    </Text>
                  </ScalePressable>
                  <ScalePressable style={[cs.coverActionBtn, cs.coverDeleteBtn]} onPress={handleRemoveCover}>
                    <Icon name="trash" size={14} color="#DC2626" />
                    <Text style={[cs.coverActionBtnText, { color: "#DC2626" }]}>Gỡ bỏ ảnh</Text>
                  </ScalePressable>
                </View>
              </View>
            ) : (
              <Pressable
                style={cs.uploadDropzone}
                onPress={handlePickCover}
                disabled={coverLoading}
                accessibilityRole="button"
                accessibilityLabel="Tải lên ảnh bìa khóa học"
              >
                {coverLoading ? (
                  <View style={cs.dropzoneContent}>
                    <ActivityIndicator color={tokens.color.brand} size="large" />
                    <Text style={cs.dropzoneTitle}>Đang tải ảnh lên...</Text>
                  </View>
                ) : (
                  <View style={cs.dropzoneContent}>
                    <View style={cs.uploadIconCircle}>
                      <Icon name="camera" size={26} color={tokens.color.brand} />
                    </View>
                    <Text style={cs.dropzoneTitle}>Nhấn để tải lên ảnh bìa khóa học</Text>
                    <Text style={cs.dropzoneDesc}>
                      Ảnh đại diện bắt mắt giúp tăng 45% tỷ lệ học viên quan tâm và tham gia học tập.
                    </Text>
                    <View style={cs.dropzoneButton}>
                      <Icon name="image" size={14} color="#FFFFFF" />
                      <Text style={cs.dropzoneButtonText}>Chọn từ thư viện ảnh</Text>
                    </View>
                  </View>
                )}
              </Pressable>
            )}
          </View>

          {/* Section 2: Thông tin cơ bản (Basic Info) */}
          <View style={[styles.card, cs.sectionCard]}>
            <View style={cs.sectionHeader}>
              <View style={cs.sectionIconBadge}>
                <Icon name="pencil" size={20} color={tokens.color.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={cs.sectionTitle}>Thông tin cơ bản</Text>
                <Text style={cs.sectionSubtitle}>Tên khóa học và nội dung giới thiệu bài giảng</Text>
              </View>
            </View>

            <View style={cs.fieldGroup}>
              <View style={cs.fieldLabelRow}>
                <Text style={cs.fieldLabel}>
                  Tên khóa học <Text style={{ color: "#DC2626" }}>*</Text>
                </Text>
                <Text style={cs.charCounter}>{title.length}/160</Text>
              </View>
              <TextInput
                accessibilityLabel="Tên khóa học"
                style={[styles.input, cs.textInput]}
                value={title}
                onChangeText={setTitle}
                maxLength={160}
                placeholder="VD: Lập trình Fullstack Web & Trợ lý AI thực chiến..."
                placeholderTextColor={tokens.color.muted}
              />
              {title.trim() ? (
                <View style={cs.slugRow}>
                  <Icon name="compass" size={12} color={tokens.color.muted} />
                  <Text style={cs.slugText} numberOfLines={1}>
                    Đường dẫn: /courses/{generateSlug(title)}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={cs.fieldGroup}>
              <View style={cs.fieldLabelRow}>
                <Text style={cs.fieldLabel}>Mô tả khóa học</Text>
                <Text style={cs.charCounter}>{description.length}/2000</Text>
              </View>
              <TextInput
                accessibilityLabel="Mô tả"
                style={[styles.input, cs.textInput, { minHeight: 90, textAlignVertical: "top" }]}
                value={description}
                onChangeText={setDescription}
                multiline
                maxLength={2000}
                placeholder="Giới thiệu mục tiêu, đối tượng người học, kiến thức cốt lõi sẽ đạt được..."
                placeholderTextColor={tokens.color.muted}
              />
            </View>
          </View>

          {/* Section 3: Phân loại & Danh mục (Category) */}
          <View style={[styles.card, cs.sectionCard]}>
            <View style={cs.sectionHeader}>
              <View style={cs.sectionIconBadge}>
                <Icon name="grid" size={20} color={tokens.color.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={cs.sectionTitle}>Danh mục đào tạo</Text>
                <Text style={cs.sectionSubtitle}>Tự nhập chuyên ngành hoặc lĩnh vực của khóa học</Text>
              </View>
            </View>

            <TextInput
              accessibilityLabel="Danh mục đào tạo"
              style={[styles.input, cs.textInput]}
              value={categoryName}
              onChangeText={setCategoryName}
              maxLength={80}
              placeholder="Ví dụ: Thiết kế đồ họa, Kế toán, Lập trình Python"
            />
            <Text style={styles.small}>Nhập từ 2 đến 80 ký tự. Danh mục sẽ dùng để lọc và tìm khóa học.</Text>
          </View>

          {/* Section 4: Thiết lập học phí & Doanh thu (Pricing) */}
          <View style={[styles.card, cs.sectionCard]}>
            <View style={cs.sectionHeader}>
              <View style={cs.sectionIconBadge}>
                <Icon name="card" size={20} color={tokens.color.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={cs.sectionTitle}>Học phí & Doanh thu</Text>
                <Text style={cs.sectionSubtitle}>Lựa chọn khóa học miễn phí cộng đồng hoặc có thu phí</Text>
              </View>
            </View>

            {/* Price Type Segmented Switcher */}
            <View style={cs.segmentedControl}>
              <ScalePressable
                style={[cs.segmentBtn, priceType === "FREE" && cs.segmentBtnActive]}
                onPress={() => {
                  setPriceType("FREE");
                  setPrice("0");
                }}
              >
                <Icon
                  name="sparkles"
                  size={16}
                  color={priceType === "FREE" ? tokens.color.brand : tokens.color.muted}
                />
                <Text style={[cs.segmentBtnText, priceType === "FREE" && cs.segmentBtnTextActive]}>
                  Miễn phí (FREE)
                </Text>
              </ScalePressable>

              <ScalePressable
                style={[cs.segmentBtn, priceType === "PAID" && cs.segmentBtnActive]}
                onPress={() => {
                  setPriceType("PAID");
                  if (price === "0") setPrice("399000");
                }}
              >
                <Icon
                  name="card"
                  size={16}
                  color={priceType === "PAID" ? tokens.color.brand : tokens.color.muted}
                />
                <Text style={[cs.segmentBtnText, priceType === "PAID" && cs.segmentBtnTextActive]}>
                  Có phí (PAID)
                </Text>
              </ScalePressable>
            </View>

            {/* Accessible TextInput for Price Type */}
            <TextInput
              accessibilityLabel="Loại giá"
              style={{ height: 0, opacity: 0 }}
              value={priceType}
              onChangeText={(val) => setPriceType(val.toUpperCase() === "PAID" ? "PAID" : "FREE")}
              editable={false}
            />

            {priceType === "PAID" ? (
              <View style={{ gap: 12, marginTop: 4 }}>
                <Text style={cs.fieldLabel}>Mức giá đề xuất nhanh:</Text>
                <View style={cs.pricePresetsRow}>
                  {PRICE_PRESETS.map((p) => {
                    const selected = price === p.value;
                    return (
                      <ScalePressable
                        key={p.value}
                        style={[cs.presetPill, selected && cs.presetPillActive]}
                        onPress={() => setPrice(p.value)}
                      >
                        <Text style={[cs.presetPillText, selected && cs.presetPillTextActive]}>
                          {p.label}
                        </Text>
                      </ScalePressable>
                    );
                  })}
                </View>

                <View style={cs.fieldGroup}>
                  <Text style={cs.fieldLabel}>Giá bán thực tế (VND)</Text>
                  <View style={cs.priceInputWrapper}>
                    <TextInput
                      accessibilityLabel="Giá"
                      style={[styles.input, cs.textInput, cs.priceInput]}
                      value={price}
                      onChangeText={(t) => setPrice(t.replace(/[^0-9]/g, ""))}
                      keyboardType="numeric"
                      placeholder="399000"
                    />
                    <View style={cs.currencyTag}>
                      <Text style={cs.currencyTagText}>{currency}</Text>
                    </View>
                  </View>
                </View>

                <View style={cs.currencySelectorRow}>
                  <Text style={cs.fieldLabel}>Đơn vị tiền tệ:</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {["VND", "USD"].map((cur) => (
                      <ScalePressable
                        key={cur}
                        style={[cs.curPill, currency === cur && cs.curPillActive]}
                        onPress={() => setCurrency(cur)}
                      >
                        <Text style={[cs.curPillText, currency === cur && cs.curPillTextActive]}>{cur}</Text>
                      </ScalePressable>
                    ))}
                  </View>
                </View>

                {/* Accessible TextInput for Currency */}
                <TextInput
                  accessibilityLabel="Đơn vị tiền tệ"
                  style={{ height: 0, opacity: 0 }}
                  value={currency}
                  onChangeText={setCurrency}
                  editable={false}
                />
              </View>
            ) : null}

            {/* Revenue Estimation */}
            <View style={{ marginTop: 10 }}>
              <RevenueQuote price={price} currency={currency} paid={priceType !== "FREE"} />
            </View>
          </View>

          {/* Action Button */}
          <View style={cs.bottomActionWrapper}>
            <Button
              label={busy ? "Đang tạo khóa học..." : "+ Hoàn tất & Tạo khóa học"}
              disabled={busy || !title.trim()}
              onPress={() => {
                void handleCreate();
              }}
            />
            <Button
              label="Quay lại danh sách"
              variant="outline"
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/teaching/courses"))}
            />
          </View>
        </ScrollView>
      </Page>

      <BottomNavBar
        currentRoute="courses"
        role={snapshot.user.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const cs = StyleSheet.create({
  previewCard: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 14,
    gap: 12,
    ...tokens.shadow.subtle,
  },
  previewHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  previewLiveTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
  },
  previewLiveText: {
    fontSize: 11,
    fontWeight: "700",
    color: tokens.color.muted,
    letterSpacing: 0.5,
  },
  previewRoleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: tokens.color.brandLight,
  },
  previewRoleText: {
    fontSize: 11,
    fontWeight: "700",
    color: tokens.color.brandDark,
  },
  previewInnerCard: {
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.surfaceSubtle,
    borderWidth: 1,
    borderColor: tokens.color.border,
    overflow: "hidden",
  },
  previewImageContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    position: "relative",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewImageBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(10, 126, 133, 0.9)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  previewImageBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  previewImagePlaceholder: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  previewPlaceholderText: {
    fontSize: 12,
    color: tokens.color.muted,
    fontWeight: "500",
  },
  previewContent: {
    padding: 12,
    gap: 8,
  },
  previewMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  categoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  categoryPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  previewPriceHighlight: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.brandDark,
  },
  previewTitleText: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
    lineHeight: 20,
  },
  previewDescText: {
    fontSize: 12,
    color: tokens.color.inkSecondary,
    lineHeight: 16,
  },
  previewLecturerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
  },
  previewAvatarMini: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  previewAvatarInitial: {
    fontSize: 10,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  previewLecturerName: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.color.inkSecondary,
  },
  previewVerifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: tokens.color.brandLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  previewVerifiedText: {
    fontSize: 9,
    fontWeight: "600",
    color: tokens.color.brandDark,
  },

  // Section Cards
  sectionCard: {
    gap: 14,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 4,
  },
  sectionIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: tokens.color.muted,
    marginTop: 2,
    lineHeight: 16,
  },

  // Cover Upload
  uploadDropzone: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: tokens.color.brand,
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.brandLight,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  dropzoneContent: {
    alignItems: "center",
    gap: 8,
  },
  uploadIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...tokens.shadow.subtle,
  },
  dropzoneTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.brandDark,
  },
  dropzoneDesc: {
    fontSize: 11,
    color: tokens.color.inkSecondary,
    textAlign: "center",
    lineHeight: 16,
    maxWidth: 280,
  },
  dropzoneButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: tokens.color.brand,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: tokens.radius.full,
    marginTop: 4,
  },
  dropzoneButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  coverSelectedWrapper: {
    gap: 10,
  },
  coverImageFrame: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: tokens.radius.md,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  coverImagePreview: {
    width: "100%",
    height: "100%",
  },
  coverBadgeOverlay: {
    position: "absolute",
    bottom: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(16, 185, 129, 0.95)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  coverBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  coverActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  coverActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: tokens.radius.sm,
    backgroundColor: tokens.color.surfaceSubtle,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  coverDeleteBtn: {
    backgroundColor: "#FEE2E2",
    borderColor: "#FECACA",
  },
  coverActionBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.ink,
  },

  // Field Groups
  fieldGroup: {
    gap: 6,
  },
  fieldLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  charCounter: {
    fontSize: 11,
    color: tokens.color.muted,
  },
  textInput: {
    backgroundColor: tokens.color.surfaceSubtle,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  slugRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 2,
  },
  slugText: {
    fontSize: 11,
    color: tokens.color.muted,
    fontFamily: "monospace",
  },

  // Categories
  categoryGrid: {
    gap: 10,
  },
  categoryCard: {
    position: "relative",
    borderRadius: tokens.radius.md,
    borderWidth: 1.5,
    borderColor: tokens.color.border,
    backgroundColor: tokens.color.surfaceSubtle,
    padding: 12,
    gap: 4,
  },
  categoryCardActive: {
    backgroundColor: tokens.color.surface,
    ...tokens.shadow.subtle,
  },
  categoryCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  categoryIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  categoryBadgePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: tokens.color.border,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: tokens.color.inkSecondary,
  },
  categoryCardName: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
    marginTop: 4,
  },
  categoryCardSub: {
    fontSize: 11,
    color: tokens.color.muted,
    lineHeight: 15,
  },
  categoryCheckmark: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  customCatToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
  customCatToggleText: {
    fontSize: 12,
    color: tokens.color.brand,
    fontWeight: "600",
  },
  customCatContainer: {
    gap: 6,
    paddingTop: 4,
  },

  // Pricing
  segmentedControl: {
    flexDirection: "row",
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.surfaceSubtle,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: tokens.radius.sm,
  },
  segmentBtnActive: {
    backgroundColor: "#FFFFFF",
    ...tokens.shadow.subtle,
  },
  segmentBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  segmentBtnTextActive: {
    color: tokens.color.brandDark,
    fontWeight: "700",
  },
  pricePresetsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  presetPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: tokens.radius.full,
    backgroundColor: tokens.color.surfaceSubtle,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  presetPillActive: {
    backgroundColor: tokens.color.brandLight,
    borderColor: tokens.color.brand,
  },
  presetPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.inkSecondary,
  },
  presetPillTextActive: {
    color: tokens.color.brandDark,
    fontWeight: "700",
  },
  priceInputWrapper: {
    position: "relative",
  },
  priceInput: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    paddingRight: 60,
  },
  currencyTag: {
    position: "absolute",
    right: 12,
    top: 10,
    backgroundColor: tokens.color.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  currencyTagText: {
    fontSize: 11,
    fontWeight: "700",
    color: tokens.color.inkSecondary,
  },
  currencySelectorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  curPill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: tokens.color.surfaceSubtle,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  curPillActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  curPillText: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.inkSecondary,
  },
  curPillTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  // Feedback Banners
  successBanner: {
    flexDirection: "row",
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    borderRadius: tokens.radius.md,
    padding: 14,
    gap: 12,
    alignItems: "flex-start",
  },
  successIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#D1FAE5",
    alignItems: "center",
    justifyContent: "center",
  },
  successTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#065F46",
  },
  successSub: {
    fontSize: 12,
    color: "#047857",
    lineHeight: 16,
  },
  successActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: tokens.radius.md,
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: "#B91C1C",
    fontWeight: "500",
  },

  // Actions
  bottomActionWrapper: {
    gap: 10,
    marginTop: 8,
  },
});
