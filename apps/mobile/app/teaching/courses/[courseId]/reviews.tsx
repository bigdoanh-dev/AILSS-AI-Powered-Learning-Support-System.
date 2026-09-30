import { useEffect, useState, useCallback, useMemo } from "react";
import { Text, View, TextInput, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import {
  reviewList,
  commentList,
  validateCommentInput,
  isAuthor,
  type Review,
  type Comment,
  type RatingSummary,
} from "../../../../src/interaction";
import { CONTRACT_LIMITED } from "../../../../src/teaching";
import { Page, Button, Icon, NonVirtualizedList, ScreenHeader, styles, tokens } from "../../../../src/ui";

export default function CourseReviewsAndCommentsScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  // Tab & Filter states
  const [activeTab, setActiveTab] = useState<"reviews" | "comments">("reviews");
  const [starFilter, setStarFilter] = useState<number | "all">("all");

  // Reviews state
  const [reviews, setReviews] = useState<Review[]>([]);
  const [ratingInfo, setRatingInfo] = useState<RatingSummary>({ reviewCount: 0, ratingSum: 0, average: 0 });
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState<string | null>(null);

  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentInput, setCommentInput] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentMsg, setCommentMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const loadReviewsAndComments = useCallback(async () => {
    if (!courseId || snapshot.user?.role !== "LECTURER") {
      setReviewsLoading(false);
      setCommentsLoading(false);
      return;
    }
    try {
      setReviewsLoading(true);
      setReviewsError(null);
      const rawReviews = await session.request(`/api/v1/courses/${courseId}/reviews`);
      const res = reviewList(rawReviews);
      setReviews(res.items);
      setRatingInfo(res.ratingSummary);
    } catch (e: unknown) {
      setReviewsError(e instanceof ApiError ? e.message : "Không thể tải danh sách đánh giá.");
    } finally {
      setReviewsLoading(false);
    }

    try {
      setCommentsLoading(true);
      const rawComments = await session.request(`/api/v1/resources/COURSE/${courseId}/comments`);
      const res = commentList(rawComments);
      setComments(res.items);
    } catch {
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [courseId, session, snapshot.user?.role]);

  useEffect(() => {
    void loadReviewsAndComments();
  }, [loadReviewsAndComments]);

  // Star breakdown
  const starCounts = useMemo(() => {
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const r of reviews) {
      const star = Math.min(5, Math.max(1, Math.round(r.rating || 5))) as keyof typeof counts;
      counts[star] = (counts[star] || 0) + 1;
    }
    return counts;
  }, [reviews]);

  const filteredReviews = useMemo(() => {
    if (starFilter === "all") return reviews;
    return reviews.filter((r) => Math.round(r.rating) === starFilter);
  }, [reviews, starFilter]);

  const handlePostComment = async () => {
    setCommentMsg(null);
    const validation = validateCommentInput(commentInput);
    if (!validation.valid) {
      setCommentMsg({ type: "error", text: validation.error ?? "Nội dung bình luận không hợp lệ." });
      return;
    }

    try {
      setCommentSaving(true);
      const idempotencyKey = Crypto.randomUUID();
      await session.request(`/api/v1/resources/COURSE/${courseId}/comments`, {
        method: "POST",
        idempotencyKey,
        body: { body: commentInput.trim() },
      });
      setCommentInput("");
      setCommentMsg({ type: "success", text: "✓ Đăng phản hồi thành công." });
      const rawComments = await session.request(`/api/v1/resources/COURSE/${courseId}/comments`);
      const res = commentList(rawComments);
      setComments(res.items);
    } catch (e: unknown) {
      setCommentMsg({
        type: "error",
        text: e instanceof ApiError ? e.message : "Không thể gửi phản hồi. Vui lòng thử lại.",
      });
    } finally {
      setCommentSaving(false);
    }
  };

  const handleDeleteComment = async (c: Comment) => {
    try {
      const idempotencyKey = Crypto.randomUUID();
      await session.request(`/api/v1/comments/${c.commentId}`, {
        method: "DELETE",
        idempotencyKey,
        headers: {
          "If-Match": `"v${c.version}"`,
        },
      });
      setComments((prev) => prev.filter((it) => it.commentId !== c.commentId));
      setCommentMsg({ type: "success", text: "✓ Đã xóa phản hồi của bạn." });
    } catch (e: unknown) {
      setCommentMsg({
        type: "error",
        text: e instanceof ApiError ? e.message : "Không thể xóa phản hồi. Vui lòng thử lại.",
      });
    } finally {
      setDeletingCommentId(null);
    }
  };

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Chỉ Giảng viên mới có quyền xem trang này.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderReview = ({ item }: { item: Review }) => (
    <View style={revStyles.card}>
      <View style={revStyles.ratingRow}>
        <Text style={revStyles.stars}>
          {"★".repeat(item.rating)}
          {"☆".repeat(5 - item.rating)}
        </Text>
        <Text style={styles.small}>
          {new Date(item.createdAt).toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })}
        </Text>
      </View>
      {item.body ? <Text style={[styles.text, { marginTop: 4 }]}>{item.body}</Text> : null}
      <Text style={[styles.small, { marginTop: 6, color: tokens.color.muted }]}>
        Học viên: {item.authorId ? `${item.authorId.slice(0, 8)}…` : "Ẩn danh"}
      </Text>
    </View>
  );

  const renderComment = ({ item }: { item: Comment }) => {
    const isMyComment = isAuthor(item, snapshot.user?.userId);
    return (
      <View style={[revStyles.card, isMyComment && revStyles.myCommentCard]}>
        <View style={revStyles.cardHeader}>
          <Text
            style={[
              styles.text,
              { fontWeight: "700", color: isMyComment ? tokens.color.brand : tokens.color.ink },
            ]}
          >
            {isMyComment
              ? "👨‍🏫 Bạn (Giảng viên)"
              : `Học viên: ${item.authorId ? `${item.authorId.slice(0, 8)}…` : ""}`}
          </Text>
          <Text style={styles.small}>
            {new Date(item.createdAt).toLocaleDateString("vi-VN", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
        <Text style={styles.text}>{item.body}</Text>
        {isMyComment && (
          <View style={{ marginTop: 8, alignSelf: "flex-end" }}>
            <Pressable
              onPress={() => void handleDeleteComment(item)}
              disabled={deletingCommentId === item.commentId}
              style={{
                paddingVertical: 4,
                paddingHorizontal: 8,
                backgroundColor: "#fee2e2",
                borderRadius: 4,
              }}
            >
              <Text style={{ fontSize: 12, color: "#dc2626", fontWeight: "600" }}>
                {deletingCommentId === item.commentId ? "Đang xóa…" : "🗑️ Xóa phản hồi"}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <Page>
      <ScreenHeader
        title="Đánh giá & Thảo luận"
        subtitle="Ý kiến học viên & giải đáp của giảng viên"
        onBack={() => (router.canGoBack() ? router.back() : router.replace(`/teaching/courses/${courseId}`))}
      />

      {/* Segmented Tab Switcher */}
      <View style={revStyles.tabBar}>
        <Pressable
          style={[revStyles.tabItem, activeTab === "reviews" && revStyles.tabItemActive]}
          onPress={() => setActiveTab("reviews")}
        >
          <Text style={[revStyles.tabItemText, activeTab === "reviews" && revStyles.tabItemTextActive]}>
            ⭐ Đánh giá ({reviews.length})
          </Text>
        </Pressable>
        <Pressable
          style={[revStyles.tabItem, activeTab === "comments" && revStyles.tabItemActive]}
          onPress={() => setActiveTab("comments")}
        >
          <Text style={[revStyles.tabItemText, activeTab === "comments" && revStyles.tabItemTextActive]}>
            💬 Thảo luận ({comments.length})
          </Text>
        </Pressable>
      </View>

      {/* TAB 1: REVIEWS */}
      {activeTab === "reviews" && (
        <View style={{ gap: 12 }}>
          {/* Rating Summary Card */}
          <View style={[styles.card, revStyles.summaryCard]}>
            <View style={revStyles.scoreCol}>
              <Text style={revStyles.bigScore}>
                {ratingInfo.average > 0 ? ratingInfo.average.toFixed(1) : "5.0"}
              </Text>
              <Text style={revStyles.stars}>
                {"★".repeat(Math.round(ratingInfo.average || 5))}
                {"☆".repeat(5 - Math.round(ratingInfo.average || 5))}
              </Text>
              <Text style={[styles.small, { textAlign: "center" }]}>{ratingInfo.reviewCount} đánh giá</Text>
            </View>

            {/* Bars */}
            <View style={revStyles.barsCol}>
              {[5, 4, 3, 2, 1].map((s) => {
                const count = starCounts[s as keyof typeof starCounts] || 0;
                const pct =
                  ratingInfo.reviewCount > 0
                    ? Math.round((count / ratingInfo.reviewCount) * 100)
                    : s === 5
                      ? 100
                      : 0;
                return (
                  <View key={s} style={revStyles.barRow}>
                    <Text style={revStyles.barLabel}>{s}★</Text>
                    <View style={revStyles.barTrack}>
                      <View style={[revStyles.barFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={revStyles.barCount}>{count}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Star Filter Chips */}
          <View style={revStyles.filterChipsRow}>
            <Pressable
              style={[revStyles.filterChip, starFilter === "all" && revStyles.filterChipActive]}
              onPress={() => setStarFilter("all")}
            >
              <Text
                style={[revStyles.filterChipText, starFilter === "all" && revStyles.filterChipTextActive]}
              >
                Tất cả ({reviews.length})
              </Text>
            </Pressable>
            {[5, 4, 3, 2, 1].map((s) => (
              <Pressable
                key={s}
                style={[revStyles.filterChip, starFilter === s && revStyles.filterChipActive]}
                onPress={() => setStarFilter(s)}
              >
                <Text style={[revStyles.filterChipText, starFilter === s && revStyles.filterChipTextActive]}>
                  {s}★ ({starCounts[s as keyof typeof starCounts] || 0})
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Reviews List */}
          {reviewsLoading ? (
            <View style={revStyles.center}>
              <ActivityIndicator size="small" color={tokens.color.brand} />
              <Text style={[styles.small, { marginTop: 6 }]}>Đang tải đánh giá…</Text>
            </View>
          ) : reviewsError ? (
            <View style={styles.card}>
              <Text accessibilityRole="alert" style={styles.error}>
                {reviewsError}
              </Text>
            </View>
          ) : filteredReviews.length === 0 ? (
            <View style={[styles.card, { alignItems: "center", paddingVertical: 24 }]}>
              <Text style={styles.text}>
                {reviews.length === 0
                  ? "Khóa học chưa có đánh giá nào."
                  : `Không có đánh giá ${starFilter} sao.`}
              </Text>
            </View>
          ) : (
            <NonVirtualizedList
              data={filteredReviews}
              keyExtractor={(item) => item.reviewId}
              renderItem={renderReview}
              contentContainerStyle={{ gap: 8 }}
            />
          )}
        </View>
      )}

      {/* TAB 2: COMMENTS / DISCUSSIONS */}
      {activeTab === "comments" && (
        <View style={{ gap: 12 }}>
          {/* Post Comment Card */}
          <View style={styles.card}>
            <Text style={[styles.title, { fontSize: 14 }]}>Phản hồi học viên với tư cách Giảng viên</Text>
            {commentMsg && (
              <Text
                accessibilityRole="alert"
                style={commentMsg.type === "error" ? styles.error : revStyles.successText}
              >
                {commentMsg.text}
              </Text>
            )}
            <TextInput
              style={revStyles.input}
              value={commentInput}
              onChangeText={setCommentInput}
              placeholder="Nhập nội dung giải đáp câu hỏi chuyên môn hoặc trao đổi với học viên..."
              multiline
              numberOfLines={3}
              accessibilityLabel="Nội dung thảo luận"
            />
            <Button
              label={commentSaving ? "Đang gửi…" : "🚀 Gửi phản hồi ngay"}
              onPress={() => void handlePostComment()}
              disabled={commentSaving}
            />
          </View>

          {commentsLoading ? (
            <View style={revStyles.center}>
              <ActivityIndicator size="small" color={tokens.color.brand} />
            </View>
          ) : comments.length === 0 ? (
            <View style={[styles.card, { alignItems: "center", paddingVertical: 24 }]}>
              <Text style={styles.text}>Chưa có thảo luận nào trên khóa học này.</Text>
            </View>
          ) : (
            <NonVirtualizedList
              data={comments}
              keyExtractor={(item) => item.commentId}
              renderItem={renderComment}
              contentContainerStyle={{ gap: 8 }}
            />
          )}
        </View>
      )}

      <View style={{ marginTop: 14 }}>
        <Button
          label="Quay lại chi tiết khóa học"
          variant="outline"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace(`/teaching/courses/${courseId}`)
          }
        />
      </View>
    </Page>
  );
}

const revStyles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#e2e8f0",
    borderRadius: 8,
    padding: 3,
    marginBottom: 12,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 6,
  },
  tabItemActive: {
    backgroundColor: "#ffffff",
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
  },
  tabItemText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  tabItemTextActive: {
    color: tokens.color.brand,
    fontWeight: "700",
  },
  summaryCard: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
    padding: 14,
  },
  scoreCol: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 90,
  },
  bigScore: {
    fontSize: 34,
    fontWeight: "800",
    color: "#f59e0b",
    lineHeight: 38,
  },
  stars: {
    fontSize: 14,
    color: "#f59e0b",
    letterSpacing: 1,
    marginVertical: 2,
  },
  barsCol: {
    flex: 1,
    gap: 3,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  barLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#f59e0b",
    width: 24,
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: "#e2e8f0",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    backgroundColor: "#f59e0b",
    borderRadius: 3,
  },
  barCount: {
    fontSize: 10,
    color: tokens.color.muted,
    width: 20,
    textAlign: "right",
  },
  filterChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 4,
  },
  filterChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  filterChipActive: {
    backgroundColor: "#eff6ff",
    borderColor: tokens.color.brand,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#475569",
  },
  filterChipTextActive: {
    color: tokens.color.brand,
    fontWeight: "700",
  },
  card: {
    padding: tokens.space.medium,
    backgroundColor: tokens.color.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  myCommentCard: {
    backgroundColor: "#f0f7ff",
    borderColor: "#bfdbfe",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: tokens.space.small,
  },
  ratingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  input: {
    minHeight: 70,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 8,
    padding: tokens.space.small,
    fontSize: 14,
    backgroundColor: "#fff",
    marginVertical: tokens.space.small,
    textAlignVertical: "top",
  },
  center: {
    padding: tokens.space.medium,
    alignItems: "center",
    justifyContent: "center",
  },
  successText: {
    color: "#166534",
    fontSize: 12,
    fontWeight: "600",
    marginVertical: 4,
  },
});
