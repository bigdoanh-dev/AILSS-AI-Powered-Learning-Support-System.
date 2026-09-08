import { useState } from "react";
export const questions = [
  [
    "General",
    "AILSS là gì?",
    "AILSS kết nối khóa học, lớp học, đánh giá, tiến độ, tương tác và quy trình AI tạo bản nháp câu hỏi có giảng viên duyệt.",
  ],
  [
    "Students",
    "Bắt đầu học như thế nào?",
    "Tìm khóa học công khai, đọc thông tin, sau đó đăng ký hoặc đăng nhập. Tham gia khóa học và các thao tác học tập thuộc trải nghiệm ứng dụng ở giai đoạn tiếp theo.",
  ],
  [
    "Lecturers",
    "Giảng viên kiểm soát nội dung AI ra sao?",
    "Giảng viên xem, sửa và phê duyệt bản nháp. AI không tự xuất bản bài đánh giá.",
  ],
  [
    "Courses",
    "Tại sao tìm kiếm không có kết quả?",
    "Thử một từ khóa khác có 3–20 ký tự. Tìm kiếm hỗ trợ tiền tố từ trong tên khóa học đã xuất bản, không phải tìm kiếm toàn văn.",
  ],
  [
    "Classrooms",
    "Lớp học khác khóa học thế nào?",
    "Khóa học tổ chức học liệu; lớp học tổ chức thành viên, lịch, phiên học và điểm danh.",
  ],
  [
    "Assessment",
    "AILSS chấm bài như thế nào?",
    "Assessment hỗ trợ lượt làm bài, nộp bài và chấm điểm khách quan. Kết quả gắn với lượt làm bài của người học.",
  ],
  [
    "AI",
    "AI có tự xuất bản quiz không?",
    "Không. Bản nháp phải qua giảng viên phê duyệt và được đưa vào bài đánh giá nháp.",
  ],
  [
    "Privacy",
    "Tài liệu tải lên có công khai không?",
    "Tài liệu được lưu trong MinIO riêng tư. Quyền truy cập được kiểm tra theo người dùng và ngữ cảnh thao tác.",
  ],
  [
    "Security",
    "AILSS đã có chứng nhận bảo mật chưa?",
    "Trang này mô tả các cơ chế đã triển khai; không tuyên bố chứng nhận SOC 2, ISO, HIPAA, PCI hay chứng nhận kiểm thử xâm nhập.",
  ],
  [
    "Accounts",
    "Tôi quên mật khẩu thì làm gì?",
    "Phiên bản này chưa có quy trình đặt lại mật khẩu qua email. Xem hướng dẫn tài khoản và liên hệ người quản trị triển khai của bạn; không gửi mật khẩu qua biểu mẫu.",
  ],
];
export function Faq({ compact = false }: { compact?: boolean }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const items = (compact ? questions.filter((_, i) => [0, 2, 6, 7].includes(i)) : questions).filter(
    ([c, t, a]) =>
      (category === "All" || category === c) &&
      `${t} ${a}`.toLocaleLowerCase("vi").includes(q.toLocaleLowerCase("vi")),
  );
  return (
    <div className="faq">
      {!compact && (
        <div className="faq-filters">
          <label>
            Tìm câu hỏi
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              type="search"
              placeholder="AI, tài khoản, khóa học…"
            />
          </label>
          <label>
            Chủ đề
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="All">Tất cả</option>
              {questions.map(([c]) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="faq-items">
        {items.map(([c, t, a]) => (
          <details key={t}>
            <summary>
              {t}
              <span aria-hidden="true">+</span>
            </summary>
            <p>{a}</p>
            {!compact && <small>{c}</small>}
          </details>
        ))}
      </div>
      {items.length === 0 && <p role="status">Chưa tìm thấy câu hỏi phù hợp. Hãy thử từ khóa khác.</p>}
    </div>
  );
}
