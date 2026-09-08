import { useEffect, useRef, useState } from "react";
const stages = [
  ["Tài liệu của bạn", "Bắt đầu từ học liệu bạn muốn chia sẻ.", "PDF · DOCX · TXT"],
  [
    "Kết nối kiến thức",
    "Đưa những ý chính trong tài liệu vào quá trình chuẩn bị câu hỏi.",
    "Đọc & trích xuất",
  ],
  [
    "AI hỗ trợ bản nháp",
    "Có một điểm bắt đầu để giảng viên rà soát, thay vì soạn từ trang trắng.",
    "Câu hỏi đề xuất",
  ],
  [
    "Giảng viên quyết định",
    "Kiểm tra đáp án, chỉnh sửa cách hỏi và duyệt nội dung phù hợp.",
    "Rà soát & chỉnh sửa",
  ],
  [
    "Chuẩn bị bài kiểm tra",
    "Đưa câu hỏi đã duyệt vào bài đánh giá nháp để tiếp tục biên tập.",
    "Bài đánh giá nháp",
  ],
  [
    "Một bước tiến của người học",
    "Nội dung được chuẩn bị kỹ để người học luyện tập và hiểu rõ hơn.",
    "Học · Luyện tập · Phản hồi",
  ],
];
export function ScrollStory() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length)
          setActive(Number((visible[visible.length - 1].target as HTMLElement).dataset.stage));
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
          <p>Cuộn để khám phá cách tài liệu trở thành một cơ hội học tập.</p>
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
            <li key={title} data-stage={i} className={active === i ? "is-current" : ""}>
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
