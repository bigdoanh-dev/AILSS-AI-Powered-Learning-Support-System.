import { useSyncExternalStore, useState, useEffect, useCallback } from "react";
import { Text, View, ActivityIndicator, StyleSheet, Linking, Pressable } from "react-native";
import { type Href, router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { runtime } from "../../../../src/runtime";
import {
  lessonDetail,
  progress as decodeProgress,
  safeContentUrl,
  type LessonDetail,
  type Progress,
} from "../../../../src/learning";
import { ApiError } from "../../../../src/api";
import {
  Page,
  Button,
  ScreenHeader,
  BottomNavBar,
  Badge,
  ProgressBar,
  Icon,
  tokens,
} from "../../../../src/ui";

export default function LessonConsumptionScreen() {
  const { courseId, lessonId } = useLocalSearchParams<{ courseId: string; lessonId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [courseProgress, setCourseProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [mutationLoading, setMutationLoading] = useState(false);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);

  // Stable idempotency key per logical action
  const [completeKey, setCompleteKey] = useState(() => Crypto.randomUUID());
  const [uncompleteKey, setUncompleteKey] = useState(() => Crypto.randomUUID());

  const fetchLesson = useCallback(async () => {
    if (!lessonId || !courseId || snapshot.state !== "AUTHENTICATED") return;
    try {
      setLoading(true);
      setError(null);

      const [lData, pData] = await Promise.all([
        session.request(`/api/v1/lessons/${lessonId}`),
        session.request(`/api/v1/courses/${courseId}/progress`),
      ]);

      const parsedLesson = lessonDetail(lData);
      if (parsedLesson.courseId !== courseId) {
        throw new ApiError("invalid");
      }

      const parsedProgress = decodeProgress(pData);
      setLesson(parsedLesson);
      setCourseProgress(parsedProgress);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.status === 403) setError("Bạn không có quyền truy cập bài học này.");
        else if (e.status === 404) setError("Không tìm thấy bài học.");
        else setError(e.message);
      } else {
        setError("Không thể tải bài học.");
      }
    } finally {
      setLoading(false);
    }
  }, [courseId, lessonId, snapshot.state, session]);

  useEffect(() => {
    void fetchLesson();
  }, [fetchLesson]);

  const toggleCompletion = async (targetCompleted: boolean) => {
    if (mutationLoading || !lessonId || !courseId) return;
    const previousState = isCompleted;

    // Optimistic update
    setIsCompleted(targetCompleted);
    setMutationLoading(true);
    setMutationMessage(null);

    try {
      const key = targetCompleted ? completeKey : uncompleteKey;

      await session.request(`/api/v1/lessons/${lessonId}/completion`, {
        method: "PUT",
        body: { completed: targetCompleted },
        idempotencyKey: key,
      });

      // On success, reset the key for the opposing action
      if (targetCompleted) {
        setUncompleteKey(Crypto.randomUUID());
      } else {
        setCompleteKey(Crypto.randomUUID());
      }

      setMutationMessage(targetCompleted ? "Đã ghi nhận hoàn thành bài học!" : "Đã hủy ghi nhận hoàn thành.");

      // Re-fetch progress to update the overall course progress bar
      const pData = await session.request(`/api/v1/courses/${courseId}/progress`);
      setCourseProgress(decodeProgress(pData));
    } catch (e: unknown) {
      // Rollback on failure
      setIsCompleted(previousState);
      setMutationMessage(
        e instanceof ApiError ? e.message : "Không thể cập nhật tiến độ hoàn thành. Vui lòng thử lại.",
      );
    } finally {
      setMutationLoading(false);
    }
  };

  const handleOpenMaterial = () => {
    const raw = lesson?.externalVideo || lesson?.contentUrl;
    const safe = safeContentUrl(raw);
    if (safe) {
      void Linking.openURL(safe);
    }
  };

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <Page>
        <ScreenHeader title="Nội dung bài học" onBack={() => router.push(`/learn/${courseId}` as Href)} />
        <View style={localStyles.authCard}>
          <Icon name="lock" size={36} color={tokens.color.brand} />
          <Text style={localStyles.cardHeading}>Yêu cầu đăng nhập</Text>
          <Text style={localStyles.authDesc}>Vui lòng đăng nhập để xem nội dung bài học.</Text>
          <Button label="Đăng nhập" onPress={() => router.push("/login" as Href)} />
        </View>
        <BottomNavBar currentRoute="/learn" onNavigate={(r) => router.push(r as Href)} role={snapshot.user?.role} />
      </Page>
    );
  }

  if (loading) {
    return (
      <Page>
        <ScreenHeader title="Đang tải..." onBack={() => router.push(`/learn/${courseId}` as Href)} />
        <View style={localStyles.center}>
          <ActivityIndicator size="large" color={tokens.color.brand} />
          <Text style={localStyles.loadingText}>Đang tải nội dung bài học…</Text>
        </View>
        <BottomNavBar currentRoute="/learn" onNavigate={(r) => router.push(r as Href)} role={snapshot.user?.role} />
      </Page>
    );
  }

  if (error || !lesson) {
    return (
      <Page>
        <ScreenHeader title="Thông báo" onBack={() => router.push(`/learn/${courseId}` as Href)} />
        <View style={localStyles.errorCard}>
          <Icon name="alert" size={32} color={tokens.color.danger} />
          <Text accessibilityRole="alert" style={localStyles.errorText}>
            {error || "Đã xảy ra lỗi khi tải bài học."}
          </Text>
          <View style={localStyles.errorActions}>
            <Button label="Thử lại" onPress={() => void fetchLesson()} />
            <Button label="← Quay lại giáo trình" variant="outline" onPress={() => router.push(`/learn/${courseId}` as Href)} />
          </View>
        </View>
        <BottomNavBar currentRoute="/learn" onNavigate={(r) => router.push(r as Href)} role={snapshot.user?.role} />
      </Page>
    );
  }

  const isVideo = lesson.contentType?.startsWith("video");
  const isPdf = lesson.contentType === "application/pdf";

  return (
    <Page>
      <ScreenHeader
        title={lesson.sectionTitle || "Bài học"}
        subtitle={lesson.title}
        onBack={() => router.push(`/learn/${courseId}` as Href)}
      />

      {/* Simulated High-End Media Player Viewport */}
      <View style={localStyles.playerCard}>
        <View style={localStyles.mediaScreen}>
          <View style={localStyles.mediaBadgeRow}>
            <Badge
              label={isVideo ? "VIDEO HD" : isPdf ? "TÀI LIỆU PDF" : "TÀI LIỆU HỌC"}
              variant={isVideo ? "primary" : "neutral"}
            />
            {lesson.preview && <Badge label="HỌC THỬ" variant="success" />}
          </View>

          <Pressable
            style={localStyles.playCenterButton}
            onPress={handleOpenMaterial}
            accessibilityRole="button"
            accessibilityLabel="Mở tài liệu học tập"
          >
            <View style={localStyles.playIconCircle}>
              <Icon name={isVideo ? "play" : "book"} size={26} color="#0F172A" />
            </View>
            <Text style={localStyles.playPromptText}>
              {isVideo ? "Chạm để mở Video" : "Chạm để mở tài liệu"}
            </Text>
          </Pressable>

          <View style={localStyles.mediaScreenFooter}>
            <Text style={localStyles.mediaFormatText}>
              {isVideo
                ? "Video bài giảng trực tuyến chất lượng cao"
                : isPdf
                  ? "Tài liệu giáo trình chuẩn PDF"
                  : "Bài giảng lý thuyết & mã nguồn thực hành"}
            </Text>
          </View>
        </View>

        {(lesson.contentUrl || lesson.externalVideo) && (
          <View style={localStyles.openButtonRow}>
            <Button
              label={isVideo ? "Mở Video học tập ↗" : "Mở tài liệu học tập ↗"}
              onPress={handleOpenMaterial}
              size="md"
            />
          </View>
        )}
      </View>

      {/* Lesson Details Card */}
      <View style={localStyles.card}>
        <Text style={localStyles.sectionTag}>{lesson.sectionTitle?.toUpperCase() || "BÀI HỌC"}</Text>
        <Text style={localStyles.lessonHeading}>{lesson.title}</Text>
      </View>

      {/* Progress & Completion Card */}
      <View style={localStyles.card}>
        <View style={localStyles.completionHeader}>
          <View style={localStyles.completionStatusRow}>
            <View
              style={[
                localStyles.checkCircle,
                isCompleted && localStyles.checkCircleCompleted,
              ]}
            >
              <Icon
                name="check"
                size={14}
                color={isCompleted ? "#FFFFFF" : tokens.color.muted}
              />
            </View>
            <View>
              <Text style={localStyles.completionTitle}>
                {isCompleted ? "Đã hoàn thành bài học" : "Chưa hoàn thành"}
              </Text>
              <Text style={localStyles.completionSub}>
                {isCompleted
                  ? "Hệ thống đã lưu lại kết quả học tập của bạn"
                  : "Đánh dấu sau khi đã nghe giảng và hiểu bài"}
              </Text>
            </View>
          </View>
        </View>

        {mutationMessage && (
          <View
            style={[
              localStyles.mutationBox,
              isCompleted ? localStyles.mutationBoxSuccess : localStyles.mutationBoxError,
            ]}
          >
            <Text
              accessibilityRole="alert"
              style={isCompleted ? localStyles.successText : localStyles.errorAlertText}
            >
              {mutationMessage}
            </Text>
          </View>
        )}

        <View style={localStyles.actionRow}>
          {isCompleted ? (
            <Button
              label={mutationLoading ? "Đang cập nhật…" : "Đánh dấu chưa hoàn thành"}
              variant="outline"
              onPress={() => void toggleCompletion(false)}
              disabled={mutationLoading}
            />
          ) : (
            <Button
              label={mutationLoading ? "Đang lưu tiến độ…" : "Đánh dấu đã hoàn thành"}
              onPress={() => void toggleCompletion(true)}
              disabled={mutationLoading}
            />
          )}
        </View>
      </View>

      {/* Overall Course Progress */}
      {courseProgress && (
        <View style={localStyles.progressCard}>
          <View style={localStyles.progressHeaderRow}>
            <Text style={localStyles.progressLabel}>Tiến độ toàn khóa học</Text>
            <Text style={localStyles.progressPercent}>{courseProgress.percent}%</Text>
          </View>
          <ProgressBar progress={courseProgress.percent} height={6} />
          <Text style={localStyles.progressSubtext}>
            Đã hoàn thành {courseProgress.completedCount} trên {courseProgress.publishedTotal} bài học
          </Text>
        </View>
      )}

      <View style={localStyles.footerActions}>
        <Button
          label="← Quay lại giáo trình khóa học"
          variant="outline"
          onPress={() => router.push(`/learn/${courseId}` as Href)}
        />
      </View>

      <BottomNavBar currentRoute="/learn" onNavigate={(r) => router.push(r as Href)} role={snapshot.user?.role} />
    </Page>
  );
}

