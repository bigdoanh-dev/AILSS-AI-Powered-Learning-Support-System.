import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { flushSync } from "react-dom";
import { mountScrollMotion } from "../motion/scroll";
export function Motion() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    let intent = 0;
    const click = async (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      const a = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href);
      if (
        url.origin !== location.origin ||
        url.pathname === location.pathname ||
        url.hash ||
        url.pathname.startsWith("/app") ||
        location.pathname.startsWith("/app")
      )
        return;
      const doc = document as Document & {
        startViewTransition?: (callback: () => void) => { finished: Promise<void> };
      };
      if (!doc.startViewTransition) return;
      event.preventDefault();
      const id = ++intent;
      const source = location.href;
      try {
        if (
          url.pathname.startsWith("/auth") ||
          ["/contact", "/faq", "/help", "/media"].includes(url.pathname)
        )
          await import("../pages/Support");
        else if (
          ["/security", "/research", "/roadmap", "/accessibility"].includes(url.pathname) ||
          url.pathname.startsWith("/legal")
        )
          await import("../pages/Trust");
        else if (!["/", "/courses"].includes(url.pathname) && !url.pathname.startsWith("/courses/"))
          await import("../pages/Platform");
      } catch {
        if (id !== intent || location.href !== source) return;
        navigate(url.pathname + url.search);
        return;
      }
      if (id !== intent || location.href !== source) return;
      doc
        .startViewTransition(() => {
          flushSync(() => navigate(url.pathname + url.search));
        })
        .finished.catch(() => {});
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, [navigate]);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const animations = new Set<Animation>();
    const seen = new WeakSet<Element>();
    let stopScroll: (() => void) | undefined;
    const reveal = (element: Element) => {
      if (preference.matches || !element.animate) return;
      const kind = (element as HTMLElement).dataset.reveal;
      const frames =
        kind === "mask"
          ? [
              { clipPath: "inset(8% 0 8% 0 round 24px)", transform: "scale(.97)" },
              { clipPath: "inset(0% 0 0% 0 round 24px)", transform: "scale(1)" },
            ]
          : kind === "line"
            ? [
                { transform: "scaleX(.15)", opacity: 0.2 },
                { transform: "scaleX(1)", opacity: 1 },
              ]
            : [
                {
                  opacity: 0.15,
                  transform: `translateY(${kind === "text" ? 14 : 28}px) scale(${kind === "depth" ? 0.975 : 1})`,
                },
                { opacity: 1, transform: "translateY(0) scale(1)" },
              ];
      const targets = kind === "stagger" ? [...element.children] : [element];
      targets.forEach((target, index) => {
        const animation = target.animate(frames, {
          duration: kind === "mask" ? 1000 : 820,
          delay: Math.min(index * 65, 260),
          easing: "cubic-bezier(.22,1,.36,1)",
          fill: "backwards",
        });
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            reveal(e.target);
            observer.unobserve(e.target);
          }
      },
      { threshold: 0.01, rootMargin: "0px 0px 40px 0px" },
    );
    const scan = () => {
      document
        .querySelectorAll(
          "main .section-heading, main .page-hero .container, main .hero-copy, main [data-reveal], main .feature-rail, main .experience-list, main .split > picture",
        )
        .forEach((element) => {
          if (seen.has(element)) return;
          seen.add(element);
          if (!element.hasAttribute("data-reveal"))
            (element as HTMLElement).dataset.reveal = element.matches("picture")
              ? "mask"
              : element.matches(".feature-rail,.experience-list")
                ? "stagger"
                : "text";
          observer.observe(element);
        });
      const root = document.querySelector<HTMLElement>("main");
      if (
        root &&
        !stopScroll &&
        !preference.matches &&
        matchMedia("(min-width: 761px) and (pointer: fine)").matches
      )
        stopScroll = mountScrollMotion(root);
    };
    const mutations = new MutationObserver(scan);
    mutations.observe(document.getElementById("root")!, { childList: true, subtree: true });
    const reduce = () => {
      animations.forEach((a) => a.cancel());
      stopScroll?.();
      stopScroll = undefined;
      if (!preference.matches) scan();
    };
    preference.addEventListener("change", reduce);
    scan();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      animations.forEach((a) => a.cancel());
      stopScroll?.();
      preference.removeEventListener("change", reduce);
    };
  }, [pathname]);
  return <div className="reading-progress" aria-hidden="true" />;
}
