import { useState, useSyncExternalStore } from "react";
import { Text, View, StyleSheet, ScrollView, Alert } from "react-native";
import { router, type Href } from "expo-router";
import { runtime } from "../../../src/runtime";
import { Page, Button, Icon, Badge, ScreenHeader, BottomNavBar, styles, tokens } from "../../../src/ui";
import { ScalePressable, AnimatedNumber, AnimatedProgressBar, StaggerPop, FadeSlideIn } from "../../../src/motion";

const GRADE_DISTRIBUTION = [
  { bracket: "Xuất sắc (9.0 - 10)", count: 36, percent: 28, color: "#059669" },
  { bracket: "Giỏi (8.0 - 8.9)", count: 54, percent: 42, color: "#0284C7" },
  { bracket: "Khá (6.5 - 7.9)", count: 28, percent: 22, color: "#D97706" },
  { bracket: "Trung bình (5.0 - 6.4)", count: 8, percent: 6, color: "#64748B" },
  { bracket: "Cần cố gắng (< 5.0)", count: 2, percent: 2, color: "#DC2626" },
];

const BLOOM_LEVELS = [
  { level: "Nhận biết (Recognition)", rate: 92, color: "#0284C7" },
  { level: "Thông hiểu (Understanding)", rate: 86, color: "#7C3AED" },
  { level: "Vận dụng (Application)", rate: 78, color: "#D97706" },
  { level: "Phân tích & Tối ưu (Analysis)", rate: 68, color: "#059669" },
  { level: "Đánh giá & Kiến trúc (Evaluation)", rate: 62, color: "#DC2626" },
];

const CLASS_REPORTS = [
  {
    id: "cls-01",
    name: "CSDL Nâng cao - Nhóm 01",
    course: "Cơ sở dữ liệu Nâng cao & Tối ưu",
    students: 42,
    submissionRate: 95.2,
    pending: 4,
    avgScore: 8.6,
    attendanceRate: 97.4,
  },
  {
    id: "cls-02",
    name: "Lập trình Web & AI - Nhóm 02",
    course: "Web & Trợ lý AI Fullstack",
    students: 48,
    submissionRate: 91.6,
    pending: 6,
    avgScore: 8.2,
    attendanceRate: 95.8,
  },
  {
    id: "cls-03",
    name: "AI & LLM thực chiến - Nhóm 01",
    course: "Ứng dụng LLM & Agent",
    students: 38,
    submissionRate: 89.5,
    pending: 4,
    avgScore: 8.5,
    attendanceRate: 96.0,
  },
];

