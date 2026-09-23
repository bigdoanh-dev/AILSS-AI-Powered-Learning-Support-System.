import { useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import type { MasteryRecord, MasteryState } from "../../src/adaptive";
import { runtime } from "../../src/runtime";
import { Button, Icon, Page, tokens, styles } from "../../src/ui";
import { useStudentLearning } from "../../src/use-student-learning";
import { StudentNav } from "../../src/StudentNav";

const stateMeta: Record<MasteryState, { label: string; ink: string; wash: string }> = {
  NOT_OBSERVED: { label: "Chưa ghi nhận", ink: "#64748B", wash: "#F1F5F9" },
  INTRODUCED: { label: "Mới bắt đầu", ink: "#0369A1", wash: "#E0F2FE" },
  DEVELOPING: { label: "Đang phát triển", ink: "#7C3AED", wash: "#EDE9FE" },
  PROFICIENT: { label: "Thành thạo", ink: "#047857", wash: "#D1FAE5" },
  MASTERED: { label: "Nắm vững", ink: "#047857", wash: "#D1FAE5" },
  DECAY_RISK: { label: "Cần ôn lại", ink: "#B45309", wash: "#FEF3C7" },
};

function isStrong(record: MasteryRecord): boolean {
  return record.masteryState === "PROFICIENT" || record.masteryState === "MASTERED";
}

function formatSync(value?: string): string {
  if (!value) return "Chưa có thời điểm đồng bộ";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("vi-VN");
}

function ScoreTrack({ value, label }: { value: number; label: string }) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={local.track}
    >
      <View style={[local.fill, { width: `${percent}%` }]} />
    </View>
  );
}

