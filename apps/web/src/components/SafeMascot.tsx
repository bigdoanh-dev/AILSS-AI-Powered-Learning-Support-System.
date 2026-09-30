import { useEffect, useState } from "react";
import { Mascot } from "@dangnguyendota/page-mascot";

// Polyfill window.matchMedia for JSDOM test environments
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

export interface SafeMascotProps {
  directions: string;
  reactions: string;
  size?: number;
  label?: string;
  className?: string;
}

export function SafeMascot({
  directions,
  reactions,
  size = 70,
  label = "Mascot Gia sư AI",
  className,
}: SafeMascotProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Ensure window.matchMedia is always present in all testing/client environments
    if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
      window.matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      });
    }
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        style={{
          width: size,
          height: size,
          backgroundImage: `url(${directions})`,
          backgroundSize: "300% 300%",
          backgroundPosition: "50% 50%",
        }}
        aria-label={label}
      />
    );
  }

  return (
    <Mascot directions={directions} reactions={reactions} size={size} label={label} className={className} />
  );
}
