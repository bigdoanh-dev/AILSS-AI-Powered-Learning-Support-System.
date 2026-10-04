import { useLanguage } from "../../../src/use-language";
import { useUiText } from "../../../src/use-language";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, TextInput, View } from "react-native";
import { router, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../src/api";
import { reviewList } from "../../../src/interaction";
import { runtime } from "../../../src/runtime";
import {
  lecturerReport,
  payoutAccount,
  vnd,
  type LecturerReport,
  type PayoutAccount,
} from "../../../src/finance";
import { Button, Page, ScreenHeader, styles, tokens } from "../../../src/ui";

const ranges = [
  { key: "today", label: "Hôm nay" },
  { key: "7d", label: "7 ngày" },
  { key: "30d", label: "30 ngày" },
] as const;
const card = {
  backgroundColor: tokens.color.surface,
  borderColor: tokens.color.border,
  borderRadius: 14,
  borderWidth: 1,
  gap: 10,
  padding: 16,
} as const;

export default function LecturerRevenueScreen() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [range, setRange] = useState<(typeof ranges)[number]["key"]>("30d");
  const [report, setReport] = useState<LecturerReport | null>(null);
  const [ratings, setRatings] = useState<Record<string, string>>({});
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    if (snapshot.user?.role !== "LECTURER") return;
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      session.request(`/api/v1/me/dashboard/revenue?range=${range}`).then(lecturerReport),
      session.request("/api/v1/me/payout-account").then(payoutAccount),
    ]);
    if (results[0]?.status === "fulfilled") {
      setReport(results[0].value);
      const rated = await Promise.all(
        [...results[0].value.lecturer.courses]
          .sort((a, b) =>
            BigInt(b.netMinor) > BigInt(a.netMinor) ? 1 : BigInt(b.netMinor) < BigInt(a.netMinor) ? -1 : 0,
          )
          .slice(0, 8)
          .map(async (course) => {
            try {
              const summary = reviewList(
                await session.request(`/api/v1/courses/${course.courseId}/reviews?limit=1`, {
                  includeMeta: true,
                }),
              ).ratingSummary;
              return [
                course.courseId,
                summary.reviewCount
                  ? `${summary.average.toFixed(1)}/5 · ${summary.reviewCount} đánh giá`
                  : "Chưa có đánh giá",
              ] as const;
            } catch {
              return [course.courseId, "Chưa tải được đánh giá"] as const;
            }
          }),
      );
      setRatings(Object.fromEntries(rated));
    } else {
      setReport(null);
      setError("Báo cáo doanh thu chưa sẵn sàng hoặc kết nối thất bại.");
    }
    if (results[1]?.status === "fulfilled") {
      const value = results[1].value;
      setAccount(value);
      setBankName(value?.bankName ?? "");
      setAccountNumber(value?.accountNumber ?? "");
      setAccountHolder(value?.accountHolder ?? "");
    } else setError((value) => `${value} Không tải được tài khoản nhận tiền.`);
    setLoading(false);
  }, [range, session, snapshot.user?.role]);
  useEffect(() => {
    void load();
  }, [load]);
  async function saveAccount() {
    setMessage("");
    const input = {
      bankName: bankName.trim(),
      accountNumber: accountNumber.trim(),
      accountHolder: accountHolder.trim(),
    };
    if (
      !/^[\p{L}\p{N} .&-]{2,100}$/u.test(input.bankName) ||
      !/^[0-9]{6,24}$/u.test(input.accountNumber) ||
      !/^[\p{L} .'-]{2,100}$/u.test(input.accountHolder)
    ) {
      setMessage("Kiểm tra tên ngân hàng, chủ tài khoản và số tài khoản 6–24 chữ số.");
      return;
    }
    setSaving(true);
    try {
      const value = payoutAccount(
        await session.request("/api/v1/me/payout-account", {
          method: "POST",
          body: input,
          idempotencyKey: Crypto.randomUUID(),
        }),
      );
      setAccount(value);
      setMessage("Đã lưu tài khoản nhận tiền.");
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "Không thể lưu tài khoản nhận tiền.");
    } finally {
      setSaving(false);
    }
  }
  if (snapshot.user?.role !== "LECTURER")
    return (
      <Page>
        <ScreenHeader title={uiText("Doanh thu giảng viên")} onBack={() => router.replace("/")} />
        <Text style={styles.error}>{uiText("Chỉ giảng viên được xem báo cáo này.")}</Text>
      </Page>
    );
  const data = report?.lecturer;
  const maxDay =
    data?.dailyRevenue.reduce((max, day) => (BigInt(day.netMinor) > max ? BigInt(day.netMinor) : max), 1n) ??
    1n;
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title={uiText("Doanh thu giảng viên")}
          subtitle={uiText("Thanh toán, hoàn tiền và khoản dự kiến nhận")}
          onBack={() => router.replace("/teaching" as Href)}
        />
        <Button
          label={loading ? uiText("Đang tải…") : uiText("Làm mới")}
          onPress={() => void load()}
          disabled={loading}
        />
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {uiText(error)}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {ranges.map((item) => (
            <Button
              key={item.key}
              label={item.label}
              variant={range === item.key ? "primary" : "outline"}
              onPress={() => setRange(item.key)}
            />
          ))}
        </View>
        {data ? (
          <>
            <View style={card}>
              <Text style={styles.title}>{uiText("Tổng quan")}</Text>
              <Text style={styles.text}>
                {uiText("Doanh thu bán khóa học: ")}
                {vnd(data.grossMinor, uiLocale)} · {data.orders} {uiText(" đơn")}
              </Text>
              <Text style={styles.text}>
                {uiText("Hoàn tiền: ")}
                {vnd(data.refundMinor, uiLocale)}
              </Text>
              <Text style={styles.text}>
                {uiText("Phí nền tảng ước tính: ")}
                {vnd(data.estimatedPlatformMinor, uiLocale)}
              </Text>
              <Text style={[styles.text, { fontWeight: "700" }]}>
                {uiText("Dự kiến nhận: ")}
                {vnd(data.estimatedEarningsMinor, uiLocale)}
              </Text>
              <Text style={styles.small}>
                {uiText("Đối soát đến ")}
                {new Date(report!.backfillThrough).toLocaleDateString(uiLocale)}
                {uiText("; tiền thực chi phụ thuộc kỳ thanh toán.")}
              </Text>
            </View>
            <View style={card}>
              <Text style={styles.title}>{uiText("Doanh thu theo ngày")}</Text>
              {data.dailyRevenue.map((day) => (
                <View key={day.day} style={{ gap: 3 }}>
                  <Text style={styles.small}>
                    {day.day} · {vnd(day.netMinor, uiLocale)}
                  </Text>
                  <View style={{ height: 10, borderRadius: 5, backgroundColor: tokens.color.border }}>
                    <View
                      style={{
                        height: 10,
                        borderRadius: 5,
                        width: `${Number(BigInt(day.netMinor) > 0n ? (BigInt(day.netMinor) * 100n) / maxDay : 0n)}%`,
                        backgroundColor: tokens.color.brand,
                      }}
                    />
                  </View>
                </View>
              ))}
            </View>
            <View style={card}>
              <Text style={styles.title}>{uiText("Khóa học doanh thu cao")}</Text>
              {data.courses.length ? (
                [...data.courses]
                  .sort((a, b) =>
                    BigInt(b.netMinor) > BigInt(a.netMinor)
                      ? 1
                      : BigInt(b.netMinor) < BigInt(a.netMinor)
                        ? -1
                        : 0,
                  )
                  .slice(0, 8)
                  .map((course) => (
                    <Text key={course.courseId} style={styles.text}>
                      {course.title} · {vnd(course.netMinor, uiLocale)} · {course.orders} {uiText(" đơn ·")}{" "}
                      {ratings[course.courseId] ?? "Đang tải đánh giá"}
                    </Text>
                  ))
              ) : (
                <Text style={styles.small}>{uiText("Chưa có doanh thu khóa học.")}</Text>
              )}
            </View>
          </>
        ) : (
          <View style={card}>
            <Text style={styles.text}>{uiText("Chưa có báo cáo doanh thu có thẩm quyền.")}</Text>
          </View>
        )}
        <View style={card}>
          <Text style={styles.title}>{uiText("Tài khoản nhận doanh thu")}</Text>
          <Text style={styles.small}>
            {account
              ? uiText("Đang dùng: {0} · {1}", [account.bankName, account.accountNumber])
              : uiText("Chưa cấu hình tài khoản nhận tiền.")}
          </Text>
          <TextInput
            accessibilityLabel={uiText("Tên ngân hàng")}
            style={styles.input}
            value={bankName}
            onChangeText={setBankName}
            placeholder={uiText("Ngân hàng")}
          />
          <TextInput
            accessibilityLabel={uiText("Số tài khoản")}
            style={styles.input}
            value={accountNumber}
            onChangeText={setAccountNumber}
            keyboardType="numeric"
            placeholder={uiText("Số tài khoản")}
          />
          <TextInput
            accessibilityLabel={uiText("Tên chủ tài khoản")}
            style={styles.input}
            value={accountHolder}
            onChangeText={setAccountHolder}
            placeholder={uiText("Tên chủ tài khoản")}
          />
          <Button
            label={saving ? uiText("Đang lưu…") : uiText("Lưu tài khoản")}
            disabled={saving}
            onPress={() => void saveAccount()}
          />
          {message ? (
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {uiText(message)}
            </Text>
          ) : null}
        </View>
      </Page>
    </View>
  );
}
