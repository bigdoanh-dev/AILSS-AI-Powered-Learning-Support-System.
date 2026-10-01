import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { record, string } from "../../../src/api";
import { useMobileCommand, useMobileQuery } from "../../../src/queries";
import { Page, Button, ScreenHeader, styles } from "../../../src/ui";
import { RevenueQuote } from "../../../src/RevenueQuote";
function decode(value: unknown) {
  const data = record(value);
  return {
    offeringId: string(data.offeringId),
    courseId: string(data.courseId),
    title: string(data.title),
    state: string(data.state),
    offeringType: string(data.offeringType),
    price: string(data.price),
    currency: string(data.currency),
    salesStartAt: typeof data.salesStartAt === "string" ? data.salesStartAt : "",
    salesEndAt: typeof data.salesEndAt === "string" ? data.salesEndAt : "",
  };
}
export default function OfferingDetailScreen() {
  const { offeringId } = useLocalSearchParams<{ offeringId: string }>();
  const query = useMobileQuery(offeringId ? `/api/v1/offerings/${offeringId}` : null, decode);
  const command = useMobileCommand();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("VND");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    setTitle(query.data?.title ?? "");
    setPrice(query.data?.price ?? "");
    setCurrency(query.data?.currency ?? "VND");
    setStart(query.data?.salesStartAt ?? "");
    setEnd(query.data?.salesEndAt ?? "");
  }, [query.data]);
  async function save() {
    try {
      setError("");
      const body = {
        title: title.trim(),
        price: price.trim(),
        currency: currency.trim().toUpperCase(),
        salesStartAt: start.trim() ? new Date(start).toISOString() : null,
        salesEndAt: end.trim() ? new Date(end).toISOString() : null,
      };
      if (body.salesStartAt && body.salesEndAt && body.salesEndAt <= body.salesStartAt)
        throw new Error("Kết thúc bán phải sau bắt đầu bán.");
      if (await command.run(`/api/v1/offerings/${offeringId}`, body, { method: "PATCH" })) query.retry();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Thông tin không hợp lệ.");
    }
  }
  async function publish() {
    if (await command.run(`/api/v1/offerings/${offeringId}/publish`, {})) query.retry();
  }
  return (
    <Page>
      <ScreenHeader
        title="Đợt mở bán"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/offerings"))}
      />
      {query.loading ? <Text>Đang tải…</Text> : null}
      {query.error ? (
        <View>
          <Text style={styles.error}>{query.error}</Text>
          <Button label="Thử lại" onPress={query.retry} />
        </View>
      ) : null}
      {query.data ? (
        <View style={styles.card}>
          <Text style={styles.title}>{query.data.title}</Text>
          <Text>
            {query.data.offeringType} · {query.data.state}
          </Text>
          <Text>
            {query.data.price} {query.data.currency}
          </Text>
          <Text style={styles.small}>
            Bán từ {query.data.salesStartAt || "không giới hạn"} đến{" "}
            {query.data.salesEndAt || "không giới hạn"}.
          </Text>
        </View>
      ) : null}
      {query.data?.state === "DRAFT" ? (
        <View style={styles.card}>
          <Text>Tên đợt bán</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Tên đợt bán"
            value={title}
            onChangeText={setTitle}
            maxLength={160}
          />
          <Text>Giá</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Giá"
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
          />
          <Text>Tiền tệ</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Tiền tệ"
            value={currency}
            onChangeText={setCurrency}
            maxLength={3}
          />
          <RevenueQuote price={price} currency={currency || "VND"} />
          <Text>Thời gian bán (ISO 8601 có múi giờ; để trống nếu không giới hạn)</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Bắt đầu bán"
            value={start}
            onChangeText={setStart}
          />
          <TextInput
            style={styles.input}
            accessibilityLabel="Kết thúc bán"
            value={end}
            onChangeText={setEnd}
          />
          <Button label="Lưu thay đổi" disabled={command.busy} onPress={() => void save()} />
          <Button label="Xuất bản đợt bán" disabled={command.busy} onPress={() => void publish()} />
        </View>
      ) : null}
      {error || command.message ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {error || command.message}
        </Text>
      ) : null}
    </Page>
  );
}
