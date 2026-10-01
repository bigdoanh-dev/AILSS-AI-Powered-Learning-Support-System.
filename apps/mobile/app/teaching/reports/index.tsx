import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ScrollView, Share, Text, View, StyleSheet, Pressable } from "react-native";
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
import { Button, Page, ScreenHeader, Icon, styles, tokens } from "../../../src/ui";

type RangeDays = 30 | 90 | 365;
const ranges: RangeDays[] = [30, 90, 365];
const brackets = ["Dưới 5", "5–<6,5", "6,5–<8", "8–<9", "9–10"];
const bracketColors = ["#EF4444", "#F59E0B", "#0D9488", "#0284C7", "#10B981"];

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

        {/* Range Segmented Control + Refresh */}
        <View style={rp.rangeRow}>
          <View style={rp.segmentedContainer}>
            {ranges.map((range) => {
              const active = days === range;
              return (
                <Pressable
                  key={range}
                  onPress={() => setDays(range)}
                  style={[rp.segmentedTab, active && rp.segmentedTabActive]}
                >
                  <Text style={[rp.segmentedText, active && rp.segmentedTextActive]}>{range} ngày</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Làm mới báo cáo"
            disabled={loading}
            style={[rp.refreshBtn, loading && { opacity: 0.5 }]}
            onPress={() => setRevision((value) => value + 1)}
          >
            <Icon name="refresh" size={16} color={tokens.color.brand} />
          </Pressable>
        </View>

        {loading && (
          <View style={rp.card}>
            <Text style={[styles.small, { textAlign: "center" }]}>Đang tải dữ liệu báo cáo từ máy chủ…</Text>
          </View>
        )}

        {!!error && (
          <View style={rp.errorCard}>
            <Icon name="alert" size={20} color="#DC2626" />
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button label="Thử lại" variant="outline" onPress={() => setRevision((value) => value + 1)} />
          </View>
        )}

        {report && !report.classes.length && (
          <View style={rp.card}>
            <Text style={styles.text}>Bạn chưa có lớp học phần nào để lập báo cáo.</Text>
          </View>
        )}

        {report && !!report.classes.length && (
          <>
            {/* Meta & Share bar */}
            <View style={rp.metaShareRow}>
              <View style={{ flex: 1 }}>
                <Text style={rp.dateRangeText}>
                  Từ {report.from} đến {report.to}
                </Text>
                <Text style={rp.fetchTimeText}>
                  Cập nhật: {new Date(report.fetchedAt).toLocaleTimeString("vi-VN")}
                </Text>
              </View>
              <Pressable style={rp.shareBtn} onPress={() => void shareCsv()}>
                <Icon name="document" size={14} color="#0D9488" />
                <Text style={rp.shareBtnText}>Xuất CSV</Text>
              </Pressable>
            </View>

            {/* Horizontal Class Selector Chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={rp.classChipScroll}
            >
              <Pressable
                onPress={() => setSelectedClass("ALL")}
                style={[rp.classChip, activeClass === "ALL" && rp.classChipActive]}
              >
                <Icon name="grid" size={14} color={activeClass === "ALL" ? "#FFFFFF" : tokens.color.muted} />
                <Text style={[rp.classChipText, activeClass === "ALL" && rp.classChipTextActive]}>
                  Tất cả lớp ({report.classes.length})
                </Text>
              </Pressable>

              {report.classes.map((item) => {
                const isSelected = activeClass === item.classId;
                return (
                  <Pressable
                    key={item.classId}
                    onPress={() => setSelectedClass(item.classId)}
                    style={[rp.classChip, isSelected && rp.classChipActive]}
                  >
                    <Icon name="class" size={14} color={isSelected ? "#FFFFFF" : tokens.color.muted} />
                    <Text style={[rp.classChipText, isSelected && rp.classChipTextActive]} numberOfLines={1}>
                      {item.className}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* KPI Metric Grid */}
            <View style={rp.kpiGrid}>
              <View style={rp.kpiCard}>
                <View style={rp.kpiHeader}>
                  <Text style={rp.kpiLabel}>HỌC VIÊN</Text>
                  <Icon name="people" size={16} color="#0284C7" />
                </View>
                <Text style={rp.kpiValue}>{total.students}</Text>
                <Text style={rp.kpiSub}>Lượt ghi danh</Text>
              </View>

              <View style={rp.kpiCard}>
                <View style={rp.kpiHeader}>
                  <Text style={rp.kpiLabel}>TỶ LỆ NỘP</Text>
                  <Icon name="document" size={16} color="#0D9488" />
                </View>
                <Text style={[rp.kpiValue, { color: "#0D9488" }]}>{format(total.submissionRate, "%")}</Text>
                <Text style={rp.kpiSub}>
                  {total.submitted}/{total.expected} bài nộp
                </Text>
              </View>

              <View style={rp.kpiCard}>
                <View style={rp.kpiHeader}>
                  <Text style={rp.kpiLabel}>ĐIỂM TRUNG BÌNH</Text>
                  <Icon name="star" size={16} color="#F59E0B" />
                </View>
                <Text style={[rp.kpiValue, { color: "#D97706" }]}>{format(total.averageScore)}</Text>
                <Text style={rp.kpiSub}>Đạt từ 5đ: {format(total.passRate, "%")}</Text>
              </View>

              <View style={rp.kpiCard}>
                <View style={rp.kpiHeader}>
                  <Text style={rp.kpiLabel}>CHUYÊN CẦN</Text>
                  <Icon name="checkCircle" size={16} color="#10B981" />
                </View>
                <Text style={[rp.kpiValue, { color: "#059669" }]}>{format(total.attendanceRate, "%")}</Text>
                <Text style={rp.kpiSub}>
                  {total.present}/{total.recorded} lượt
                </Text>
              </View>
            </View>

            {/* Score Distribution Chart */}
            <View style={rp.card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name="stats" size={18} color={tokens.color.brand} />
                <Text style={rp.cardTitle}>Phổ điểm bài kiểm tra</Text>
              </View>
              {total.scored ? (
                <View style={{ gap: 8, marginTop: 4 }}>
                  {brackets.map((bracket, index) => {
                    const count = total.distribution[index] ?? 0;
                    const percent = Math.round((count / maxBracket) * 100);
                    return (
                      <View key={bracket} style={{ gap: 4 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={rp.bracketLabel}>{bracket}</Text>
                          <Text style={rp.bracketCount}>{count} lượt</Text>
                        </View>
                        <View style={rp.trackBar}>
                          <View
                            style={[
                              rp.fillBar,
                              {
                                width: `${percent}%`,
                                backgroundColor: bracketColors[index],
                              },
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.small}>Chưa có bài kiểm tra đã chấm trong kỳ.</Text>
              )}
            </View>

            {/* Class Breakdown Section */}
            <View style={rp.card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name="class" size={18} color={tokens.color.brand} />
                <Text style={rp.cardTitle}>Chi tiết từng lớp ({classes.length})</Text>
              </View>
              {classes.map((item) => {
                const stat = aggregateReport([item]);
                return (
                  <View key={item.classId} style={rp.classDetailItem}>
                    <View style={rp.classDetailHeader}>
                      <Text style={rp.classDetailName} numberOfLines={1}>
                        {item.className}
                      </Text>
                      <View
                        style={[rp.classStatePill, item.state === "ACTIVE" ? rp.stateActive : rp.stateClosed]}
                      >
                        <Text
                          style={[
                            rp.classStateText,
                            item.state === "ACTIVE" ? { color: "#059669" } : { color: "#64748B" },
                          ]}
                        >
                          {item.state === "ACTIVE" ? "Đang dạy" : "Đã đóng"}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.small}>
                      {item.students} học viên · {item.quizzes} bài KT · Chờ chấm: {item.pending}
                    </Text>

                    <View style={rp.miniStatRow}>
                      <View style={rp.miniStatBox}>
                        <Text style={rp.miniStatLbl}>Tỷ lệ nộp</Text>
                        <Text style={rp.miniStatVal}>{format(stat.submissionRate, "%")}</Text>
                      </View>
                      <View style={rp.miniStatBox}>
                        <Text style={rp.miniStatLbl}>Điểm TB</Text>
                        <Text style={rp.miniStatVal}>{format(stat.averageScore, "/10")}</Text>
                      </View>
                      <View style={rp.miniStatBox}>
                        <Text style={rp.miniStatLbl}>Chuyên cần</Text>
                        <Text style={rp.miniStatVal}>{format(stat.attendanceRate, "%")}</Text>
                      </View>
                      <View style={rp.miniStatBox}>
                        <Text style={rp.miniStatLbl}>Đạt chuẩn</Text>
                        <Text style={rp.miniStatVal}>{format(stat.passRate, "%")}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>

            <Text
              style={[styles.small, { fontSize: 11, color: "#94A3B8", lineHeight: 16, marginBottom: 16 }]}
            >
              Ghi chú: Báo cáo gồm bài kiểm tra của lớp và khóa học liên kết, tính cho học viên đang học có
              quyền làm bài. Điểm dùng bài nộp mới nhất đã chấm; chuyên cần chỉ tính lượt điểm danh đã ghi.
            </Text>
          </>
        )}
      </Page>
    </View>
  );
}

const rp = StyleSheet.create({
  rangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  segmentedContainer: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#E2E8F0",
    borderRadius: 12,
    padding: 3,
  },
  segmentedTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  segmentedTabActive: {
    backgroundColor: "#FFFFFF",
    ...tokens.shadow.subtle,
  },
  segmentedText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  segmentedTextActive: {
    color: tokens.color.brand,
    fontWeight: "800",
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 12,
    marginBottom: 12,
    ...tokens.shadow.subtle,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  metaShareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  dateRangeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  fetchTimeText: {
    fontSize: 11,
    color: "#94A3B8",
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0FDFA",
    borderWidth: 1,
    borderColor: "#CCFBF1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  shareBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0D9488",
  },
  classChipScroll: {
    gap: 8,
    paddingVertical: 2,
    marginBottom: 12,
  },
  classChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  classChipActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  classChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
    maxWidth: 200,
  },
  classChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  kpiCard: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 3,
    ...tokens.shadow.subtle,
  },
  kpiHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kpiLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 2,
  },
  kpiSub: {
    fontSize: 11,
    color: "#94A3B8",
  },
  bracketLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
  },
  bracketCount: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  trackBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#F1F5F9",
    overflow: "hidden",
  },
  fillBar: {
    height: 8,
    borderRadius: 4,
  },
  classDetailItem: {
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 10,
    gap: 6,
  },
  classDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  classDetailName: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
    flex: 1,
    marginRight: 8,
  },
  classStatePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  stateActive: {
    backgroundColor: "#DCFCE7",
  },
  stateClosed: {
    backgroundColor: "#F1F5F9",
  },
  classStateText: {
    fontSize: 10,
    fontWeight: "700",
  },
  miniStatRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 2,
  },
  miniStatBox: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    padding: 6,
    borderRadius: 8,
    alignItems: "center",
  },
  miniStatLbl: {
    fontSize: 9,
    color: "#94A3B8",
    fontWeight: "600",
  },
  miniStatVal: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 1,
  },
  errorCard: {
    backgroundColor: "#FEF2F2",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FECACA",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
});
