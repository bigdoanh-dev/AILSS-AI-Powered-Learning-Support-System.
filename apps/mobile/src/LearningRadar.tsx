import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  radarGroups,
  radarPoint,
  radarEdges,
  type RadarAxis,
} from "../../../packages/learning-visuals/src/radar";
import { Button, styles, tokens } from "./ui";

function Segment({
  from,
  to,
  ink,
  thickness = 1,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  ink: string;
  thickness?: number;
}) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: (from.x + to.x - length) / 2,
        top: (from.y + to.y - thickness) / 2,
        width: length,
        height: thickness,
        backgroundColor: ink,
        transform: [{ rotate: `${Math.atan2(to.y - from.y, to.x - from.x)}rad` }],
      }}
    />
  );
}

export function LearningRadar({ axes, studentCount }: { axes: RadarAxis[]; studentCount?: number }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [width, setWidth] = useState(280);
  const groups = radarGroups(axes),
    group = groups[Math.min(page, Math.max(0, groups.length - 1))] ?? [];
  const observed = axes.filter((axis) => axis.score !== null).length;
  const detail = group.find((axis) => axis.id === selected);
  return (
    <View style={s.root}>
      <View style={s.caption}>
        <Text style={styles.small}>Thang 0–100</Text>
        <Text style={s.coverage}>
          {observed}/{axes.length} nội dung đã đánh giá
        </Text>
      </View>
      {!axes.length ? (
        <Text style={styles.text}>
          Chưa có nội dung để vẽ biểu đồ. Kết quả sẽ xuất hiện khi khóa học có bài học hoặc bài kiểm tra.
        </Text>
      ) : (
        <>
          {group.length >= 3 ? (
            <View
              onLayout={(event) => setWidth(Math.min(320, event.nativeEvent.layout.width))}
              style={{ width: "100%", height: width, overflow: "hidden" }}
              accessibilityRole="image"
              accessibilityLabel="Biểu đồ radar mức độ làm chủ; số thứ tự tương ứng danh sách nội dung bên dưới"
            >
              <View
                style={{
                  position: "absolute",
                  width: 320,
                  height: 320,
                  left: "50%",
                  marginLeft: -160,
                  top: (width - 320) / 2,
                  transform: [{ scale: width / 320 }],
                }}
              >
                {[20, 40, 60, 80, 100].flatMap((percent) =>
                  group.map((_, index) => (
                    <Segment
                      key={`${percent}:${index}`}
                      from={radarPoint(index, group.length, percent)}
                      to={radarPoint((index + 1) % group.length, group.length, percent)}
                      ink="#DCE5EE"
                    />
                  )),
                )}
                {group.map((_, index) => (
                  <Segment
                    key={index}
                    from={{ x: 160, y: 160 }}
                    to={radarPoint(index, group.length)}
                    ink="#DCE5EE"
                  />
                ))}
                {[20, 40, 60, 80, 100].map((percent) => (
                  <Text
                    key={percent}
                    style={{
                      position: "absolute",
                      left: 166,
                      top: 153 - (106 * percent) / 100,
                      fontSize: 9,
                      color: tokens.color.muted,
                    }}
                  >
                    {percent}
                  </Text>
                ))}
                {radarEdges(group).map((edge, index) => (
                  <Segment
                    key={index}
                    from={edge.from}
                    to={edge.to}
                    ink={tokens.color.brand}
                    thickness={2.5}
                  />
                ))}
                {group.map((axis, index) => {
                  const label = radarPoint(index, group.length, 122),
                    p = radarPoint(index, group.length, axis.score ?? 100);
                  return (
                    <View key={axis.id}>
                      <Text
                        style={{
                          position: "absolute",
                          left: label.x - 14,
                          top: label.y - 9,
                          width: 28,
                          textAlign: "center",
                          fontSize: 13,
                          fontWeight: "700",
                          color: tokens.color.ink,
                        }}
                      >
                        {index + 1}
                      </Text>
                      <View
                        style={{
                          position: "absolute",
                          left: p.x - 5,
                          top: p.y - 5,
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          borderWidth: 2,
                          borderColor: axis.score === null ? tokens.color.muted : "#FFFFFF",
                          backgroundColor: axis.score === null ? "#FFFFFF" : tokens.color.brand,
                        }}
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          ) : (
            <Text style={styles.small}>
              Cần ít nhất 3 nội dung để vẽ radar. Kết quả hiện có vẫn hiển thị bên dưới.
            </Text>
          )}
          {group.map((axis, index) => (
            <Pressable
              key={axis.id}
              accessibilityRole="button"
              accessibilityState={{ selected: selected === axis.id }}
              accessibilityLabel={`${index + 1}. ${axis.label}: ${axis.score === null ? "Chưa đánh giá" : `${axis.score} phần trăm`}`}
              onPress={() => setSelected(axis.id)}
              style={[s.row, selected === axis.id && s.selected]}
            >
              <Text style={s.index}>{index + 1}</Text>
              <Text style={s.label}>{axis.label}</Text>
              <Text style={s.score}>{axis.score === null ? "Chưa đánh giá" : `${axis.score}%`}</Text>
            </Pressable>
          ))}
          <Text style={styles.small}>
            ● {studentCount === undefined ? "Mức độ làm chủ" : "Mức độ làm chủ trung bình"} ○ Chưa có bằng
            chứng đánh giá
          </Text>
          {!observed && (
            <Text style={styles.text}>
              Chưa có kết quả đánh giá. Hoàn thành bài học và bài kiểm tra để cập nhật biểu đồ.
            </Text>
          )}
          {detail && (
            <View style={s.detail}>
              <Text style={s.heading}>{detail.label}</Text>
              <Text style={styles.text}>
                {detail.score === null
                  ? "Chưa có bằng chứng để xác định mức độ làm chủ."
                  : `${studentCount === undefined ? "Mức độ làm chủ" : "Mức độ làm chủ trung bình"} ${detail.score}%${studentCount === undefined ? "" : ` · ${detail.assessedStudentCount ?? 0}/${studentCount} học viên đã đánh giá`} · ${detail.evidenceCount} bằng chứng học tập${detail.confidence === null ? "" : ` · Độ tin cậy ${Math.round(detail.confidence)}%`}.`}
              </Text>
            </View>
          )}
          {groups.length > 1 && (
            <View style={s.pagination}>
              <Button
                label="Nhóm trước"
                disabled={page === 0}
                onPress={() => {
                  setPage(page - 1);
                  setSelected(null);
                }}
              />
              <Text style={styles.small}>
                {Math.min(page, groups.length - 1) + 1}/{groups.length}
              </Text>
              <Button
                label="Nhóm tiếp"
                disabled={page >= groups.length - 1}
                onPress={() => {
                  setPage(page + 1);
                  setSelected(null);
                }}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  root: { gap: 12 },
  caption: { flexDirection: "row", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  coverage: { fontSize: 12, fontWeight: "600", color: tokens.color.muted },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#DCE5EE",
    borderRadius: 12,
  },
  selected: { borderColor: tokens.color.brand, backgroundColor: "#E6F7F7" },
  index: {
    width: 28,
    height: 28,
    lineHeight: 28,
    textAlign: "center",
    borderRadius: 14,
    backgroundColor: "#E6F7F7",
    color: tokens.color.brand,
    fontWeight: "700",
  },
  label: { flex: 1, fontSize: 14, color: tokens.color.ink },
  score: { fontSize: 12, fontWeight: "600", color: tokens.color.muted },
  detail: {
    borderLeftWidth: 3,
    borderLeftColor: tokens.color.brand,
    padding: 12,
    backgroundColor: "#F1FAFA",
    gap: 6,
  },
  heading: { fontSize: 15, fontWeight: "700", color: tokens.color.ink },
  pagination: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
});
