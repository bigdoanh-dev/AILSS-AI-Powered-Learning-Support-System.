import { Section, TextLink, ButtonLink, Picture, Reveal } from "../components/ui";
import { KnowledgeScene } from "../components/KnowledgeScene";
import { Workflow } from "../components/Workflow";
import { ScrollStory } from "../components/ScrollStory";
import { Faq } from "../components/Faq";
import { VideoStory } from "../components/VideoStory";
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
      <section className="home-hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">AI-Powered Learning Platform</p>
            <h1>
              Học <em>thông minh</em> hơn.
              <br />
              Dạy <em>hiệu quả</em> hơn.
            </h1>
            <p className="hero-ai">AI đồng hành cùng bạn.</p>
            <p className="lead">
              Khám phá khóa học, tham gia lớp học, theo dõi tiến độ và luyện tập. Biến tài liệu thành bản nháp
              quiz với AI — luôn có giảng viên kiểm soát nội dung cuối cùng.
            </p>
            <div className="actions">
              <ButtonLink to="/courses">Khám phá khóa học</ButtonLink>
              <ButtonLink to="/auth/register/student" secondary>
                Bắt đầu học
              </ButtonLink>
            </div>
            <TextLink to="/lecturers">Dành cho giảng viên</TextLink>
          </div>
          <KnowledgeScene />
        </div>
      </section>
      <Section className="highlights soft">
        <div className="section-heading center">
          <h2>
            Một hành trình học tập.
            <br />
            Kết nối trọn vẹn.
          </h2>
          <p>Từ học liệu đến phản hồi, mỗi bước đều có mục đích.</p>
        </div>
        <div className="feature-rail">
          {[
            ["/courses", "01", "Khóa học", "Học liệu được tổ chức rõ ràng."],
            ["/classroom", "02", "Lớp học", "Kết nối thành viên và lịch học."],
            ["/assessment", "03", "Đánh giá", "Làm bài, nhận kết quả, hiểu hơn."],
            ["/progress", "04", "Tiến độ", "Nhìn lại từng bài học đã hoàn thành."],
          ].map(([to, n, title, desc]) => (
            <div key={to}>
              <span className="step-number">{n}</span>
              <h3>{title}</h3>
              <p>{desc}</p>
              <TextLink to={to}>Khám phá</TextLink>
            </div>
          ))}
        </div>
        <div className="trust-line">
          <span>AI có giảng viên phê duyệt</span>
          <span>Học liệu riêng tư</span>
          <span>Quyền truy cập rõ ràng</span>
        </div>
      </Section>
      <Section>
        <Reveal>
          <div className="section-heading">
            <p className="eyebrow">AI + HUMAN REVIEW</p>
            <h2>
              AI hỗ trợ.
              <br />
              Giảng viên quyết định.
            </h2>
            <p>Từ tài liệu đến bản nháp có cấu trúc. Quyết định cuối cùng luôn thuộc về người dạy.</p>
          </div>
          <Workflow />
          <TextLink to="/ai-learning">Khám phá quy trình AI</TextLink>
        </Reveal>
      </Section>
      <ScrollStory />
      <Section>
        <div className="section-heading">
          <p className="eyebrow">CÂU CHUYỆN SẢN PHẨM</p>
          <h2>Từ tài liệu đến cơ hội học tập.</h2>
          <p>Một minh họa ngắn về cách AI và giảng viên phối hợp.</p>
        </div>
        <VideoStory />
        <TextLink to="/media">Mở thư viện hình ảnh</TextLink>
      </Section>
      <Section className="soft">
        <div className="section-heading row">
          <div>
            <p className="eyebrow">KHÁM PHÁ KHÓA HỌC</p>
            <h2>Bắt đầu với điều bạn tò mò.</h2>
          </div>
          <TextLink to="/courses">Mở danh mục</TextLink>
        </div>
        <CourseSearch compact />
      </Section>
      <Section>
        <Reveal>
          <div className="split">
            <Picture name="students" alt="Ảnh minh họa sinh viên Việt Nam cùng học bên laptop" />
            <div>
              <p className="eyebrow">DÀNH CHO SINH VIÊN</p>
              <h2>Học theo nhịp của bạn.</h2>
              <p>Khám phá khóa học, tham gia lớp, theo dõi bài học hoàn thành và xem lại kết quả đánh giá.</p>
              <ProgressPreview />
              <TextLink to="/students">Khám phá trải nghiệm sinh viên</TextLink>
            </div>
          </div>
        </Reveal>
      </Section>
      <Section className="soft">
        <div className="split">
          <div>
            <p className="eyebrow">DÀNH CHO GIẢNG VIÊN</p>
            <h2>
              Dành tâm sức
              <br />
              cho việc giảng dạy.
            </h2>
            <p>
              Tổ chức học liệu, quản lý lớp và rà soát câu hỏi AI trong một hành trình có kiểm soát. Bạn quyết
              định nội dung nào sẵn sàng cho sinh viên.
            </p>
            <TextLink to="/lecturers">Khám phá trải nghiệm giảng viên</TextLink>
          </div>
          <div className="review-preview" data-reveal="depth">
            <small>Minh họa quy trình duyệt</small>
            <h3>Câu hỏi từ tài liệu của bạn</h3>
            <p>Cách nào giúp bạn ghi nhớ một khái niệm mới lâu hơn?</p>
            <div className="answer selected">Tự giải thích và luyện tập bằng ví dụ của mình.</div>
            <div className="answer">Chỉ đọc lại một lần trước giờ kiểm tra.</div>
            <div className="review-note">Chờ giảng viên kiểm tra đáp án và phê duyệt.</div>
            <TextLink to="/ai-quiz">Xem minh họa rà soát</TextLink>
          </div>
        </div>
      </Section>
      <Section>
        <div className="section-heading">
          <h2>
            Việc học tiếp tục.
            <br />
            Mọi kết nối được giữ lại.
          </h2>
        </div>
        <div className="experience-list">
          {[
            [
              "/classroom",
              "Lớp học có tổ chức",
              "Thành viên, mã tham gia, lịch học, phiên học và điểm danh trong cùng một bối cảnh.",
            ],
            [
              "/assessment",
              "Đánh giá có phản hồi",
              "Quiz, lượt làm bài và kết quả chấm khách quan giúp người học nhìn lại kiến thức.",
            ],
            [
              "/progress",
              "Tiến bộ có thể nhìn thấy",
              "Hoàn thành từng bài học và theo dõi tiến độ theo khóa học.",
            ],
            [
              "/notifications",
              "Thông tin đến đúng lúc",
              "Thông báo trong ứng dụng giúp theo dõi cập nhật lớp học và trạng thái đã đọc.",
            ],
          ].map(([to, title, description], i) => (
            <article key={to}>
              <span>0{i + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <TextLink to={to}>Tìm hiểu</TextLink>
            </article>
          ))}
        </div>
      </Section>
      <Section className="dark">
        <div className="section-heading">
          <p className="eyebrow">AN TÂM ĐỂ TẬP TRUNG</p>
          <h2>
            Việc học của bạn.
            <br />
            Quyền kiểm soát của bạn.
          </h2>
          <p>
            Học liệu có quyền truy cập rõ ràng. AI đưa ra gợi ý; giảng viên giữ quyết định cuối cùng. Tài
            khoản của bạn được bảo vệ trong suốt hành trình.
          </p>
        </div>
        <div className="trust-benefits" data-reveal="stagger">
          <article>
            <span>01</span>
            <h3>Học liệu đúng người</h3>
            <p>Nội dung riêng tư dành cho người được phép truy cập.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Nội dung có người duyệt</h3>
            <p>Câu hỏi AI cần được giảng viên kiểm tra trước khi sử dụng.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Thông tin minh bạch</h3>
            <p>Biết rõ trạng thái tài khoản và các lựa chọn bảo mật của bạn.</p>
          </article>
        </div>
        <TextLink to="/security">Cách AILSS bảo vệ trải nghiệm</TextLink>
      </Section>
      <Section className="soft">
        <div className="section-heading">
          <h2>
            Một nền tảng.
            <br />
            Hai hành trình.
          </h2>
        </div>
        <div className="journey-rail">
          <div>
            <h3>Sinh viên</h3>
            <p>Khám phá → Tham gia → Học → Đánh giá → Phản hồi</p>
          </div>
          <div>
            <h3>Giảng viên</h3>
            <p>Tạo → Tổ chức → AI hỗ trợ → Duyệt → Đánh giá</p>
          </div>
        </div>
        <TextLink to="/how-it-works">Xem từng bước</TextLink>
      </Section>
      <Section className="soft">
        <div className="section-heading row">
          <h2>Bạn còn băn khoăn?</h2>
          <TextLink to="/faq">Tất cả câu hỏi</TextLink>
        </div>
        <Faq compact />
      </Section>
      <Section className="final-cta dark">
        <p className="eyebrow">BƯỚC TIẾP THEO CỦA BẠN</p>
        <h2>
          Cùng mở rộng
          <br />
          khả năng học tập.
        </h2>
        <p>Bắt đầu bằng một khóa học. Tìm hiểu một cách dạy mới.</p>
        <div className="actions">
          <ButtonLink to="/auth/register">Bắt đầu cùng AILSS</ButtonLink>
          <ButtonLink to="/contact" secondary>
            Trao đổi với chúng tôi
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
