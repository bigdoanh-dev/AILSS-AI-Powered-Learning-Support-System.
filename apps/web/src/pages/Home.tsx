import { useUiText } from "../lib/i18n";
import { LearningModes } from "../components/LearningModes";
import { Section, TextLink, ButtonLink, Picture } from "../components/ui";
import { KnowledgeScene } from "../components/KnowledgeScene";
import { Workflow } from "../components/Workflow";
import { Faq } from "../components/Faq";
import { CourseSearch } from "./Courses";
export function ProgressPreview() {
  const uiText = useUiText();
  const values = [
    ["Khám phá nội dung", 100],
    ["Hoàn thành bài học", 65],
    ["Sẵn sàng đánh giá", 40],
  ] as const;
  return (
    <div className="product-preview" data-reveal="depth">
      <div className="preview-top">
        <strong>{uiText("Hành trình học tập")}</strong>
        <small>{uiText("Minh họa giao diện")}</small>
      </div>
      <h3>{uiText("Mỗi bài học là một bước tiến.")}</h3>
      {values.map(([label, value]) => (
        <div className="progress-row" key={label}>
          <div>
            <span>{uiText(label)}</span>
            <span>{value}%</span>
          </div>
          <div className="progress-bar">
            <span style={{ width: `${value}%` }} />
          </div>
        </div>
      ))}
      <small>{uiText("Số liệu minh họa, không phải dữ liệu của người dùng.")}</small>
    </div>
  );
}
import { MetricsBanner } from "../components/MetricsBanner";