export default function LecturerReportsScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [exported, setExported] = useState(false);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <ScreenHeader title="Báo cáo giảng dạy" onBack={() => router.replace("/")} />
        <Text style={styles.error}>Chức năng này chỉ dành cho Giảng viên.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const handleExport = () => {
    setExported(true);
    Alert.alert(
      "Xuất báo cáo thành công",
      "Báo cáo thống kê chi tiết giảng dạy và bảng điểm 3 lớp học phần đã được chuẩn bị và lưu vào tệp tải xuống."
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Báo Cáo & Thống Kê Giảng Dạy"
          subtitle="Chỉ số sinh viên, phân phổ điểm và chất lượng bài nộp"
          onBack={() => router.replace("/teaching" as Href)}
        />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>
          {/* 4 Summary KPIs */}
          <FadeSlideIn duration={500}>
            <View style={st.kpiGrid}>
              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#EDE9FE" }]}>
                  <Icon name="people" size={18} color="#7C3AED" />
                </View>
                <AnimatedNumber value={128} suffix=" SV" style={st.kpiValue} />
                <Text style={st.kpiLabel}>Tổng sinh viên phụ trách</Text>
                <Text style={st.kpiSub}>3 lớp học phần</Text>
              </View>

              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#DCFCE7" }]}>
                  <Icon name="check" size={18} color="#15803D" />
                </View>
                <AnimatedNumber value={94.2} suffix="%" decimals={1} style={st.kpiValue} />
                <Text style={st.kpiLabel}>Tỷ lệ nộp bài đánh giá</Text>
                <Text style={[st.kpiSub, { color: "#D97706" }]}>14 bài chờ chấm</Text>
              </View>

              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#E0F2FE" }]}>
                  <Icon name="award" size={18} color="#0284C7" />
                </View>
                <AnimatedNumber value={8.4} suffix=" / 10" decimals={1} style={[st.kpiValue, { color: "#0284C7" }]} />
                <Text style={st.kpiLabel}>Điểm trung bình lớp</Text>
                <Text style={st.kpiSub}>98.5% đạt chuẩn</Text>
              </View>

              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#FEF3C7" }]}>
                  <Icon name="calendar" size={18} color="#D97706" />
                </View>
                <AnimatedNumber value={96.4} suffix="%" decimals={1} style={st.kpiValue} />
                <Text style={st.kpiLabel}>Tỷ lệ chuyên cần</Text>
                <Text style={st.kpiSub}>Khảo sát qua QR/GPS</Text>
              </View>
            </View>
          </FadeSlideIn>

          {/* Grade Distribution Bar Chart View */}
          <FadeSlideIn delay={120} duration={500}>
            <View style={st.card}>
              <View style={st.cardHeaderRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="chart" size={18} color="#0284C7" />
                  <Text style={st.cardHeading}>Phân Phổ Điểm Đánh Giá</Text>
                </View>
                <Badge label="128 SINH VIÊN" variant="neutral" />
              </View>
              <Text style={st.cardDesc}>Tỷ lệ sinh viên theo từng khung điểm kiểm tra.</Text>

              <View style={{ gap: 10, marginTop: 4 }}>
                {GRADE_DISTRIBUTION.map((g, idx) => (
                  <View key={idx} style={{ gap: 4 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: tokens.color.ink }}>
                        {g.bracket}
                      </Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: g.color }}>
                        {g.count} SV ({g.percent}%)
                      </Text>
                    </View>
                    <AnimatedProgressBar progress={g.percent} color={g.color} height={6} />
                  </View>
                ))}
              </View>
            </View>
          </FadeSlideIn>

          {/* Bloom Cognitive Levels */}
          <FadeSlideIn delay={200} duration={500}>
            <View style={st.card}>
              <View style={st.cardHeaderRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="sparkles" size={18} color="#7C3AED" />
                  <Text style={st.cardHeading}>Cấp Độ Nhận Thức Bloom</Text>
                </View>
                <Badge label="AI ADAPTIVE" variant="ai" />
              </View>
              <Text style={st.cardDesc}>Khả năng giải quyết câu hỏi phân loại theo độ khó.</Text>

              <View style={{ gap: 10, marginTop: 4 }}>
                {BLOOM_LEVELS.map((b, idx) => (
                  <View key={idx} style={{ gap: 4 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: tokens.color.ink }}>
                        {b.level}
                      </Text>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: b.color }}>
                        {b.rate}% Đạt
                      </Text>
                    </View>
                    <AnimatedProgressBar progress={b.rate} color={b.color} height={6} />
                  </View>
                ))}
              </View>
            </View>
          </FadeSlideIn>

          {/* Detailed Class Breakdown Cards */}
          <Text style={st.sectionTitle}>Báo Cáo Từng Lớp Học Phần</Text>
          {CLASS_REPORTS.map((c, idx) => (
            <StaggerPop key={c.id} index={idx} baseDelay={100} staggerStep={60}>
              <View style={st.classCard}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.className}>{c.name}</Text>
                    <Text style={st.classCourse}>{c.course}</Text>
                  </View>
                  <Badge label={`${c.students} SV`} variant="neutral" />
                </View>

                <View style={st.classStatsRow}>
                  <View style={st.classStatCol}>
                    <Text style={st.classStatVal}>{c.submissionRate}%</Text>
                    <Text style={st.classStatLbl}>Nộp bài</Text>
                  </View>
                  <View style={st.classStatCol}>
                    <Text style={[st.classStatVal, { color: c.pending > 0 ? "#D97706" : "#059669" }]}>
                      {c.pending} bài
                    </Text>
                    <Text style={st.classStatLbl}>Chờ chấm</Text>
                  </View>
                  <View style={st.classStatCol}>
                    <Text style={[st.classStatVal, { color: "#0284C7" }]}>{c.avgScore} / 10</Text>
                    <Text style={st.classStatLbl}>Điểm TB</Text>
                  </View>
                  <View style={st.classStatCol}>
                    <Text style={[st.classStatVal, { color: "#15803D" }]}>{c.attendanceRate}%</Text>
                    <Text style={st.classStatLbl}>Chuyên cần</Text>
                  </View>
                </View>
              </View>
            </StaggerPop>
          ))}

          {/* Export Action */}
          <Button
            label={exported ? "✓ Đã xuất báo cáo CSV" : "📥 Xuất Báo Cáo Tổng Hợp (CSV)"}
            variant="primary"
            onPress={handleExport}
          />
        </ScrollView>
      </Page>

      <BottomNavBar
        currentRoute="teaching"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 10,
    ...tokens.shadow.subtle,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardHeading: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  cardDesc: {
    fontSize: 12,
    color: tokens.color.muted,
    marginTop: -4,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  kpiCard: {
    width: "48%",
    backgroundColor: tokens.color.surface,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 3,
    ...tokens.shadow.subtle,
  },
  kpiIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  kpiValue: {
    fontSize: 17,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  kpiLabel: {
    fontSize: 11,
    color: tokens.color.muted,
    fontWeight: "600",
  },
  kpiSub: {
    fontSize: 11,
    color: tokens.color.muted,
    marginTop: 1,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
    marginTop: 4,
  },
  classCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 10,
    ...tokens.shadow.subtle,
  },
  className: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  classCourse: {
    fontSize: 11,
    color: tokens.color.muted,
    marginTop: 2,
  },
  classStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  classStatCol: {
    alignItems: "center",
    gap: 2,
  },
  classStatVal: {
    fontSize: 13,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  classStatLbl: {
    fontSize: 10,
    color: tokens.color.muted,
    fontWeight: "600",
  },
});
