import { useEffect, useRef } from "react";

export interface TiltOptions {
  maxTilt?: number;
  scale?: number;
  speed?: number;
  glare?: boolean;
}

export function use3DTilt<T extends HTMLElement = HTMLDivElement>(options: TiltOptions = {}) {
  const ref = useRef<T>(null);
  const { maxTilt = 8, scale = 1.025, speed = 400, glare = true } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    if (reduced) return;

    let frame = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let isHovered = false;

    // Optional glare element inside card
    let glareEl = el.querySelector<HTMLElement>(".tilt-glare-effect");
    if (glare && !glareEl) {
      glareEl = document.createElement("div");
      glareEl.className = "tilt-glare-effect";
      glareEl.setAttribute("aria-hidden", "true");
      el.appendChild(glareEl);
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      targetX = (x - 0.5) * 2;
      targetY = (y - 0.5) * 2;
      isHovered = true;

      if (!frame) frame = requestAnimationFrame(update);
    };

    const onPointerLeave = () => {
      isHovered = false;
      targetX = 0;
      targetY = 0;
      if (!frame) frame = requestAnimationFrame(update);
    };

    const update = () => {
      frame = 0;
      const ease = isHovered ? 0.14 : 0.08;
      currentX += (targetX - currentX) * ease;
      currentY += (targetY - currentY) * ease;

      const rotateX = -currentY * maxTilt;
      const rotateY = currentX * maxTilt;
      const currentScale = isHovered ? scale : 1;

      el.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(${currentScale}, ${currentScale}, ${currentScale})`;

      if (glareEl) {
        if (isHovered) {
          const gx = (currentX * 0.5 + 0.5) * 100;
          const gy = (currentY * 0.5 + 0.5) * 100;
          glareEl.style.opacity = "1";
          glareEl.style.background = `radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.18), transparent 65%)`;
        } else {
          glareEl.style.opacity = "0";
        }
      }

      if (
        Math.abs(targetX - currentX) > 0.005 ||
        Math.abs(targetY - currentY) > 0.005 ||
        (isHovered && Math.abs(currentScale - scale) > 0.001)
      ) {
        frame = requestAnimationFrame(update);
      } else if (!isHovered) {
        el.style.transform = "";
      }
    };

    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerleave", onPointerLeave);

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerleave", onPointerLeave);
      el.style.transform = "";
      if (glareEl) glareEl.style.opacity = "0";
    };
  }, [maxTilt, scale, speed, glare]);

  return ref;
}
