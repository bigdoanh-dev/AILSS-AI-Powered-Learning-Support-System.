import { useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, router, type Href } from "expo-router";
import { runtime } from "../../src/runtime";
import { Button, Icon, Page, tokens, styles } from "../../src/ui";
import { useStudentLearning } from "../../src/use-student-learning";
import { StudentNav } from "../../src/StudentNav";

export default function StudentWorkspace() {
  const session = runtime!;
  const auth = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const data = useStudentLearning(session, auth.user?.userId, auth.state);
  if (auth.state !== "AUTHENTICATED" && auth.state !== "OFFLINE_CACHE") return <Redirect href="/login" />;
  if (auth.user?.role !== "STUDENT") return <Redirect href="/" />;

  return (
    <View style={screen.root}>
      <Page style={screen.page}>
        <View style={screen.header}>
          <View style={{ flex: 1, gap: 5 }}>
            <Text style={screen.eyebrow}>KHÔNG GIAN HỌC TẬP</Text>
            <Text style={styles.title}>Chào {auth.user.displayName}</Text>
            <Text style={styles.text}>
              {data.source === "LIVE" ? "Dữ liệu học tập trực tiếp từ AILSS." : "Đang xem bản lưu cục bộ, không thay thế dữ liệu máy chủ."}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tài khoản"
            onPress={() => router.push("/account")}
            style={screen.account}
          >
            <Icon name="user" size={20} color={tokens.color.brand} />
          </Pressable>
        </View>
        {data.loading ? (
          <View style={screen.state}>
            <ActivityIndicator color={tokens.color.brand} />
            <Text style={styles.small}>Đang tải dữ liệu học tập…</Text>
          </View>
        ) : data.error ? (
          <View style={screen.state}>
            <Text accessibilityRole="alert" style={styles.error}>
              {data.error}
            </Text>
            <Button label="Tải lại" onPress={data.refresh} />
          </View>
        ) : data.courses.length === 0 ? (
          <View style={screen.empty}>
            <Text style={screen.emptyTitle}>Chưa có khóa học đang học</Text>
            <Text style={styles.text}>Các khóa bạn được quyền truy cập sẽ xuất hiện tại đây.</Text>
            <Button label="Khám phá khóa học" onPress={() => router.push("/courses")} />
          </View>
        ) : (
          <>
            <View style={screen.sectionHead}>
              <Text style={screen.sectionTitle}>Khóa học của bạn</Text>
              <Text accessibilityLabel={data.source === "LIVE" ? "LIVE" : "OFFLINE_CACHE"} style={screen.live}>
                {data.source === "LIVE" ? "LIVE" : "OFFLINE_CACHE"}
              </Text>
            </View>
            {data.source === "OFFLINE_CACHE" && (
              <Text style={styles.small}>
                LAST_SYNCED · {data.courseSyncedAt ? new Date(data.courseSyncedAt).toLocaleString("vi-VN") : "chưa rõ"}
              </Text>
            )}
            {data.courses.map(({ course, mastery, masteryError, studyPlan, studyPlanError }) => {
              const next = studyPlan?.items.find((item) =>
                ["PROPOSED", "PENDING", "ACCEPTED", "RESCHEDULED"].includes(item.status),
              );
              const mastered =
                mastery?.filter((item) => ["PROFICIENT", "MASTERED"].includes(item.masteryState)).length ?? 0;
              return (
                <View key={course.courseId} style={screen.course}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Mở khóa ${course.title}`}
                    onPress={() => router.push(`/learn/${course.courseId}` as Href)}
                    style={screen.courseHead}
                  >
                    <View style={screen.book}>
                      <Icon name="book" size={21} color={tokens.color.brand} />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={screen.courseTitle}>{course.title}</Text>
                      <Text style={screen.courseMeta}>Mở nội dung khóa học</Text>
                    </View>
                    <Icon name="chevronRight" size={18} color={tokens.color.muted} />
                  </Pressable>
                  <View style={screen.metrics}>
                    <View style={screen.metric}>
                      <Text style={screen.metricValue}>{masteryError ? "—" : (mastery?.length ?? 0)}</Text>
                      <Text style={screen.metricLabel}>kết quả năng lực</Text>
                    </View>
                    <View style={screen.metricDivider} />
                    <View style={screen.metric}>
                      <Text style={screen.metricValue}>{masteryError ? "—" : mastered}</Text>
                      <Text style={screen.metricLabel}>đạt thành thạo</Text>
                    </View>
                  </View>
                  {masteryError && (
                    <Text accessibilityRole="alert" style={screen.warning}>
                      Không tải được Mastery: {masteryError}
                    </Text>
                  )}
                  <View style={screen.planBox}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={screen.planLabel}>LỘ TRÌNH HỌC</Text>
                      <Text style={screen.planText}>
                        {studyPlanError
                          ? "Không tải được Study Plan"
                          : (next?.title ?? (studyPlan ? "Không còn việc đang chờ" : "Chưa có Study Plan"))}
                      </Text>
                      {next && (
                        <Text style={screen.planMeta}>
                          {next.scheduledDate} · {next.estimatedMinutes} phút
                        </Text>
                      )}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Mở lộ trình học"
                      onPress={() =>
                        router.push({
                          pathname: "/student/study-plan",
                          params: { courseId: course.courseId },
                        })
                      }
                      style={screen.action}
                    >
                      <Text style={screen.actionText}>Mở</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            <View style={screen.quickLinks}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/assessments")}
                style={screen.quick}
              >
                <Text style={screen.quickTitle}>Bài kiểm tra</Text>
                <Text style={screen.quickDetail}>Xem bài đã phát hành</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push("/notifications")}
                style={screen.quick}
              >
                <Text style={screen.quickTitle}>Thông báo</Text>
                <Text style={screen.quickDetail}>Cập nhật từ lớp học</Text>
              </Pressable>
            </View>
          </>
        )}
        {auth.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {auth.error}
          </Text>
        )}
      </Page>
      <StudentNav />
    </View>
  );
}
const screen = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.color.canvas },
  page: { gap: 18, paddingBottom: 28 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1, color: tokens.color.brand },
  account: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#E6F7F7",
    alignItems: "center",
    justifyContent: "center",
  },
  state: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 14 },
  empty: {
    padding: 22,
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 16,
  },
  emptyTitle: { fontSize: 20, fontWeight: "700", color: tokens.color.ink },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: tokens.color.ink },
  live: {
    fontSize: 10,
    fontWeight: "700",
    color: tokens.color.brand,
    backgroundColor: "#E6F7F7",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  course: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  courseHead: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 54 },
  book: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#E6F7F7",
    alignItems: "center",
    justifyContent: "center",
  },
  courseTitle: { fontSize: 16, fontWeight: "700", color: tokens.color.ink },
  courseMeta: { fontSize: 13, color: tokens.color.muted },
  metrics: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  metric: { flex: 1, gap: 3 },
  metricValue: { fontSize: 20, fontWeight: "700", color: tokens.color.ink },
  metricLabel: { fontSize: 12, color: tokens.color.muted },
  metricDivider: { width: 1, height: 32, backgroundColor: tokens.color.border },
  planBox: {
    backgroundColor: "#F6F8F7",
    borderRadius: 12,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  planLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6, color: tokens.color.brand },
  planText: { fontSize: 14, fontWeight: "600", color: tokens.color.ink },
  planMeta: { fontSize: 12, color: tokens.color.muted },
  action: {
    minWidth: 48,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#F2B84B",
  },
  actionText: { fontSize: 13, fontWeight: "700", color: "#17313A" },
  warning: { fontSize: 13, color: "#854D0E" },
  quickLinks: { flexDirection: "row", gap: 10 },
  quick: {
    flex: 1,
    minHeight: 92,
    justifyContent: "center",
    gap: 6,
    padding: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 14,
  },
  quickTitle: { fontSize: 15, fontWeight: "700", color: tokens.color.ink },
  quickDetail: { fontSize: 12, color: tokens.color.muted },
});
