import { useUiText } from "../lib/i18n";
import { useEffect, useRef } from "react";
import type { NotFoundSceneController } from "../lib/notFound3dScene";

export function NotFound3DScene() {
  const uiText = useUiText();
  const host = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<NotFoundSceneController | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const motion =
      typeof matchMedia === "function"
        ? matchMedia("(prefers-reduced-motion: reduce)")
        : { matches: false, addEventListener: () => {}, removeEventListener: () => {} };

    let disposed = false;
    let generation = 0;
    let cleanup: (() => void) | undefined;
    let observer: IntersectionObserver | undefined;

    const observe = () => {
      const current = ++generation;
      observer?.disconnect();
      cleanup?.();
      cleanup = undefined;
      controllerRef.current = null;
      if (motion.matches) return;
      if (typeof IntersectionObserver === "undefined") return;

      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            observer?.disconnect();
            void import("../lib/notFound3dScene")
              .then(({ mountNotFoundScene }) => {
                if (!disposed && generation === current && !cleanup) {
                  cleanup = mountNotFoundScene(element, (controller) => {
                    controllerRef.current = controller;
                  });
                }
              })
              .catch(() => {});
          }
        },
        { rootMargin: "100px" },
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
      controllerRef.current = null;
    };
  }, []);

  return (
    <div
      className="notfound-scene-container"
      tabIndex={0}
      role="region"
      aria-label={uiText("Mô hình 3D 404 tương tác")}
      aria-description={uiText("Kéo chuột để xoay 3D hoặc nhấp để tạo sóng xung lượng.")}
    >
      <div ref={host} className="notfound-webgl-layer" aria-hidden="true" />
      <div className="notfound-ambient-backdrop" aria-hidden="true" />
    </div>
  );
}
