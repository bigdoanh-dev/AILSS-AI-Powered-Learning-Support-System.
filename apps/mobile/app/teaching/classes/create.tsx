import { useUiText } from "../../../src/use-language";
import { useState, useSyncExternalStore } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { ApiError, record } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { Page, Button, ScreenHeader, styles } from "../../../src/ui";

export default function CreateClass() {
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [name, setName] = useState("");
  const [maxMembers, setMaxMembers] = useState("100");
  const [classKind, setClassKind] = useState<"INSTITUTIONAL" | "PRIVATE">("INSTITUTIONAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ classId: string; joinCode: string } | null>(null);
  const [key, setKey] = useState(() => Crypto.randomUUID());

  async function create() {
    if (name.trim().length < 3 || name.trim().length > 160) {
      setError("Tên lớp cần từ 3 đến 160 ký tự.");
      return;
    }
    const capacity = Number(maxMembers);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
      setError("Sĩ số tối đa cần từ 1 đến 10.000.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = record(
        await session.request("/api/v1/classes", {
          method: "POST",
          idempotencyKey: key,
          body: { name: name.trim(), classKind, maxMembers: capacity },
        }),
      );
      if (typeof result.classId !== "string" || typeof result.joinCode !== "string")
        throw new ApiError("invalid");
      setCreated({ classId: result.classId, joinCode: result.joinCode });
      setKey(Crypto.randomUUID());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Không thể tạo lớp học.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <ScreenHeader title={uiText("Tạo lớp học")} onBack={() => router.replace("/teaching/classes")} />
      {snapshot.user?.role !== "LECTURER" ? (
        <Text style={styles.error}>{uiText("Chỉ giảng viên được tạo lớp.")}</Text>
      ) : created ? (
        <View style={[styles.card, { gap: 12 }]}>
          <Text style={styles.title}>{uiText("Lớp đã được tạo")}</Text>
          <Text style={styles.text}>
            {uiText("Mã tham gia: ")}
            {created.joinCode}
          </Text>
          <Text style={styles.small}>
            {uiText("Chia sẻ mã này riêng với học viên của trường hoặc tổ chức.")}
          </Text>
          <Button
            label={uiText("Quản lý lớp")}
            onPress={() => router.replace(`/teaching/classes/${created.classId}`)}
          />
        </View>
      ) : (
        <View style={[styles.card, { gap: 12 }]}>
          <Text style={styles.text}>{uiText("Tên lớp")}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={uiText("Ví dụ: CSDL nâng cao - Nhóm 01")}
          />
          <Text style={styles.text}>{uiText("Loại lớp")}</Text>
          <Button
            label={uiText("Trường / tổ chức {0}", [classKind === "INSTITUTIONAL" ? "✓" : ""])}
            variant="outline"
            onPress={() => setClassKind("INSTITUTIONAL")}
          />
          <Button
            label={uiText("Lớp riêng {0}", [classKind === "PRIVATE" ? "✓" : ""])}
            variant="outline"
            onPress={() => setClassKind("PRIVATE")}
          />
          <Text style={styles.text}>{uiText("Sĩ số tối đa")}</Text>
          <TextInput
            style={styles.input}
            value={maxMembers}
            onChangeText={setMaxMembers}
            keyboardType="number-pad"
          />
          <Text style={styles.small}>{uiText("Học viên tham gia bằng mã lớp sau khi tạo.")}</Text>
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {uiText(error)}
            </Text>
          ) : null}
          <Button
            label={busy ? uiText("Đang tạo…") : uiText("Tạo lớp")}
            disabled={busy}
            onPress={() => void create()}
          />
        </View>
      )}
    </Page>
  );
}
