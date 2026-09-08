import { useState } from "react";
export const services = [
  ["Identity", "Danh tính & quyền truy cập", "Tài khoản, phiên đăng nhập, vai trò và xác minh giảng viên."],
  ["Learning", "Khóa học & hành trình", "Nội dung khóa học, bài học, enrollment, entitlement và tiến độ."],
  ["Classroom", "Không gian lớp học", "Thành viên, mã tham gia, lịch, phiên học và điểm danh."],
  ["Assessment", "Đánh giá & kết quả", "Quiz, lượt làm bài, chấm điểm khách quan và kết quả."],
  ["Interaction", "Trao đổi & phản hồi", "Bình luận, đánh giá, báo cáo nội dung và kiểm duyệt."],
  ["AI", "Tài liệu & bản nháp", "Xử lý tài liệu, tạo quiz theo objective-v1 và phê duyệt bởi giảng viên."],
];
export function Architecture() {
  const [selected, setSelected] = useState(0);
  return (
    <div className="architecture">
      <p className="eyebrow">6 business services</p>
      <div className="service-grid">
        {services.map(([name, sub], i) => (
          <button key={name} aria-pressed={selected === i} onClick={() => setSelected(i)}>
            <span className="service-index">0{i + 1}</span>
            <strong>{name}</strong>
            <small>{sub}</small>
          </button>
        ))}
      </div>
      <div key={selected} className="service-detail panel-motion" aria-live="polite">
        <strong>{services[selected][0]}</strong>
        <p>{services[selected][2]}</p>
      </div>
      <div className="infrastructure">
        <span>Hạ tầng & tiến trình hỗ trợ</span>
        <div>
          {["Gateway", "RabbitMQ", "MinIO", "Cassandra", "Workers", "Notification Worker"].map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <small>
          Notification Worker là tiến trình hỗ trợ, không phải business service thứ bảy. Redis không được sử
          dụng.
        </small>
      </div>
    </div>
  );
}
