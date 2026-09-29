import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Share, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import {
  aggregateReport,
  loadMobileTeachingReport,
  reportCsv,
  ReportDataError,
  type TeachingReport,
} from "../../../src/teachingReport";
import { Button, Page, ScreenHeader, styles, tokens } from "../../../src/ui";

type RangeDays = 30 | 90 | 365;
const ranges: RangeDays[] = [30, 90, 365];
const brackets = ["Dưới 5", "5–<6,5", "6,5–<8", "8–<9", "9–10"];
const card = {
  backgroundColor: tokens.color.surface,
  borderColor: tokens.color.border,
  borderRadius: 14,
  borderWidth: 1,
  gap: 10,
  padding: 16,
} as const;
const format = (value: number | null, suffix = "") => (value === null ? "—" : `${value.toFixed(1)}${suffix}`);

export default function LecturerTeachingReportScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [days, setDays] = useState<RangeDays>(30);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<TeachingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") return;
    const controller = new AbortController();
    setLoading(true);
    setReport(null);
    setError("");
    loadMobileTeachingReport(days, controller.signal, session)
      .then((value) => {
        if (!controller.signal.aborted) setReport(value);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof ReportDataError || cause instanceof ApiError
            ? cause.message
            : "Không thể tải báo cáo giảng dạy.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, revision, session, snapshot.user?.role]);

  const activeClass = report?.classes.some((item) => item.classId === selectedClass) ? selectedClass : "ALL";
  const classes = useMemo(
    () => report?.classes.filter((item) => activeClass === "ALL" || item.classId === activeClass) ?? [],
    [report, activeClass],
  );
  const total = useMemo(() => aggregateReport(classes), [classes]);
  const maxBracket = Math.max(1, ...total.distribution);
  async function shareCsv() {
    if (!report || !classes.length) return;
    try {
      await Share.share({ title: "Báo cáo giảng dạy CSV", message: reportCsv(report, classes) });
    } catch {
      setError("Không thể mở bảng chia sẻ CSV.");
    }
  }

  if (snapshot.user?.role !== "LECTURER")
    return (
      <Page>
        <ScreenHeader title="Báo cáo giảng dạy" onBack={() => router.replace("/" as Href)} />
        <Text style={styles.error}>Chỉ giảng viên được xem báo cáo này.</Text>
      </Page>
    );

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Báo cáo giảng dạy"
          subtitle="Kết quả kiểm tra và chuyên cần theo lớp"
          onBack={() => router.replace("/teaching" as Href)}
        />
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {ranges.map((range) => (
            <Button
              key={range}
              label={`${range} ngày`}
              variant={days === range ? "primary" : "outline"}
              onPress={() => setDays(range)}
            />
          ))}
          <Button
            label="Làm mới"
            variant="outline"
            disabled={loading}
            onPress={() => setRevision((value) => value + 1)}
          />
        </View>
        {loading && <Text style={styles.small}>Đang tải dữ liệu từ máy chủ…</Text>}
        {!!error && (
          <View style={card}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button label="Thử lại" onPress={() => setRevision((value) => value + 1)} />
          </View>
        )}
        {report && !report.classes.length && (
          <View style={card}>
            <Text style={styles.text}>Bạn chưa có lớp học phần nào để lập báo cáo.</Text>
          </View>
        )}
        {report && !!report.classes.length && (
          <>
            <Text style={styles.small}>
              Từ {report.from} đến {report.to} · Đã tải {new Date(report.fetchedAt).toLocaleString("vi-VN")}
            </Text>
            <Button label="Chia sẻ dữ liệu CSV" variant="outline" onPress={() => void shareCsv()} />
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button
                label="Tất cả lớp"
                variant={activeClass === "ALL" ? "primary" : "outline"}
                onPress={() => setSelectedClass("ALL")}
              />
              {report.classes.map((item) => (
                <Button
                  key={item.classId}
                  label={item.className}
                  variant={activeClass === item.classId ? "primary" : "outline"}
                  onPress={() => setSelectedClass(item.classId)}
                />
              ))}
            </View>
            <View style={card}>
              <Text style={styles.title}>Tổng quan · {classes.length} lớp</Text>
              <Text style={styles.text}>Lượt ghi danh đang học: {total.students}</Text>
              <Text style={styles.text}>
                Tỷ lệ nộp: {format(total.submissionRate, "%")} ({total.submitted}/{total.expected} lượt)
              </Text>
              <Text style={styles.text}>Bài chờ chấm: {total.pending}</Text>
              <Text style={styles.text}>
                Điểm trung bình: {format(total.averageScore, " / 10")} · Đạt từ 5 điểm:{" "}
                {format(total.passRate, "%")}
              </Text>
              <Text style={styles.text}>
                Có mặt đã ghi nhận: {format(total.attendanceRate, "%")} ({total.present}/{total.recorded}{" "}
                lượt)
              </Text>
            </View>
            <View style={card}>
              <Text style={styles.title}>Phổ điểm bài kiểm tra</Text>
              {total.scored ? (
                brackets.map((bracket, index) => (
                  <View key={bracket} style={{ gap: 4 }}>
                    <Text style={styles.small}>
                      {bracket}: {total.distribution[index]} lượt
                    </Text>
                    <View style={{ height: 9, borderRadius: 5, backgroundColor: tokens.color.border }}>
                      <View
                        style={{
                          height: 9,
                          borderRadius: 5,
                          width: `${((total.distribution[index] ?? 0) / maxBracket) * 100}%`,
                          backgroundColor: tokens.color.brand,
                        }}
                      />
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.small}>Chưa có bài kiểm tra đã chấm trong kỳ.</Text>
              )}
            </View>
            <View style={card}>
              <Text style={styles.title}>Chi tiết từng lớp</Text>
              {classes.map((item) => {
                const stat = aggregateReport([item]);
                return (
                  <View
                    key={item.classId}
                    style={{ borderTopWidth: 1, borderTopColor: tokens.color.border, paddingTop: 10, gap: 4 }}
                  >
                    <Text style={[styles.text, { fontWeight: "700" }]}>{item.className}</Text>
                    <Text style={styles.small}>
                      {item.students} học viên · {item.quizzes} bài kiểm tra ·{" "}
                      {item.state === "ACTIVE" ? "Đang dạy" : "Đã đóng"}
                    </Text>
                    <Text style={styles.small}>
                      Nộp {format(stat.submissionRate, "%")} · Chờ chấm {item.pending} · Điểm TB{" "}
                      {format(stat.averageScore, "/10")}
                    </Text>
                    <Text style={styles.small}>
                      Chuyên cần {format(stat.attendanceRate, "%")} · Đạt {format(stat.passRate, "%")}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.small}>
              Gồm bài kiểm tra của lớp và khóa học liên kết, tính cho học viên đang học có quyền làm bài. Điểm
              dùng bài nộp mới nhất đã chấm; chuyên cần chỉ tính lượt điểm danh đã ghi. Một học viên ở hai lớp
              được tính hai lượt ghi danh.
            </Text>
          </>
        )}
      </Page>
    </View>
  );
}
