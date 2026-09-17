import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { flushSync } from "react-dom";
import { mountScrollMotion } from "../motion/scroll";

type RevealKind = "depth" | "line" | "mask" | "text";
type RevealTarget = { element: HTMLElement; kind: RevealKind; delay: number };

const GROUP_SELECTOR = [
  ".account-grid",
  ".admin-list",
  ".ai-workspace-grid",
  ".builder-question-list",
  ".calendar-list",
  ".card-grid",
  ".check-list",
  ".class-breakdown-table tbody",
  ".cognitive-levels-list",
  ".contact-grid",
  ".course-grid",
  ".course-progress-list",
  ".dashboard-data-table tbody",
  ".experience-list",
  ".feature-rail",
  ".gallery-grid",
  ".help-grid",
  ".home-card-list",
  ".home-section-grid",
  ".instructor-grid",
  ".learning-modes-grid",
  ".media-grid",
  ".notification-list",
  ".readiness-list",
  ".sepay-status-grid",
  ".service-grid",
  ".stats-charts-row",
  ".study-grid",
  ".timeline",
  ".user-stats-grid",
  ".workspace-cards",
  ".workspace-kpi-grid",
].join(",");

const PANEL_SELECTOR = [
  ".admin-welcome",
  ".ai-hero",
  ".application-panel",
  ".attendance-scroll",
  ".dashboard-heading",
  ".dashboard-section-card",
  ".form-panel",
  ".kpi-card",
  ".preview-panel",
  ".recharts-pie-wrapper",
  ".recharts-radar-wrapper",
  ".recharts-wrapper",
  ".schedule-panel",
  ".study-card",
  ".verification-welcome",
].join(",");

function visibleBlock(element: HTMLElement) {
  if (
    element.matches("script,style,link,template,.route-loading,.sr-only,[role='dialog']") ||
    element.closest(
      "[hidden],[aria-hidden='true'],dialog:not([open]),[role='dialog'],.auth-environment,.auth-main,.focused-auth",
    )
  )
    return false;
  const style = getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.position !== "fixed" &&
    element.getBoundingClientRect().width > 1 &&
    element.getBoundingClientRect().height > 1
  );
}

function revealKind(element: HTMLElement): RevealKind {
  const requested = element.dataset.reveal;
  if (requested === "depth" || requested === "line" || requested === "mask" || requested === "text")
    return requested;
  if (element.matches("picture,img,table,.attendance-scroll,.gallery-item,.video-story,.recharts-wrapper,.recharts-pie-wrapper,.recharts-radar-wrapper")) return "mask";
  if (element.matches("article,.study-card,.form-panel,.application-panel,.preview-panel,.dashboard-section-card,.kpi-card,.cognitive-level-card")) return "depth";
  return "text";
}

