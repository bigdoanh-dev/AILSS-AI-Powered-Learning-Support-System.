import { useUiText } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
export function VideoStory() {
  const uiText = useUiText();
  const [ready, setReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const observer = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) element.pause();
    });
    observer.observe(element);
    const pause = () => {
      if (document.hidden) element.pause();
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", pause);
    };
  }, [ready]);
  return (
    <div className="video-story cinematic-video" data-reveal="mask">
      <div className="video-frame">
        {ready ? (
          <video
            ref={video}
            controls
            muted
            playsInline
            preload="metadata"
            poster="/assets/media/workflow-poster.svg"
            width="1280"
            height="720"
          >
            <source src="/assets/media/ailss-workflow.webm" type="video/webm" />
            <track
              kind="captions"
              src="/assets/media/workflow.vi.vtt"
              srcLang="vi"
              label={uiText("Tiếng Việt")}
              default
            />
            {uiText("Trình duyệt không hỗ trợ video. Xem bản mô tả bên dưới.")}
          </video>
        ) : (
          <button
            className="video-launch"
            onClick={() => setReady(true)}
            aria-label={uiText("Tải video quy trình AI")}
          >
            <img
              src="/assets/media/workflow-poster.svg"
              alt={uiText("Từ tài liệu đến bài đánh giá: AI hỗ trợ, giảng viên quyết định")}
              width="1280"
              height="720"
              loading="lazy"
            />
            <span>{uiText("▶ Xem câu chuyện sản phẩm · 18 giây")}</span>
          </button>
        )}
      </div>
      <details>
        <summary>{uiText("Bản mô tả video")}</summary>
        <p>
          {uiText(
            "Tài liệu PDF, DOCX hoặc TXT được trích xuất riêng tư. AI tạo bản nháp câu hỏi từ nội dung tài liệu. Giảng viên rà soát, chỉnh sửa và phê duyệt. Bản đã duyệt được chuyển thành bài đánh giá nháp; AI không tự xuất bản quiz.",
          )}
        </p>
      </details>
    </div>
  );
}
