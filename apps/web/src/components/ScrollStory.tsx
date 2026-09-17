import { useEffect, useRef, useState } from "react";

const stages = [
  [
    "Tài liệu của bạn",
    "Bắt đầu từ giáo trình, bài giảng và tài liệu học tập bạn muốn chia sẻ.",
    "PDF · DOCX · TXT",
  ],
  [
    "RAG & Trích xuất ngữ nghĩa",
    "Phân đoạn thông minh (Semantic Chunking) và tạo Vector Embeddings riêng tư.",
    "Trích xuất & Vector DB",
  ],
  [
    "AI soạn thảo bản nháp",
    "Mô hình AI chuyên sâu phân tích tài liệu và định hình ngân hàng câu hỏi có cấu trúc.",
    "Sinh câu hỏi theo RAG",
  ],
  [
    "Định hình thang đo Bloom",
    "Chuẩn hóa 6 cấp độ từ Nhận biết, Thông hiểu tới Vận dụng, Phân tích chuyên sâu.",
    "Ma trận Bloom L1 - L6",
  ],
  [
    "Giảng viên rà soát & quyết định",
    "Kiểm tra đối chiếu tài liệu nguồn, tinh chỉnh câu từ và phê duyệt phương án chính xác.",
    "Rà soát & Phê duyệt",
  ],
  [
    "Đề thi nháp & Luyện tập thích ứng",
    "Xuất bản bài đánh giá nháp, kích hoạt trợ lý AI luyện đề cá nhân hóa theo năng lực.",
    "Luyện thi thích ứng AI",
  ],
];

export function ScrollStory() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);

  // Auto-play cycling through 3D stages every 4 seconds
  useEffect(() => {
    if (!autoPlay) return;
    const timer = setInterval(() => {
      setActive((prev) => (prev + 1) % stages.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [autoPlay]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) {
          setActive(Number((visible[visible.length - 1].target as HTMLElement).dataset.stage));
        }
      },
      { rootMargin: "-28% 0px -38% 0px", threshold: 0 },
    );
    root.current?.querySelectorAll("[data-stage]").forEach((e) => observer.observe(e));
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={root} className="scroll-story section dark">
      <div className="container story-grid">
        <div className="story-sticky">
          <p className="eyebrow">TỪ Ý TƯỞNG ĐẾN BÀI HỌC</p>
          <h2>
            Tri thức chuyển động.
            <br />
            Bạn giữ tay lái.
          </h2>
          <p>Cuộn hoặc xem tự động để khám phá cách tài liệu trở thành một cơ hội học tập.</p>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 12 }}>
            <button
              type="button"
              className="button button-subtle button-small"
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                color: "#7dd3fc",
                border: "1px solid rgba(125,211,252,0.25)",
                cursor: "pointer",
              }}
              onClick={() => setAutoPlay(!autoPlay)}
              title={autoPlay ? "Bấm để tạm dừng tự động chuyển động" : "Bấm để tiếp tục tự động chuyển động"}
            >
              <span>{autoPlay ? "⏸ Tự động chuyển động 3D: Bật" : "▶ Tiếp tục chuyển động 3D"}</span>
            </button>
          </div>

          <div
            className="story-stage"
            aria-hidden="true"
            style={{ "--stage": active } as React.CSSProperties}
          >
            <div className="story-halo" />
            <div className="story-stack">
              <span className="story-sheet sheet-back" />
              <span className="story-sheet sheet-middle" />
              <div className="story-sheet sheet-front">
                <span>AILSS / 0{active + 1}</span>
                <strong key={active} className="panel-motion">
                  {stages[active][2]}
                </strong>
                <i />
                <i />
                <i />
                <b>✦</b>
              </div>
            </div>
            <div className="story-rail" data-reveal="line">
              <span style={{ transform: `scaleX(${(active + 1) / 6})` }} />
            </div>
          </div>
          <small>Minh họa quy trình. AI không tự xuất bản bài kiểm tra.</small>
        </div>
        <ol className="story-chapters">
          {stages.map(([title, copy], i) => (
            <li
              key={title}
              data-stage={i}
              className={active === i ? "is-current" : ""}
              onClick={() => {
                setActive(i);
                setAutoPlay(false);
              }}
              style={{ cursor: "pointer" }}
              title={`Nhấp để chuyển sang giai đoạn 0${i + 1}`}
            >
              <span className="story-number">0{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

