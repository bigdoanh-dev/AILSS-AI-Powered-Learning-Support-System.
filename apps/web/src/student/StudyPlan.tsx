import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Heading } from "./ui";

export interface WebStudyPlanItem {
  id: string;
  title: string;
  concept: string;
  action: "REVIEW_CONCEPT" | "WATCH_LESSON" | "PRACTICE_QUESTIONS" | "TAKE_DIAGNOSTIC" | "ASK_AI_TUTOR";
  scheduledDate: string;
  estimatedMinutes: number;
  priority: number;
  reasonCode: string;
  rationale: string;
  status: "PENDING" | "COMPLETED" | "SKIPPED" | "RESCHEDULED";
}

export interface WebMasteryGap {
  conceptId: string;
  conceptName: string;
  currentScore: number;
  targetScore: number;
  state: "INTRODUCED" | "DEVELOPING" | "DECAY_RISK";
  whyDeveloping: string;
}

export interface WebUpcomingAssessment {
  id: string;
  title: string;
  dueDate: string;
  daysRemaining: number;
  weightPercent: number;
}

export function StudyPlanPage() {
  const [activeTab, setActiveTab] = useState<
    "OVERVIEW" | "THIS_WEEK" | "GAPS" | "RECOMMENDED" | "UPCOMING" | "COMPLETED"
  >("THIS_WEEK");

  const [items, setItems] = useState<WebStudyPlanItem[]>([
    {
      id: "item-1",
      title: "Binary Search Trees Invariant Review",
      concept: "binary_search_trees",
      action: "REVIEW_CONCEPT",
      scheduledDate: "2026-09-22",
      estimatedMinutes: 25,
      priority: 1,
      reasonCode: "RECENCY_DECAY",
      rationale: "Achieved proficiency 3 weeks ago; quick refresher will maintain mastery state.",
      status: "PENDING",
    },
    {
      id: "item-2",
      title: "Targeted Socratic Practice: Tree Rotations",
      concept: "tree_rotations",
      action: "PRACTICE_QUESTIONS",
      scheduledDate: "2026-09-23",
      estimatedMinutes: 35,
      priority: 2,
      reasonCode: "LOW_MASTERY",
      rationale: "Mastery is currently at 64% (Developing). Practice questions will elevate to Proficient.",
      status: "PENDING",
    },
    {
      id: "item-3",
      title: "Midterm Diagnostic Readiness Simulation",
      concept: "algorithms_midterm_prep",
      action: "TAKE_DIAGNOSTIC",
      scheduledDate: "2026-09-25",
      estimatedMinutes: 45,
      priority: 1,
      reasonCode: "UPCOMING_ASSESSMENT",
      rationale: "CS101 Midterm Examination is scheduled for Sept 28.",
      status: "PENDING",
    },
  ]);

  const [gaps] = useState<WebMasteryGap[]>([
    {
      conceptId: "c-tree-rotations",
      conceptName: "AVL Tree Rotations & Balancing",
      currentScore: 64,
      targetScore: 80,
      state: "DEVELOPING",
      whyDeveloping: "Recent quiz attempt scored 64%. Prerequisite binary tree properties verified.",
    },
    {
      conceptId: "c-graph-dijkstra",
      conceptName: "Dijkstra Shortest Path Complexity",
      currentScore: 78,
      targetScore: 85,
      state: "DECAY_RISK",
      whyDeveloping: "Inactive for 22 days since initial completion. Requires 1 refresher session.",
    },
  ]);

  const [upcoming] = useState<WebUpcomingAssessment[]>([
    {
      id: "midterm-01",
      title: "CS101 Algorithms & Data Structures Midterm",
      dueDate: "2026-09-28",
      daysRemaining: 6,
      weightPercent: 30,
    },
  ]);

  const handleStatusChange = (itemId: string, newStatus: "COMPLETED" | "SKIPPED" | "RESCHEDULED") => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status: newStatus } : i)),
    );
  };

  const completedItems = items.filter((i) => i.status === "COMPLETED");
  const pendingItems = items.filter((i) => i.status !== "COMPLETED");

  return (
    <div className="study-plan-container" style={{ padding: "var(--space-6) 0" }}>
      <Heading title="Kế hoạch học tập cá nhân hóa (Adaptive Study Plan V2)">
        Lộ trình tối ưu hóa dựa trên điểm thành thạo thực tế, khoảng trống kiến thức tiên quyết và kỳ thi sắp tới.
      </Heading>

      {/* Tab Navigation */}
      <div
        className="module-segmented-bar"
        role="navigation"
        aria-label="Phân hệ Kế hoạch học tập"
        style={{ marginBottom: "var(--space-5)" }}
      >
        <button
          type="button"
          className={`segmented-tab ${activeTab === "THIS_WEEK" ? "active" : ""}`}
          onClick={() => setActiveTab("THIS_WEEK")}
        >
          📅 Tuần này ({pendingItems.length})
        </button>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "RECOMMENDED" ? "active" : ""}`}
          onClick={() => setActiveTab("RECOMMENDED")}
        >
          ⚡ Bước tiếp theo khuyên dùng
        </button>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "GAPS" ? "active" : ""}`}
          onClick={() => setActiveTab("GAPS")}
        >
          🎯 Khoảng trống kỹ năng ({gaps.length})
        </button>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "UPCOMING" ? "active" : ""}`}
          onClick={() => setActiveTab("UPCOMING")}
        >
          ⏳ Bài thi sắp tới ({upcoming.length})
        </button>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "COMPLETED" ? "active" : ""}`}
          onClick={() => setActiveTab("COMPLETED")}
        >
          ✅ Đã hoàn thành ({completedItems.length})
        </button>
      </div>

      {/* THIS WEEK TAB */}
      {activeTab === "THIS_WEEK" && (
        <section aria-labelledby="this-week-heading">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <h2 id="this-week-heading" style={{ fontSize: "1.25rem", color: "var(--ink)", margin: 0 }}>
              Các hoạt động được đề xuất tuần này
            </h2>
            <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
              Tổng thời lượng dự kiến: {items.reduce((s, i) => s + (i.status === "PENDING" ? i.estimatedMinutes : 0), 0)} phút
            </span>
          </div>

          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {pendingItems.map((item) => (
              <div
                key={item.id}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius)",
                  padding: "var(--space-4)",
                  background: "var(--white)",
                  boxShadow: "var(--shadow)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: item.reasonCode === "RECENCY_DECAY" ? "#fff3cd" : "#e7f1ff",
                        color: item.reasonCode === "RECENCY_DECAY" ? "#856404" : "#0d6efd",
                        marginBottom: "var(--space-2)",
                      }}
                    >
                      {item.reasonCode} · Độ ưu tiên #{item.priority}
                    </span>
                    <h3 style={{ margin: "0 0 var(--space-2) 0", fontSize: "1.1rem" }}>{item.title}</h3>
                    <p style={{ margin: "0 0 var(--space-2) 0", color: "var(--muted)", fontSize: "0.95rem" }}>
                      {item.rationale}
                    </p>
                    <small style={{ color: "var(--muted)" }}>
                      Lịch dự kiến: {item.scheduledDate} · Thời lượng: {item.estimatedMinutes} phút
                    </small>
                  </div>

                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <button
                      type="button"
                      style={{
                        padding: "6px 14px",
                        background: "var(--blue)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                      }}
                      onClick={() => handleStatusChange(item.id, "COMPLETED")}
                    >
                      Đánh dấu hoàn thành
                    </button>
                    <button
                      type="button"
                      style={{
                        padding: "6px 14px",
                        background: "transparent",
                        border: "1px solid var(--line)",
                        color: "var(--ink)",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                      }}
                      onClick={() => handleStatusChange(item.id, "SKIPPED")}
                    >
                      Bỏ qua
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* RECOMMENDED NEXT STEP TAB */}
      {activeTab === "RECOMMENDED" && (
        <section aria-labelledby="recommended-heading">
          <h2 id="recommended-heading" style={{ fontSize: "1.25rem", color: "var(--ink)", marginBottom: "var(--space-4)" }}>
            Hành động được cá nhân hóa ưu tiên cao nhất
          </h2>
          <div
            style={{
              padding: "var(--space-5)",
              background: "linear-gradient(135deg, #1760ef10, #77dfff15)",
              border: "2px solid var(--blue)",
              borderRadius: "var(--radius)",
            }}
          >
            <span style={{ fontWeight: 700, color: "var(--blue)", fontSize: "0.9rem" }}>
              ⚡ HÀNH ĐỘNG KHUYÊN DÙNG NGAY (Next-Action Engine)
            </span>
            <h3 style={{ margin: "var(--space-2) 0", fontSize: "1.3rem" }}>
              Luyện tập Socratic cùng AI Tutor: Cân bằng cây AVL
            </h3>
            <p style={{ color: "var(--ink)", fontSize: "1rem", lineHeight: 1.5 }}>
              Lý do: Điểm thành thạo hiện tại của bạn là 64% (Developing). Vượt qua 3 câu hỏi thực hành giải thích bước quay LL và RR sẽ đưa khái niệm lên mức Proficient (≥ 75%).
            </p>
            <div style={{ marginTop: "var(--space-4)", display: "flex", gap: "var(--space-3)" }}>
              <Link
                to="/app/ai-tutor?concept=tree_rotations&mode=SOCRATIC"
                style={{
                  padding: "10px 20px",
                  background: "var(--blue)",
                  color: "#fff",
                  borderRadius: "var(--radius-sm)",
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                Bắt đầu học với AI Tutor ngay →
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* MASTERY GAPS TAB */}
      {activeTab === "GAPS" && (
        <section aria-labelledby="gaps-heading">
          <h2 id="gaps-heading" style={{ fontSize: "1.25rem", color: "var(--ink)", marginBottom: "var(--space-4)" }}>
            Khoảng trống kiến thức và giải trình tính minh bạch
          </h2>
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {gaps.map((gap) => (
              <div
                key={gap.conceptId}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius)",
                  padding: "var(--space-4)",
                  background: "var(--white)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{gap.conceptName}</h3>
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: "12px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      background: gap.state === "DECAY_RISK" ? "#fff3cd" : "#ffebee",
                      color: gap.state === "DECAY_RISK" ? "#856404" : "#c62828",
                    }}
                  >
                    Trạng thái: {gap.state}
                  </span>
                </div>
                <p style={{ margin: "var(--space-2) 0", color: "var(--muted)" }}>
                  <strong>Tại sao khái niệm này ở trạng thái này:</strong> {gap.whyDeveloping}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginTop: "var(--space-3)" }}>
                  <div style={{ flex: 1, height: "8px", background: "var(--line)", borderRadius: "4px", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${gap.currentScore}%`,
                        height: "100%",
                        background: "var(--blue)",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    {gap.currentScore}% / Mục tiêu: {gap.targetScore}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* UPCOMING ASSESSMENTS TAB */}
      {activeTab === "UPCOMING" && (
        <section aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" style={{ fontSize: "1.25rem", color: "var(--ink)", marginBottom: "var(--space-4)" }}>
            Lịch kiểm tra & đánh giá sắp diễn ra
          </h2>
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {upcoming.map((a) => (
              <div
                key={a.id}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius)",
                  padding: "var(--space-4)",
                  background: "var(--white)",
                }}
              >
                <h3 style={{ margin: "0 0 var(--space-2) 0" }}>{a.title}</h3>
                <p style={{ margin: 0, color: "var(--muted)" }}>
                  Hạn hoàn thành: <strong>{a.dueDate}</strong> (Còn {a.daysRemaining} ngày) · Trọng số: {a.weightPercent}%
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* COMPLETED TAB */}
      {activeTab === "COMPLETED" && (
        <section aria-labelledby="completed-heading">
          <h2 id="completed-heading" style={{ fontSize: "1.25rem", color: "var(--ink)", marginBottom: "var(--space-4)" }}>
            Hoạt động đã hoàn thành
          </h2>
          {completedItems.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>Chưa có hoạt động nào được đánh dấu hoàn thành trong tuần này.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0 }}>
              {completedItems.map((c) => (
                <li
                  key={c.id}
                  style={{
                    padding: "var(--space-3) 0",
                    borderBottom: "1px solid var(--line)",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>✓ {c.title}</span>
                  <span style={{ color: "var(--muted)" }}>{c.estimatedMinutes} phút</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
