import { useUiText } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import type { SceneController, ScenePreset } from "../lib/scene";

export function KnowledgeScene() {
  const uiText = useUiText();
  const host = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SceneController | null>(null);
  const [preset, setPreset] = useState<ScenePreset>("galaxy");

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
      controllerRef.current = null;
      if (motion.matches) return;

      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            observer?.disconnect();
            void import("../lib/scene")
              .then(({ mountScene }) => {
                if (!disposed && generation === current && !cleanup) {
                  cleanup = mountScene(element, (controller) => {
                    controllerRef.current = controller;
                  });
                }
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
      controllerRef.current = null;
    };
  }, []);

  const changePreset = (next: ScenePreset) => {
    setPreset(next);
    controllerRef.current?.setPreset(next);
  };

  const handleReset = () => {
    setPreset("galaxy");
    controllerRef.current?.resetView();
  };

  return (
    <div
      className="knowledge-scene"
      tabIndex={0}
      role="region"
      aria-label={uiText("Không gian tri thức tương tác")}
      aria-description={uiText(
        "Di chuyển chuột để tương tác với các hạt sáng. Kéo hoặc dùng phím mũi tên để xoay góc nhìn.",
      )}
    >
      <div className="galaxy-poster" aria-hidden="true" />
      <div ref={host} className="webgl-layer" aria-hidden="true" />

      <div className="scene-top-hud" aria-hidden="true">
        <div className="scene-live-tag">
          <span className="live-pulsing-dot" />
          <span>{uiText("8,600 Hạt tri thức 3D")}</span>
        </div>
        <div className="scene-hud-controls" role="group" aria-label={uiText("Góc nhìn không gian 3D")}>
          <button
            type="button"
            className={`scene-preset-btn ${preset === "galaxy" ? "active" : ""}`}
            onClick={() => changePreset("galaxy")}
            title={uiText("Xem toàn cảnh ngân hà tri thức")}
          >
            {uiText("🌌 Toàn cảnh")}
          </button>
          <button
            type="button"
            className={`scene-preset-btn ${preset === "orbit" ? "active" : ""}`}
            onClick={() => changePreset("orbit")}
            title={uiText("Quan sát các quỹ đạo tri thức")}
          >
            {uiText("⚡ Quỹ đạo")}
          </button>
          <button
            type="button"
            className={`scene-preset-btn ${preset === "core" ? "active" : ""}`}
            onClick={() => changePreset("core")}
            title={uiText("Tập trung vào lõi năng lượng")}
          >
            {uiText("✨ Lõi tri thức")}
          </button>
        </div>
      </div>

      <button
        type="button"
        className="scene-reset-corner-btn"
        onClick={handleReset}
        aria-label={uiText("Đặt lại góc nhìn dải ngân hà 3D")}
        title={uiText("Đặt lại góc nhìn")}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
    </div>
  );
}
