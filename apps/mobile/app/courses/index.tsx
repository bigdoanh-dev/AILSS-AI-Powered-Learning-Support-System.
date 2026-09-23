import { useSyncExternalStore, useState, useEffect, useCallback } from "react";
import { Text, View, Pressable, ActivityIndicator, StyleSheet, ScrollView, Modal, Image } from "react-native";
import { router, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { runtime } from "../../src/runtime";
import { courses as decodeCourses, type Course } from "../../src/learning";
import { ApiError } from "../../src/api";
import {
  Page,
  Button,
  SearchBar,
  Badge,
  Icon,
  EmptyState,
  BottomNavBar,
  tokens,
  styles,
  type IconName,
} from "../../src/ui";

const CATEGORIES: { id: string; label: string; icon: IconName }[] = [
  { id: "all", label: "Tất cả", icon: "sparkles" },
  { id: "ai", label: "AI & Machine Learning", icon: "academic" },
  { id: "web", label: "Lập trình ứng dụng", icon: "compass" },
  { id: "db", label: "Cơ sở dữ liệu", icon: "book" },
  { id: "soft", label: "Kỹ năng & Ngoại ngữ", icon: "award" },
];

interface MobileCatalogCourse {
  courseId: string;
  title: string;
  categoryId: string;
  categoryLabel: string;
  lecturer: string;
  price: string;
  priceValue: number;
  originalPrice?: string;
  priceType: "FREE" | "PAID";
  duration: string;
  lessonsCount: number;
  rating: number;
  reviewsCount: number;
  highlights: string[];
}

const CATALOG_COURSES: MobileCatalogCourse[] = [
  {
    courseId: "10000000-0000-4000-8000-000000000002",
    title: "Lập trình Web & Trợ lý AI Fullstack",
    categoryId: "web",
    categoryLabel: "Lập trình Web",
    lecturer: "ThS. Hoàng Quốc Bảo",
    price: "590.000 ₫",
    priceValue: 590000,
    originalPrice: "750.000 ₫",
    priceType: "PAID",
    duration: "34.0h",
    lessonsCount: 28,
    rating: 4.9,
    reviewsCount: 210,
    highlights: ["Trợ lý AI Copilot & Chatbot", "FastAPI, React 19 & LangChain", "Cấp chứng chỉ"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000001",
    title: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa truy vấn",
    categoryId: "db",
    categoryLabel: "Cơ sở dữ liệu",
    lecturer: "TS. Nguyễn Minh Trí",
    price: "490.000 ₫",
    priceValue: 490000,
    originalPrice: "650.000 ₫",
    priceType: "PAID",
    duration: "21.5h",
    lessonsCount: 25,
    rating: 4.8,
    reviewsCount: 142,
    highlights: ["Tối ưu Sharding & Replication", "Đo lường chỉ mục EXPLAIN", "Thực hành DB 500k"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000003",
    title: "DevOps CI/CD Pipeline & Kubernetes Thực chiến",
    categoryId: "devops",
    categoryLabel: "DevOps",
    lecturer: "Kỹ sư Đặng Hải Nam",
    price: "450.000 ₫",
    priceValue: 450000,
    originalPrice: "550.000 ₫",
    priceType: "PAID",
    duration: "18.0h",
    lessonsCount: 20,
    rating: 4.6,
    reviewsCount: 96,
    highlights: ["GitHub Actions & ArgoCD", "Microservices Kube", "Zero-downtime Rollout"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000004",
    title: "Kỹ thuật Prompt Engineering & Tinh chỉnh LLM Cơ bản",
    categoryId: "ai",
    categoryLabel: "Trí tuệ nhân tạo",
    lecturer: "ThS. Đỗ Tuấn Kiệt",
    price: "350.000 ₫",
    priceValue: 350000,
    originalPrice: "490.000 ₫",
    priceType: "PAID",
    duration: "12.5h",
    lessonsCount: 15,
    rating: 4.7,
    reviewsCount: 88,
    highlights: ["Few-Shot & Chain-of-Thought", "Đánh giá RAG và LLM", "AI Tutor tương tác"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000005",
    title: "Nhập môn Kiểm thử Phần mềm & Automation Test",
    categoryId: "devops",
    categoryLabel: "Testing",
    lecturer: "ThS. Lê Thị Ánh Tuyết",
    price: "Miễn phí",
    priceValue: 0,
    priceType: "FREE",
    duration: "9.5h",
    lessonsCount: 14,
    rating: 4.6,
    reviewsCount: 75,
    highlights: ["Unit Test với Vitest", "E2E Testing với Playwright", "Tự động hóa CI"],
  },
  {
    courseId: "10000000-0000-4000-8000-000000000006",
    title: "Python: Lập trình từ Nền tảng tới Hướng đối tượng",
    categoryId: "web",
    categoryLabel: "Lập trình Web",
    lecturer: "ThS. Doanh Nguyễn",
    price: "Miễn phí",
    priceValue: 0,
    priceType: "FREE",
    duration: "28.0h",
    lessonsCount: 32,
    rating: 4.9,
    reviewsCount: 318,
    highlights: ["100 bài tập code tự động", "Lập trình OOP", "Học liệu video & slide"],
  },
];

export default function CourseDiscoveryScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [enrollFilter, setEnrollFilter] = useState<"ALL" | "UNENROLLED" | "ENROLLED">("UNENROLLED");
  const [enrolledIds, setEnrolledIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkoutCourse, setCheckoutCourse] = useState<MobileCatalogCourse | null>(null);
  const [buying, setBuying] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrFallback, setQrFallback] = useState(false);
  const [countdown, setCountdown] = useState(900);
  const [successCourse, setSuccessCourse] = useState<MobileCatalogCourse | null>(null);
  const [transactionId, setTransactionId] = useState<string>("");
  const [paymentTime, setPaymentTime] = useState<string>("");

  const fetchEnrolled = useCallback(async () => {
    if (snapshot.state !== "AUTHENTICATED") return;
    try {
      const res = await session.request("/api/v1/me/courses");
      const list = decodeCourses(res);
      if (list.length > 0) {
        setEnrolledIds((prev) => Array.from(new Set([...prev, ...list.map((c) => c.courseId)])));
      }
    } catch {}
  }, [session, snapshot.state]);

  useEffect(() => {
    void fetchEnrolled();
  }, [fetchEnrolled]);

  useEffect(() => {
    if (checkoutCourse) {
      setQrLoading(true);
      setQrFallback(false);
      setCountdown(900);
    }
  }, [checkoutCourse]);

  useEffect(() => {
    if (!checkoutCourse) return;
    const t = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [checkoutCourse]);

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const timeFormatted = `${mins}:${secs < 10 ? "0" : ""}${secs}`;

  const transferCode = "";
  const vietQrUrl = "";
  const sepayQrUrl = "";
  const activeQrUrl = qrFallback ? sepayQrUrl : vietQrUrl;

  const handleCopy = (val: string, field: string) => {
    setCopiedField(field);
    setToastMsg(`✓ Đã sao chép: ${val}`);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const handleCopyAll = () => {
    if (!checkoutCourse) return;
    const allInfo = "Thông tin thanh toán chưa được máy chủ phát hành.";
    setCopiedField("all");
    setToastMsg(`✓ Đã sao chép toàn bộ thông tin thanh toán!`);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const handleSimulatePayment = () => {
    setBuying(false);
    setToastMsg("Thanh toán Mobile đang tạm khóa cho đến khi máy chủ phát hành đơn và QR có thể xác minh.");
  };

  const handleEnrollFree = async (course: MobileCatalogCourse) => {
    if (snapshot.state !== "AUTHENTICATED") {
      router.push("/login");
      return;
    }
    try {
      setLoading(true);
      await session.request(`/api/v1/courses/${course.courseId}/enrollments`, {
        method: "POST",
        idempotencyKey: Crypto.randomUUID(),
      });
      setEnrolledIds((prev) => Array.from(new Set([...prev, course.courseId])));
      setToastMsg(`✓ Đã đăng ký thành công khóa học miễn phí "${course.title}"!`);
    } catch (cause: unknown) {
      setToastMsg(
        cause instanceof ApiError
          ? cause.message
          : "Máy chủ chưa xác nhận đăng ký; quyền học không được thay đổi.",
      );
    } finally {
      setLoading(false);
    }
  };

  const filteredCourses = CATALOG_COURSES.filter((c) => {
    const isEnrolled = enrolledIds.includes(c.courseId);
    if (enrollFilter === "ENROLLED" && !isEnrolled) return false;
    if (enrollFilter === "UNENROLLED" && isEnrolled) return false;

    if (selectedCategory !== "all") {
      if (selectedCategory === "ai" && c.categoryId !== "ai") return false;
      if (selectedCategory === "web" && c.categoryId !== "web") return false;
      if (selectedCategory === "db" && c.categoryId !== "db") return false;
      if (selectedCategory === "soft" && c.categoryId !== "devops") return false;
    }

    const q = (activeQuery || query).trim().toLowerCase();
    if (q.length >= 2) {
      const match =
        c.title.toLowerCase().includes(q) ||
        c.categoryLabel.toLowerCase().includes(q) ||
        c.lecturer.toLowerCase().includes(q) ||
        c.highlights.some((h) => h.toLowerCase().includes(q));
      if (!match) return false;
    }

    return true;
  });

  const unenrolledCount = CATALOG_COURSES.filter((c) => !enrolledIds.includes(c.courseId)).length;
  const enrolledCount = CATALOG_COURSES.filter((c) => enrolledIds.includes(c.courseId)).length;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page style={{ paddingBottom: 24 }}>
        <View style={{ gap: 4 }}>
          <Badge label="AILSS ACADEMY" variant="primary" icon="book" />
          <Text style={styles.title}>Khám phá &amp; Mua khóa học</Text>
          <Text style={styles.text}>Khóa học mở bán trực tuyến. Quét mã VietQR để kích hoạt tài khoản tự động 24/7.</Text>
        </View>

        {toastMsg && (
          <View style={localStyles.toastBox}>
            <Icon name="check" size={16} color="#FFFFFF" />
            <Text style={localStyles.toastText}>{toastMsg}</Text>
            <Pressable onPress={() => setToastMsg(null)}>
              <Text style={{ color: "#FFF", fontWeight: "700" }}>✕</Text>
            </Pressable>
          </View>
        )}

        {/* Search Bar */}
        <SearchBar
          value={query}
          onChangeText={setQuery}
          onSubmit={() => setActiveQuery(query)}
          placeholder="Tìm theo tên môn, công nghệ, kỹ năng..."
          onClear={() => {
            setQuery("");
            setActiveQuery("");
          }}
        />

        {/* Filter Segmented Bar: Mua ngay (Mặc định) | Đã đăng ký | Tất cả */}
        <View style={localStyles.enrollSegmentRow} role="tablist">
          <Pressable
            style={[localStyles.enrollSegmentBtn, enrollFilter === "UNENROLLED" && localStyles.enrollSegmentBtnActive]}
            onPress={() => setEnrollFilter("UNENROLLED")}
          >
            <Text style={[localStyles.enrollSegmentText, enrollFilter === "UNENROLLED" && localStyles.enrollSegmentTextActive]}>
              🛒 Khóa học mua ngay ({unenrolledCount})
            </Text>
          </Pressable>

          <Pressable
            style={[localStyles.enrollSegmentBtn, enrollFilter === "ENROLLED" && localStyles.enrollSegmentBtnActive]}
            onPress={() => setEnrollFilter("ENROLLED")}
          >
            <Text style={[localStyles.enrollSegmentText, enrollFilter === "ENROLLED" && localStyles.enrollSegmentTextActive]}>
              🎓 Khóa học của tôi ({enrolledCount})
            </Text>
          </Pressable>

          <Pressable
            style={[localStyles.enrollSegmentBtn, enrollFilter === "ALL" && localStyles.enrollSegmentBtnActive]}
            onPress={() => setEnrollFilter("ALL")}
          >
            <Text style={[localStyles.enrollSegmentText, enrollFilter === "ALL" && localStyles.enrollSegmentTextActive]}>
              ⚡ Tất cả ({CATALOG_COURSES.length})
            </Text>
          </Pressable>
        </View>

        {/* Category Horizontal Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={localStyles.categoryScroll}
        >
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <Pressable
                key={cat.id}
                onPress={() => setSelectedCategory(cat.id)}
                style={[
                  localStyles.categoryChip,
                  isSelected && localStyles.categoryChipActive,
                ]}
              >
                <Icon
                  name={cat.icon}
                  size={14}
                  color={isSelected ? "#FFF" : tokens.color.ink}
                />
                <Text
                  style={[
                    localStyles.categoryChipText,
                    isSelected && localStyles.categoryChipTextActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Course Cards List */}
        <View style={localStyles.list}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.muted }}>
              HIỂN THỊ {filteredCourses.length} KHÓA HỌC
            </Text>
          </View>

          {filteredCourses.map((c, index) => {
            const isOwned = enrolledIds.includes(c.courseId);
            const bgGradient =
              index % 3 === 0 ? "#0284C7" : index % 3 === 1 ? "#7C3AED" : "#059669";

            return (
              <View key={c.courseId} style={localStyles.courseCard}>
                {/* Header Strip */}
                <View style={[localStyles.cardHeader, { backgroundColor: bgGradient }]}>
                  <Badge
                    label={isOwned ? "✓ ĐÃ ĐĂNG KÝ" : c.priceType === "FREE" ? "MIỄN PHÍ" : "CHƯA ĐĂNG KÝ"}
                    variant={isOwned ? "success" : c.priceType === "FREE" ? "primary" : "warning"}
                  />
                  <View style={localStyles.starBadge}>
                    <Icon name="star" size={12} color="#F59E0B" />
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#FFF" }}>
                      {c.rating}★ ({c.reviewsCount})
                    </Text>
                  </View>
                </View>

                {/* Card Content Area */}
                <View style={localStyles.cardBody}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#64748B" }}>{c.categoryLabel}</Text>
                  </View>

                  <Text style={localStyles.courseTitle} numberOfLines={2}>
                    {c.title}
                  </Text>

                  <View style={localStyles.metadataRow}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Icon name="user" size={12} color={tokens.color.muted} />
                      <Text style={styles.small}>{c.lecturer}</Text>
                    </View>
                    <Text style={styles.small}>•</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Icon name="clock" size={12} color={tokens.color.muted} />
                      <Text style={styles.small}>{c.duration} ({c.lessonsCount} bài)</Text>
                    </View>
                  </View>

                  <View style={{ gap: 3, marginTop: 4 }}>
                    {c.highlights.map((h) => (
                      <Text key={h} style={{ fontSize: 12, color: "#475569" }} numberOfLines={1}>
                        ✓ {h}
                      </Text>
                    ))}
                  </View>

                  {/* Price & Action Row */}
                  <View style={localStyles.cardFooter}>
                    <View>
                      <Text style={localStyles.priceText}>
                        {isOwned ? "Đã sở hữu khóa học" : c.price}
                      </Text>
                      {!isOwned && c.originalPrice && (
                        <Text style={{ fontSize: 11, color: "#94A3B8", textDecorationLine: "line-through" }}>
                          {c.originalPrice}
                        </Text>
                      )}
                    </View>

                    {isOwned ? (
                      <Pressable
                        style={localStyles.learnNowBtn}
                        onPress={() => router.push(`/learn` as Href)}
                      >
                        <Text style={localStyles.learnNowText}>Tiếp tục học →</Text>
                      </Pressable>
                    ) : c.priceType === "PAID" ? (
                      <Pressable
                        style={localStyles.buyNowBtn}
                        onPress={() => {
                          setToastMsg("Giá đang hiển thị chỉ là dữ liệu danh mục. Thanh toán Mobile chưa được mở khi chưa có offering từ máy chủ.");
                        }}
                      >
                        <Icon name="card" size={14} color="#FFFFFF" />
                        <Text style={localStyles.buyNowText}>Mua ngay</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[localStyles.buyNowBtn, { backgroundColor: "#16A34A" }]}
                        onPress={() => void handleEnrollFree(c)}
                      >
                        <Icon name="book" size={14} color="#FFFFFF" />
                        <Text style={localStyles.buyNowText}>Học miễn phí</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {/* Mobile SePay Checkout Modal */}
        <Modal
          visible={!!checkoutCourse}
          transparent
          animationType="slide"
          onRequestClose={() => setCheckoutCourse(null)}
        >
          <View style={localStyles.modalOverlay}>
            <View style={localStyles.modalSheet}>
              <View style={localStyles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={localStyles.modalEyebrow}>THANH TOÁN VIETQR TỰ ĐỘNG</Text>
                  <Text style={localStyles.modalTitle} numberOfLines={2}>
                    {checkoutCourse?.title}
                  </Text>
                  <Text style={localStyles.modalPriceHighlight}>
                    Số tiền thanh toán: {checkoutCourse?.price}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setCheckoutCourse(null)}
                  style={localStyles.modalCloseBtn}
                  hitSlop={10}
                >
                  <Icon name="close" size={18} color="#64748B" />
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                {/* Genuine VietQR Card */}
                <View style={localStyles.vietQrCard}>
                  <View style={localStyles.vietQrHeader}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={localStyles.vietQrBrand}>VIETQR</Text>
                      <View style={localStyles.napasBadge}>
                        <Text style={localStyles.napasBadgeText}>NAPAS 24/7</Text>
                      </View>
                    </View>
                    <View style={localStyles.mbBadge}>
                      <Text style={localStyles.mbBadgeText}>MB BANK</Text>
                    </View>
                  </View>

                  <View style={localStyles.qrImageBox}>
                    {qrLoading && (
                      <View style={localStyles.qrLoadingBox}>
                        <ActivityIndicator size="large" color="#0284C7" />
                        <Text style={localStyles.qrLoadingText}>Đang tạo mã QR VietQR...</Text>
                      </View>
                    )}
                    <Image
                      source={{ uri: activeQrUrl }}
                      style={localStyles.qrRealImage}
                      resizeMode="contain"
                      onLoadStart={() => setQrLoading(true)}
                      onLoadEnd={() => setQrLoading(false)}
                      onError={() => {
                        if (!qrFallback) {
                          setQrFallback(true);
                        }
                        setQrLoading(false);
                      }}
                    />
                  </View>

                  <View style={localStyles.qrTimerStrip}>
                    <View style={localStyles.pulseDot} />
                    <Text style={localStyles.timerStripText}>
                      Hết hạn sau: {timeFormatted} • Quét bằng mọi app Ngân hàng
                    </Text>
                  </View>
                </View>

                {/* Bank Account Details with Copy Buttons */}
                <View style={localStyles.paymentDetailsBox}>
                  <View style={localStyles.paymentRow}>
                    <Text style={localStyles.paymentLabel}>Ngân hàng:</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={localStyles.paymentVal}>MB Bank (Quân Đội)</Text>
                      <Pressable
                        style={[localStyles.miniCopyBtn, copiedField === "bank" && localStyles.miniCopyBtnActive]}
                        onPress={() => handleCopy("MB Bank", "bank")}
                      >
                        <Text style={localStyles.miniCopyText}>{copiedField === "bank" ? "✓ Đã chép" : "Sao chép"}</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={localStyles.paymentRow}>
                    <Text style={localStyles.paymentLabel}>Số tài khoản:</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[localStyles.paymentVal, { color: "#0284C7", fontWeight: "800", fontSize: 14 }]}>
                        Chưa được phát hành
                      </Text>
                      <Pressable
                        style={[localStyles.miniCopyBtn, copiedField === "stk" && localStyles.miniCopyBtnActive]}
                        onPress={() => handleCopy("", "stk")}
                      >
                        <Text style={localStyles.miniCopyText}>{copiedField === "stk" ? "✓ Đã chép" : "Sao chép"}</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={localStyles.paymentRow}>
                    <Text style={localStyles.paymentLabel}>Chủ tài khoản:</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={localStyles.paymentVal}>Chưa được phát hành</Text>
                      <Pressable
                        style={[localStyles.miniCopyBtn, copiedField === "name" && localStyles.miniCopyBtnActive]}
                        onPress={() => handleCopy("", "name")}
                      >
                        <Text style={localStyles.miniCopyText}>{copiedField === "name" ? "✓ Đã chép" : "Sao chép"}</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={localStyles.paymentRow}>
                    <Text style={localStyles.paymentLabel}>Số tiền:</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[localStyles.paymentVal, { color: "#DC2626", fontWeight: "800", fontSize: 14 }]}>
                        {checkoutCourse?.price}
                      </Text>
                      <Pressable
                        style={[localStyles.miniCopyBtn, copiedField === "amount" && localStyles.miniCopyBtnActive]}
                        onPress={() => handleCopy(String(checkoutCourse?.priceValue || 0), "amount")}
                      >
                        <Text style={localStyles.miniCopyText}>{copiedField === "amount" ? "✓ Đã chép" : "Sao chép"}</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={localStyles.paymentRow}>
                    <Text style={localStyles.paymentLabel}>Nội dung bắt buộc:</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[localStyles.paymentVal, { color: "#7C3AED", fontWeight: "800", backgroundColor: "#EDE9FE", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }]}>
                        {transferCode}
                      </Text>
                      <Pressable
                        style={[localStyles.miniCopyBtn, copiedField === "content" && localStyles.miniCopyBtnActive]}
                        onPress={() => handleCopy(transferCode, "content")}
                      >
                        <Text style={localStyles.miniCopyText}>{copiedField === "content" ? "✓ Đã chép" : "Sao chép"}</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>

                {/* Quick Copy All Details Button */}
                <Pressable
                  style={localStyles.copyAllBtn}
                  onPress={handleCopyAll}
                >
                  <Icon name="receipt" size={14} color="#0284C7" />
                  <Text style={localStyles.copyAllText}>
                    {copiedField === "all" ? "✓ Đã sao chép toàn bộ thông tin" : "📋 Sao chép toàn bộ thông tin chuyển khoản"}
                  </Text>
                </Pressable>

                <View style={localStyles.sepaySecurityNotice}>
                  <Icon name="shield" size={16} color="#16A34A" />
                  <Text style={localStyles.sepaySecurityText}>
                    Cổng thanh toán tự động kiểm tra biến động số dư 24/7. Khóa học được kích hoạt sau 1-3 giây.
                  </Text>
                </View>
              </ScrollView>

              <View style={{ gap: 10, marginTop: 12 }}>
                <Pressable
                  style={[localStyles.confirmPayBtn, buying && { opacity: 0.7 }]}
                  onPress={handleSimulatePayment}
                  disabled={buying}
                >
                  {buying ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Icon name="check" size={16} color="#FFFFFF" />
                      <Text style={localStyles.confirmPayText}>Xác nhận đã chuyển khoản</Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  style={localStyles.cancelPayBtn}
                  onPress={() => setCheckoutCourse(null)}
                >
                  <Text style={localStyles.cancelPayText}>Đóng / Hủy giao dịch</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Payment Success Notification Screen */}
        <Modal
          visible={!!successCourse}
          transparent
          animationType="fade"
          onRequestClose={() => setSuccessCourse(null)}
        >
          <View style={localStyles.modalOverlay}>
            <View style={localStyles.successModalSheet}>
              {/* Success Badge Icon */}
              <View style={localStyles.successIconContainer}>
                <View style={localStyles.successIconCircle}>
                  <Icon name="check" size={32} color="#FFFFFF" />
                </View>
              </View>

              <Text style={localStyles.successTitle}>Thanh Toán Thành Công!</Text>
              <Text style={localStyles.successSubtitle}>
                Khóa học đã được kích hoạt thành công trên tài khoản của bạn.
              </Text>

              {/* Receipt Summary Card */}
              <View style={localStyles.receiptCard}>
                <View style={localStyles.receiptHeaderRow}>
                  <Text style={localStyles.receiptHeaderTitle}>CHI TIẾT ĐƠN HÀNG</Text>
                  <View style={localStyles.entitledBadge}>
                    <Text style={localStyles.entitledBadgeText}>● ĐÃ KÍCH HOẠT</Text>
                  </View>
                </View>

                <View style={localStyles.receiptRow}>
                  <Text style={localStyles.receiptLabel}>Khóa học:</Text>
                  <Text style={[localStyles.receiptValue, { flex: 1, textAlign: "right" }]} numberOfLines={2}>
                    {successCourse?.title}
                  </Text>
                </View>

                <View style={localStyles.receiptRow}>
                  <Text style={localStyles.receiptLabel}>Mã giao dịch:</Text>
                  <Text style={[localStyles.receiptValue, { color: "#0284C7" }]}>
                    {transactionId}
                  </Text>
                </View>

                <View style={localStyles.receiptRow}>
                  <Text style={localStyles.receiptLabel}>Số tiền đã trả:</Text>
                  <Text style={[localStyles.receiptValue, { color: "#16A34A", fontSize: 15, fontWeight: "800" }]}>
                    {successCourse?.price}
                  </Text>
                </View>

                <View style={localStyles.receiptRow}>
                  <Text style={localStyles.receiptLabel}>Phương thức:</Text>
                  <Text style={localStyles.receiptValue}>Chuyển khoản VietQR (MB Bank)</Text>
                </View>

                <View style={localStyles.receiptRow}>
                  <Text style={localStyles.receiptLabel}>Thời gian:</Text>
                  <Text style={[localStyles.receiptValue, { fontSize: 12, color: "#64748B" }]}>
                    {paymentTime}
                  </Text>
                </View>
              </View>

              {/* Perk highlight box */}
              <View style={localStyles.successPerkBox}>
                <Icon name="sparkles" size={16} color="#0284C7" />
                <Text style={localStyles.successPerkText}>
                  Bạn đã sở hữu trọn đời khóa học này. Hãy bắt đầu học video bài giảng, luyện tập và trao đổi cùng trợ lý AI ngay bây giờ.
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={{ gap: 10, width: "100%", marginTop: 16 }}>
                <Pressable
                  style={localStyles.startLearningBtn}
                  onPress={() => {
                    setSuccessCourse(null);
                    router.push(`/learn` as Href);
                  }}
                >
                  <Icon name="academic" size={18} color="#FFFFFF" />
                  <Text style={localStyles.startLearningBtnText}>Vào học khóa học ngay →</Text>
                </Pressable>

                <Pressable
                  style={localStyles.viewMyCoursesBtn}
                  onPress={() => {
                    setSuccessCourse(null);
                    setEnrollFilter("ENROLLED");
                  }}
                >
                  <Icon name="book" size={16} color="#0284C7" />
                  <Text style={localStyles.viewMyCoursesBtnText}>Xem khóa học của tôi</Text>
                </Pressable>

                <Pressable
                  style={localStyles.continueBrowsingBtn}
                  onPress={() => setSuccessCourse(null)}
                >
                  <Text style={localStyles.continueBrowsingText}>Tiếp tục khám phá khóa học khác</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </Page>

      {/* Bottom Navigation Dock */}
      <BottomNavBar
        currentRoute="courses"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const localStyles = StyleSheet.create({
  categoryScroll: {
    gap: 8,
    paddingVertical: 4,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.subtle,
  },
  categoryChipActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  categoryChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  list: {
    gap: 14,
    marginTop: 4,
  },
  center: {
    padding: tokens.space.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.small,
  },
  courseCard: {
    backgroundColor: tokens.color.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: tokens.color.border,
    overflow: "hidden",
    ...tokens.shadow.card,
  },
  cardHeader: {
    height: 70,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
  },
  starBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  cardBody: {
    padding: 16,
    gap: 10,
  },
  courseTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: tokens.color.ink,
    lineHeight: 23,
  },
  metadataRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    borderTopWidth: 1,
    borderColor: tokens.color.border,
    marginTop: 2,
  },
  priceText: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  toastBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#16A34A",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
    marginVertical: 6,
  },
  toastText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  enrollSegmentRow: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    padding: 3,
    gap: 4,
    marginVertical: 4,
  },
  enrollSegmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  enrollSegmentBtnActive: {
    backgroundColor: "#FFFFFF",
    elevation: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  enrollSegmentText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  enrollSegmentTextActive: {
    color: "#0284C7",
    fontWeight: "800",
  },
  learnNowBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#E0F2FE",
  },
  learnNowText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0284C7",
  },
  buyNowBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#0284C7",
  },
  buyNowText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  modalEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0284C7",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 22,
  },
  modalPriceHighlight: {
    fontSize: 15,
    fontWeight: "800",
    color: "#DC2626",
    marginTop: 4,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  vietQrCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#BAE6FD",
    padding: 14,
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#0284C7",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  vietQrHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    marginBottom: 10,
  },
  vietQrBrand: {
    fontSize: 14,
    fontWeight: "900",
    color: "#0284C7",
    letterSpacing: 1,
  },
  napasBadge: {
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  napasBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#1D4ED8",
  },
  mbBadge: {
    backgroundColor: "#002B49",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  mbBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  qrImageBox: {
    width: 200,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
  },
  qrLoadingBox: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    zIndex: 2,
  },
  qrLoadingText: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
  qrRealImage: {
    width: 196,
    height: 196,
    borderRadius: 6,
  },
  qrTimerStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    backgroundColor: "#F0F9FF",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#0284C7",
  },
  timerStripText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#0369A1",
  },
  paymentDetailsBox: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  paymentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  paymentLabel: {
    fontSize: 13,
    color: "#64748B",
  },
  paymentVal: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  miniCopyBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "#E0F2FE",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  miniCopyBtnActive: {
    backgroundColor: "#DCFCE7",
    borderColor: "#86EFAC",
  },
  miniCopyText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0369A1",
  },
  copyAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
    paddingVertical: 10,
    backgroundColor: "#F0F9FF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  copyAllText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0284C7",
  },
  sepaySecurityNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F0FDF4",
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  sepaySecurityText: {
    flex: 1,
    fontSize: 12,
    color: "#15803D",
    lineHeight: 16,
  },
  confirmPayBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#16A34A",
    borderRadius: 12,
    paddingVertical: 14,
  },
  confirmPayText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  cancelPayBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  cancelPayText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  successModalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  successIconContainer: {
    alignItems: "center",
    marginBottom: 12,
  },
  successIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#16A34A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
  },
  successSubtitle: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  receiptCard: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 14,
    gap: 8,
  },
  receiptHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  receiptHeaderTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.5,
  },
  entitledBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  entitledBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#15803D",
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  receiptLabel: {
    fontSize: 13,
    color: "#64748B",
  },
  receiptValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  successPerkBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#F0F9FF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BAE6FD",
    padding: 12,
    marginTop: 12,
    width: "100%",
  },
  successPerkText: {
    flex: 1,
    fontSize: 12,
    color: "#0369A1",
    lineHeight: 18,
  },
  startLearningBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0284C7",
    borderRadius: 12,
    paddingVertical: 14,
  },
  startLearningBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  viewMyCoursesBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#F0F9FF",
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#BAE6FD",
    paddingVertical: 12,
  },
  viewMyCoursesBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0284C7",
  },
  continueBrowsingBtn: {
    alignItems: "center",
    paddingVertical: 8,
  },
  continueBrowsingText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
});
