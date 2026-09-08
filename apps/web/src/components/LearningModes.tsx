import { Link } from "react-router-dom";
const modes = [
  {
    name: "Khóa học video",
    code: "SELF_PACED",
    tag: "Tự học theo tiến độ",
    description: "Học bằng video, tài liệu và bài tập. Bạn chọn thời gian và tốc độ học phù hợp.",
    entry: "Đăng ký miễn phí hoặc mua khóa học",
    schedule: "Không có lịch cố định",
    format: "Tự học trực tuyến",
    to: "/courses",
    action: "Tìm khóa học video",
  },
  {
    name: "Khóa học trực tuyến theo lịch",
    code: "LIVE_COHORT",
    tag: "Học cùng giảng viên",
    description: "Chọn một đợt mở lớp, xem lịch trước khi đăng ký và tham gia các buổi học cùng nhóm.",
    entry: "Mua một đợt mở bán gắn với lớp",
    schedule: "Có lịch học và thời gian từng buổi",
    format: "Trực tuyến theo lịch",
    to: "/courses?mode=LIVE_COHORT",
    action: "Khám phá lớp theo lịch",
  },
  {
    name: "Lớp riêng hoặc lớp của đơn vị",
    code: "PRIVATE_CLASS",
    tag: "Học cùng lớp của bạn",
    description: "Tham gia lớp do giảng viên hoặc đơn vị tổ chức bằng mã mời hay được thêm vào lớp.",
    entry: "Nhập mã tham gia hoặc được thêm",
    schedule: "Có thể có lịch tùy lớp",
    format: "Trực tiếp, trực tuyến hoặc kết hợp",
    to: "/app/classes",
    action: "Tham gia bằng mã lớp",
  },
];
export function LearningModes() {
  return (
    <section className="section learning-modes">
      <div className="container">
        <div className="section-heading">
          <h2>Ba cách học. Chọn cách phù hợp với bạn.</h2>
          <p>Cách tham gia, lịch học và hình thức tổ chức được phân biệt ngay từ đầu.</p>
        </div>
        <div className="learning-modes-grid">
          {modes.map((mode) => (
            <article key={mode.code}>
              <span className="mode-tag">{mode.tag}</span>
              <h3>{mode.name}</h3>
              <p>{mode.description}</p>
              <dl>
                <dt>Cách tham gia</dt>
                <dd>{mode.entry}</dd>
                <dt>Lịch học</dt>
                <dd>{mode.schedule}</dd>
                <dt>Hình thức</dt>
                <dd>{mode.format}</dd>
              </dl>
              <Link className="button secondary" to={mode.to}>
                {mode.action}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
