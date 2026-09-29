import React, { useState } from "react";
import { Heading } from "../student/ui";

export interface QuestionDraft {
  id: string;
  course: string;
  outcome: string;
  text: string;
  type: string;
  correctAnswer: string;
  difficulty: string;
  status: "DRAFT" | "APPROVED" | "REJECTED";
  rejectionReason?: string;
}

export interface MisconceptionItem {
  id: string;
  concept: string;
  affectedCount: number;
  cohortPercent: number;
  pattern: string;
  remediation: string;
}

export interface RiskSignalItem {
  id: string;
  studentName: string;
  signalType: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  explanation: string;
  interventionStatus: "OPEN" | "CONTACTED" | "RESOLVED";
}

export function TeacherCopilotPage() {
  const [activeTab, setActiveTab] = useState<"QUESTIONS" | "RUBRICS" | "MISCONCEPTIONS" | "INTERVENTIONS">(
    "QUESTIONS",
  );

  const [questions, setQuestions] = useState<QuestionDraft[]>([
    {
      id: "q-draft-1",
      course: "CS101 Cấu trúc Dữ liệu & Giải thuật",
      outcome: "LO-04: Thao tác cân bằng cây AVL",
      text: "Cho cây AVL ban đầu với các nút 10, 20. Chèn tiếp nút 30 vào cây. Thao tác quay nào cần được áp dụng tại nút 10 để khôi phục tính chất AVL?",
      type: "SINGLE_CHOICE",
      correctAnswer: "Quay đơn trái (Left Rotation - LL)",
      difficulty: "INTERMEDIATE",
      status: "DRAFT",
    },
    {
      id: "q-draft-2",
      course: "CS101 Cấu trúc Dữ liệu & Giải thuật",
      outcome: "LO-02: Đánh giá độ phức tạp thuật toán đồ thị",
      text: "Trong đồ thị có trọng số âm không có chu trình âm, thuật toán nào phù hợp nhất để tìm đường đi ngắn nhất?",
      type: "SINGLE_CHOICE",
      correctAnswer: "Bellman-Ford",
      difficulty: "ADVANCED",
      status: "DRAFT",
    },
  ]);

  const [misconceptions] = useState<MisconceptionItem[]>([
    {
      id: "misc-1",
      concept: "Cân bằng cây AVL (Tree Rotations)",
      affectedCount: 14,
      cohortPercent: 32,
      pattern: "Nhầm lẫn giữa phép quay kép LR (Left-Right) và RL (Right-Left)",
      remediation: "Dành 10 phút đầu buổi học tới để minh họa trực quan 2 bước quay trên bảng tương tác.",
    },
    {
      id: "misc-2",
      concept: "Độ phức tạp thuật toán Dijkstra",
      affectedCount: 9,
      cohortPercent: 21,
      pattern:
        "Mặc định độ phức tạp luôn là O(V^2) mà bỏ qua vai trò của hàng đợi ưu tiên Min-Heap O((V+E)log V)",
      remediation: "Giao thêm bài tập so sánh cấu trúc dữ liệu mảng vs Binary Heap.",
    },
  ]);

  const [signals, setSignals] = useState<RiskSignalItem[]>([
    {
      id: "sig-1",
      studentName: "Nguyễn Văn A (MSSV: 20210012)",
      signalType: "RAPID_MASTERY_DECLINE",
      severity: "HIGH",
      explanation: "Điểm thành thạo giảm từ 82% xuống 58% sau chuỗi 3 bài trắc nghiệm về Cây nhị phân.",
      interventionStatus: "OPEN",
    },
    {
      id: "sig-2",
      studentName: "Trần Thị B (MSSV: 20210045)",
      signalType: "LONG_INACTIVITY",
      severity: "MEDIUM",
      explanation: "Không truy cập hoặc nộp bài tập trong 12 ngày liên tục.",
      interventionStatus: "OPEN",
    },
  ]);

  const handleApprove = (id: string) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, status: "APPROVED" } : q)));
  };

  const handleReject = (id: string) => {
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === id ? { ...q, status: "REJECTED", rejectionReason: "Từ chối bởi giảng viên" } : q,
      ),
    );
  };

  const handleIntervene = (id: string, newStatus: "CONTACTED" | "RESOLVED") => {
    setSignals((prev) => prev.map((s) => (s.id === id ? { ...s, interventionStatus: newStatus } : s)));
  };

  return (
    <div className="teacher-copilot-container" style={{ padding: "var(--space-6) 0" }}>
      <Heading title="Teacher Copilot & Misconceptions Studio">
        Trợ lý giảng viên hỗ trợ soạn câu hỏi, ma trận tiêu chí chấm (Rubrics), phân tích lỗi sai phổ biến và
        can thiệp sư phạm kịp thời.
      </Heading>

      {/* Human Approval Gate Alert */}
      <div
        style={{
          padding: "var(--space-3) var(--space-4)",
          background: "#fff8e1",
          borderLeft: "4px solid #ffb300",
          borderRadius: "var(--radius-sm)",
          margin: "var(--space-4) 0",
          fontSize: "0.95rem",
          color: "var(--ink)",
        }}
      >
        🔒 <strong>Cổng phê duyệt Giảng viên (Human Approval Required):</strong> Toàn bộ câu hỏi, tiêu chí
        rubric và nội dung do AI tạo ra mặc định ở trạng thái <em>DRAFT</em> và chỉ có hiệu lực chính thức khi
        được giảng viên xem xét và phê duyệt.
      </div>

      {/* Tabs */}
      <div className="module-segmented-bar" role="navigation" style={{ marginBottom: "var(--space-5)" }}>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "QUESTIONS" ? "active" : ""}`}
          onClick={() => setActiveTab("QUESTIONS")}
        >
          📝 Soạn thảo câu hỏi ({questions.filter((q) => q.status === "DRAFT").length} bản nháp)
        </button>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "RUBRICS" ? "active" : ""}`}
          onClick={() => setActiveTab("RUBRICS")}
        >
          📊 Tiêu chí chấm Rubric
        </button>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "MISCONCEPTIONS" ? "active" : ""}`}
          onClick={() => setActiveTab("MISCONCEPTIONS")}
        >
          🔍 Phân tích lỗi sai phổ biến ({misconceptions.length})
        </button>
        <button
          type="button"
          className={`segmented-tab ${activeTab === "INTERVENTIONS" ? "active" : ""}`}
          onClick={() => setActiveTab("INTERVENTIONS")}
        >
          🚨 Cảnh báo sớm & Can thiệp ({signals.filter((s) => s.interventionStatus === "OPEN").length})
        </button>
      </div>

      {/* QUESTIONS TAB */}
      {activeTab === "QUESTIONS" && (
        <section>
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {questions.map((q) => (
              <div
                key={q.id}
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
                        padding: "2px 8px",
                        borderRadius: "10px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background:
                          q.status === "APPROVED"
                            ? "#e8f5e9"
                            : q.status === "REJECTED"
                              ? "#ffebee"
                              : "#fff3cd",
                        color:
                          q.status === "APPROVED"
                            ? "#2e7d32"
                            : q.status === "REJECTED"
                              ? "#c62828"
                              : "#856404",
                      }}
                    >
                      {q.status === "APPROVED"
                        ? "✓ ĐÃ DUYỆT (ĐÃ VÀO NGÂN HÀNG CÂU HỎI)"
                        : q.status === "REJECTED"
                          ? "✕ TỪ CHỐI"
                          : "⏳ BẢN NHÁP (CHỜ GIẢNG VIÊN DUYỆT)"}
                    </span>
                    <h3 style={{ margin: "var(--space-2) 0", fontSize: "1.1rem" }}>{q.text}</h3>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
                      Môn học: {q.course} · Chuẩn đầu ra: {q.outcome} · Độ khó: {q.difficulty}
                    </p>
                    <p style={{ margin: "4px 0 0 0", fontSize: "0.95rem" }}>
                      <strong>Đáp án đúng đề xuất:</strong> {q.correctAnswer}
                    </p>
                  </div>

                  {q.status === "DRAFT" && (
                    <div style={{ display: "flex", gap: "var(--space-2)" }}>
                      <button
                        type="button"
                        onClick={() => handleApprove(q.id)}
                        style={{
                          padding: "6px 16px",
                          background: "#2e7d32",
                          color: "#fff",
                          border: "none",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        Phê duyệt câu hỏi
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(q.id)}
                        style={{
                          padding: "6px 14px",
                          background: "transparent",
                          border: "1px solid var(--line)",
                          color: "#c62828",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        Từ chối
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* RUBRICS TAB */}
      {activeTab === "RUBRICS" && (
        <section>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
              padding: "var(--space-4)",
              background: "var(--white)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Ma trận tiêu chí Rubric: Đồ án Cấu trúc Dữ liệu Nâng cao</h3>
            <p style={{ color: "var(--muted)" }}>
              Dự thảo rubric do AI Copilot hỗ trợ thiết lập dựa trên yêu cầu đồ án (Tổng điểm: 100).
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "var(--space-3)" }}>
              <thead>
                <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                  <th style={{ padding: "10px", borderBottom: "2px solid var(--line)" }}>Tiêu chí</th>
                  <th style={{ padding: "10px", borderBottom: "2px solid var(--line)" }}>Điểm tối đa</th>
                  <th style={{ padding: "10px", borderBottom: "2px solid var(--line)" }}>
                    Mô tả mức xuất sắc (A)
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>
                    1. Tính đúng đắn của cấu trúc tự cân bằng
                  </td>
                  <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>40 điểm</td>
                  <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>
                    Tất cả các phép quay đơn và kép xử lý chính xác 100% test case kiểm thử.
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>
                    2. Tối ưu bộ nhớ & thời gian thực thi
                  </td>
                  <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>35 điểm</td>
                  <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>
                    Đạt độ phức tạp thời gian O(log N) và giải phóng bộ nhớ sạch không có memory leak.
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>
                    3. Phong cách mã nguồn & tài liệu hóa
                  </td>
                  <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>25 điểm</td>
                  <td style={{ padding: "10px", borderBottom: "1px solid var(--line)" }}>
                    Mã nguồn tuân thủ Clean Code, có unit tests bao phủ đầy đủ.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* MISCONCEPTIONS TAB */}
      {activeTab === "MISCONCEPTIONS" && (
        <section>
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {misconceptions.map((m) => (
              <div
                key={m.id}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius)",
                  padding: "var(--space-4)",
                  background: "var(--white)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>Khái niệm: {m.concept}</h3>
                  <span style={{ fontWeight: 700, color: "#c62828" }}>
                    {m.affectedCount} sinh viên mắc phải ({m.cohortPercent}% lớp)
                  </span>
                </div>
                <p style={{ margin: "var(--space-2) 0", color: "var(--ink)" }}>
                  <strong>Quy luật sai phổ biến:</strong> {m.pattern}
                </p>
                <div
                  style={{
                    background: "#e8f4fd",
                    padding: "var(--space-3)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--blue)" }}>💡 Đề xuất sư phạm khắc phục:</span>
                  <p style={{ margin: "4px 0 0 0" }}>{m.remediation}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* INTERVENTIONS TAB */}
      {activeTab === "INTERVENTIONS" && (
        <section>
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {signals.map((s) => (
              <div
                key={s.id}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "var(--radius)",
                  padding: "var(--space-4)",
                  background: "var(--white)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ margin: "0 0 var(--space-1) 0" }}>{s.studentName}</h3>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: "10px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        background: s.severity === "HIGH" ? "#ffebee" : "#fff3cd",
                        color: s.severity === "HIGH" ? "#c62828" : "#856404",
                        marginBottom: "var(--space-2)",
                      }}
                    >
                      Cảnh báo: {s.signalType} (Mức độ: {s.severity})
                    </span>
                    <p style={{ margin: 0, color: "var(--muted)" }}>{s.explanation}</p>
                  </div>

                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    {s.interventionStatus === "OPEN" && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleIntervene(s.id, "CONTACTED")}
                          style={{
                            padding: "6px 14px",
                            background: "var(--blue)",
                            color: "#fff",
                            border: "none",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                          }}
                        >
                          Liên hệ sinh viên
                        </button>
                        <button
                          type="button"
                          onClick={() => handleIntervene(s.id, "RESOLVED")}
                          style={{
                            padding: "6px 14px",
                            background: "#2e7d32",
                            color: "#fff",
                            border: "none",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                          }}
                        >
                          Đánh dấu đã can thiệp
                        </button>
                      </>
                    )}
                    {s.interventionStatus === "CONTACTED" && (
                      <button
                        type="button"
                        onClick={() => handleIntervene(s.id, "RESOLVED")}
                        style={{
                          padding: "6px 14px",
                          background: "#2e7d32",
                          color: "#fff",
                          border: "none",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        Đánh dấu đã can thiệp
                      </button>
                    )}
                    {s.interventionStatus === "RESOLVED" && (
                      <span style={{ color: "#2e7d32", fontWeight: 600 }}>✓ Đã giải quyết</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