export default function MasteryScreen() {
  const session = runtime!;
  const auth = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const data = useStudentLearning(session, auth.user?.userId, auth.state);
  if (auth.state !== "AUTHENTICATED" && auth.state !== "OFFLINE_CACHE") return <Redirect href="/login" />;
  if (auth.user?.role !== "STUDENT") return <Redirect href="/" />;

  const availableCourses = data.courses.filter((item) => !item.masteryError && item.mastery !== null);
  const records = availableCourses.flatMap((item) => item.mastery ?? []);
  const strong = records.filter(isStrong).length;
  const developing = records.filter((item) => item.masteryState === "INTRODUCED" || item.masteryState === "DEVELOPING").length;
  const review = records.filter((item) => item.masteryState === "DECAY_RISK").length;
  const notObserved = records.filter((item) => item.masteryState === "NOT_OBSERVED").length;
  const hasCachedMastery = data.courseSource === "OFFLINE_CACHE" || data.courses.some((item) => item.masterySource === "OFFLINE_CACHE");

  return (
    <View style={page.root}>
      <Page style={local.pageContent}>
        <View style={local.intro}>
          <View style={local.introIcon}><Icon name="stats" size={19} color={tokens.color.brand} /></View>
          <Text style={styles.title}>Năng lực học tập</Text>
          <Text style={styles.text}>Theo dõi từng khái niệm từ bằng chứng học tập đã được ghi nhận.</Text>
        </View>

        {data.loading ? (
          <View style={local.center}>
            <ActivityIndicator color={tokens.color.brand} />
            <Text style={styles.small}>Đang tải năng lực của bạn…</Text>
          </View>
        ) : data.error ? (
          <View style={local.center}>
            <Text accessibilityRole="alert" style={styles.error}>{data.error}</Text>
            <Button label="Tải lại" onPress={data.refresh} />
          </View>
        ) : data.courses.length === 0 ? (
          <View style={local.emptyCard}>
            <Icon name="academic" size={24} color={tokens.color.brand} />
            <Text style={local.emptyHeading}>Chưa có khóa học</Text>
            <Text style={styles.text}>Năng lực sẽ xuất hiện sau khi bạn bắt đầu học và có bằng chứng đầu tiên.</Text>
          </View>
        ) : (
          <>
            <View style={local.overview}>
              <View style={local.overviewTop}>
                <View style={local.overviewMark}><Icon name="award" size={19} color="#BDF5E3" /></View>
                <Text style={local.overviewCaption}>Bản đồ năng lực</Text>
              </View>
              <View style={local.overviewCountRow}>
                <Text style={local.overviewCount}>{strong}</Text>
                <Text style={local.overviewTotal}>/ {records.length} khái niệm đạt mức thành thạo</Text>
              </View>
              <Text style={local.overviewExplanation}>
                Tổng hợp từ {availableCourses.length} khóa học đã tải dữ liệu Mastery
                {notObserved > 0 ? ` · ${notObserved} khái niệm chưa ghi nhận` : ""}.
              </Text>
              <View style={local.statRow}>
                <View style={local.statCell}>
                  <Text style={local.statValue}>{strong}</Text>
                  <Text style={local.statLabel}>Thành thạo</Text>
                </View>
                <View style={local.statDivider} />
                <View style={local.statCell}>
                  <Text style={local.statValue}>{developing}</Text>
                  <Text style={local.statLabel}>Đang học</Text>
                </View>
                <View style={local.statDivider} />
                <View style={local.statCell}>
                  <Text style={local.statValue}>{review}</Text>
                  <Text style={local.statLabel}>Cần ôn lại</Text>
                </View>
              </View>
            </View>

            <View style={local.freshness}>
              <View style={[local.sourceDot, hasCachedMastery ? local.cachedDot : local.liveDot]} />
              <Text style={local.sourceText}>
                {hasCachedMastery ? "Một số dữ liệu lấy từ bản lưu trên thiết bị" : "Dữ liệu Mastery từ máy chủ"}
              </Text>
            </View>
            {availableCourses.length < data.courses.length ? (
              <Text accessibilityRole="alert" style={local.partialNotice}>
                Tổng quan chưa bao gồm {data.courses.length - availableCourses.length} khóa học chưa tải được Mastery.
              </Text>
            ) : null}

            <Text style={local.sectionHeading}>Theo khóa học</Text>
            {data.courses.map(({ course, mastery, masteryError, masterySource, masterySyncedAt }) => {
              const mastered = mastery?.filter(isStrong).length ?? 0;
              const total = mastery?.length ?? 0;
              const share = total > 0 ? Math.round((mastered / total) * 100) : 0;
              return (
                <View key={course.courseId} style={local.courseCard}>
                  <View style={local.courseHeader}>
                    <View style={local.courseIcon}><Icon name="book" size={18} color={tokens.color.brand} /></View>
                    <View style={local.courseHeadingWrap}>
                      <Text style={local.courseTitle}>{course.title}</Text>
                      <Text style={local.courseMeta}>
                        {masterySource === "OFFLINE_CACHE" ? `Bản lưu · ${formatSync(masterySyncedAt)}` : "Đã đồng bộ từ máy chủ"}
                      </Text>
                    </View>
                  </View>
                  {masteryError ? (
                    <Text accessibilityRole="alert" style={styles.error}>Không tải được dữ liệu Mastery: {masteryError}</Text>
                  ) : total > 0 && mastery ? (
                    <>
                      <View style={local.courseProgressHeader}>
                        <Text style={local.courseProgressLabel}>{mastered}/{total} khái niệm thành thạo</Text>
                        <Text style={local.courseProgressValue}>{share}%</Text>
                      </View>
                      <ScoreTrack value={share} label={`Tỷ lệ khái niệm thành thạo của ${course.title}: ${share} phần trăm`} />
                      <View style={local.conceptList}>
                        {mastery.map((item) => {
                          const meta = stateMeta[item.masteryState];
                          const score = Math.round(item.masteryScore);
                          return (
                            <View key={`${item.courseId}-${item.conceptId}`} style={local.concept}>
                              <View style={local.conceptTop}>
                                <Text style={local.conceptName}>{item.conceptId}</Text>
                                <Text style={[local.state, { color: meta.ink, backgroundColor: meta.wash }]}>{meta.label}</Text>
                              </View>
                              <View style={local.scoreLine}>
                                <Text style={local.scoreLabel}>Mức độ làm chủ</Text>
                                <Text style={local.score}>{score}%</Text>
                              </View>
                              <ScoreTrack value={item.masteryScore} label={`Mức độ làm chủ ${item.conceptId}: ${score} phần trăm`} />
                              <Text style={local.description}>{item.explanation.whyState}</Text>
                              <Text style={local.evidence}>Bằng chứng {item.evidenceCount} · Độ tin cậy {Math.round(item.confidenceScore)}%</Text>
                              <View style={local.nextBox}>
                                <Icon name="sparkles" size={15} color={tokens.color.brandDark} />
                                <Text style={local.next}>Tiếp theo: {item.explanation.nextSteps}</Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </>
                  ) : (
                    <View style={local.noEvidence}>
                      <Text style={local.emptyHeading}>Chưa có bằng chứng cho khóa học này</Text>
                      <Text style={styles.text}>Hoàn thành bài học hoặc bài đánh giá để hệ thống cập nhật năng lực.</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </Page>
      <StudentNav />
    </View>
  );
}

const page = StyleSheet.create({ root: { flex: 1, backgroundColor: tokens.color.canvas } });
const local = StyleSheet.create({
  pageContent: { gap: 16, paddingBottom: 28 },
  intro: { gap: 6, paddingTop: 4 },
  introIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: tokens.color.brandLight, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  center: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 12 },
  overview: { backgroundColor: "#073A46", borderRadius: 22, padding: 20, gap: 11, overflow: "hidden" },
  overviewTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  overviewMark: { width: 32, height: 32, borderRadius: 10, backgroundColor: "#155664", alignItems: "center", justifyContent: "center" },
  overviewCaption: { color: "#C8F1E9", fontSize: 13, fontWeight: "700" },
  overviewCountRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 8 },
  overviewCount: { color: "#FFFFFF", fontSize: 40, lineHeight: 47, fontWeight: "800", letterSpacing: -1 },
  overviewTotal: { color: "#E5F5F1", fontSize: 15, lineHeight: 22, flexShrink: 1 },
  overviewExplanation: { color: "#B5D9D5", fontSize: 12, lineHeight: 18 },
  statRow: { flexDirection: "row", alignItems: "stretch", borderTopWidth: 1, borderTopColor: "#28606A", marginTop: 5, paddingTop: 16 },
  statCell: { flex: 1, alignItems: "center", gap: 3 },
  statDivider: { width: 1, backgroundColor: "#28606A" },
  statValue: { color: "#FFFFFF", fontSize: 20, fontWeight: "800" },
  statLabel: { color: "#C8E0DD", fontSize: 11, textAlign: "center" },
  freshness: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 },
  sourceDot: { width: 8, height: 8, borderRadius: 4 },
  liveDot: { backgroundColor: "#10B981" },
  cachedDot: { backgroundColor: "#D97706" },
  sourceText: { color: tokens.color.muted, fontSize: 12, lineHeight: 18, flex: 1 },
  partialNotice: { color: "#92400E", backgroundColor: "#FEF3C7", borderRadius: 10, padding: 12, fontSize: 12, lineHeight: 18 },
  sectionHeading: { fontSize: 18, fontWeight: "800", color: tokens.color.ink, marginTop: 6 },
  courseCard: { backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.border, borderRadius: 18, padding: 16, gap: 12, ...tokens.shadow.subtle },
  courseHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  courseIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.brandLight },
  courseHeadingWrap: { flex: 1, gap: 3 },
  courseTitle: { color: tokens.color.ink, fontSize: 16, fontWeight: "800", lineHeight: 22 },
  courseMeta: { color: tokens.color.muted, fontSize: 11, lineHeight: 16 },
  courseProgressHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 2 },
  courseProgressLabel: { color: tokens.color.inkSecondary, fontSize: 12, fontWeight: "600", flexShrink: 1 },
  courseProgressValue: { color: tokens.color.brandDark, fontSize: 13, fontWeight: "800" },
  track: { height: 7, backgroundColor: "#E2E8F0", borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999, backgroundColor: tokens.color.brand },
  conceptList: { marginTop: 4 },
  concept: { paddingVertical: 16, gap: 9, borderTopWidth: 1, borderTopColor: "#E9EFF2" },
  conceptTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  conceptName: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "700", color: tokens.color.ink },
  state: { fontSize: 11, fontWeight: "700", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, overflow: "hidden", textAlign: "center", maxWidth: 122 },
  scoreLine: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  scoreLabel: { fontSize: 12, color: tokens.color.muted },
  score: { fontSize: 19, fontWeight: "800", color: tokens.color.brandDark },
  description: { fontSize: 13, lineHeight: 19, color: tokens.color.inkSecondary },
  evidence: { fontSize: 12, lineHeight: 18, color: tokens.color.muted },
  nextBox: { flexDirection: "row", alignItems: "flex-start", gap: 7, backgroundColor: "#F0FAF8", borderRadius: 10, padding: 10 },
  next: { flex: 1, fontSize: 12, lineHeight: 18, color: tokens.color.brandDark },
  noEvidence: { gap: 6, paddingTop: 5 },
  emptyCard: { backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.border, borderRadius: 18, padding: 18, gap: 10 },
  emptyHeading: { fontSize: 15, fontWeight: "700", color: tokens.color.ink },
});
