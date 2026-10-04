import { useUiText } from "../../../src/use-language";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useMobileQuery, useMobileCommand } from "../../../src/queries";
import { lecturerCourses, ownedClasses } from "../../../src/teaching";
import { Page, ScreenHeader, Button, styles } from "../../../src/ui";
export default function CreateOffering() {
  const uiText = useUiText();
  const params = useLocalSearchParams<{ courseId?: string }>();
  const courses = useMobileQuery("/api/v1/me/owned-courses", lecturerCourses);
  const classes = useMobileQuery("/api/v1/me/owned-classes", ownedClasses);
  const [courseId, setCourseId] = useState(params.courseId ?? "");
  const [classId, setClassId] = useState("");
  const [type, setType] = useState<"SELF_PACED" | "LIVE_COHORT">("SELF_PACED");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("0");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const command = useMobileCommand();
  async function create() {
    try {
      setError("");
      if (
        !courses.data?.some((c) => c.courseId === courseId && c.state === "PUBLISHED") ||
        !title.trim() ||
        (type === "LIVE_COHORT" && !classId)
      )
        throw new Error("Chọn khóa học, nhập tên đợt bán và chọn lớp nếu học trực tiếp.");
      const body = {
        offeringType: type,
        title: title.trim(),
        price,
        currency: "VND",
        ...(type === "LIVE_COHORT" ? { classId } : {}),
        ...(start ? { salesStartAt: new Date(start).toISOString() } : {}),
        ...(end ? { salesEndAt: new Date(end).toISOString() } : {}),
      };
      if (await command.run(`/api/v1/courses/${courseId}/offerings`, body))
        router.replace("/teaching/offerings" as Href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Thông tin không hợp lệ.");
    }
  }
  return (
    <Page>
      <ScreenHeader title={uiText("Tạo đợt mở bán")} onBack={() => router.back()} />
      <Text>{uiText("Chọn khóa học đã xuất bản")}</Text>
      {courses.loading ? <Text>{uiText("Đang tải khóa học…")}</Text> : null}
      {courses.error ? (
        <View>
          <Text style={styles.error}>{uiText(courses.error)}</Text>
          <Button label={uiText("Thử tải khóa học")} onPress={courses.retry} />
        </View>
      ) : null}
      {courses.data && !courses.data.some((c) => c.state === "PUBLISHED") ? (
        <View>
          <Text>
            {uiText("Chưa có khóa học được xuất bản. Hãy gửi khóa học cho quản trị viên duyệt trước.")}
          </Text>
          <Button label={uiText("Khóa học của tôi")} onPress={() => router.push("/teaching/courses")} />
        </View>
      ) : null}
      {courses.data
        ?.filter((c) => c.state === "PUBLISHED")
        .map((c) => (
          <Button
            key={c.courseId}
            label={`${c.courseId === courseId ? "✓ " : ""}${c.title}`}
            onPress={() => {
              setCourseId(c.courseId);
              setPrice(c.price ?? "0");
            }}
          />
        ))}
      <View style={styles.card}>
        <Button
          label={uiText("Tự học {0}", [type === "SELF_PACED" ? "✓" : ""])}
          onPress={() => setType("SELF_PACED")}
        />
        <Button
          label={uiText("Học cùng lớp {0}", [type === "LIVE_COHORT" ? "✓" : ""])}
          onPress={() => setType("LIVE_COHORT")}
        />
      </View>
      {type === "LIVE_COHORT" ? (
        <View>
          {classes.error ? <Text style={styles.error}>{uiText(classes.error)}</Text> : null}
          {classes.data?.map((c) => (
            <Button
              key={c.classId}
              label={`${c.classId === classId ? "✓ " : ""}${c.name}`}
              onPress={() => setClassId(c.classId)}
            />
          ))}
        </View>
      ) : null}
      <Text>{uiText("Tên đợt mở bán")}</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel={uiText("Tên đợt mở bán")}
        value={title}
        onChangeText={setTitle}
      />
      <Text>{uiText("Giá (VND)")}</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel={uiText("Giá")}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
      />
      <Text>{uiText("Bắt đầu/kết thúc bán (ISO 8601 có múi giờ; có thể bỏ trống)")}</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel={uiText("Bắt đầu bán")}
        value={start}
        onChangeText={setStart}
      />
      <TextInput
        style={styles.input}
        accessibilityLabel={uiText("Kết thúc bán")}
        value={end}
        onChangeText={setEnd}
      />
      {error || command.message ? <Text accessibilityRole="alert">{error || command.message}</Text> : null}
      <Button
        label={uiText("Tạo bản nháp mở bán")}
        disabled={
          command.busy || !courses.data?.some((c) => c.courseId === courseId && c.state === "PUBLISHED")
        }
        onPress={() => void create()}
      />
    </Page>
  );
}
