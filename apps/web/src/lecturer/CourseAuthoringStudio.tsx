import React, { useState } from "react";

export type ContentLifecycleState = "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED";

export function CourseAuthoringStudio() {
  const [courseStatus, setCourseStatus] = useState<ContentLifecycleState>("IN_REVIEW");
  const [activeVersion, setActiveVersion] = useState("v2.1.0");
  const [modules, setModules] = useState([
    {
      id: "mod-1",
      title: "Chương 1: Tổng quan và Độ phức tạp thuật toán",
      lessons: [
        { id: "les-1", title: "1.1 Ký pháp Big-O và Không gian bộ nhớ", status: "APPROVED" },
        { id: "les-2", title: "1.2 Phân tích đệ quy và Định lý Thợ (Master Theorem)", status: "APPROVED" },
      ],
    },
    {
      id: "mod-2",
      title: "Chương 2: Cấu trúc Cây nâng cao",
      lessons: [
        { id: "les-3", title: "2.1 Cây nhị phân tìm kiếm & Cây AVL", status: "APPROVED" },
        { id: "les-4", title: "2.2 Cây Đỏ Đen (Red-Black Trees)", status: "DRAFT" },
      ],
    },
  ]);

  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiDraftOutput, setAiDraftOutput] = useState<string | null>(null);

  const handlePublish = () => {
    if (courseStatus !== "APPROVED") {
      alert("Khóa học chưa được Phê duyệt (APPROVED). Cần hoàn tất duyệt nội dung trước khi Xuất bản!");
      return;
    }
    setActiveVersion("v2.2.0");
    setCourseStatus("PUBLISHED");
    alert("Khóa học đã được Xuất bản thành công phiên bản v2.2.0!");
  };

  const handleGenerateAiDraft = () => {
    setAiDraftOutput(
      "[BẢN THẢO DO AI ĐỀ XUẤT - YÊU CẦU GIẢNG VIÊN PHÊ DUYỆT]\n" +
        "Chủ đề: Hoạt động thực hành Cây Đỏ Đen\n" +
        "Nguồn tham chiếu: Giáo trình Cấu trúc Dữ liệu ĐHQG-HCM, Mục 5.3, Chuẩn đầu ra LO-08\n\n" +
        "Nội dung bài tập:\n" +
        "1. Cho dãy khóa: [12, 18, 5, 2, 9, 15, 19, 17]. Hãy mô phỏng từng bước chèn vào Cây Đỏ Đen và chỉ ra các thao tác đổi màu và xoay cây.",
    );
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", borderBottom: "1px solid #e2e8f0", paddingBottom: "16px" }}>
        <div>
          <h1 style={{ fontSize: "26px", fontWeight: "700", color: "#0f172a", margin: "0 0 6px 0" }}>
            Xưởng Soạn thảo Khóa học V2 (Course Studio)
          </h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Môn học: <strong>Cấu trúc Dữ liệu & Giải thuật (CS101)</strong> | Phiên bản hiện tại: <strong>{activeVersion}</strong>
          </p>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span
            style={{
              padding: "6px 14px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: 700,
              backgroundColor: courseStatus === "PUBLISHED" ? "#dcfce7" : courseStatus === "APPROVED" ? "#dbeafe" : "#fef9c3",
              color: courseStatus === "PUBLISHED" ? "#166534" : courseStatus === "APPROVED" ? "#1e40af" : "#854d0e",
            }}
          >
            Trạng thái: {courseStatus}
          </span>

          {courseStatus === "IN_REVIEW" && (
            <button
              onClick={() => setCourseStatus("APPROVED")}
              style={{
                minHeight: "40px",
                padding: "8px 16px",
                backgroundColor: "#16a34a",
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Phê duyệt toàn bộ Khóa học
            </button>
          )}

          <button
            onClick={handlePublish}
            style={{
              minHeight: "40px",
              padding: "8px 16px",
              backgroundColor: courseStatus === "APPROVED" ? "#2563eb" : "#94a3b8",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              cursor: courseStatus === "APPROVED" ? "pointer" : "not-allowed",
            }}
          >
            Xuất bản Phiên bản Mới
          </button>
        </div>
      </header>

      {/* Structure & Module Studio */}
      <main>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: "600", color: "#1e293b", margin: 0 }}>Cấu trúc Chương mục & Bài giảng</h2>
          <button
            onClick={() => setAiModalOpen(true)}
            style={{
              minHeight: "38px",
              padding: "6px 14px",
              backgroundColor: "#7c3aed",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Trợ lý Soạn thảo AI (Draft Assistant)
          </button>
        </div>

        {modules.map((m) => (
          <section
            key={m.id}
            style={{
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "16px",
            }}
          >
            <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", color: "#0f172a" }}>{m.title}</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {m.lessons.map((les) => (
                <li
                  key={les.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 14px",
                    backgroundColor: "#ffffff",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                    marginBottom: "8px",
                  }}
                >
                  <span style={{ fontWeight: 500, color: "#334155" }}>{les.title}</span>
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      padding: "4px 8px",
                      borderRadius: "4px",
                      backgroundColor: les.status === "APPROVED" ? "#dcfce7" : "#fef9c3",
                      color: les.status === "APPROVED" ? "#166534" : "#854d0e",
                    }}
                  >
                    {les.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {/* AI Assistant Modal */}
      {aiModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              padding: "24px",
              borderRadius: "10px",
              width: "600px",
              maxHeight: "80vh",
              overflowY: "auto",
            }}
          >
            <h3 style={{ margin: "0 0 12px 0", fontSize: "18px", color: "#0f172a" }}>
              Yêu cầu AI Soạn Thảo Bản Thảo Nội Dung
            </h3>
            <p style={{ fontSize: "13px", color: "#64748b" }}>
              Mọi nội dung do AI tạo ra đều bắt đầu ở trạng thái <strong>BẢN THẢO (DRAFT)</strong> và bắt buộc phải có sự phê duyệt của giảng viên trước khi xuất bản.
            </p>

            <button
              onClick={handleGenerateAiDraft}
              style={{
                minHeight: "38px",
                padding: "8px 16px",
                backgroundColor: "#7c3aed",
                color: "#ffffff",
                borderRadius: "6px",
                border: "none",
                fontWeight: 600,
                cursor: "pointer",
                marginBottom: "16px",
              }}
            >
              Tạo bài tập thực hành theo giáo trình
            </button>

            {aiDraftOutput && (
              <div
                style={{
                  backgroundColor: "#f8fafc",
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "14px",
                  whiteSpace: "pre-wrap",
                  fontSize: "13px",
                  color: "#1e293b",
                  marginBottom: "16px",
                }}
              >
                {aiDraftOutput}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={() => setAiModalOpen(false)}
                style={{ minHeight: "36px", padding: "0 14px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#ffffff", cursor: "pointer" }}
              >
                Đóng
              </button>
              {aiDraftOutput && (
                <button
                  onClick={() => {
                    const newLesson = { id: `les-${Date.now()}`, title: "2.3 Bài tập Cây Đỏ Đen (Đã duyệt)", status: "APPROVED" };
                    const updated = [...modules];
                    updated[1]?.lessons.push(newLesson);
                    setModules(updated);
                    setAiModalOpen(false);
                    alert("Đã phê duyệt và đưa bài giảng vào Chương 2!");
                  }}
                  style={{ minHeight: "36px", padding: "0 16px", backgroundColor: "#16a34a", color: "#ffffff", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}
                >
                  Phê duyệt bản thảo vào Khóa học
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
