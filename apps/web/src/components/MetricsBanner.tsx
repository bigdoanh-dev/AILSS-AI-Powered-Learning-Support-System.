import { useLanguage } from "../lib/i18n";
import { useUiText } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";

interface MetricItem {
  id: string;
  icon: string;
  target: number;
  prefix?: string;
  suffix: string;
  label: string;
  description: string;
  decimals?: number;
}

const metrics: MetricItem[] = [
  {
    id: "lessons",
    icon: "📚",
    target: 50000,
    suffix: "+",
    label: "Bài học tương tác",
    description: "Nội dung chuẩn hóa, thực hành qua video & quiz",
  },
  {
    id: "accuracy",
    icon: "🎯",
    target: 99.2,
    suffix: "%",
    decimals: 1,
    label: "Giảng viên kiểm duyệt",
    description: "100% câu hỏi AI đều qua rà soát của con người",
  },
  {
    id: "tutor",
    icon: "⚡",
    target: 24,
    suffix: "/7",
    label: "Trợ lý học tập AI",
    description: "Giải đáp thắc mắc và gợi ý lộ trình ngay lập tức",
  },
  {
    id: "rating",
    icon: "⭐",
    target: 4.9,
    suffix: "/5",
    decimals: 1,
    label: "Đánh giá hài lòng",
    description: "Từ hàng ngàn học viên và giảng viên đồng hành",
  },
];

export function MetricsBanner() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(false);
  const [counts, setCounts] = useState<number[]>(metrics.map(() => 0));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const reduced =
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    if (reduced) {
      setCounts(metrics.map((m) => m.target));
      setActivated(true);
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setActivated(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActivated(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activated) return;
    const reduced =
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    if (reduced) return;

    const startTime = performance.now();
    const duration = 1800; // ms

    let frame = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(now - startTime, duration);
      const progress = elapsed / duration;
      // Smooth ease-out cubic
      const ease = 1 - Math.pow(1 - progress, 3);

      setCounts(metrics.map((m) => m.target * ease));

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setCounts(metrics.map((m) => m.target));
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [activated]);

  return (
    <section
      className="metrics-banner-section"
      ref={containerRef}
      aria-label={uiText("Thống kê ấn tượng của AILSS")}
    >
      <div className="container">
        <div className="metrics-grid">
          {metrics.map((metric, idx) => {
            const displayValue =
              metric.decimals !== undefined
                ? counts[idx].toFixed(metric.decimals)
                : Math.round(counts[idx]).toLocaleString(uiLocale);

            return (
              <div className="metric-card" key={metric.id}>
                <div className="metric-icon-wrap" aria-hidden="true">
                  <span>{metric.icon}</span>
                </div>
                <div className="metric-value-wrap">
                  <span className="metric-number">
                    {metric.prefix}
                    {displayValue}
                    {metric.suffix}
                  </span>
                </div>
                <strong className="metric-label">{uiText(metric.label)}</strong>
                <p className="metric-desc">{uiText(metric.description)}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