const localStyles = StyleSheet.create({
  center: {
    padding: tokens.space.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.small,
  },
  loadingText: {
    fontSize: 14,
    color: tokens.color.muted,
  },
  authCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.xl,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginVertical: tokens.space.large,
    gap: tokens.space.medium,
    ...tokens.shadow.card,
  },
  cardHeading: {
    fontSize: 18,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  authDesc: {
    fontSize: 14,
    color: tokens.color.muted,
    textAlign: "center",
  },
  errorCard: {
    backgroundColor: "#FEF2F2",
    padding: tokens.space.large,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: "#FECACA",
    marginVertical: tokens.space.large,
    alignItems: "center",
    gap: tokens.space.medium,
  },
  errorText: {
    color: tokens.color.danger,
    fontSize: 14,
    textAlign: "center",
  },
  errorActions: {
    width: "100%",
    gap: tokens.space.small,
  },
  playerCard: {
    backgroundColor: tokens.color.surface,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    overflow: "hidden",
    marginBottom: tokens.space.medium,
    ...tokens.shadow.card,
  },
  mediaScreen: {
    backgroundColor: "#0F172A",
    height: 210,
    justifyContent: "space-between",
    padding: tokens.space.medium,
  },
  mediaBadgeRow: {
    flexDirection: "row",
    gap: 8,
  },
  playCenterButton: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  playIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...tokens.shadow.floating,
  },
  playPromptText: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "600",
  },
  mediaScreenFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mediaFormatText: {
    color: "#94A3B8",
    fontSize: 11,
  },
  openButtonRow: {
    padding: tokens.space.medium,
  },
  card: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.large,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.medium,
    gap: tokens.space.small,
    ...tokens.shadow.card,
  },
  sectionTag: {
    fontSize: 11,
    fontWeight: "800",
    color: tokens.color.brand,
    letterSpacing: 0.8,
  },
  lessonHeading: {
    fontSize: 20,
    fontWeight: "800",
    color: tokens.color.ink,
    lineHeight: 28,
  },
  completionHeader: {
    marginBottom: tokens.space.small,
  },
  completionStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  checkCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: tokens.color.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.canvas,
  },
  checkCircleCompleted: {
    backgroundColor: tokens.color.success,
    borderColor: tokens.color.success,
  },
  completionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  completionSub: {
    fontSize: 12,
    color: tokens.color.muted,
    marginTop: 2,
  },
  mutationBox: {
    padding: tokens.space.small,
    borderRadius: tokens.radius.sm,
    borderWidth: 1,
    marginVertical: tokens.space.xs,
  },
  mutationBoxSuccess: {
    backgroundColor: "#F0FDF4",
    borderColor: "#DCFCE7",
  },
  mutationBoxError: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FEE2E2",
  },
  successText: {
    fontSize: 13,
    color: tokens.color.success,
    fontWeight: "600",
  },
  errorAlertText: {
    fontSize: 13,
    color: tokens.color.danger,
    fontWeight: "600",
  },
  actionRow: {
    marginTop: tokens.space.small,
  },
  progressCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.large,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.medium,
    gap: tokens.space.small,
    ...tokens.shadow.subtle,
  },
  progressHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.inkSecondary,
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.brand,
  },
  progressSubtext: {
    fontSize: 12,
    color: tokens.color.muted,
    marginTop: 4,
  },
  footerActions: {
    marginTop: tokens.space.small,
    marginBottom: tokens.space.large,
  },
});

