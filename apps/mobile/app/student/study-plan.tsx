import { useCallback, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { runtime } from "../../src/runtime";
import { ApiError } from "../../src/api";
import { Button, Page, tokens, styles } from "../../src/ui";
import { useStudentLearning } from "../../src/use-student-learning";
import { StudentNav } from "../../src/StudentNav";

export default function StudyPlanScreen() {
  const session = runtime!;
  const auth = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const data = useStudentLearning(session, auth.user?.userId, auth.state);
  const params = useLocalSearchParams<{ courseId?: string }>();
  const [actionError, setActionError] = useState("");
  const selected = data.courses.find((x) => x.course.courseId === params.courseId) ?? data.courses[0];
  const act = useCallback(
    async (itemId: string, action: "accept" | "complete" | "skip") => {
      if (!selected) return;
      if (auth.state !== "AUTHENTICATED") {
        setActionError("Study Plan chỉ thay đổi khi có kết nối máy chủ.");
        return;
      }
      setActionError("");
      try {
        await session.request(`/api/v1/study-plan/items/${encodeURIComponent(itemId)}/${action}`, {
          method: "POST",
          body: { courseId: selected.course.courseId },
        });
        data.refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Không thể cập nhật lộ trình.");
        if (error instanceof ApiError && error.status === 409) data.refresh();
      }
    },
    [auth.state, data.refresh, selected, session],
  );
  const generate = useCallback(async () => {
    if (!selected) return;
    if (auth.state !== "AUTHENTICATED") {
      setActionError("Study Plan chỉ thay đổi khi có kết nối máy chủ.");
      return;
    }
    setActionError("");
    try {
      await session.request("/api/v1/study-plan/generate", {
        method: "POST",
        body: { courseId: selected.course.courseId, availableHoursPerWeek: 7 },
      });
      data.refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Không thể tạo lộ trình.");
    }
  }, [auth.state, data.refresh, selected, session]);
  if (auth.state !== "AUTHENTICATED" && auth.state !== "OFFLINE_CACHE") return <Redirect href="/login" />;
  if (auth.user?.role !== "STUDENT") return <Redirect href="/" />;
  return (
    <View style={page.root}>
      <Page style={{ gap: 16, paddingBottom: 28 }}>
        <View style={{ gap: 5 }}>
          <Text style={local.eyebrow}>STUDY PLAN V2</Text>
          <Text style={styles.title}>Lộ trình của bạn</Text>
          <Text style={styles.text}>Đề xuất, lịch và lý do được cung cấp bởi Learning Service.</Text>
          <Text accessibilityLabel={data.source === "LIVE" ? "LIVE" : "OFFLINE_CACHE"} style={styles.small}>
            {data.source === "LIVE" ? "LIVE · dữ liệu mới nhất từ máy chủ" : `OFFLINE_CACHE · LAST_SYNCED ${selected?.studyPlanSyncedAt ?? "chưa có"}`}
          </Text>
        </View>
        {data.loading ? (
          <View style={local.center}>
            <ActivityIndicator color={tokens.color.brand} />
            <Text style={styles.small}>Đang tải lộ trình…</Text>
          </View>
        ) : data.error ? (
          <View style={local.card}>
            <Text accessibilityRole="alert" style={styles.error}>
              {data.error}
            </Text>
            <Button label="Tải lại" onPress={data.refresh} />
          </View>
        ) : data.courses.length === 0 ? (
          <View style={local.card}>
            <Text style={local.heading}>Chưa có khóa học đang học</Text>
          </View>
        ) : (
          <>
            <View style={local.selector} accessibilityRole="radiogroup" accessibilityLabel="Chọn khóa học">
              {data.courses.map((item) => (
                <Pressable
                  key={item.course.courseId}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: item.course.courseId === selected?.course.courseId }}
                  onPress={() => router.setParams({ courseId: item.course.courseId })}
                  style={[
                    local.courseChoice,
                    item.course.courseId === selected?.course.courseId && local.courseChoiceActive,
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      local.choiceText,
                      item.course.courseId === selected?.course.courseId && local.choiceTextActive,
                    ]}
                  >
                    {item.course.title}
                  </Text>
                </Pressable>
              ))}
            </View>
            {selected?.studyPlanError ? (
              <View style={local.card}>
                <Text accessibilityRole="alert" style={styles.error}>
                  Không tải được Study Plan: {selected.studyPlanError}
                </Text>
                <Button label="Thử lại" onPress={data.refresh} />
              </View>
            ) : selected?.studyPlan ? (
              <>
                <View style={local.summary}>
                  <Text style={local.summaryTitle}>{selected.course.title}</Text>
                  <Text style={local.summaryText}>
                    Sinh lúc {new Date(selected.studyPlan.generatedAt).toLocaleString("vi-VN")} · Mastery tổng
                    quan {Math.round(selected.studyPlan.overallMasteryPercent)}%
                  </Text>
                </View>
                {selected.studyPlan.items.length === 0 ? (
                  <View style={local.card}>
                    <Text style={local.heading}>Chưa có việc học được đề xuất</Text>
                  </View>
                ) : (
                  selected.studyPlan.items.map((item) => (
                    <View key={item.itemId} style={local.card}>
                      <View style={local.row}>
                        <Text style={local.heading}>{item.title}</Text>
                        <Text style={local.status}>{item.status}</Text>
                      </View>
                      <Text style={local.body}>{item.description}</Text>
                      <Text style={local.reason}>{item.rationale}</Text>
                      <Text style={local.body}>
                        Lịch: {item.scheduledDate} · {item.estimatedMinutes} phút
                      </Text>
                      {item.dueAt && (
                        <Text style={local.body}>Hạn: {new Date(item.dueAt).toLocaleString("vi-VN")}</Text>
                      )}
                      {!["COMPLETED", "SKIPPED", "REPLACED"].includes(item.status) && (
                        <View style={local.actions}>
                          {item.status === "PROPOSED" || item.status === "PENDING" ? (
                            <Button
                              label="Chấp nhận"
                              size="sm"
                              disabled={auth.state !== "AUTHENTICATED"}
                              onPress={() => void act(item.itemId, "accept")}
                            />
                          ) : null}
                          <Button
                            label="Hoàn thành"
                            size="sm"
                            variant="secondary"
                            disabled={auth.state !== "AUTHENTICATED"}
                            onPress={() => void act(item.itemId, "complete")}
                          />
                          <Button
                            label="Bỏ qua"
                            size="sm"
                            variant="ghost"
                            disabled={auth.state !== "AUTHENTICATED"}
                            onPress={() => void act(item.itemId, "skip")}
                          />
                        </View>
                      )}
                    </View>
                  ))
                )}
              </>
            ) : (
              <View style={local.card}>
                <Text style={local.heading}>Chưa có Study Plan cho khóa này</Text>
                <Text style={local.body}>
                  {selected?.masteryError
                    ? `Không thể kiểm tra điều kiện tạo lộ trình: ${selected.masteryError}`
                    : selected?.mastery?.length
                      ? "Có dữ liệu Mastery. Bạn có thể tạo lộ trình mới từ dữ liệu hiện có."
                      : "Cần có Mastery evidence trước khi hệ thống tạo lộ trình."}
                </Text>
                <Button
                  disabled={auth.state !== "AUTHENTICATED" || !selected?.mastery?.length || !!selected?.masteryError}
                  label="Tạo lộ trình"
                  onPress={() => void generate()}
                />
              </View>
            )}
            {actionError && (
              <View style={local.error}>
                <Text accessibilityRole="alert" style={styles.error}>
                  {actionError}
                </Text>
                <Button
                  label="Tải trạng thái mới nhất"
                  size="sm"
                  onPress={() => {
                    setActionError("");
                    data.refresh();
                  }}
                />
              </View>
            )}
          </>
        )}
      </Page>
      <StudentNav />
    </View>
  );
}
const page = StyleSheet.create({ root: { flex: 1, backgroundColor: tokens.color.canvas } });
const local = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1, color: tokens.color.brand },
  center: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 12 },
  selector: { gap: 8 },
  courseChoice: {
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  courseChoiceActive: { borderColor: tokens.color.brand, backgroundColor: "#E6F7F7" },
  choiceText: { color: tokens.color.inkSecondary, fontWeight: "600" },
  choiceTextActive: { color: tokens.color.brandDark },
  summary: { padding: 16, borderRadius: 14, backgroundColor: "#123B42", gap: 6 },
  summaryTitle: { fontSize: 17, fontWeight: "700", color: "#FFFFFF" },
  summaryText: { fontSize: 13, color: "#D7E9E8" },
  card: {
    padding: 16,
    gap: 9,
    borderRadius: 14,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  heading: { flex: 1, fontSize: 15, fontWeight: "700", color: tokens.color.ink },
  status: { fontSize: 11, fontWeight: "700", color: tokens.color.brand },
  body: { fontSize: 13, lineHeight: 19, color: tokens.color.inkSecondary },
  reason: { fontSize: 13, lineHeight: 19, color: tokens.color.brandDark },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  error: { padding: 14, borderRadius: 12, backgroundColor: tokens.color.dangerLight },
});
