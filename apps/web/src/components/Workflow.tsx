import { useState, useEffect } from "react";

export const steps = [
  [
    "Tài liệu",
    "PDF / DOCX / TXT",
    "Giảng viên tải tài liệu phục vụ khóa học (giáo trình, slide bài giảng, đề cương). Chỉ xử lý nội dung bạn có quyền sử dụng và bảo mật riêng tư tuyệt đối.",
  ],
  [
    "Trích xuất riêng tư",
    "Nội dung có cấu trúc",
    "Tài liệu được kiểm tra checksum SHA-256, lưu trữ bảo mật và chuyển qua quy trình phân đoạn ngữ nghĩa (Semantic Chunking) để lập chỉ mục Vector.",
  ],
  [
    "AI tạo bản nháp",
    "Câu hỏi từ học liệu",
    "Mô hình AI chuyên sâu phân tích tài liệu để đề xuất các câu hỏi trắc nghiệm khách quan bám sát mục tiêu học tập theo thang nhận thức Bloom.",
  ],
  [
    "Giảng viên rà soát",
    "Kiểm tra & chỉnh sửa",
    "Quy trình Human-in-the-Loop: Giảng viên đọc câu hỏi, đối chiếu tài liệu nguồn, kiểm tra đáp án và chỉnh sửa nội dung trước khi phê duyệt.",
  ],
  [
    "Phê duyệt",
    "Quyết định của con người",
    "Quyền quyết định chất lượng thuộc về người dạy. Chỉ bản nháp được giảng viên chấp thuận mới đi vào bước chuẩn bị bài đánh giá chính thức.",
  ],
  [
    "Bài đánh giá nháp",
    "Sẵn sàng để biên tập",
    "Kết quả nhập vào bài đánh giá ở trạng thái nháp, sẵn sàng cho học viên luyện tập thích ứng. AI không tự xuất bản quiz khi chưa được mở thi.",
  ],
];

export function Workflow() {
  const [active, setActive] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);

  // Auto-advance through workflow steps every 4.5 seconds
  useEffect(() => {
    if (!autoPlay) return;
    const timer = setInterval(() => {
      setActive((prev) => (prev + 1) % steps.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [autoPlay]);

  return (
    <div className="workflow" onMouseEnter={() => setAutoPlay(false)} onMouseLeave={() => setAutoPlay(true)}>
      <ol className="workflow-steps">
        {steps.map(([title, sub], i) => (
          <li key={title}>
            <button
              onClick={() => {
                setActive(i);
                setAutoPlay(false);
              }}
              aria-pressed={active === i}
            >
              <span className="step-number">0{i + 1}</span>
              <strong>{title}</strong>
              <small>{sub}</small>
            </button>
          </li>
        ))}
      </ol>
      <div className="workflow-detail" aria-live="polite">
        <div key={active} className="panel-motion">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span className="eyebrow">Bước {active + 1} / 6</span>
            <button
              type="button"
              className="workflow-autoplay-btn"
              onClick={() => setAutoPlay(!autoPlay)}
              title={autoPlay ? "Bấm để dừng tự động chuyển bước" : "Bấm để tiếp tục tự động chuyển bước"}
            >
              <span>{autoPlay ? "⏸ Tự động: Bật" : "▶ Tiếp tục tự động"}</span>
            </button>
          </div>
          <h3>{steps[active][0]}</h3>
          <p>{steps[active][2]}</p>
        </div>
        <div className="workflow-track" aria-hidden="true">
          <span style={{ width: `${((active + 1) / 6) * 100}%` }} />
        </div>
        <div className="inline-actions">
          <button
            className="plain-button"
            disabled={active === 0}
            onClick={() => {
              setActive(active - 1);
              setAutoPlay(false);
            }}
          >
            Bước trước
          </button>
          <button
            className="plain-button"
            disabled={active === 5}
            onClick={() => {
              setActive(active + 1);
              setAutoPlay(false);
            }}
          >
            Bước tiếp theo
          </button>
        </div>
      </div>
    </div>
  );
}
