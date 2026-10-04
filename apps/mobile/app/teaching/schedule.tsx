import { useLanguage } from "../../src/use-language";
import { useUiText } from "../../src/use-language";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { runtime } from "../../src/runtime";
import { ApiError } from "../../src/api";
import { ownedClasses, classSessions, rangeForMonth, type ClassSession } from "../../src/teaching";
import { Page, Button, ScreenHeader, BottomNavBar, styles } from "../../src/ui";

type TeachingSession = ClassSession & { className: string };
export default function TeachingScheduleScreen() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [items, setItems] = useState<TeachingSession[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const identity = snapshot.user?.role === "LECTURER" ? snapshot.user.userId : null;
  useEffect(() => {
    const abort = new AbortController();
    setItems(null);
    setError("");
    if (identity)
      void (async () => {
        try {
          const classes = ownedClasses(
            await session.request("/api/v1/me/owned-classes", { signal: abort.signal }),
          );
          const range = rangeForMonth(month);
          const all: TeachingSession[] = [];
          // Bounded requests keep large organizations from overloading the gateway.
          let cursor = 0;
          await Promise.all(
            Array.from({ length: Math.min(3, classes.length) }, async () => {
              while (cursor < classes.length && !abort.signal.aborted) {
                const cls = classes[cursor++];
                const rows = classSessions(
                  await session.request(
                    `/api/v1/classes/${cls.classId}/sessions?from=${range.from}&to=${range.to}`,
                    { signal: abort.signal },
                  ),
                );
                all.push(...rows.map((row) => ({ ...row, classId: cls.classId, className: cls.name })));
              }
            }),
          );
          if (!abort.signal.aborted) setItems(all.sort((a, b) => a.startAt.localeCompare(b.startAt)));
        } catch (e) {
          if (!abort.signal.aborted)
            setError(e instanceof ApiError ? e.message : "Không thể tải lịch giảng dạy.");
        }
      })();
    return () => abort.abort();
  }, [identity, month, retry, session]);
  return (
    <Page>
      <ScreenHeader
        title={uiText("Lịch giảng dạy")}
        subtitle={uiText("Lịch từ các lớp bạn phụ trách")}
        onBack={() => router.replace("/teaching")}
      />
      {!identity ? (
        <Text style={styles.error}>{uiText("Bạn không có quyền truy cập.")}</Text>
      ) : (
        <>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Button
              label={uiText("Tháng trước")}
              onPress={() => setMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            />
            <Text>{month.toLocaleDateString(uiLocale, { month: "long", year: "numeric" })}</Text>
            <Button
              label={uiText("Tháng sau")}
              onPress={() => setMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            />
          </View>
          {error ? (
            <>
              <Text style={styles.error}>{uiText(error)}</Text>
              <Button label={uiText("Thử lại")} onPress={() => setRetry((v) => v + 1)} />
            </>
          ) : items === null ? (
            <Text>{uiText("Đang tải lịch giảng dạy…")}</Text>
          ) : items.length === 0 ? (
            <Text>{uiText("Chưa có buổi học trong tháng này. Tạo lớp và lập lịch để bắt đầu.")}</Text>
          ) : (
            items.map((item) => (
              <View key={item.sessionId} style={{ padding: 16, gap: 8 }}>
                <Text style={styles.title}>{item.title}</Text>
                <Text>{item.className}</Text>
                <Text>
                  {new Date(item.startAt).toLocaleString(uiLocale)} —{" "}
                  {new Date(item.endAt).toLocaleString(uiLocale)}
                </Text>
                <Text>
                  {item.mode === "ONLINE" ? uiText("Trực tuyến") : item.location || "Chưa có địa điểm"} ·{" "}
                  {item.status}
                </Text>
                <Button
                  label={uiText("Chi tiết buổi học")}
                  onPress={() => router.push(`/teaching/classes/${item.classId}/sessions/${item.sessionId}`)}
                />
              </View>
            ))
          )}
        </>
      )}
      <BottomNavBar
        currentRoute="/teaching/schedule"
        role="LECTURER"
        onNavigate={(route) => router.push(route as import("expo-router").Href)}
      />
    </Page>
  );
}
