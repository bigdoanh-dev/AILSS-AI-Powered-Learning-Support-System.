import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { record, string, ApiError } from "./api";
import { useMobileQuery } from "./queries";
import { masteryRecords, type MasteryRecord } from "./adaptive";
import { courseMasterySummary } from "./course-mastery";
import type { CourseLearningData } from "./use-student-learning";
import { LearningRadar } from "./LearningRadar";
import { Button, styles, tokens } from "./ui";
import { radarAxes, type RadarContent } from "../../../packages/learning-visuals/src/radar";

function contentPage(value: unknown): RadarContent[] {
  const items = Array.isArray(value) ? value : (record(value).lessons ?? record(value).items);
  if (!Array.isArray(items)) throw new ApiError("invalid");
  return items
    .filter((entry) => {
      const item = record(entry);
      return !item.lessonId || item.state === "READY";
    })
    .map((entry) => {
      const item = record(entry);
      return {
        id: item.lessonId ? `lesson:${string(item.lessonId)}` : `quiz:${string(item.quizId)}`,
        label: string(item.title),
      };
    });
}
function CourseRadar({
  courseId,
  records,
  live = true,
  studentId,
  aggregate = false,
}: {
  courseId: string;
  records?: MasteryRecord[];
  live?: boolean;
  studentId?: string;
  aggregate?: boolean;
}) {
  const lessons = useMobileQuery(live ? `/api/v1/courses/${courseId}/lessons` : null, contentPage);
  const quizzes = useMobileQuery(live ? `/api/v1/targets/COURSE/${courseId}/quizzes` : null, contentPage);
  const mastery = useMobileQuery(
    studentId ? `/api/v1/courses/${courseId}/students/${studentId}/mastery` : null,
    masteryRecords,
  );
  const summary = useMobileQuery(
    aggregate ? `/api/v1/courses/${courseId}/mastery-summary` : null,
    courseMasterySummary,
  );
  const error = lessons.error || quizzes.error || mastery.error || summary.error;
  const loading = lessons.loading || quizzes.loading || mastery.loading || summary.loading;
  if (loading)
    return (
      <View>
        <ActivityIndicator color={tokens.color.brand} />
        <Text style={styles.small}>Đang tải biểu đồ năng lực…</Text>
      </View>
    );
  if (error)
    return (
      <View>
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
        <Button
          label="Thử lại biểu đồ"
          onPress={() => {
            lessons.retry();
            quizzes.retry();
            mastery.retry();
            summary.retry();
          }}
        />
      </View>
    );
  return (
    <View style={{ gap: 12 }}>
      {summary.data && (
        <Text style={styles.text}>
          {summary.data.assessedStudentCount}/{summary.data.studentCount} học viên có kết quả đánh giá. Mỗi
          trục là điểm trung bình của những người đã được đánh giá ở nội dung đó.
        </Text>
      )}
      <LearningRadar
        studentCount={summary.data?.studentCount}
        axes={radarAxes(
          [...(lessons.data ?? []), ...(quizzes.data ?? [])],
          records ?? mastery.data ?? summary.data?.records ?? [],
        )}
      />
    </View>
  );
}
export function StudentLearningRadar({ courses, live }: { courses: CourseLearningData[]; live: boolean }) {
  const [selected, setSelected] = useState("");
  const current = courses.find((item) => item.course.courseId === selected) ?? courses[0];
  return (
    <View style={styles.card}>
      <Text style={[styles.title, { fontSize: 20 }]}>Bản đồ năng lực học tập</Text>
      <Text style={styles.text}>
        Mỗi trục là một bài học hoặc bài kiểm tra. Điểm thể hiện mức độ làm chủ từ bằng chứng học tập đã ghi
        nhận.
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
        accessibilityLabel="Khóa học xem năng lực"
      >
        {courses.map((item) => (
          <Button
            key={item.course.courseId}
            label={`${item.course.courseId === current?.course.courseId ? "✓ " : ""}${item.course.title}`}
            onPress={() => setSelected(item.course.courseId)}
          />
        ))}
      </ScrollView>
      {current ? (
        current.masteryError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {current.masteryError}
          </Text>
        ) : current.mastery === null ? (
          <Text style={styles.small}>Đang tải năng lực…</Text>
        ) : (
          <CourseRadar
            key={current.course.courseId}
            courseId={current.course.courseId}
            records={current.mastery}
            live={live}
          />
        )
      ) : (
        <Text style={styles.text}>Đăng ký khóa học và bắt đầu học để theo dõi năng lực của bạn.</Text>
      )}
      {!live && (
        <Text style={styles.small}>
          Bản lưu trên thiết bị. Tên nội dung sẽ được cập nhật khi kết nối lại máy chủ.
        </Text>
      )}
    </View>
  );
}
export function LecturerLearningRadar({
  courseId,
  studentId,
  studentName,
}: {
  courseId: string;
  studentId?: string;
  studentName?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={[styles.title, { fontSize: 20 }]}>
        {studentId ? "Năng lực học viên" : "Tổng quan năng lực khóa học"}
      </Text>
      <Text style={styles.text}>
        {studentId
          ? `${studentName || "Học viên"} · Mức độ làm chủ từng nội dung của khóa học.`
          : "Theo dõi nội dung học viên đang nắm tốt và nội dung cần hỗ trợ trong khóa học bạn phụ trách."}
      </Text>
      <CourseRadar
        key={`${courseId}:${studentId ?? "summary"}`}
        courseId={courseId}
        studentId={studentId}
        aggregate={!studentId}
      />
    </View>
  );
}
