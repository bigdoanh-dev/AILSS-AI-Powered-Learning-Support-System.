import { useState } from "react";
export const steps = [
  [
    "Tài liệu",
    "PDF / DOCX / TXT",
    "Giảng viên tải tài liệu phục vụ khóa học. Chỉ dùng nội dung bạn có quyền sử dụng.",
  ],
  [
    "Trích xuất riêng tư",
    "Nội dung có cấu trúc",
    "Tài liệu được kiểm tra checksum, lưu riêng tư và chuyển qua quy trình trích xuất.",
  ],
  [
    "AI tạo bản nháp",
    "Câu hỏi từ học liệu",
    "AI đề xuất câu hỏi khách quan từ nội dung tài liệu. Nội dung vẫn cần được rà soát.",
  ],
  [
    "Giảng viên rà soát",
    "Kiểm tra & chỉnh sửa",
    "Đọc câu hỏi, kiểm tra đáp án và chỉnh sửa nội dung trước khi phê duyệt.",
  ],
  [
    "Phê duyệt",
    "Quyết định của con người",
    "Chỉ bản nháp được giảng viên chấp thuận mới đi vào bước chuẩn bị bài đánh giá.",
  ],
  [
    "Bài đánh giá nháp",
    "Sẵn sàng để biên tập",
    "Kết quả nhập vào bài đánh giá ở trạng thái nháp. AI không tự xuất bản quiz.",
  ],
];
export function Workflow() {
  const [active, setActive] = useState(0);
  return (
    <div className="workflow">
      <ol className="workflow-steps">
        {steps.map(([title, sub], i) => (
          <li key={title}>
            <button onClick={() => setActive(i)} aria-pressed={active === i}>
              <span className="step-number">0{i + 1}</span>
              <strong>{title}</strong>
              <small>{sub}</small>
            </button>
          </li>
        ))}
      </ol>
      <div className="workflow-detail" aria-live="polite">
        <div key={active} className="panel-motion">
          <span className="eyebrow">Bước {active + 1} / 6</span>
          <h3>{steps[active][0]}</h3>
          <p>{steps[active][2]}</p>
        </div>
        <div className="workflow-track" aria-hidden="true">
          <span style={{ width: `${((active + 1) / 6) * 100}%` }} />
        </div>
        <div className="inline-actions">
          <button className="plain-button" disabled={active === 0} onClick={() => setActive(active - 1)}>
            Bước trước
          </button>
          <button className="plain-button" disabled={active === 5} onClick={() => setActive(active + 1)}>
            Bước tiếp theo
          </button>
        </div>
      </div>
    </div>
  );
}
