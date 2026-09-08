export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export interface ScrollState {
  position: number;
  velocity: number;
  direction: number;
  progress: number;
}
export function advanceScroll(state: ScrollState, target: number, dt: number, range: number): ScrollState {
  const alpha = 1 - Math.exp(-clamp(dt, 0, 64) / 115);
  const delta = target - state.position;
  return {
    position: state.position + delta * alpha,
    velocity: state.velocity + (clamp(delta / Math.max(dt, 1), -3, 3) - state.velocity) * alpha,
    direction: Math.abs(delta) < 0.1 ? 0 : Math.sign(delta),
    progress: clamp(target / Math.max(range, 1), 0, 1),
  };
}
// Passive input; only decorative transforms are written. No scroll position writes.
export function mountScrollMotion(root: HTMLElement) {
  let state: ScrollState = { position: scrollY, velocity: 0, direction: 0, progress: 0 };
  let target = scrollY,
    frame = 0,
    last = 0;
  const media = [
    ...root.querySelectorAll<HTMLElement>("[data-parallax], .knowledge-scene > picture, .split > picture"),
  ];
  const active = new Set<HTMLElement>();
  const offsets = new WeakMap<HTMLElement, number>();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) =>
      e.isIntersecting ? active.add(e.target as HTMLElement) : active.delete(e.target as HTMLElement),
    );
    wake();
  });
  media.forEach((e) => observer.observe(e));
  function render(time: number) {
    frame = 0;
    const dt = last ? time - last : 16;
    last = time;
    state = advanceScroll(state, target, dt, document.documentElement.scrollHeight - innerHeight);
    document.documentElement.style.setProperty("--scroll-progress", String(state.progress));
    root.style.setProperty("--scroll-velocity", String(state.velocity));
    for (const element of active) {
      const rect = element.parentElement!.getBoundingClientRect();
      const depth = clamp((innerHeight / 2 - rect.top - rect.height / 2) * 0.045, -22, 22);
      const previous = offsets.get(element) || 0;
      const next =
        previous + (depth - state.velocity * 2 - previous) * (1 - Math.exp(-Math.min(dt, 64) / 140));
      offsets.set(element, next);
      element.style.translate = `0 ${next}px`;
    }
    if (Math.abs(target - state.position) > 0.08 || Math.abs(state.velocity) > 0.005)
      frame = requestAnimationFrame(render);
    else last = 0;
  }
  function wake() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(render);
  }
  const scroll = () => {
    target = scrollY;
    wake();
  };
  const visible = () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else scroll();
  };
  addEventListener("scroll", scroll, { passive: true });
  addEventListener("resize", scroll, { passive: true });
  document.addEventListener("visibilitychange", visible);
  wake();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    removeEventListener("scroll", scroll);
    removeEventListener("resize", scroll);
    document.removeEventListener("visibilitychange", visible);
    media.forEach((e) => e.style.removeProperty("translate"));
    root.style.removeProperty("--scroll-velocity");
    document.documentElement.style.removeProperty("--scroll-progress");
  };
}
