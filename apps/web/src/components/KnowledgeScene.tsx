import { useEffect, useRef, useState } from "react";
import { Picture } from "./ui";
export function KnowledgeScene() {
  const host = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let observer: IntersectionObserver | undefined;
    if (enabled && !motion.matches) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            observer?.disconnect();
            void import("../lib/scene")
              .then(({ mountScene }) => {
                if (!disposed) cleanup = mountScene(element);
              })
              .catch(() => {
                /* Poster remains fully available. */
              });
          }
        },
        { rootMargin: "80px" },
      );
      observer.observe(element);
    }
    return () => {
      disposed = true;
      observer?.disconnect();
      cleanup?.();
    };
  }, [enabled]);
  return (
    <div className="knowledge-scene">
      <Picture name="ai" alt="Kết nối tri thức với khối 3D và các học liệu chuyển động" eager />
      <div ref={host} className="webgl-layer" aria-hidden="true" />
      <div className="orbit-label top">▤ Tài liệu của bạn</div>
      <div className="orbit-label right">✧ AI kết nối ý tưởng</div>
      <div className="orbit-label bottom">✓ Giảng viên hướng dẫn</div>
      <span className="scene-status">Di chuyển chuột để khám phá</span>
      <button className="scene-toggle" onClick={() => setEnabled(!enabled)} aria-pressed={enabled}>
        {enabled ? "Tạm dừng hiệu ứng 3D" : "Bật hiệu ứng 3D"}
      </button>
    </div>
  );
}
