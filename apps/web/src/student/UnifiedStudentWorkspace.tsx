import React, { useState } from "react";
import { Link } from "react-router-dom";

export interface StudentWorkspaceProps {
  studentName?: string;
  studentId?: string;
  tenantId?: string;
}

export function UnifiedStudentWorkspace({
  studentName = "Nguyễn Văn An",
  studentId = "stu-2026-001",
  tenantId = "tenant-polytech-hcm",
}: StudentWorkspaceProps) {
  const [goals, setGoals] = useState([
    {
      id: "g1",
      title: "Hoàn thành Khóa Cấu trúc Dữ liệu & Giải thuật",
      target: "100%",
      current: 78,
      type: "COMPLETE_COURSE",
    },
    {
      id: "g2",
      title: "Đạt Mastery Cây AVL & Cây Đỏ Đen",
      target: "Score >= 90",
      current: 85,
      type: "MASTER_TOPIC",
    },
    {
      id: "g3",
      title: "Thời gian học tuần này",
      target: "180 phút",
      current: 135,
      type: "WEEKLY_STUDY_TIME",
    },
  ]);

  const [dismissedRecs, setDismissedRecs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"today" | "study-plan" | "mastery" | "goals">("today");

  const recommendation = {
    id: "rec-avl-rotation",
    title: "Luyện tập: Phép xoay kép LR/RL trên Cây AVL",
    rationale: "Bạn có 2 câu trả lời sai ở phần xoay kép trong bài kiểm tra tuần trước.",
    actionType: "PRACTICE_QUESTION",
    isMandatory: false,
  };

  const isRecDismissed = dismissedRecs.includes(recommendation.id);

  return (
    <div className="unified-workspace" style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header with high contrast and WCAG 2.2 focus styling */}
      <header style={{ marginBottom: "24px", borderBottom: "1px solid #e2e8f0", paddingBottom: "16px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "700", color: "#0f172a", margin: "0 0 8px 0" }}>
          Không gian Học tập Cá nhân hóa
        </h1>
        <p style={{ color: "#475569", margin: 0 }}>
          Xin chào <strong>{studentName}</strong> (MSSV: {studentId}) | Đơn vị: {tenantId}
        </p>
      </header>

      {/* Navigation tabs with accessible roles and minimum 24x24 target size */}
      <nav
        role="tablist"
        aria-label="Các phân hệ học tập"
        style={{ display: "flex", gap: "12px", marginBottom: "24px" }}
      >
        <button
          role="tab"
          aria-selected={activeTab === "today"}
          onClick={() => setActiveTab("today")}
          style={{
            minHeight: "44px",
            minWidth: "120px",
            padding: "8px 16px",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
            border: activeTab === "today" ? "2px solid #2563eb" : "1px solid #cbd5e1",
            backgroundColor: activeTab === "today" ? "#eff6ff" : "#ffffff",
            color: activeTab === "today" ? "#1d4ed8" : "#334155",
          }}
        >
          Hôm nay (Today)
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "study-plan"}
          onClick={() => setActiveTab("study-plan")}
          style={{
            minHeight: "44px",
            minWidth: "120px",
            padding: "8px 16px",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
            border: activeTab === "study-plan" ? "2px solid #2563eb" : "1px solid #cbd5e1",
            backgroundColor: activeTab === "study-plan" ? "#eff6ff" : "#ffffff",
            color: activeTab === "study-plan" ? "#1d4ed8" : "#334155",
          }}
        >
          Kế hoạch Học tập
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "mastery"}
          onClick={() => setActiveTab("mastery")}
          style={{
            minHeight: "44px",
            minWidth: "120px",
            padding: "8px 16px",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
            border: activeTab === "mastery" ? "2px solid #2563eb" : "1px solid #cbd5e1",
            backgroundColor: activeTab === "mastery" ? "#eff6ff" : "#ffffff",
            color: activeTab === "mastery" ? "#1d4ed8" : "#334155",
          }}
        >
          Năng lực (Mastery V2)
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "goals"}
          onClick={() => setActiveTab("goals")}
          style={{
            minHeight: "44px",
            minWidth: "120px",
            padding: "8px 16px",
            borderRadius: "6px",
            fontWeight: 600,
            cursor: "pointer",
            border: activeTab === "goals" ? "2px solid #2563eb" : "1px solid #cbd5e1",
            backgroundColor: activeTab === "goals" ? "#eff6ff" : "#ffffff",
            color: activeTab === "goals" ? "#1d4ed8" : "#334155",
          }}
        >
          Mục tiêu Học tập
        </button>
      </nav>

      {/* Main Content Area */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px" }}>
        {/* Left Column: Today Highlights & Recommendations */}
        <section aria-labelledby="today-overview-heading">
          <h2 id="today-overview-heading" style={{ fontSize: "20px", fontWeight: "600", color: "#1e293b", marginBottom: "16px" }}>
            Tiếp tục học & Khuyến nghị hôm nay
          </h2>

          {/* Continue Learning Card */}
          <div
            style={{
              padding: "18px",
              borderRadius: "8px",
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0",
              marginBottom: "16px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 700, color: "#2563eb", textTransform: "uppercase" }}>
              Tiếp tục bài học gần nhất
            </span>
            <h3 style={{ margin: "6px 0 10px 0", fontSize: "18px", color: "#0f172a" }}>
              Cấu trúc Dữ liệu & Giải thuật: Bài 4 - Cây Cân Bằng AVL
            </h3>
            <div style={{ width: "100%", height: "8px", backgroundColor: "#e2e8f0", borderRadius: "4px", marginBottom: "12px" }}>
              <div style={{ width: "72%", height: "100%", backgroundColor: "#3b82f6", borderRadius: "4px" }} />
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                style={{
                  minHeight: "40px",
                  padding: "8px 16px",
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  borderRadius: "6px",
                  border: "none",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Vào bài học ngay
              </button>
              <Link
                to="/app/ai-tutor?mode=STUDY_BUDDY"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: "40px",
                  padding: "8px 16px",
                  backgroundColor: "#f1f5f9",
                  color: "#334155",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontWeight: 600,
                }}
              >
                Hỏi AI Tutor bài này
              </Link>
            </div>
          </div>

          {/* Recommended Next Action */}
          {!isRecDismissed && (
            <div
              style={{
                padding: "16px",
                borderRadius: "8px",
                backgroundColor: "#fffbeb",
                border: "1px solid #fef3c7",
                marginBottom: "16px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#b45309", textTransform: "uppercase" }}>
                    Khuyến nghị từ Hệ thống Adaptive V2
                  </span>
                  <h4 style={{ margin: "4px 0 6px 0", fontSize: "16px", color: "#78350f" }}>
                    {recommendation.title}
                  </h4>
                  <p style={{ margin: 0, fontSize: "14px", color: "#92400e" }}>
                    {recommendation.rationale}
                  </p>
                </div>
                <button
                  aria-label="Bỏ qua khuyến nghị"
                  onClick={() => setDismissedRecs([...dismissedRecs, recommendation.id])}
                  style={{
                    minWidth: "32px",
                    minHeight: "32px",
                    border: "none",
                    background: "transparent",
                    color: "#92400e",
                    cursor: "pointer",
                    fontSize: "18px",
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Due Assessments */}
          <div style={{ padding: "18px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", color: "#0f172a" }}>
              Nhiệm vụ & Bài kiểm tra sắp đến hạn
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              <li style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span>Bài trắc nghiệm giữa kỳ (Midterm Quiz 1)</span>
                <strong style={{ color: "#dc2626" }}>Hạn chót: 23:59 ngày mai</strong>
              </li>
              <li style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
                <span>Bài tập thực hành Lab 4 - AVL Tree</span>
                <span style={{ color: "#64748b" }}>Hạn chót: 3 ngày nữa</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Right Column: Learning Goals & AI Tutor Shortcut */}
        <aside aria-labelledby="goals-sidebar-heading">
          <h2 id="goals-sidebar-heading" style={{ fontSize: "20px", fontWeight: "600", color: "#1e293b", marginBottom: "16px" }}>
            Mục tiêu học tập
          </h2>

          <div style={{ padding: "16px", borderRadius: "8px", border: "1px solid #e2e8f0", backgroundColor: "#ffffff" }}>
            {goals.map((g) => (
              <div key={g.id} style={{ marginBottom: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", marginBottom: "4px" }}>
                  <span style={{ fontWeight: 600, color: "#334155" }}>{g.title}</span>
                  <span style={{ color: "#2563eb", fontWeight: 700 }}>{g.target}</span>
                </div>
                <div style={{ width: "100%", height: "6px", backgroundColor: "#f1f5f9", borderRadius: "3px" }}>
                  <div style={{ width: `${Math.min(100, g.current)}%`, height: "100%", backgroundColor: "#10b981", borderRadius: "3px" }} />
                </div>
              </div>
            ))}

            <button
              onClick={() => {
                const newGoal = {
                  id: `g-${Date.now()}`,
                  title: "Luyện tập thêm 30 phút",
                  target: "30 phút",
                  current: 0,
                  type: "WEEKLY_STUDY_TIME",
                };
                setGoals([...goals, newGoal]);
              }}
              style={{
                width: "100%",
                minHeight: "40px",
                marginTop: "8px",
                border: "1px dashed #94a3b8",
                borderRadius: "6px",
                backgroundColor: "#f8fafc",
                color: "#475569",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + Đặt mục tiêu học tập mới
            </button>
          </div>

          {/* Instructor Feedback Box */}
          <div style={{ marginTop: "20px", padding: "16px", borderRadius: "8px", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0" }}>
            <h3 style={{ margin: "0 0 6px 0", fontSize: "15px", color: "#166534" }}>
              Nhận xét từ Giảng viên (Thầy Tuấn)
            </h3>
            <p style={{ margin: 0, fontSize: "13px", color: "#14532d" }}>
              &quot;Em đã nắm rất tốt phần duyệt cây theo thứ tự. Hãy cố gắng hoàn thành phần xoay kép để sẵn sàng cho bài thi.&quot;
            </p>
          </div>
        </aside>
      </div>

    </div>
  );
}
