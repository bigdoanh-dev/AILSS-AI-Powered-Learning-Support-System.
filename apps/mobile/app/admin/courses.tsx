import { useState } from "react";
import { Text, TextInput, Alert } from "react-native";
import { router } from "expo-router";
import { useMobileCommand } from "../../src/queries";
import { Page, ScreenHeader, Button, PasswordInput, styles } from "../../src/ui";
export default function CourseGovernance() {
  const [courseId, setCourseId] = useState("");
  const [password, setPassword] = useState("");
  const command = useMobileCommand();
  async function run(action: "publish" | "archive") {
    if (
      await command.run(`/api/v1/admin/courses/${courseId.trim()}/${action}`, { currentPassword: password })
    )
      setPassword("");
  }
  return (
    <Page>
      <ScreenHeader title="Duyệt khóa học" onBack={() => router.back()} />
      <Text>Mã khóa học do giảng viên gửi duyệt</Text>
      <TextInput
        accessibilityLabel="Mã khóa học"
        style={styles.input}
        autoCapitalize="none"
        value={courseId}
        onChangeText={setCourseId}
      />
      <Text>Mật khẩu quản trị để xác nhận</Text>
      <PasswordInput accessibilityLabel="Mật khẩu quản trị" value={password} onChangeText={setPassword} />
      <Button
        label="Xuất bản khóa đã duyệt"
        disabled={command.busy || !courseId || !password}
        onPress={() => void run("publish")}
      />
      <Button
        label="Lưu trữ khóa học"
        disabled={command.busy || !courseId || !password}
        onPress={() =>
          Alert.alert("Lưu trữ khóa học?", "Khóa học sẽ không còn xuất hiện trong danh mục công khai.", [
            { text: "Hủy", style: "cancel" },
            { text: "Lưu trữ", style: "destructive", onPress: () => void run("archive") },
          ])
        }
      />
      {command.message ? <Text accessibilityRole="alert">{command.message}</Text> : null}
      <Text style={styles.small}>
        Hệ thống kiểm tra quyền quản trị và trạng thái khóa trước khi thực hiện.
      </Text>
    </Page>
  );
}
