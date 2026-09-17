import { useEffect, useState, useCallback } from "react";
import { Text, View, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import {
  aiJobs,
  aiUsage,
  AI_JOB_STATE_COPY,
  type AiJob,
  type AiJobState,
  type AiUsage,
  type CognitiveLevel,
} from "../../../src/ai-authoring";
import { Page, Button, ScreenHeader, NonVirtualizedList, styles, tokens } from "../../../src/ui";

export default function LecturerAiStudioScreen() {
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  // Target & Document inputs
  const [targetType, setTargetType] = useState<"COURSE" | "CLASS">(
    params.targetType === "CLASS" ? "CLASS" : "COURSE",
  );
  const [targetId, setTargetId] = useState(params.targetId ?? "");
  const [documentId, setDocumentId] = useState("");

  // Cognitive distribution state
  const [distribution, setDistribution] = useState<Record<CognitiveLevel, number>>({
    RECOGNITION: 4,
    UNDERSTANDING: 4,
    APPLICATION: 2,
    ADVANCED_APPLICATION: 0,
  });

  // Data states
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [jobs, setJobs] = useState<AiJob[] | null>(null);
  const [filter, setFilter] = useState<string>("AI_DRAFT");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  const totalQuestions =
    (distribution.RECOGNITION || 0) +
    (distribution.UNDERSTANDING || 0) +
    (distribution.APPLICATION || 0) +
    (distribution.ADVANCED_APPLICATION || 0);

  const currentMonth = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setLoading(true);
    setError("");

    Promise.all([
      session.request("/api/v1/ai/usage", { signal: abort.signal }).catch(() => null),
      session
        .request(`/api/v1/ai/jobs?state=${filter}&month=${currentMonth}`, { signal: abort.signal })
        .catch(() => null),
    ])
      .then(([usageData, jobsData]) => {
        if (abort.signal.aborted) return;
        if (usageData) setUsage(aiUsage(usageData));
        if (jobsData) setJobs(aiJobs(jobsData));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setError(e instanceof ApiError ? e.message : "Không thể tải dữ liệu AI Studio.");
          setLoading(false);
        }
      });

    return () => abort.abort();
  }, [session, retry, filter, snapshot.user?.role]);

  const handleCreateJob = async () => {
    if (!targetId.trim()) {
      setError("Vui lòng nhập mã đối tượng (Target ID).");
      return;
    }
    if (!documentId.trim()) {
      setError("Vui lòng nhập mã tài liệu (Document ID).");
      return;
    }
    if (totalQuestions < 1 || totalQuestions > 50) {
      setError("Tổng số câu hỏi phải từ 1 đến 50 câu.");
      return;
    }

    setGenerating(true);
    setError("");

    try {
      const res = (await session.request("/api/v1/ai/quiz-jobs", {
        method: "POST",
        body: {
          targetType,
          targetId: targetId.trim(),
          documentId: documentId.trim(),
          numberOfQuestions: totalQuestions,
          cognitiveDistribution: distribution,
        },
      })) as { jobId: string; data?: { jobId: string } };

      const newJobId = res.jobId || res.data?.jobId;
      setGenerating(false);
      if (newJobId) {
        router.push(`/teaching/ai/${newJobId}` as Href);
      }
    } catch (e: unknown) {
      setGenerating(false);
      setError(e instanceof ApiError ? e.message : "Không thể tạo yêu cầu AI sinh câu hỏi.");
    }
  };

  const filteredJobs = jobs?.filter((j) => (filter === "ALL" ? true : j.state === filter));

  const handleRefresh = useCallback(() => {
    setRetry((v) => v + 1);
  }, []);

  return (
    <Page>
      <ScreenHeader
        title="Trợ lý soạn đề AI"
        subtitle="Sinh bản nháp câu hỏi trắc nghiệm từ tài liệu học tập"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching"))}
      />

      {/* Daily Usage Quota Card */}
      {usage && (
        <View style={s.usageCard}>
          <Text style={s.usageTitle}>Mức sử dụng hôm nay</Text>
          <View style={s.usageRow}>
            <Text style={s.usageBig}>
              {usage.remaining} <Text style={s.usageSub}>/ {usage.limit} câu còn lại</Text>
            </Text>
            <Text style={s.usageMeta}>
              {usage.consumed} đã dùng · {usage.reserved} đang xử lý
            </Text>
          </View>
        </View>
      )}

      {/* Generation Form */}
      <View style={s.formCard}>
        <Text style={s.sectionTitle}>Tạo câu hỏi từ tài liệu</Text>

        <Text style={s.fieldLabel}>Đối tượng liên kết:</Text>
        <View style={s.row}>
          <Button
            label={targetType === "COURSE" ? "● Khóa học" : "○ Khóa học"}
            onPress={() => setTargetType("COURSE")}
          />
          <Button
            label={targetType === "CLASS" ? "● Lớp học" : "○ Lớp học"}
            onPress={() => setTargetType("CLASS")}
          />
        </View>

        <Text style={s.fieldLabel}>Mã đối tượng (Target ID) *</Text>
        <TextInput
          accessibilityLabel="Mã đối tượng"
          style={s.input}
          placeholder="Mã khóa học hoặc lớp học"
          value={targetId}
          onChangeText={setTargetId}
          autoCapitalize="none"
        />

        <Text style={s.fieldLabel}>Mã tài liệu học tập (Document ID) *</Text>
        <TextInput
          accessibilityLabel="Mã tài liệu"
          style={s.input}
          placeholder="Nhập documentId đã tải lên"
          value={documentId}
          onChangeText={setDocumentId}
          autoCapitalize="none"
        />

        {/* Presets */}
        <Text style={s.fieldLabel}>Mẫu phân bổ câu hỏi:</Text>
        <View style={s.presetRow}>
          <Pressable
            accessibilityRole="button"
            style={s.presetChip}
            onPress={() =>
              setDistribution({
                RECOGNITION: 4,
                UNDERSTANDING: 4,
                APPLICATION: 2,
                ADVANCED_APPLICATION: 0,
              })
            }
          >
            <Text style={s.presetText}>Ôn tập nhanh (10 câu)</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={s.presetChip}
            onPress={() =>
              setDistribution({
                RECOGNITION: 4,
                UNDERSTANDING: 6,
                APPLICATION: 6,
                ADVANCED_APPLICATION: 4,
              })
            }
          >
            <Text style={s.presetText}>Kiểm tra (20 câu)</Text>
          </Pressable>
        </View>

        <Text style={s.totalText}>
          Tổng số câu hỏi: <Text style={{ fontWeight: "700" }}>{totalQuestions} câu</Text>
        </Text>

        <Button
          label={generating ? "Đang gửi yêu cầu…" : "Tạo bản nháp câu hỏi"}
          onPress={() => void handleCreateJob()}
        />
      </View>

      {error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{error}</Text>
          <Button label="Thử lại" onPress={handleRefresh} />
        </View>
      ) : null}

      {/* Jobs List Section */}
      <View style={s.jobsHeader}>
        <Text style={s.sectionTitle}>Công việc của tôi</Text>
      </View>

      {/* Filter Chips */}
      <View style={s.filterRow}>
        {["AI_DRAFT", "APPROVED", "PROCESSING", "FAILED"].map((stateKey) => (
          <Pressable
            key={stateKey}
            accessibilityRole="button"
            style={[s.filterChip, filter === stateKey && s.filterChipActive]}
            onPress={() => setFilter(stateKey)}
          >
            <Text style={[s.filterText, filter === stateKey && s.filterTextActive]}>
              {AI_JOB_STATE_COPY[stateKey as AiJobState] ?? stateKey}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && (
        <View style={s.loadingBox}>
          <ActivityIndicator color={tokens.color.brand} />
          <Text style={styles.small}>Đang tải danh sách công việc…</Text>
        </View>
      )}

      {!loading && filteredJobs && filteredJobs.length === 0 && (
        <View style={s.emptyBox}>
          <Text style={styles.text}>Không có công việc nào.</Text>
        </View>
      )}

      {!loading && filteredJobs && filteredJobs.length > 0 && (
        <NonVirtualizedList
          data={filteredJobs}
          keyExtractor={(item) => item.jobId}
          contentContainerStyle={{ gap: 10 }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Công việc ${item.jobId}`}
              style={s.jobCard}
              onPress={() => router.push(`/teaching/ai/${item.jobId}` as Href)}
            >
              <View style={s.rowBetween}>
                <Text style={s.jobTitle} numberOfLines={1}>
                  Mã: {item.jobId.slice(0, 12)}...
                </Text>
                <View
                  style={[
                    s.stateBadge,
                    item.state === "AI_DRAFT"
                      ? s.badgeDraft
                      : item.state === "APPROVED"
                        ? s.badgeApproved
                        : item.state === "FAILED"
                          ? s.badgeFailed
                          : s.badgeProcessing,
                  ]}
                >
                  <Text style={s.badgeText}>{AI_JOB_STATE_COPY[item.state] ?? item.state}</Text>
                </View>
              </View>

              <Text style={styles.small}>
                {item.targetType === "COURSE" ? "Khóa học" : "Lớp học"}: {item.targetId.slice(0, 12)}...
              </Text>
              <Text style={styles.small}>
                Tạo lúc: {new Date(item.createdAt).toLocaleTimeString("vi-VN")},{" "}
                {new Date(item.createdAt).toLocaleDateString("vi-VN")}
              </Text>

              <Text style={s.linkText}>
                {item.state === "AI_DRAFT" ? "Xem và duyệt câu hỏi →" : "Xem chi tiết tiến trình →"}
              </Text>
            </Pressable>
          )}
        />
      )}

      <Button label="Quay lại Giảng dạy" onPress={() => router.replace("/teaching")} />
    </Page>
  );
}

const s = StyleSheet.create({
  usageCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    gap: 4,
    marginVertical: 4,
  },
  usageTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  usageRow: {
    gap: 2,
  },
  usageBig: {
    fontSize: 20,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  usageSub: {
    fontSize: 14,
    fontWeight: "400",
    color: tokens.color.muted,
  },
  usageMeta: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  formCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 10,
    marginVertical: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    backgroundColor: "#fafafa",
    color: tokens.color.ink,
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  presetText: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  totalText: {
    fontSize: 13,
    color: tokens.color.ink,
  },
  jobsHeader: {
    marginTop: 12,
    marginBottom: 6,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  filterChipActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  filterText: {
    fontSize: 11,
    color: tokens.color.ink,
  },
  filterTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  loadingBox: {
    padding: 24,
    alignItems: "center",
    gap: 6,
  },
  emptyBox: {
    padding: 24,
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  jobCard: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 6,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  jobTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
    flex: 1,
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeDraft: { backgroundColor: "#fef3c7" },
  badgeApproved: { backgroundColor: "#dcfce7" },
  badgeFailed: { backgroundColor: "#fee2e2" },
  badgeProcessing: { backgroundColor: "#e0e7ff" },
  badgeText: { fontSize: 10, fontWeight: "700" },
  linkText: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.brand,
    marginTop: 2,
  },
});
