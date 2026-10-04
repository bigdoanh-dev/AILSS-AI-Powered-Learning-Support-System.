import { useUiText } from "../lib/i18n";
import { useState } from "react";
import {
  radarGroups,
  radarPoint,
  radarEdges,
  type RadarAxis,
} from "../../../../packages/learning-visuals/src/radar";
import "./learning-radar.css";

export function LearningRadar({ axes, studentCount }: { axes: RadarAxis[]; studentCount?: number }) {
  const uiText = useUiText();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const groups = radarGroups(axes);
  const group = groups[Math.min(page, Math.max(0, groups.length - 1))] ?? [];
  const detail = group.find((axis) => axis.id === selected);
  const observed = axes.filter((axis) => axis.score !== null).length;
  const complete = group.length >= 3 && group.every((axis) => axis.score !== null);
  const points = (percent: number) =>
    group
      .map((_, index) => {
        const p = radarPoint(index, group.length, percent);
        return `${p.x},${p.y}`;
      })
      .join(" ");
  return (
    <div className="learning-radar">
      <div className="learning-radar-caption">
        <span>Thang 0–100</span>
        <strong>
          {observed}/{axes.length} {uiText(" nội dung đã đánh giá")}
        </strong>
      </div>
      {!axes.length ? (
        <p>
          {uiText(
            "Chưa có nội dung để vẽ biểu đồ. Kết quả sẽ xuất hiện khi khóa học có bài học hoặc bài kiểm tra.",
          )}
        </p>
      ) : (
        <>
          <div className="learning-radar-layout">
            {group.length >= 3 ? (
              <svg
                className="learning-radar-chart"
                viewBox="0 0 320 320"
                role="img"
                aria-label={uiText(
                  "Biểu đồ radar mức độ làm chủ; số thứ tự tương ứng danh sách nội dung bên cạnh",
                )}
              >
                <title>{uiText("Mức độ làm chủ theo nội dung học tập")}</title>
                {[20, 40, 60, 80, 100].map((percent) => (
                  <polygon
                    key={percent}
                    points={points(percent)}
                    fill="none"
                    className="learning-radar-grid"
                  />
                ))}
                {group.map((_, index) => {
                  const p = radarPoint(index, group.length);
                  return (
                    <line key={index} x1="160" y1="160" x2={p.x} y2={p.y} className="learning-radar-grid" />
                  );
                })}
                {[20, 40, 60, 80, 100].map((percent) => (
                  <text
                    key={percent}
                    x="166"
                    y={160 - (106 * percent) / 100 + 4}
                    className="learning-radar-scale"
                  >
                    {percent}
                  </text>
                ))}
                {complete && (
                  <polygon
                    points={group
                      .map((axis, index) => {
                        const p = radarPoint(index, group.length, axis.score!);
                        return `${p.x},${p.y}`;
                      })
                      .join(" ")}
                    className="learning-radar-area"
                  />
                )}
                {!complete &&
                  radarEdges(group).map((edge, index) => (
                    <line
                      key={index}
                      x1={edge.from.x}
                      y1={edge.from.y}
                      x2={edge.to.x}
                      y2={edge.to.y}
                      className="learning-radar-edge"
                    />
                  ))}
                {group.map((axis, index) => {
                  const label = radarPoint(index, group.length, 122);
                  const p = radarPoint(index, group.length, axis.score ?? 100);
                  return (
                    <g key={axis.id}>
                      <text x={label.x} y={label.y + 5} textAnchor="middle" className="learning-radar-number">
                        {index + 1}
                      </text>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={axis.id === selected ? 7 : 4.5}
                        className={axis.score === null ? "learning-radar-unknown" : "learning-radar-point"}
                      />
                    </g>
                  );
                })}
              </svg>
            ) : (
              <p className="learning-radar-insufficient">
                {uiText("Cần ít nhất 3 nội dung để vẽ radar. Kết quả hiện có vẫn hiển thị bên cạnh.")}
              </p>
            )}
            <ol className="learning-radar-list">
              {group.map((axis, index) => (
                <li key={axis.id}>
                  <button
                    type="button"
                    aria-pressed={selected === axis.id}
                    onClick={() => setSelected(axis.id)}
                  >
                    <span className="learning-radar-index">{index + 1}</span>
                    <span>{axis.label}</span>
                    <strong>{axis.score === null ? uiText("Chưa đánh giá") : `${axis.score}%`}</strong>
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <p className="learning-radar-key">
            <span className="learning-radar-dot" />{" "}
            {studentCount === undefined ? uiText("Mức độ làm chủ") : uiText("Mức độ làm chủ trung bình")}{" "}
            <span className="learning-radar-dot unknown" /> {uiText(" Chưa có bằng chứng đánh giá")}
          </p>
          {!observed && (
            <p>
              {uiText("Chưa có kết quả đánh giá. Hoàn thành bài học và bài kiểm tra để cập nhật biểu đồ.")}
            </p>
          )}
          {detail && (
            <div className="learning-radar-detail" role="status">
              <strong>{detail.label}</strong>
              <p>
                {detail.score === null
                  ? uiText("Chưa có bằng chứng để xác định mức độ làm chủ.")
                  : uiText("{0} {1}%{2} · {3} bằng chứng học tập{4}.", [
                      studentCount === undefined ? "Mức độ làm chủ" : "Mức độ làm chủ trung bình",
                      detail.score,
                      studentCount === undefined
                        ? ""
                        : ` · ${detail.assessedStudentCount ?? 0}/${studentCount} học viên đã đánh giá`,
                      detail.evidenceCount,
                      detail.confidence === null ? "" : ` · Độ tin cậy ${Math.round(detail.confidence)}%`,
                    ])}
              </p>
            </div>
          )}
          {groups.length > 1 && (
            <div className="learning-radar-pagination">
              <button
                type="button"
                className="button secondary"
                disabled={page === 0}
                onClick={() => {
                  setPage(page - 1);
                  setSelected(null);
                }}
              >
                {uiText("Nhóm trước")}
              </button>
              <span>
                {uiText("Nhóm ")}
                {Math.min(page, groups.length - 1) + 1}/{groups.length}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={page >= groups.length - 1}
                onClick={() => {
                  setPage(page + 1);
                  setSelected(null);
                }}
              >
                {uiText("Nhóm tiếp")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
