import { useState, useSyncExternalStore } from "react";
import { Text, View, StyleSheet, ScrollView, Alert } from "react-native";
import { router, type Href } from "expo-router";
import { runtime } from "../../src/runtime";
import { Page, Button, Icon, Badge, ScreenHeader, BottomNavBar, styles, tokens } from "../../src/ui";
import { ScalePressable, AnimatedNumber, AnimatedProgressBar, StaggerPop, FadeSlideIn } from "../../src/motion";

const STUDENT_BLOOM = [
  { level: "Nhận biết (Khái niệm & Thuật ngữ)", rate: 94, color: "#0284C7" },
  { level: "Thông hiểu (Giải thích & Nguyên lý)", rate: 88, color: "#7C3AED" },
  { level: "Vận dụng (Viết truy vấn SQL & Code)", rate: 82, color: "#D97706" },
  { level: "Phân tích (Tối ưu hóa Index & Plan)", rate: 70, color: "#059669" },
  { level: "Đánh giá & Sáng tạo", rate: 58, color: "#DC2626" },
];

const STUDENT_COURSES = [
  {
    id: "c1",
    title: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa",
    percent: 78,
    completedLessons: 18,
    totalLessons: 24,
    avgScore: 8.8,
    nextLesson: "Bài 5: Phân tích Query Execution Plan trong PostgreSQL",
  },
  {
    id: "c2",
    title: "Lập trình Web & Trợ lý AI Fullstack",
    percent: 62,
    completedLessons: 14,
    totalLessons: 22,
    avgScore: 8.2,
    nextLesson: "Bài 4: Tích hợp Vector Database & LLM Agent",
  },
];

const RECENT_QUIZZES = [
  {
    title: "Trắc nghiệm AI: Chuẩn hóa 3NF & BCNF",
    course: "CSDL Nâng cao",
    score: 9.5,
    maxScore: 10,
    status: "EXCELLENT",
    date: "16/09/2026",
  },
  {
    title: "Lab 03: REST API & LangChain",
    course: "Web & AI",
    score: 8.5,
    maxScore: 10,
    status: "GOOD",
    date: "15/09/2026",
  },
  {
    title: "Trắc nghiệm: Index Scan vs Index Seek",
    course: "CSDL Nâng cao",
    score: 8.0,
    maxScore: 10,
    status: "GOOD",
    date: "14/09/2026",
  },
];