export default function Home() {
  const uiText = useUiText();
  return (
    <>
      <section className="commercial-hero astra-hero">
        <div className="astra-hero-universe">
          <KnowledgeScene />
        </div>

        <div className="astra-hero-typography" aria-hidden="true">
          <div className="astra-brand-side astra-brand-left">{uiText("AILSS")}</div>
          <div className="astra-brand-side astra-brand-right">{uiText("Tri thức")}</div>
        </div>

        <div className="container astra-hero-dock">
          <div className="hero-eyebrow-pill" aria-hidden="true">
            <span className="pill-pulse" />
            <span>{uiText("Nền tảng Giáo dục AI Thế hệ mới")}</span>
          </div>
          <h1>
            {uiText("Mỗi điều bạn học.")}
            <br />
            {uiText("Một khả năng mới.")}
          </h1>
          <p className="lead">
            {uiText(
              "Từ bài giảng đầu tiên đến dự án của riêng bạn. Khám phá khóa học, luyện tập và tiến bộ cùng giảng viên và AI.",
            )}
          </p>
          <div className="actions astra-hero-actions">
            <ButtonLink to="/courses">{uiText("Khám phá khóa học")}</ButtonLink>
            <ButtonLink secondary to="/auth/register/lecturer">
              {uiText("Tôi muốn giảng dạy")}
            </ButtonLink>
          </div>

          <a
            href="#explore-sections"
            className="astra-scroll-cue"
            aria-label={uiText("Cuộn xuống để xem nội dung")}
          >
            <span>{uiText("Cuộn để khám phá")}</span>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 10l5 5 5-5" />
            </svg>
          </a>
        </div>
      </section>

      <div id="explore-sections">
        <MetricsBanner />
      </div>

      <LearningModes />

      <Section className="homepage-courses">
        <div className="section-heading row">
          <div>
            <h2>{uiText("Bắt đầu với điều bạn tò mò.")}</h2>
            <p>{uiText("Học liệu có tổ chức. Bài tập để vận dụng. Một hành trình rõ ràng.")}</p>
          </div>
          <TextLink to="/courses">{uiText("Tất cả khóa học")}</TextLink>
        </div>
        <CourseSearch compact />
      </Section>

      <Section className="learning-story">
        <div className="split">
          <Picture name="study" alt={uiText("Minh họa hai học viên cùng thảo luận trong thư viện")} />
          <div>
            <h2>
              {uiText("Học một mình.")}
              <br />
              {uiText("Không phải đi một mình.")}
            </h2>
            <p>
              {uiText(
                "Gặp giảng viên, đặt câu hỏi và theo dõi bài học ngay trong lớp. Video, tài liệu và bài tập ở cùng một nơi để bạn tập trung vào điều cần học.",
              )}
            </p>
            <div className="story-features">
              <p>
                <strong>01</strong> {uiText(" Học qua video và tài liệu")}
              </p>
              <p>
                <strong>02</strong> {uiText(" Vận dụng qua bài luyện tập")}
              </p>
              <p>
                <strong>03</strong> {uiText(" Nhận phản hồi và theo dõi tiến độ")}
              </p>
            </div>
            <TextLink to="/auth/register/student">{uiText("Tạo tài khoản học viên")}</TextLink>
          </div>
        </div>
      </Section>

      <Section className="ai-story">
        <div className="split">
          <div>
            <h2>
              {uiText("Thêm thời gian")}
              <br />
              {uiText("cho việc giảng dạy.")}
            </h2>
            <p>
              {uiText(
                "Chuẩn bị câu hỏi từ tài liệu với trợ lý AI. Rà soát nội dung, điều chỉnh đáp án và quyết định khi nào bài kiểm tra sẵn sàng cho học viên.",
              )}
            </p>
            <TextLink to="/ai-learning">{uiText("Tìm hiểu trợ lý AI")}</TextLink>
          </div>
          <Picture name="ai" alt={uiText("Mạng kết nối tri thức, hình minh họa tạo bằng AI")} />
        </div>

        <div className="ai-studio-showcase">
          <div className="studio-caption">
            <span className="eyebrow">AILSS AI STUDIO</span>
            <h3>{uiText("Giao diện làm việc & rà soát bài giảng thực tế")}</h3>
            <p>
              {uiText(
                "Minh họa quy trình trích xuất tài liệu nguồn, tạo câu hỏi tự động và sự phê duyệt của giảng viên.",
              )}
            </p>
          </div>
          <div className="studio-preview-card">
            <div className="studio-window-bar" aria-hidden="true">
              <span className="window-dot red" />
              <span className="window-dot yellow" />
              <span className="window-dot green" />
              <span className="studio-window-title">ailss.edu.vn / studio / exam-composer</span>
              <span className="studio-window-badge">{uiText("Trợ lý AI v2.4")}</span>
            </div>
            <picture>
              <source
                type="image/avif"
                srcSet="/assets/media/ai-workspace-preview-640.avif 640w, /assets/media/ai-workspace-preview-1280.avif 1280w"
                sizes="(max-width: 1000px) 100vw, 1200px"
              />
              <img
                src="/assets/media/ai-workspace-preview-1280.webp"
                srcSet="/assets/media/ai-workspace-preview-640.webp 640w, /assets/media/ai-workspace-preview-1280.webp 1280w"
                sizes="(max-width: 1000px) 100vw, 1200px"
                alt={uiText("Giao diện làm việc thực tế của trợ lý AI và màn hình rà soát của giảng viên")}
                width="1280"
                height="853"
                loading="lazy"
                decoding="async"
              />
            </picture>
          </div>
        </div>

        <Workflow />
      </Section>

      <Section>
        <div className="section-heading row">
          <h2>{uiText("Bạn còn băn khoăn?")}</h2>
          <TextLink to="/help">{uiText("Trung tâm trợ giúp")}</TextLink>
        </div>
        <Faq compact />
      </Section>

      <Section className="join-band">
        <div>
          <h2>
            {uiText("Điều mới tiếp theo,")}
            <br />
            {uiText("bắt đầu từ hôm nay.")}
          </h2>
          <p>{uiText("Chọn hành trình học tập hoặc chia sẻ kiến thức của bạn.")}</p>
        </div>
        <div className="actions">
          <ButtonLink to="/auth/register/student">{uiText("Bắt đầu học")}</ButtonLink>
          <ButtonLink to="/auth/register/lecturer" secondary>
            {uiText("Trở thành giảng viên")}
          </ButtonLink>
        </div>
      </Section>
    </>
  );
}
