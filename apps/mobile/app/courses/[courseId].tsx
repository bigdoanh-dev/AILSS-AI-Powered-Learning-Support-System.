import { useLanguage } from "../../src/use-language";
import { useUiText } from "../../src/use-language";
import { useSyncExternalStore, useState, useEffect, useCallback, useRef } from "react";
import { Text, View, TextInput, Pressable, ActivityIndicator, StyleSheet, Alert, Image } from "react-native";
import { router, useLocalSearchParams, useFocusEffect, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { runtime } from "../../src/runtime";
import {
  courseDetail,
  offerings as decodeOfferings,
  isAlreadyEnrolledConflict,
  type CourseDetail,
  type Offering,
} from "../../src/learning";
import {
  reviewList,
  buildIfMatch,
  validateReviewInput,
  isAuthor,
  type Review,
  type RatingSummary,
} from "../../src/interaction";
import { ApiError } from "../../src/api";
import { order as decodeOrder } from "../../src/commerce";
import { publicLecturer, type PublicLecturer } from "../../src/public-lecturer";
import { Page, Button, Badge, Icon, BottomNavBar, styles, tokens } from "../../src/ui";

export default function CourseDetailScreen() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { courseId, review } = useLocalSearchParams<{ courseId: string; review?: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [lecturerProfile, setLecturerProfile] = useState<PublicLecturer | null>(null);
  const [offeringsList, setOfferingsList] = useState<Offering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => Crypto.randomUUID());
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState("");
  const orderKeys = useRef(new Map<string, string>());

  // Reviews state
  const [reviews, setReviews] = useState<Review[]>([]);
  const [ratingInfo, setRatingInfo] = useState<RatingSummary>({ reviewCount: 0, ratingSum: 0, average: 0 });
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState(false);

  // Write/Edit Review Form state
  const [showReviewForm, setShowReviewForm] = useState(() => review === "1");
  const [formRating, setFormRating] = useState(5);
  const [formBody, setFormBody] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const fetchDetails = useCallback(async () => {
    if (!courseId) return;
    setEnrolled(false);
    try {
      setLoading(true);
      setError(null);
      const api = snapshot.state === "AUTHENTICATED" ? session : session.api;

      const [courseData, offeringsData] = await Promise.all([
        api.request(`/api/v1/courses/${courseId}`),
        api.request(`/api/v1/courses/${courseId}/offerings`),
      ]);

      setCourse(courseDetail(courseData));
      setOfferingsList(decodeOfferings(offeringsData));

      if (snapshot.state === "AUTHENTICATED") {
        try {
          await session.request(`/api/v1/courses/${courseId}/progress`);
          setEnrolled(true);
        } catch (cause) {
          if (!(cause instanceof ApiError) || cause.status !== 403) throw cause;
        }
      }
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Không thể tải thông tin khóa học. Vui lòng thử lại.");
      }
    } finally {
      setLoading(false);
    }
  }, [courseId, snapshot.state, session]);

  const [nextReviewCursor, setNextReviewCursor] = useState<string | null>(null);
  const fetchReviews = useCallback(
    async (cursor = "") => {
      if (!courseId) return;
      try {
        setReviewsLoading(true);
        setReviewsError(false);
        const api = snapshot.state === "AUTHENTICATED" ? session : session.api;
        const data = await api.request(
          `/api/v1/courses/${courseId}/reviews?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          { includeMeta: true },
        );
        const res = reviewList(data);
        setReviews((current) =>
          cursor
            ? [
                ...current,
                ...res.items.filter((item) => !current.some((old) => old.reviewId === item.reviewId)),
              ]
            : res.items,
        );
        setNextReviewCursor(res.nextCursor);
        setRatingInfo(res.ratingSummary);
      } catch {
        setReviewsError(true);
      } finally {
        setReviewsLoading(false);
      }
    },
    [courseId, snapshot.state, session],
  );

  useFocusEffect(
    useCallback(() => {
      void fetchDetails();
      void fetchReviews();
    }, [fetchDetails, fetchReviews]),
  );

  useEffect(() => {
    setLecturerProfile(null);
    if (!course?.lecturerId) return;
    const controller = new AbortController();
    void session.api
      .request(`/api/v1/lecturers/${encodeURIComponent(course.lecturerId)}`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setLecturerProfile(publicLecturer(value));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [course?.lecturerId, session]);

  useEffect(() => {
    if (review === "1") {
      setShowReviewForm(true);
    }
  }, [review]);

  const handleEnrollFree = async () => {
    if (snapshot.state !== "AUTHENTICATED") {
      router.push("/login");
      return;
    }
    try {
      setEnrollmentLoading(true);
      setEnrollmentError(null);
      await session.request(`/api/v1/courses/${courseId}/enrollments`, {
        method: "POST",
        idempotencyKey,
      });
      setEnrolled(true);
      setIdempotencyKey(Crypto.randomUUID());
    } catch (e: unknown) {
      if (isAlreadyEnrolledConflict(e)) {
        setEnrolled(true);
      } else {
        setEnrollmentError(
          e instanceof ApiError
            ? e.code === "PURCHASE_REQUIRED"
              ? "Khóa học này yêu cầu thanh toán để tham gia."
              : e.message
            : "Đăng ký không thành công. Vui lòng thử lại.",
        );
      }
    } finally {
      setEnrollmentLoading(false);
    }
  };

  const handleCreateOrder = async (offeringId: string) => {
    if (snapshot.state !== "AUTHENTICATED") {
      router.push("/login");
      return;
    }
    const key = orderKeys.current.get(offeringId) ?? Crypto.randomUUID();
    orderKeys.current.set(offeringId, key);
    setOrderLoading(true);
    setOrderError("");
    try {
      const created = decodeOrder(
        await session.request("/api/v1/orders", {
          method: "POST",
          idempotencyKey: key,
          body: { offeringId },
        }),
      );
      orderKeys.current.delete(offeringId);
      router.push(`/checkout/${created.orderId}` as Href);
    } catch (cause) {
      setOrderError(cause instanceof ApiError ? cause.message : "Không thể tạo đơn hàng. Vui lòng thử lại.");
    } finally {
      setOrderLoading(false);
    }
  };

  const myReview = reviews.find((r) => isAuthor(r, snapshot.user?.userId));

  const openWriteForm = () => {
    if (myReview) {
      setFormRating(myReview.rating);
      setFormBody(myReview.body ?? "");
    } else {
      setFormRating(5);
      setFormBody("");
    }
    setReviewError(null);
    setShowReviewForm(true);
  };

  const handleSubmitReview = async () => {
    setReviewError(null);
    const validation = validateReviewInput(formRating, formBody);
    if (!validation.valid) {
      setReviewError(validation.error ?? "Dữ liệu không hợp lệ.");
      return;
    }

    try {
      setReviewSaving(true);
      const key = Crypto.randomUUID();

      if (myReview) {
        // Edit existing review (INT-07)
        await session.request(`/api/v1/reviews/${myReview.reviewId}`, {
          method: "PATCH",
          idempotencyKey: key,
          headers: {
            "If-Match": buildIfMatch(myReview.version),
          },
          body: {
            rating: formRating,
            body: formBody.trim(),
          },
        });
      } else {
        // Create new review (INT-06)
        await session.request(`/api/v1/courses/${courseId}/reviews`, {
          method: "POST",
          idempotencyKey: key,
          body: {
            rating: formRating,
            body: formBody.trim(),
          },
        });
      }

      setShowReviewForm(false);
      void fetchReviews();
    } catch (e: unknown) {
      setReviewError(e instanceof ApiError ? e.message : "Gửi đánh giá không thành công. Vui lòng thử lại.");
    } finally {
      setReviewSaving(false);
    }
  };

  const handleDeleteReview = async () => {
    if (!myReview) return;
    Alert.alert(uiText("Xác nhận xóa"), uiText("Bạn có chắc chắn muốn xóa đánh giá của mình?"), [
      { text: uiText("Hủy"), style: "cancel" },
      {
        text: uiText("Xóa"),
        style: "destructive",
        onPress: async () => {
          try {
            setReviewSaving(true);
            const key = Crypto.randomUUID();
            await session.request(`/api/v1/reviews/${myReview.reviewId}`, {
              method: "DELETE",
              idempotencyKey: key,
              headers: {
                "If-Match": buildIfMatch(myReview.version),
              },
            });
            setShowReviewForm(false);
            void fetchReviews();
          } catch (e: unknown) {
            setReviewError(e instanceof ApiError ? e.message : "Không thể xóa đánh giá. Vui lòng thử lại.");
          } finally {
            setReviewSaving(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <Page>
        <View style={localStyles.center}>
          <ActivityIndicator size="large" color={tokens.color.brand} />
          <Text style={styles.small}>{uiText("Đang tải chi tiết khóa học…")}</Text>
        </View>
      </Page>
    );
  }

  if (error || !course) {
    return (
      <Page>
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error || "Không tìm thấy thông tin khóa học."}
          </Text>
          <Button label={uiText("Thử lại")} onPress={() => void fetchDetails()} />
          <Button label={uiText("Về danh mục")} onPress={() => router.back()} />
        </View>
      </Page>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page style={{ paddingBottom: 24 }}>
        {/* Back navigation button */}
        <Pressable
          onPress={() => router.back()}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}
          accessibilityLabel={uiText("Quay lại danh mục")}
        >
          <Icon name="chevronLeft" size={16} color={tokens.color.brand} />
          <Text style={{ fontSize: 14, fontWeight: "700", color: tokens.color.brand }}>
            {uiText("Quay lại danh mục")}
          </Text>
        </Pressable>

        {/* Hero Banner */}
        <View style={localStyles.heroCard}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Badge
              label={course.priceType === "FREE" ? uiText("MIỄN PHÍ") : uiText("CÓ PHÍ")}
              variant={course.priceType === "FREE" ? "success" : "warning"}
            />
            <View style={localStyles.ratingBadge}>
              <Icon name="star" size={13} color="#F59E0B" />
              <Text style={{ fontSize: 13, fontWeight: "800", color: "#FFF" }}>
                {ratingInfo.reviewCount > 0 ? ratingInfo.average.toFixed(1) : "—"}
              </Text>
            </View>
          </View>

          {course.coverDataUrl ? (
            <Image
              source={{ uri: course.coverDataUrl }}
              accessibilityLabel={uiText("Ảnh bìa {0}", [course.title])}
              style={{ width: "100%", height: 170, borderRadius: 12 }}
              resizeMode="cover"
            />
          ) : null}
          <Text style={localStyles.heroTitle}>{course.title}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText("Xem hồ sơ giảng viên")}
            disabled={!course.lecturerId}
            onPress={() => router.push(`/lecturers/${course.lecturerId}?courseId=${courseId}` as Href)}
            style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}
          >
            {lecturerProfile?.avatarRef ? (
              <Image
                source={{ uri: lecturerProfile.avatarRef }}
                accessibilityLabel={uiText("Ảnh giảng viên {0}", [lecturerProfile.displayName])}
                style={localStyles.instructorAvatar}
              />
            ) : (
              <View style={localStyles.instructorAvatar}>
                <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 12 }}>
                  {(lecturerProfile?.displayName ?? course.lecturerName ?? "G").charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                {uiText("Giảng viên phụ trách")}
              </Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: "#FFF" }}>
                {lecturerProfile?.displayName ?? course.lecturerName ?? "Hồ sơ giảng viên"}
              </Text>
            </View>
          </Pressable>

          {offeringsList.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {offeringsList.map((o) => (
                <View key={o.offeringId} style={localStyles.offeringChip}>
                  <Icon name="calendar" size={12} color="#E0F2FE" />
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFF" }}>
                    {o.offeringType === "SELF_PACED" ? uiText("Tự học linh hoạt") : uiText("Lớp theo lịch")}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Enrollment Card */}
        <View
          style={[
            styles.card,
            { borderWidth: 1.5, borderColor: tokens.color.brandLight, ...tokens.shadow.card },
          ]}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[styles.title, { fontSize: 18 }]}>{uiText("Tham gia học tập")}</Text>
            <Text style={{ fontSize: 18, fontWeight: "800", color: tokens.color.brand }}>
              {course.priceType === "FREE"
                ? uiText("Miễn phí 100%")
                : course.price
                  ? `${course.price} ${course.currency ?? "VND"}`
                  : uiText("Có phí")}
            </Text>
          </View>

          <View style={{ gap: 6, marginVertical: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="check" size={14} color={tokens.color.success} />
              <Text style={styles.small}>{uiText("Toàn quyền truy cập học liệu & video bài giảng")}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="sparkles" size={14} color="#8B5CF6" />
              <Text style={styles.small}>{uiText("Luyện đề và hỏi đáp cùng trợ lý AI 24/7")}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="award" size={14} color="#D97706" />
              <Text style={styles.small}>{uiText("Chứng chỉ xác nhận sau khi hoàn thành khóa học")}</Text>
            </View>
          </View>

          {enrolled ? (
            <View style={{ gap: 8 }}>
              <Badge label={uiText("ĐÃ ĐĂNG KÝ KHÓA HỌC NÀY")} variant="success" icon="check" />
              <Button
                label={uiText("Tiếp tục học ngay ▶")}
                variant="primary"
                size="lg"
                onPress={() => router.push(`/learn/${courseId}` as Href)}
              />
            </View>
          ) : snapshot.state !== "AUTHENTICATED" ? (
            <Button
              label={uiText("Đăng nhập để đăng ký học")}
              variant="primary"
              size="lg"
              onPress={() => router.push("/login")}
            />
          ) : course.priceType === "FREE" ? (
            <>
              {enrollmentError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {uiText(enrollmentError)}
                </Text>
              )}
              <Button
                label={
                  enrollmentLoading ? uiText("Đang xử lý đăng ký…") : uiText("Đăng ký học ngay (Miễn phí)")
                }
                variant="primary"
                size="lg"
                onPress={() => void handleEnrollFree()}
                disabled={enrollmentLoading}
              />
            </>
          ) : (
            <View style={{ gap: 10 }}>
              <Text style={styles.small}>{uiText("Chọn hình thức học để tạo đơn thanh toán.")}</Text>
              {offeringsList
                .filter((item) => item.state === "PUBLISHED")
                .map((item) => (
                  <Button
                    key={item.offeringId}
                    label={uiText("Mua {0} · {1} {2}", [
                      item.offeringType === "SELF_PACED" ? "khóa tự học" : "lớp theo lịch",
                      item.price ?? course.price ?? "Có phí",
                      item.currency ?? course.currency ?? "VND",
                    ])}
                    variant="outline"
                    disabled={orderLoading}
                    onPress={() => void handleCreateOrder(item.offeringId)}
                  />
                ))}
              {!offeringsList.some((item) => item.state === "PUBLISHED") ? (
                <Text style={styles.small}>{uiText("Hiện chưa có hình thức học mở bán.")}</Text>
              ) : null}
              {orderError ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {uiText(orderError)}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {/* Description Section */}
        {course.description && (
          <View style={styles.card}>
            <Text style={[styles.title, { fontSize: 16 }]}>{uiText("Mô tả chi tiết")}</Text>
            <Text style={[styles.text, { lineHeight: 24 }]}>{course.description}</Text>
          </View>
        )}

        {/* Reviews & Ratings Section */}
        <View style={styles.card}>
          <View style={localStyles.ratingHeader}>
            <View>
              <Text style={[styles.title, { fontSize: 16 }]}>{uiText("Đánh giá từ học viên")}</Text>
              <Text style={localStyles.ratingScore}>
                ⭐ {ratingInfo.average > 0 ? ratingInfo.average.toFixed(1) : uiText("Chưa có")}{" "}
                <Text style={styles.small}>
                  ({ratingInfo.reviewCount} {uiText(" nhận xét)")}
                </Text>
              </Text>
            </View>

            {snapshot.state === "AUTHENTICATED" ? (
              <Button
                label={myReview ? uiText("Sửa đánh giá") : uiText("Viết đánh giá")}
                variant="secondary"
                size="sm"
                onPress={openWriteForm}
              />
            ) : (
              <Button
                label={uiText("Đăng nhập để viết đánh giá")}
                variant="outline"
                size="sm"
                onPress={() => router.push("/login")}
              />
            )}
          </View>

          {/* Review Form Modal/Inline */}
          {showReviewForm && (
            <View style={localStyles.reviewForm}>
              <Text style={[styles.title, { fontSize: 15 }]}>
                {myReview ? uiText("Chỉnh sửa đánh giá của bạn") : uiText("Đánh giá khóa học của bạn")}
              </Text>

              {/* Stars Picker */}
              <View style={localStyles.starPicker}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Pressable
                    key={star}
                    accessibilityRole="button"
                    accessibilityLabel={`${star} sao`}
                    onPress={() => setFormRating(star)}
                    style={localStyles.starBtn}
                  >
                    <Text style={[localStyles.starText, formRating >= star && localStyles.starActive]}>
                      ★
                    </Text>
                  </Pressable>
                ))}
                <Text style={styles.small}>({formRating} / 5 sao)</Text>
              </View>

              <TextInput
                style={localStyles.reviewInput}
                value={formBody}
                onChangeText={setFormBody}
                placeholder={uiText("Chia sẻ trải nghiệm học tập của bạn về khóa học này…")}
                multiline
                numberOfLines={4}
              />

              {reviewError && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {uiText(reviewError)}
                </Text>
              )}

              <View style={localStyles.reviewFormActions}>
                <Button
                  label={
                    reviewSaving
                      ? uiText("Đang lưu…")
                      : myReview
                        ? uiText("Cập nhật đánh giá")
                        : uiText("Gửi đánh giá")
                  }
                  onPress={() => void handleSubmitReview()}
                  disabled={reviewSaving}
                />
                {myReview && (
                  <Button
                    label={uiText("Xóa đánh giá")}
                    variant="danger"
                    onPress={() => void handleDeleteReview()}
                    disabled={reviewSaving}
                  />
                )}
                <Button
                  label={uiText("Đóng")}
                  variant="outline"
                  onPress={() => setShowReviewForm(false)}
                  disabled={reviewSaving}
                />
              </View>
            </View>
          )}

          {nextReviewCursor && !reviewsLoading ? (
            <Button label={uiText("Xem thêm đánh giá")} onPress={() => void fetchReviews(nextReviewCursor)} />
          ) : null}
          {/* Reviews List */}
          {reviewsError ? (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="alert" style={styles.error}>
                {uiText("Không tải được đánh giá khóa học.")}
              </Text>
              <Button
                label={uiText("Thử tải đánh giá")}
                variant="outline"
                onPress={() => void fetchReviews()}
              />
            </View>
          ) : reviewsLoading ? (
            <ActivityIndicator size="small" color={tokens.color.brand} />
          ) : reviews.length === 0 ? (
            <Text style={styles.small}>
              {uiText(
                "Chưa có nhận xét nào cho khóa học này. Hãy là người đầu tiên trải nghiệm và đánh giá!",
              )}
            </Text>
          ) : (
            <View style={localStyles.reviewsList}>
              {reviews.map((rev) => {
                const mine = isAuthor(rev, snapshot.user?.userId);
                return (
                  <View key={rev.reviewId} style={[localStyles.reviewItem, mine && localStyles.myReviewItem]}>
                    <View style={localStyles.reviewItemHeader}>
                      <Text style={localStyles.reviewStars}>
                        {"★".repeat(rev.rating)}
                        {"☆".repeat(5 - rev.rating)}
                      </Text>
                      {mine && <Badge label={uiText("Của bạn")} variant="success" />}
                      <Text style={styles.small}>{new Date(rev.createdAt).toLocaleDateString(uiLocale)}</Text>
                    </View>
                    {rev.body && <Text style={styles.text}>{rev.body}</Text>}
                  </View>
                );
              })}
            </View>
          )}
        </View>
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
  center: {
    padding: tokens.space.large,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.small,
  },
  heroCard: {
    backgroundColor: tokens.color.brand,
    borderRadius: 20,
    padding: 22,
    gap: 12,
    ...tokens.shadow.floating,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.25)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFFFFF",
    lineHeight: 30,
  },
  instructorAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFF",
  },
  offeringChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9999,
  },
  ratingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: tokens.space.medium,
  },
  ratingScore: {
    fontSize: 18,
    fontWeight: "800",
    color: tokens.color.brand,
    marginTop: 2,
  },
  reviewForm: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: tokens.space.medium,
    marginVertical: tokens.space.medium,
    gap: tokens.space.small,
  },
  starPicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  starBtn: {
    padding: 4,
  },
  starText: {
    fontSize: 28,
    color: tokens.color.border,
  },
  starActive: {
    color: "#F59E0B",
  },
  reviewInput: {
    borderWidth: 1.5,
    borderColor: tokens.color.border,
    borderRadius: 10,
    padding: tokens.space.small,
    fontSize: 14,
    backgroundColor: "#FFF",
    minHeight: 80,
    textAlignVertical: "top",
  },
  reviewFormActions: {
    gap: tokens.space.small,
  },
  reviewsList: {
    marginTop: tokens.space.small,
    gap: tokens.space.small,
  },
  reviewItem: {
    paddingVertical: tokens.space.small,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
  },
  myReviewItem: {
    backgroundColor: "#F0FDF4",
    paddingHorizontal: tokens.space.small,
    borderRadius: 8,
  },
  reviewItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  reviewStars: {
    fontSize: 14,
    color: "#F59E0B",
  },
});
