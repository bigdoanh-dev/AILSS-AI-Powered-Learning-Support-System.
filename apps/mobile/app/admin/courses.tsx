import { useUiText } from "../../src/use-language";
import { useState } from "react";
import { Text, TextInput, Alert } from "react-native";
import { router } from "expo-router";
import { useMobileCommand } from "../../src/queries";
import { Page, ScreenHeader, Button, PasswordInput, styles } from "../../src/ui";
export default function CourseGovernance() {
  const uiText = useUiText();
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
      <ScreenHeader title={uiText("Duyệt khóa học")} onBack={() => router.back()} />
      <Text>{uiText("Mã khóa học do giảng viên gửi duyệt")}</Text>
      <TextInput
        accessibilityLabel={uiText("Mã khóa học")}
        style={styles.input}
        autoCapitalize="none"
        value={courseId}
        onChangeText={setCourseId}
      />
      <Text>{uiText("Mật khẩu quản trị để xác nhận")}</Text>
      <PasswordInput
        accessibilityLabel={uiText("Mật khẩu quản trị")}
        value={password}
        onChangeText={setPassword}
      />
      <Button
        label={uiText("Xuất bản khóa đã duyệt")}
        disabled={command.busy || !courseId || !password}
        onPress={() => void run("publish")}
      />
      <Button
        label={uiText("Lưu trữ khóa học")}
        disabled={command.busy || !courseId || !password}
        onPress={() =>
          Alert.alert(
            uiText("Lưu trữ khóa học?"),
            uiText("Khóa học sẽ không còn xuất hiện trong danh mục công khai."),
            [
              { text: uiText("Hủy"), style: "cancel" },
              { text: uiText("Lưu trữ"), style: "destructive", onPress: () => void run("archive") },
            ],
          )
        }
      />
      {command.message ? <Text accessibilityRole="alert">{command.message}</Text> : null}
      <Text style={styles.small}>
        {uiText("Hệ thống kiểm tra quyền quản trị và trạng thái khóa trước khi thực hiện.")}
      </Text>
    </Page>
  );
}
