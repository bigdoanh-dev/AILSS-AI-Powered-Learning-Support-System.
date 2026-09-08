import { useEffect, useRef, useState } from "react";
import { Picture } from "./ui";
export function KnowledgeScene() {
  const host = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const mobile = matchMedia("(max-width: 760px)");
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let observer: IntersectionObserver | undefined;
    if (enabled && !motion.matches && !mobile.matches) {
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
      <Picture name="knowledge" alt="Quả cầu tri thức kết nối tài liệu, AI và bước giảng viên duyệt" eager />
      <div ref={host} className="webgl-layer" aria-hidden="true" />
      <div className="orbit-label top">01 · Tài liệu</div>
      <div className="orbit-label right">02 · AI tạo bản nháp</div>
      <div className="orbit-label bottom">03 · Giảng viên rà soát</div>
      <button className="scene-toggle" onClick={() => setEnabled(!enabled)} aria-pressed={enabled}>
        {enabled ? "Tạm dừng hiệu ứng 3D" : "Bật hiệu ứng 3D"}
      </button>
    </div>
  );
}