export default function StudentProgressReportScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [exported, setExported] = useState(false);

  const handleExport = () => {
    setExported(true);
    Alert.alert(
      "Xuất bảng kết quả thành công",
      "Bảng tổng hợp điểm số, tỷ lệ chuyên cần và năng lực nhận thức Bloom đã được lưu thành công."
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Báo Cáo Tiến Độ & Năng Lực"
          subtitle="Thống kê học tập, năng lực Bloom và kết quả bài thi"
          onBack={() => router.replace("/" as Href)}
        />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>
          {/* 4 KPIs */}
          <FadeSlideIn duration={500}>
            <View style={st.kpiGrid}>
              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#E0F2FE" }]}>
                  <Icon name="chart" size={18} color="#0284C7" />
                </View>
                <AnimatedNumber value={76} suffix="%" style={[st.kpiValue, { color: "#0284C7" }]} />
                <Text style={st.kpiLabel}>Tiến độ môn học TB</Text>
                <Text style={st.kpiSub}>Hoàn thành 32 bài học</Text>
              </View>

              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#DCFCE7" }]}>
                  <Icon name="award" size={18} color="#15803D" />
                </View>
                <AnimatedNumber value={8.6} suffix=" / 10" decimals={1} style={[st.kpiValue, { color: "#15803D" }]} />
                <Text style={st.kpiLabel}>Điểm thi đánh giá TB</Text>
                <Text style={st.kpiSub}>Hạng Giỏi (Top 15%)</Text>
              </View>

              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#EDE9FE" }]}>
                  <Icon name="clock" size={18} color="#7C3AED" />
                </View>
                <AnimatedNumber value={24.5} suffix=" giờ" decimals={1} style={st.kpiValue} />
                <Text style={st.kpiLabel}>Thời lượng học tích lũy</Text>
                <Text style={st.kpiSub}>+4.5 giờ tuần này</Text>
              </View>

              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#FEF3C7" }]}>
                  <Icon name="check" size={18} color="#D97706" />
                </View>
                <AnimatedNumber value={7} suffix=" bài" style={st.kpiValue} />
                <Text style={st.kpiLabel}>Bài kiểm tra hoàn tất</Text>
                <Text style={st.kpiSub}>100% đạt yêu cầu</Text>
              </View>
            </View>
          </FadeSlideIn>

          {/* Bloom Cognitive Radar */}
          <FadeSlideIn delay={120} duration={500}>
            <View style={st.card}>
              <View style={st.cardHeaderRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="sparkles" size={18} color="#7C3AED" />
                  <Text style={st.cardHeading}>Ma Trận Năng Lực Bloom</Text>
                </View>
                <Badge label="AI ADAPTIVE" variant="ai" />
              </View>
              <Text style={st.cardDesc}>Tỷ lệ làm chủ kiến thức theo ngân hàng đề thi thích ứng.</Text>

              <View style={{ gap: 10, marginTop: 4 }}>
                {STUDENT_BLOOM.map((b, idx) => (
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

          {/* Courses Progress */}
          <Text style={st.sectionTitle}>Tiến Độ Khóa Học Đang Theo Học</Text>
          {STUDENT_COURSES.map((c, idx) => (
            <StaggerPop key={c.id} index={idx} baseDelay={80} staggerStep={60}>
              <View style={st.courseCard}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Text style={st.courseTitle}>{c.title}</Text>
                  <Badge label={`Điểm TB: ${c.avgScore}`} variant="primary" />
                </View>

                <View style={{ gap: 4, marginVertical: 6 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, color: tokens.color.muted }}>
                      {c.completedLessons}/{c.totalLessons} bài học hoàn tất
                    </Text>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: tokens.color.brand }}>
                      {c.percent}%
                    </Text>
                  </View>
                  <AnimatedProgressBar progress={c.percent} color={tokens.color.brand} height={6} />
                </View>

                <View style={st.nextLessonBox}>
                  <Icon name="sparkles" size={14} color="#0284C7" />
                  <Text style={st.nextLessonText} numberOfLines={1}>
                    Tiếp theo: {c.nextLesson}
                  </Text>
                </View>
              </View>
            </StaggerPop>
          ))}

          {/* Recent Quiz Scores */}
          <Text style={st.sectionTitle}>Kết Quả Bài Kiểm Tra Gần Nhất</Text>
          <View style={st.card}>
            {RECENT_QUIZZES.map((q, idx) => (
              <View
                key={idx}
                style={[
                  st.quizRow,
                  idx < RECENT_QUIZZES.length - 1 && { borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
                ]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.ink }}>
                    {q.title}
                  </Text>
                  <Text style={{ fontSize: 11, color: tokens.color.muted }}>
                    {q.course} • {q.date}
                  </Text>
                </View>

                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: "#059669" }}>
                    {q.score} / {q.maxScore}
                  </Text>
                  <Badge
                    label={q.status === "EXCELLENT" ? "Xuất sắc" : "Giỏi"}
                    variant={q.status === "EXCELLENT" ? "success" : "primary"}
                  />
                </View>
              </View>
            ))}
          </View>

          {/* Export Action */}
          <Button
            label={exported ? "✓ Đã xuất bảng kết quả" : "📥 Xuất Bảng Kết Quả Học Tập (PDF/CSV)"}
            variant="primary"
            onPress={handleExport}
          />
        </ScrollView>
      </Page>

      <BottomNavBar
        currentRoute="learn"
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
  courseCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 6,
    ...tokens.shadow.subtle,
  },
  courseTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
    flex: 1,
  },
  nextLessonBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0F9FF",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  nextLessonText: {
    fontSize: 11,
    color: "#0369A1",
    fontWeight: "500",
    flex: 1,
  },
  quizRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  },
});
