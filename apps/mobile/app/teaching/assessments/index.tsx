import { useUiText } from "../../../src/use-language";
import { useEffect, useState, useCallback } from "react";
import { Text, View, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { ownedClasses, lecturerCourses, type OwnedClass } from "../../../src/teaching";
import { authoringQuizSummaries, type AuthoringQuizSummary } from "../../../src/assessment-authoring";
import { Page, Button, ScreenHeader, NonVirtualizedList, styles, tokens } from "../../../src/ui";

export default function LecturerAssessmentsScreen() {
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [targetType, setTargetType] = useState<"COURSE" | "CLASS">("COURSE");
  const [targetId, setTargetId] = useState<string>("");

  const [courses, setCourses] = useState<{ courseId: string; title: string }[]>([]);
  const [classes, setClasses] = useState<OwnedClass[]>([]);

  const [quizzes, setQuizzes] = useState<AuthoringQuizSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  // Load target lists (courses & classes)
  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();

    Promise.all([
      session.request("/api/v1/me/owned-courses", { signal: abort.signal }),
      session.request("/api/v1/me/owned-classes", { signal: abort.signal }),
    ])
      .then(([offeringData, classData]) => {
        if (abort.signal.aborted) return;
        const crs = lecturerCourses(offeringData);
        setCourses(crs);

        const cls = ownedClasses(classData);
        setClasses(cls);

        // Select default target if none selected
        if (!targetId) {
          if (crs.length > 0) {
            setTargetType("COURSE");
            setTargetId(crs[0].courseId);
          } else if (cls.length > 0) {
            setTargetType("CLASS");
            setTargetId(cls[0].classId);
          }
        }
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setError(e instanceof ApiError ? e.message : "Không thể tải danh sách giảng dạy.");
        }
      });

    return () => abort.abort();
  }, [session, snapshot.user?.role]);

  // Load quizzes when target changes
  useEffect(() => {
    if (!targetId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setLoading(true);
    setError("");

    session
      .request(`/api/v1/targets/${targetType}/${targetId}/quizzes`, { signal: abort.signal })
      .then((data: unknown) => {
        if (!abort.signal.aborted) {
          setQuizzes(authoringQuizSummaries(data));
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setError(e instanceof ApiError ? e.message : "Không thể tải danh sách bài kiểm tra.");
          setLoading(false);
        }
      });

    return () => abort.abort();
  }, [session, targetType, targetId, retry, snapshot.user?.role]);

  const handleRefresh = useCallback(() => {
    setRetry((v) => v + 1);
  }, []);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.title}>{uiText("Đánh giá")}</Text>
        <Text style={styles.error}>{uiText("Chức năng này chỉ dành cho Giảng viên.")}</Text>
        <Button label={uiText("Về trang chủ")} onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <Page>
      <ScreenHeader
        title={uiText("Quản lý bài kiểm tra")}
        subtitle={uiText("Soạn và quản lý bài kiểm tra theo khóa học hoặc lớp học")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching"))}
      />

      {/* Target Type Selector */}
      <View style={s.tabRow}>
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel={uiText("Chọn xem theo khóa học")}
          style={[s.tab, targetType === "COURSE" && s.tabActive]}
          onPress={() => {
            setTargetType("COURSE");
            if (courses.length > 0) setTargetId(courses[0].courseId);
          }}
        >
          <Text style={[s.tabText, targetType === "COURSE" && s.tabTextActive]}>
            {uiText("Khóa học (")}
            {courses.length})
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityLabel={uiText("Chọn xem theo lớp học")}
          style={[s.tab, targetType === "CLASS" && s.tabActive]}
          onPress={() => {
            setTargetType("CLASS");
            if (classes.length > 0) setTargetId(classes[0].classId);
          }}
        >
          <Text style={[s.tabText, targetType === "CLASS" && s.tabTextActive]}>
            {uiText("Lớp học (")}
            {classes.length})
          </Text>
        </Pressable>
      </View>

      {/* Target Items Horizontal Selector */}
      <View style={s.targetList}>
        {targetType === "COURSE" &&
          courses.map((c) => (
            <Pressable
              key={c.courseId}
              accessibilityRole="button"
              style={[s.chip, targetId === c.courseId && s.chipActive]}
              onPress={() => setTargetId(c.courseId)}
            >
              <Text style={[s.chipText, targetId === c.courseId && s.chipTextActive]} numberOfLines={1}>
                {c.title}
              </Text>
            </Pressable>
          ))}
        {targetType === "CLASS" &&
          classes.map((c) => (
            <Pressable
              key={c.classId}
              accessibilityRole="button"
              style={[s.chip, targetId === c.classId && s.chipActive]}
              onPress={() => setTargetId(c.classId)}
            >
              <Text style={[s.chipText, targetId === c.classId && s.chipTextActive]} numberOfLines={1}>
                {c.name}
              </Text>
            </Pressable>
          ))}
      </View>

      {/* Top Actions */}
      <View style={s.actionRow}>
        <Button
          label={uiText("Tạo bài kiểm tra mới")}
          onPress={() =>
            router.push({
              pathname: "/teaching/assessments/create",
              params: { targetType, targetId },
            } as Href)
          }
        />
        <Button
          label={uiText("Soạn đề bằng AI")}
          onPress={() =>
            router.push({
              pathname: "/teaching/ai",
              params: { targetType, targetId },
            } as Href)
          }
        />
      </View>

      {/* Loading & Error States */}
      {loading && (
        <View style={s.loadingBox}>
          <ActivityIndicator color={tokens.color.brand} />
          <Text style={styles.small}>{uiText("Đang tải bài kiểm tra…")}</Text>
        </View>
      )}

      {error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{uiText(error)}</Text>
          <Button label={uiText("Thử lại")} onPress={handleRefresh} />
        </View>
      ) : null}

      {/* Quiz List */}
      {!loading && !error && quizzes && quizzes.length === 0 && (
        <View style={s.emptyBox}>
          <Text style={styles.text}>{uiText("Chưa có bài kiểm tra cho nội dung này.")}</Text>
          <Text style={styles.small}>{uiText("Hãy tạo bài kiểm tra đầu tiên hoặc sử dụng Trợ lý AI.")}</Text>
        </View>
      )}

      {!loading && !error && quizzes && quizzes.length > 0 && (
        <NonVirtualizedList
          data={quizzes}
          keyExtractor={(item) => item.quizId}
          contentContainerStyle={{ gap: 12 }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("Bài kiểm tra {0}", [item.title])}
              style={s.quizCard}
              onPress={() => router.push(`/teaching/assessments/${item.quizId}` as Href)}
            >
              <View style={s.cardHeader}>
                <Text style={s.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <View
                  style={[
                    s.stateBadge,
                    item.state === "PUBLISHED"
                      ? s.badgePublished
                      : item.state === "CLOSED"
                        ? s.badgeClosed
                        : s.badgeDraft,
                  ]}
                >
                  <Text style={s.badgeText}>{item.state}</Text>
                </View>
              </View>

              <Text style={styles.small}>
                {item.questionCount} {uiText(" câu hỏi · Phiên bản v")}
                {item.currentVersion}
              </Text>

              <View style={s.cardFooter}>
                <Text style={s.linkText}>{uiText("Chi tiết & Soạn câu hỏi →")}</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <Button label={uiText("Quay lại Giảng dạy")} onPress={() => router.replace("/teaching")} />
    </Page>
  );
}

const s = StyleSheet.create({
  tabRow: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 6,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: "#fff",
  },
  tabActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  tabTextActive: {
    color: "#fff",
  },
  targetList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginVertical: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: "#fff",
  },
  chipActive: {
    backgroundColor: "#e6f4fe",
    borderColor: tokens.color.brand,
  },
  chipText: {
    fontSize: 12,
    color: tokens.color.ink,
  },
  chipTextActive: {
    color: tokens.color.brand,
    fontWeight: "700",
  },
  actionRow: {
    gap: 8,
    marginVertical: 6,
  },
  loadingBox: {
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  emptyBox: {
    padding: 24,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  quizCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    flex: 1,
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgePublished: {
    backgroundColor: "#dcfce7",
  },
  badgeDraft: {
    backgroundColor: "#fef3c7",
  },
  badgeClosed: {
    backgroundColor: "#fee2e2",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  cardFooter: {
    marginTop: 4,
  },
  linkText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.brand,
  },
});
