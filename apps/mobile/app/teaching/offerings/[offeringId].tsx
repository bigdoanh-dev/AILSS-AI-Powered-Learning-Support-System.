import { useEffect, useState, useCallback } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError, record, string } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { CONTRACT_LIMITED } from "../../../src/teaching";
import { Page, Button, styles } from "../../../src/ui";
import { RevenueQuote } from "../../../src/RevenueQuote";

interface OfferingDetail {
  offeringId: string;
  courseId: string;
  offeringType: string;
  state: string;
  price?: string;
  currency?: string;
}

function decodeOffering(value: unknown): OfferingDetail {
  const rec = record(value);
  return {
    offeringId: string(rec.offeringId),
    courseId: string(rec.courseId),
    offeringType: string(rec.offeringType),
    state: string(rec.state),
    price: typeof rec.price === "string" ? rec.price : undefined,
    currency: typeof rec.currency === "string" ? rec.currency : undefined,
  };
}

export default function OfferingDetailScreen() {
  const { offeringId } = useLocalSearchParams<{ offeringId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [offering, setOffering] = useState<OfferingDetail | null>(null);
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => Crypto.randomUUID());
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!offeringId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setError("");
    void session
      .request(`/api/v1/offerings/${offeringId}`, { signal: abort.signal })
      .then((value) => {
        if (abort.signal.aborted) return;
        const o = decodeOffering(value);
        setOffering(o);
        setPrice(o.price ?? "");
        setCurrency(o.currency ?? "");
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(e instanceof ApiError ? e.message : "Không thể tải offering.");
      });
    return () => abort.abort();
  }, [offeringId, session, snapshot.user?.userId, retry]);

  const handleUpdate = useCallback(async () => {
    if (!offeringId || !offering || offering.state !== "DRAFT") return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body: Record<string, unknown> = {};
      if (price !== (offering.price ?? "")) body.price = price;
      if (currency !== (offering.currency ?? "")) body.currency = currency;
      if (Object.keys(body).length === 0) {
        setMessage("Không có thay đổi.");
        return;
      }
      await session.request(`/api/v1/offerings/${offeringId}`, {
        method: "PATCH",
        body,
        idempotencyKey,
      });
      setMessage("Đã lưu thành công.");
      setIdempotencyKey(Crypto.randomUUID());
      setRetry((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không thể lưu thay đổi.");
    } finally {
      setBusy(false);
    }
  }, [offeringId, offering, price, currency, session, idempotencyKey]);

  const handlePublish = useCallback(async () => {
    if (!offeringId || !offering || offering.state !== "DRAFT") return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await session.request(`/api/v1/offerings/${offeringId}/publish`, {
        method: "POST",
        idempotencyKey,
      });
      setMessage("Đã xuất bản offering.");
      setIdempotencyKey(Crypto.randomUUID());
      setRetry((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không thể xuất bản offering.");
    } finally {
      setBusy(false);
    }
  }, [offeringId, offering, session, idempotencyKey]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <Page>
      <Text style={styles.title}>Chi tiết Offering</Text>

      {!offering && !error && (
        <Text accessibilityRole="alert" style={styles.text}>
          Đang tải…
        </Text>
      )}

      {offering && (
        <>
          <View style={styles.card}>
            <Text style={styles.text}>Loại: {offering.offeringType}</Text>
            <Text style={styles.text}>Trạng thái: {offering.state}</Text>
            <Text style={styles.small}>Course: {offering.courseId}</Text>
          </View>

          {offering.state === "DRAFT" && (
            <>
              <Text style={styles.small}>Giá</Text>
              <TextInput
                accessibilityLabel="Giá"
                style={styles.input}
                value={price}
                onChangeText={setPrice}
                keyboardType="numeric"
              />
              <Text style={styles.small}>Đơn vị tiền tệ</Text>
              <TextInput
                accessibilityLabel="Đơn vị tiền tệ"
                style={styles.input}
                value={currency}
                onChangeText={setCurrency}
                placeholder="VND"
              />
              <RevenueQuote price={price} currency={currency || "VND"} />
              <Button
                label={busy ? "Đang lưu…" : "Lưu thay đổi"}
                disabled={busy}
                onPress={() => {
                  void handleUpdate();
                }}
              />
              <Button
                label={busy ? "Đang xuất bản…" : "Xuất bản Offering"}
                disabled={busy}
                onPress={() => {
                  void handlePublish();
                }}
              />
            </>
          )}

          <Text style={styles.small}>{CONTRACT_LIMITED.offeringDelete}</Text>
        </>
      )}

      {message && <Text style={styles.text}>{message}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {error && <Button label="Thử lại" onPress={() => setRetry((v) => v + 1)} />}
      <Button label="Quay lại" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
    </Page>
  );
}
