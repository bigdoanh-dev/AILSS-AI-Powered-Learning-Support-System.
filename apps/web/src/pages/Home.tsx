import { LearningModes } from "../components/LearningModes";
import { Section, TextLink, ButtonLink, Picture } from "../components/ui";
import { KnowledgeScene } from "../components/KnowledgeScene";
import { Workflow } from "../components/Workflow";
import { Faq } from "../components/Faq";
import { CourseSearch } from "./Courses";
export function ProgressPreview() {
  const values = [
    ["Khám phá nội dung", 100],
    ["Hoàn thành bài học", 65],
    ["Sẵn sàng đánh giá", 40],
  ] as const;
  return (
    <div className="product-preview" data-reveal="depth">
      <div className="preview-top">
        <strong>Hành trình học tập</strong>
        <small>Minh họa giao diện</small>
      </div>
      <h3>Mỗi bài học là một bước tiến.</h3>
      {values.map(([label, value]) => (
        <div className="progress-row" key={label}>
          <div>
            <span>{label}</span>
            <span>{value}%</span>
          </div>
          <div className="progress-bar">
            <span style={{ width: `${value}%` }} />
          </div>
        </div>
      ))}
      <small>Số liệu minh họa, không phải dữ liệu của người dùng.</small>
    </div>
  );
}
export default function Home() {
  return (
    <>
      <section className="commercial-hero">
        <div className="container commercial-hero-grid">
          <div className="commercial-hero-copy">
            <h1>
              Mỗi điều bạn học.
              <br />
              Một khả năng mới.
            </h1>
            <p className="lead">
              Từ bài giảng đầu tiên đến dự án của riêng bạn. Khám phá khóa học, luyện tập và tiến bộ cùng
              giảng viên và AI.
            </p>
            <div className="actions">
              <ButtonLink to="/courses">Khám phá khóa học</ButtonLink>
              <ButtonLink secondary to="/auth/register/lecturer">
                Tôi muốn giảng dạy
              </ButtonLink>
            </div>
            <div className="hero-note">
              <span aria-hidden="true">✓</span>Học theo nhịp của bạn. Luyện tập bằng điều vừa học.
            </div>
          </div>
          <KnowledgeScene />
        </div>
      </section>
      <LearningModes />
      <Section className="homepage-courses">
        <div className="section-heading row">
          <div>
            <h2>Bắt đầu với điều bạn tò mò.</h2>
            <p>Học liệu có tổ chức. Bài tập để vận dụng. Một hành trình rõ ràng.</p>
          </div>
          <TextLink to="/courses">Tất cả khóa học</TextLink>
        </div>
        <CourseSearch compact />
      </Section>
      <Section className="learning-story">
        <div className="split">
          <Picture name="study" alt="Minh họa hai học viên cùng thảo luận trong thư viện" />
          <div>
            <h2>
              Học một mình.
              <br />
              Không phải đi một mình.
            </h2>
            <p>
              Gặp giảng viên, đặt câu hỏi và theo dõi bài học ngay trong lớp. Video, tài liệu và bài tập ở
              cùng một nơi để bạn tập trung vào điều cần học.
            </p>
            <div className="story-features">
              <p>
                <strong>01</strong> Học qua video và tài liệu
              </p>
              <p>
                <strong>02</strong> Vận dụng qua bài luyện tập
              </p>
              <p>
                <strong>03</strong> Nhận phản hồi và theo dõi tiến độ
              </p>
            </div>
            <TextLink to="/auth/register/student">Tạo tài khoản học viên</TextLink>
          </div>
        </div>
      </Section>
      <Section className="ai-story">
        <div className="split">
          <div>
            <h2>
              Thêm thời gian
              <br />
              cho việc giảng dạy.
            </h2>
            <p>
              Chuẩn bị câu hỏi từ tài liệu với trợ lý AI. Rà soát nội dung, điều chỉnh đáp án và quyết định
              khi nào bài kiểm tra sẵn sàng cho học viên.
            </p>
            <TextLink to="/ai-learning">Tìm hiểu trợ lý AI</TextLink>
          </div>
          <Picture name="ai" alt="Mạng kết nối tri thức, hình minh họa tạo bằng AI" />
        </div>
        <Workflow />
      </Section>
      <Section>
        <div className="section-heading row">
          <h2>Bạn còn băn khoăn?</h2>
          <TextLink to="/help">Trung tâm trợ giúp</TextLink>
        </div>
        <Faq compact />
      </Section>
      <Section className="join-band">
        <div>
          <h2>
            Điều mới tiếp theo,
            <br />
            bắt đầu từ hôm nay.
          </h2>
          <p>Chọn hành trình học tập hoặc chia sẻ kiến thức của bạn.</p>
        </div>
        <div className="actions">
          <ButtonLink to="/auth/register/student">Bắt đầu học</ButtonLink>
          <ButtonLink to="/auth/register/lecturer" secondary>
            Trở thành giảng viên
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
