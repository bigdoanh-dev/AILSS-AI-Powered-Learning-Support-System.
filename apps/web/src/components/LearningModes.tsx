import { useUiText } from "../lib/i18n";
import { Link } from "react-router-dom";
import { TiltCard } from "./TiltCard";

const modes = [
  {
    name: "Khóa học video",
    code: "SELF_PACED",
    tag: "Tự học theo tiến độ",
    icon: "⚡",
    image: "mode-self-paced",
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
    icon: "🎙️",
    image: "mode-live-cohort",
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
    icon: "🏛️",
    image: "mode-private-class",
    description: "Tham gia lớp do giảng viên hoặc đơn vị tổ chức bằng mã mời hay được thêm vào lớp.",
    entry: "Nhập mã tham gia hoặc được thêm",
    schedule: "Có thể có lịch tùy lớp",
    format: "Trực tiếp, trực tuyến hoặc kết hợp",
    to: "/app/classes",
    action: "Tham gia bằng mã lớp",
  },
];

export function LearningModes() {
  const uiText = useUiText();
  return (
    <section className="section learning-modes">
      <div className="container">
        <div className="section-heading">
          <h2>{uiText("Ba cách học. Chọn cách phù hợp với bạn.")}</h2>
          <p>{uiText("Cách tham gia, lịch học và hình thức tổ chức được phân biệt ngay từ đầu.")}</p>
        </div>
        <div className="learning-modes-grid">
          {modes.map((source) => {
            const mode = {
              ...source,
              name: uiText(source.name),
              tag: uiText(source.tag),
              description: uiText(source.description),
              entry: uiText(source.entry),
              schedule: uiText(source.schedule),
              format: uiText(source.format),
              action: uiText(source.action),
            };
            return (
              <TiltCard
                as="article"
                key={mode.code}
                className="learning-mode-card"
                tiltOptions={{ maxTilt: 6, scale: 1.02 }}
              >
                <div className="mode-media-wrap">
                  <picture>
                    <source
                      type="image/avif"
                      srcSet={`/assets/media/${mode.image}-640.avif 640w, /assets/media/${mode.image}-1280.avif 1280w`}
                      sizes="(max-width: 760px) 100vw, 33vw"
                    />
                    <img
                      className="mode-cover-image"
                      src={`/assets/media/${mode.image}-1280.webp`}
                      srcSet={`/assets/media/${mode.image}-640.webp 640w, /assets/media/${mode.image}-1280.webp 1280w`}
                      sizes="(max-width: 760px) 100vw, 33vw"
                      alt={uiText("Minh họa hình thức {0}", [mode.name])}
                      width="1280"
                      height="853"
                      loading="lazy"
                      decoding="async"
                    />
                  </picture>
                  <span className="mode-tag-overlay">
                    <span aria-hidden="true">{mode.icon}</span> {mode.tag}
                  </span>
                </div>
                <div className="mode-content">
                  <span className="mode-tag">{mode.tag}</span>
                  <h3>{mode.name}</h3>
                  <p>{mode.description}</p>
                  <dl>
                    <dt>{uiText("Cách tham gia")}</dt>
                    <dd>{mode.entry}</dd>
                    <dt>{uiText("Lịch học")}</dt>
                    <dd>{mode.schedule}</dd>
                    <dt>{uiText("Hình thức")}</dt>
                    <dd>{mode.format}</dd>
                  </dl>
                  <Link className="button secondary" to={mode.to}>
                    {mode.action}
                  </Link>
                </div>
              </TiltCard>
            );
          })}
        </div>
      </div>
    </section>
  );
}
