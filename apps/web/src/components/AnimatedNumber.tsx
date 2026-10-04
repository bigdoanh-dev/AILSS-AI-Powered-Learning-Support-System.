import { useLanguage } from "../lib/i18n";
import React, { useEffect, useRef, useState } from "react";

export interface AnimatedNumberProps {
  value: number | string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
  formatter?: (val: number) => string;
}

interface ParsedNumber {
  target: number;
  prefix: string;
  suffix: string;
  decimals: number;
  hasFormat: boolean;
}

const IS_TEST = typeof process !== "undefined" && process.env?.NODE_ENV === "test";

function parseNumber(
  input: number | string,
  explicitDecimals?: number,
  explicitPrefix = "",
  explicitSuffix = "",
): ParsedNumber | null {
  if (typeof input === "number") {
    const dec = explicitDecimals !== undefined ? explicitDecimals : input % 1 !== 0 ? 1 : 0;
    return {
      target: input,
      prefix: explicitPrefix,
      suffix: explicitSuffix,
      decimals: dec,
      hasFormat: true,
    };
  }

  const str = String(input).trim();
  if (!str) return null;

  const match = str.match(/^([^\d\-+]*)([-+]?\d(?:[\d.,]*\d)?)(.*)$/);
  if (!match) return null;

  const rawPrefix = explicitPrefix || match[1];
  const rawNum = match[2];
  const rawSuffix = explicitSuffix || match[3];

  let cleanNum = rawNum;
  let detectedDecimals = explicitDecimals ?? 0;

  if (cleanNum.includes(".") && cleanNum.includes(",")) {
    if (cleanNum.lastIndexOf(".") > cleanNum.lastIndexOf(",")) {
      cleanNum = cleanNum.replace(/,/g, "");
      if (explicitDecimals === undefined) {
        detectedDecimals = cleanNum.split(".")[1]?.length || 0;
      }
    } else {
      cleanNum = cleanNum.replace(/\./g, "").replace(",", ".");
      if (explicitDecimals === undefined) {
        detectedDecimals = cleanNum.split(".")[1]?.length || 0;
      }
    }
  } else if (cleanNum.includes(".")) {
    const parts = cleanNum.split(".");
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      if (explicitDecimals === undefined) detectedDecimals = lastPart.length;
    } else {
      cleanNum = parts.join("");
    }
  } else if (cleanNum.includes(",")) {
    const parts = cleanNum.split(",");
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      cleanNum = cleanNum.replace(",", ".");
      if (explicitDecimals === undefined) detectedDecimals = lastPart.length;
    } else {
      cleanNum = parts.join("");
    }
  }

  const parsedVal = parseFloat(cleanNum);
  if (isNaN(parsedVal)) return null;

  return {
    target: parsedVal,
    prefix: rawPrefix,
    suffix: rawSuffix,
    decimals: explicitDecimals !== undefined ? explicitDecimals : detectedDecimals,
    hasFormat: true,
  };
}

export function AnimatedNumber({
  value,
  prefix = "",
  suffix = "",
  decimals,
  duration = 1000,
  className,
  style,
  formatter,
}: AnimatedNumberProps) {
  const { locale: uiLocale } = useLanguage();
  const containerRef = useRef<HTMLSpanElement>(null);
  const parsed = parseNumber(value, decimals, prefix, suffix);
  const targetVal = parsed ? parsed.target : 0;

  const [inView, setInView] = useState(() => IS_TEST);
  const [displayNumber, setDisplayNumber] = useState(() => (IS_TEST ? targetVal : 0));

  useEffect(() => {
    if (IS_TEST) {
      setDisplayNumber(targetVal);
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    const reduced =
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    if (reduced || typeof IntersectionObserver === "undefined") {
      setInView(true);
      setDisplayNumber(targetVal);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [targetVal]);

  useEffect(() => {
    if (IS_TEST) {
      setDisplayNumber(targetVal);
      return;
    }

    if (!inView || !parsed) {
      return;
    }

    const reduced =
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    if (reduced) {
      setDisplayNumber(targetVal);
      return;
    }

    const startTime = performance.now();
    let frameId: number;

    const tick = (now: number) => {
      const elapsed = Math.min(now - startTime, duration);
      const progress = elapsed / duration;
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = targetVal * ease;

      setDisplayNumber(current);

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        setDisplayNumber(targetVal);
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [inView, targetVal, duration]);

  if (!parsed) {
    return (
      <span ref={containerRef} className={className} style={style}>
        {value}
      </span>
    );
  }

  const formattedNum = formatter
    ? formatter(displayNumber)
    : parsed.decimals > 0
      ? displayNumber.toFixed(parsed.decimals)
      : Math.round(displayNumber).toLocaleString(uiLocale);

  return (
    <span
      ref={containerRef}
      className={className}
      style={style}
    >{`${parsed.prefix}${formattedNum}${parsed.suffix}`}</span>
  );
}

export interface AnimatedProgressBarProps {
  percent: number;
  color?: string;
  height?: number;
  duration?: number;
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function AnimatedProgressBar({
  percent,
  color,
  height = 8,
  duration = 1100,
  delay = 60,
  className,
  style,
}: AnimatedProgressBarProps) {
  const [width, setWidth] = useState(IS_TEST ? percent : 0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (IS_TEST) {
      setWidth(percent);
      return;
    }

    // Trigger smooth fill from 0 to percent on mount/update
    const timer = setTimeout(() => {
      setWidth(percent);
    }, delay);

    return () => clearTimeout(timer);
  }, [percent, delay]);

  const isHigh = percent >= 70;
  const gradient = color
    ? color
    : isHigh
      ? "linear-gradient(90deg, #10B981 0%, #22C55E 100%)"
      : "linear-gradient(90deg, #0284C7 0%, #38BDF8 100%)";
  const glow = isHigh ? "rgba(34, 197, 94, 0.45)" : "rgba(56, 189, 248, 0.45)";

  return (
    <div
      ref={containerRef}
      className={`animated-progress-track ${className ?? ""}`}
      style={{
        width: "100%",
        height,
        backgroundColor: "var(--line, #E2E8F0)",
        borderRadius: height / 2,
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      <div
        className="animated-progress-fill"
        style={{
          width: `${width}%`,
          height: "100%",
          background: gradient,
          borderRadius: height / 2,
          transition: `width ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          boxShadow: `0 0 10px ${glow}`,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div className="progress-shimmer-highlight" />
      </div>
    </div>
  );
}