function siblingDelay(element: HTMLElement) {
  const parent = element.parentElement;
  if (!parent?.matches(GROUP_SELECTOR)) return 0;
  const siblings = [...parent.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
  return Math.min(Math.max(0, siblings.indexOf(element)) * 120, 600);
}

/** Finds meaningful content blocks in every route, including items mounted after data loads. */
function collectRevealTargets(root: HTMLElement): RevealTarget[] {
  const candidates = new Map<HTMLElement, RevealTarget>();
  const add = (element: Element, delay = 0) => {
    if (!(element instanceof HTMLElement) || !visibleBlock(element)) return;
    candidates.set(element, {
      element,
      kind: revealKind(element),
      delay: Math.max(delay, siblingDelay(element)),
    });
  };

  [...root.children].forEach((element) => add(element));
  root
    .querySelectorAll<HTMLElement>(".section > .container")
    .forEach((container) =>
      [...container.children].forEach((element, index) => add(element, Math.min(index * 55, 220))),
    );
  root.querySelectorAll<HTMLElement>("section").forEach((section) => {
    add(section);
    if (!section.matches(PANEL_SELECTOR))
      [...section.children].forEach((element, index) => add(element, Math.min(index * 55, 220)));
  });
  root
    .querySelectorAll<HTMLElement>(`${PANEL_SELECTOR},article,form,details,table,[data-reveal]`)
    .forEach((element) => add(element));
  root
    .querySelectorAll<HTMLElement>(GROUP_SELECTOR)
    .forEach((group) =>
      [...group.children].forEach((element, index) => add(element, Math.min(index * 120, 600))),
    );

  const all = [...candidates.values()];
  return all.filter(
    ({ element }) => !all.some(({ element: child }) => child !== element && element.contains(child)),
  );
}

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
        location.pathname.startsWith("/app") ||
        url.pathname.startsWith("/auth") ||
        location.pathname.startsWith("/auth")
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
    const tracked = new Set<HTMLElement>();
    let stopScroll: (() => void) | undefined;
    const targetData = new WeakMap<HTMLElement, RevealTarget>();
    const reveal = (element: HTMLElement) => {
      element.classList.remove("motion-pending");
      if (preference.matches || !element.animate) return;
      const { kind, delay } = targetData.get(element) || { kind: revealKind(element), delay: 0 };
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
                  opacity: 0,
                  transform: `translateY(${kind === "text" ? 56 : 72}px) scale(${kind === "depth" ? 0.975 : 1})`,
                },
                { opacity: 1, transform: "translateY(0) scale(1)" },
              ];
      const animation = element.animate(frames, {
        duration: kind === "mask" ? 1400 : 1100,
        delay,
        easing: "cubic-bezier(.16,.65,.25,1)",
        fill: "backwards",
      });
      animations.add(animation);
      animation.onfinish = () => animations.delete(animation);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            reveal(e.target as HTMLElement);
            observer.unobserve(e.target);
          }
      },
      { threshold: 0.01, rootMargin: "0px 0px -90px 0px" },
    );
    const retire = (element: HTMLElement) => {
      observer.unobserve(element);
      element.classList.remove("motion-pending");
      delete element.dataset.motionReveal;
      tracked.delete(element);
      animations.forEach((animation) => {
        if ((animation.effect as KeyframeEffect | null)?.target === element) {
          animation.cancel();
          animations.delete(animation);
        }
      });
    };
    const scan = () => {
      const root = document.querySelector<HTMLElement>("main");
      if (!root) return;
      const targets = collectRevealTargets(root);
      const current = new Set(targets.map(({ element }) => element));
      tracked.forEach((element) => {
        if (!element.isConnected || !current.has(element)) retire(element);
      });
      targets.forEach((target) => {
        const { element } = target;
        targetData.set(element, target);
        if (tracked.has(element)) return;
        tracked.add(element);
        element.dataset.motionReveal = target.kind;
        if (!preference.matches && element.getBoundingClientRect().top >= innerHeight - 90)
          element.classList.add("motion-pending");
        observer.observe(element);
      });
      if (!stopScroll && !preference.matches && matchMedia("(min-width: 761px) and (pointer: fine)").matches)
        stopScroll = mountScrollMotion(root);
    };
    const mutations = new MutationObserver(scan);
    mutations.observe(document.getElementById("root")!, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "open", "aria-hidden"],
    });
    const reduce = () => {
      animations.forEach((a) => a.cancel());
      animations.clear();
      tracked.forEach((node) => {
        observer.unobserve(node);
        node.classList.remove("motion-pending");
      });
      stopScroll?.();
      stopScroll = undefined;
      if (!preference.matches) {
        tracked.forEach((node) => {
          if (node.getBoundingClientRect().top >= innerHeight - 90) node.classList.add("motion-pending");
          observer.observe(node);
        });
        scan();
      }
    };
    preference.addEventListener("change", reduce);
    scan();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      tracked.forEach((node) => {
        node.classList.remove("motion-pending");
        delete node.dataset.motionReveal;
      });
      animations.forEach((a) => a.cancel());
      stopScroll?.();
      preference.removeEventListener("change", reduce);
    };
  }, [pathname]);
  return <div className="reading-progress" aria-hidden="true" />;
}
