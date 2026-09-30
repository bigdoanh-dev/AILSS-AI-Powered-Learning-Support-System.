import { useState, useCallback } from "react";
import { Text, TextInput } from "react-native";
import { router } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { Page, Button, ScreenHeader, styles } from "../../../src/ui";
import { RevenueQuote } from "../../../src/RevenueQuote";

function generateSlug(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "khoa-hoc"}-${Date.now().toString(36)}`;
}

export default function CreateCourse() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("10000000-0000-4000-8000-000000000001");
  const [priceType, setPriceType] = useState("FREE");
  const [price, setPrice] = useState("0");
  const [currency, setCurrency] = useState("VND");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => Crypto.randomUUID());

  const handleCreate = useCallback(async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const slug = generateSlug(title.trim());
      await session.request("/api/v1/courses", {
        method: "POST",
        body: {
          title: title.trim(),
          slug,
          description: description.trim() || undefined,
          categoryId: categoryId.trim() || "10000000-0000-4000-8000-000000000001",
          priceType: priceType || "FREE",
          price: priceType === "FREE" ? "0" : price.trim() || "0",
          currency: currency.trim() || "VND",
        },
        idempotencyKey,
      });
      setMessage("Đã tạo khóa học thành công.");
      setIdempotencyKey(Crypto.randomUUID());
      setTitle("");
      setDescription("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không thể tạo khóa học.");
    } finally {
      setBusy(false);
    }
  }, [title, description, categoryId, priceType, price, currency, session, idempotencyKey]);

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
      <ScreenHeader
        title="Tạo khóa học mới"
        subtitle="Thiết lập thông tin khóa học & mức học phí"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/courses"))}
      />

      <Text style={styles.small}>Tên khóa học *</Text>
      <TextInput
        accessibilityLabel="Tên khóa học"
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
      />

      <Text style={styles.small}>Mô tả</Text>
      <TextInput
        accessibilityLabel="Mô tả"
        style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={2000}
      />

      <Text style={styles.small}>Mã danh mục</Text>
      <TextInput
        accessibilityLabel="Mã danh mục"
        style={styles.input}
        value={categoryId}
        onChangeText={setCategoryId}
      />

      <Text style={styles.small}>Loại giá (FREE hoặc PAID)</Text>
      <TextInput
        accessibilityLabel="Loại giá"
        style={styles.input}
        value={priceType}
        onChangeText={setPriceType}
      />

      {priceType !== "FREE" && (
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
          />
        </>
      )}

      <RevenueQuote price={price} currency={currency} paid={priceType !== "FREE"} />

      <Button
        label={busy ? "Đang tạo…" : "Tạo khóa học"}
        disabled={busy || !title.trim()}
        onPress={() => {
          void handleCreate();
        }}
      />

      {message && <Text style={styles.text}>{message}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Button label="Quay lại" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
    </Page>
  );
}
