import { useState } from "react";
import { Share, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { record, string } from "../../../../src/api";
import { useMobileQuery } from "../../../../src/queries";
import { Page, ScreenHeader, Button, styles } from "../../../../src/ui";
function roster(value: unknown) {
  const items = Array.isArray(value) ? value : record(value).items;
  if (!Array.isArray(items)) throw new Error("Dữ liệu không hợp lệ.");
  return items.map((value) => {
    const r = record(value);
    return {
      studentId: string(r.studentId),
      name: typeof r.studentName === "string" ? r.studentName : "—",
      email: typeof r.email === "string" ? r.email : "—",
      enrolledAt: typeof r.enrolledAt === "string" ? r.enrolledAt : "",
      progress: r.progressPercent ?? "—",
      state: string(r.state),
    };
  });
}
export default function CourseRoster() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const query = useMobileQuery(courseId ? `/api/v1/courses/${courseId}/roster` : null, roster);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const items =
    query.data?.filter((r) =>
      [r.studentId, r.name, r.email].some((v) =>
        v.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi")),
      ),
    ) ?? [];
  async function share() {
    const cell = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
    try {
      await Share.share({
        title: "Học viên khóa học",
        message: [
          ["Mã học viên", "Họ tên", "Email", "Ngày ghi danh", "Tiến độ", "Trạng thái"],
          ...items.map((r) => [r.studentId, r.name, r.email, r.enrolledAt, r.progress, r.state]),
        ]
          .map((r) => r.map(cell).join(","))
          .join("\n"),
      });
    } catch {
      setError("Không thể chia sẻ CSV.");
    }
  }
  return (
    <Page>
      <ScreenHeader title="Học viên khóa học" onBack={() => router.back()} />
      <TextInput
        accessibilityLabel="Tìm học viên"
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Tên, email hoặc mã học viên"
      />
      <Button label="Chia sẻ CSV" disabled={!items.length} onPress={() => void share()} />
      {query.loading ? <Text>Đang tải…</Text> : null}
      {query.error || error ? <Text style={styles.error}>{query.error || error}</Text> : null}
      <Button label="Tải lại" onPress={query.retry} />
      {query.data?.length === 0 ? <Text>Chưa có học viên ghi danh.</Text> : null}
      {items.map((r) => (
        <View key={r.studentId} style={styles.card}>
          <Text style={styles.title}>{r.name}</Text>
          <Text>{r.email}</Text>
          <Text>
            {r.enrolledAt} · Tiến độ {String(r.progress)} · {r.state}
          </Text>
        </View>
      ))}
    </Page>
  );
}
