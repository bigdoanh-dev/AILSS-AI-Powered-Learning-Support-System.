import { useEffect, useRef } from "react";
export function KnowledgeScene() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let generation = 0;
    let cleanup: (() => void) | undefined;
    let observer: IntersectionObserver | undefined;
    const observe = () => {
      const current = ++generation;
      observer?.disconnect();
      cleanup?.();
      cleanup = undefined;
      if (motion.matches) return;
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            observer?.disconnect();
            void import("../lib/scene")
              .then(({ mountScene }) => {
                if (!disposed && generation === current && !cleanup) cleanup = mountScene(element);
              })
              .catch(() => {
                /* Poster remains fully available. */
              });
          }
        },
        { rootMargin: "80px" },
      );
      observer.observe(element);
    };
    observe();
    motion.addEventListener("change", observe);
    return () => {
      disposed = true;
      motion.removeEventListener("change", observe);
      observer?.disconnect();
      cleanup?.();
    };
  }, []);
  return (
    <div
      className="knowledge-scene"
      tabIndex={0}
      role="region"
      aria-label="Không gian tri thức tương tác"
      aria-description="Di chuyển chuột để tương tác với các hạt sáng. Kéo hoặc dùng phím mũi tên để xoay góc nhìn."
    >
      <div className="galaxy-poster" aria-hidden="true" />
      <div ref={host} className="webgl-layer" aria-hidden="true" />
      <div className="galaxy-caption">
        <span>AILSS</span>
        <strong>
          Không gian
          <br />
          tri thức.
        </strong>
      </div>
      <span className="scene-status">Di chuột để khám phá · Kéo để xoay</span>
    </div>
  );
}
