import { useLanguage } from "../../../src/use-language";
import { useUiText, interfaceMessage, type InterfaceMessage } from "../../../src/use-language";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import {
  adminReport,
  payouts,
  preparePayouts,
  readCommission,
  saveCommission,
  percent,
  vnd,
  type AdminReport,
  type Commission,
  type Payouts,
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

export default function AdminRevenueDashboard() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [range, setRange] = useState<(typeof ranges)[number]["key"]>("30d");
  const [report, setReport] = useState<AdminReport | null>(null);
  const [policy, setPolicy] = useState<Commission | null>(null);
  const [percentInput, setPercentInput] = useState("");
  const [payout, setPayout] = useState<Payouts | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<InterfaceMessage>("");
  const [message, setMessage] = useState<InterfaceMessage>("");

  const load = useCallback(async () => {
    if (snapshot.user?.role !== "ADMIN") return;
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      session.request(`/api/v1/admin/dashboard/revenue?range=${range}`).then(adminReport),
      readCommission(session, "ADMIN"),
      session.request("/api/v1/admin/payouts").then(payouts),
    ]);
    if (results[0]?.status === "fulfilled") setReport(results[0].value);
    else {
      setReport(null);
      setError("Báo cáo doanh thu chưa sẵn sàng hoặc kết nối thất bại.");
    }
    if (results[1]?.status === "fulfilled") {
      setPolicy(results[1].value);
      setPercentInput(String(results[1].value.basisPoints / 100));
    } else {
      setPolicy(null);
      setError((value) =>
        interfaceMessage("{0} {1}", [value, interfaceMessage("Không tải được tỷ lệ chiết khấu.")]),
      );
    }
    if (results[2]?.status === "fulfilled") setPayout(results[2].value);
    else {
      setPayout(null);
      setError((value) =>
        interfaceMessage("{0} {1}", [value, interfaceMessage("Không tải được phiếu chi.")]),
      );
    }
    setLoading(false);
  }, [range, session, snapshot.user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateCommission() {
    if (!policy) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await saveCommission(session, policy, percentInput, Crypto.randomUUID());
      setPolicy(updated);
      setPercentInput(String(updated.basisPoints / 100));
      setMessage(interfaceMessage("Đã áp dụng chiết khấu {0}% cho đơn mới.", [updated.basisPoints / 100]));
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "Không thể lưu tỷ lệ.");
      void readCommission(session, "ADMIN")
        .then((latest) => {
          setPolicy(latest);
          setPercentInput(String(latest.basisPoints / 100));
        })
        .catch(() => {});
    } finally {
      setSaving(false);
    }
  }
  async function prepare(lecturerId?: string) {
    setPreparing(true);
    setMessage("");
    try {
      const result = await preparePayouts(session, lecturerId, Crypto.randomUUID());
      setPayout((current) => ({
        ...result,
        canPrepare: current?.canPrepare ?? false,
        candidates: current?.candidates ?? [],
      }));
      setMessage(
        interfaceMessage("Đã lập phiếu kỳ {0}. Cần chuyển khoản và đối chiếu riêng.{1}", [
          result.month,
          result.skipped.length
            ? interfaceMessage(" {0} người chưa đủ điều kiện.", [result.skipped.length])
            : "",
        ]),
      );
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : "Không thể lập phiếu chi.");
    } finally {
      setPreparing(false);
    }
  }

  if (snapshot.user?.role !== "ADMIN")
    return (
      <Page>
        <ScreenHeader title="Dashboard Doanh thu" onBack={() => router.replace("/")} />
        <Text style={styles.error}>{uiText("Chức năng này yêu cầu quyền Quản trị viên.")}</Text>
      </Page>
    );
  const topCourses =
    report?.lecturers
      .flatMap((lecturer) => lecturer.courses)
      .sort((a, b) =>
        BigInt(b.netMinor) > BigInt(a.netMinor) ? 1 : BigInt(b.netMinor) < BigInt(a.netMinor) ? -1 : 0,
      )
      .slice(0, 5) ?? [];
  const maxDay =
    report?.dailyRevenue.reduce(
      (max, day) => (BigInt(day.netMinor) > max ? BigInt(day.netMinor) : max),
      1n,
    ) ?? 1n;
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title={uiText("Doanh thu & chiết khấu")}
          subtitle={uiText("Dữ liệu đã đối soát từ thanh toán và hoàn tiền")}
          onBack={() => router.replace("/admin")}
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
        <View style={card}>
          <Text style={styles.title}>{uiText("Chiết khấu nền tảng")}</Text>
          {policy ? (
            <>
              <Text style={styles.text}>
                {uiText("Hiện tại ")}
                {percent(policy.basisPoints, uiLocale)} {uiText(" · Giảng viên nhận")}{" "}
                {percent(10_000 - policy.basisPoints, uiLocale)}
              </Text>
              <Text style={styles.small}>
                {uiText("Hiệu lực từ ")}
                {new Date(policy.effectiveAt).toLocaleString(uiLocale)}
                {uiText(". Đơn cũ giữ tỷ lệ lúc mua.")}
              </Text>
              <TextInput
                accessibilityLabel={uiText("Chiết khấu phần trăm")}
                style={styles.input}
                keyboardType="decimal-pad"
                value={percentInput}
                onChangeText={setPercentInput}
                placeholder="0–50"
              />
              <Button
                label={saving ? uiText("Đang lưu…") : uiText("Lưu tỷ lệ")}
                disabled={saving}
                onPress={() => void updateCommission()}
              />
            </>
          ) : (
            <Text style={styles.small}>{uiText("Chưa tải được chính sách chiết khấu.")}</Text>
          )}
        </View>
        {message ? (
          <Text accessibilityLiveRegion="polite" style={styles.text}>
            {uiText(message)}
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
        {report ? (
          <>
            <View style={card}>
              <Text style={styles.title}>{uiText("Tổng quan doanh thu")}</Text>
              <Text style={styles.text}>
                {uiText("Thanh toán: ")}
                {vnd(report.grossMinor, uiLocale)} · {report.orderCount} {uiText(" đơn")}
              </Text>
              <Text style={styles.text}>
                {uiText("Hoàn tiền: ")}
                {vnd(report.refundMinor, uiLocale)} · {report.refundCount} {uiText(" giao dịch")}
              </Text>
              <Text style={styles.text}>
                {uiText("Sau hoàn tiền: ")}
                {vnd(report.netMinor, uiLocale)}
              </Text>
              <Text style={styles.text}>
                {uiText("Dự kiến trả giảng viên:")}{" "}
                {vnd(
                  report.lecturers.reduce((sum, item) => sum + BigInt(item.estimatedEarningsMinor), 0n),
                  uiLocale,
                )}
              </Text>
              <Text style={styles.small}>
                {uiText("Đối soát đến ")}
                {new Date(report.backfillThrough).toLocaleDateString(uiLocale)}
              </Text>
            </View>
            <View style={card}>
              <Text style={styles.title}>{uiText("Doanh thu theo ngày")}</Text>
              {report.dailyRevenue.map((day) => (
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
              {topCourses.length ? (
                topCourses.map((course) => (
                  <Text key={course.courseId} style={styles.text}>
                    {course.title} · {vnd(course.netMinor, uiLocale)} · {course.orders} {uiText(" đơn")}
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
          <Text style={styles.title}>
            {uiText("Phiếu chi kỳ ")}
            {payout?.month ?? "trước"}
          </Text>
          <Text style={styles.small}>
            {uiText(
              "Lập phiếu cho một người hoặc tất cả giảng viên. Phiếu chờ chuyển khoản thủ công; thao tác này chưa chuyển tiền.",
            )}
          </Text>
          <Button
            label={preparing ? uiText("Đang lập…") : uiText("Lập phiếu chi tất cả")}
            disabled={preparing || !payout?.canPrepare}
            onPress={() => void prepare()}
          />
          {payout?.canPrepare === false ? (
            <Text style={styles.small}>
              {uiText("Có thể lập phiếu sau ngày 7 để chờ hết thời hạn hoàn tiền.")}
            </Text>
          ) : null}
          {payout?.candidates.map((candidate) => {
            const instruction = payout.instructions.find((item) => item.lecturerId === candidate.lecturerId);
            return (
              <View
                key={candidate.lecturerId}
                style={{ gap: 5, borderTopWidth: 1, borderColor: tokens.color.border, paddingTop: 8 }}
              >
                <Text style={styles.text}>
                  {uiText("Mã giảng viên ")}
                  {candidate.lecturerId} · {vnd(candidate.estimatedEarningsMinor, uiLocale)}
                </Text>
                <Text style={styles.small}>
                  {instruction
                    ? `${instruction.bankName} · ${instruction.accountNumber} · ${instruction.status}`
                    : candidate.accountConfigured
                      ? uiText("Chưa lập phiếu")
                      : uiText("Chưa có tài khoản nhận tiền")}
                </Text>
                <Button
                  label={instruction ? uiText("Đã lập phiếu") : uiText("Lập phiếu chi")}
                  disabled={preparing || !payout.canPrepare || !candidate.accountConfigured || !!instruction}
                  onPress={() => void prepare(candidate.lecturerId)}
                />
              </View>
            );
          })}
        </View>
      </Page>
    </View>
  );
}
