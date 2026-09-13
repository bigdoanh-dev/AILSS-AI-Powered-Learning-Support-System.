import { type ReactNode, type HTMLAttributes } from "react";
import { use3DTilt, type TiltOptions } from "../motion/tilt";

export interface TiltCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tiltOptions?: TiltOptions;
  className?: string;
  as?: "div" | "article" | "section";
}

export function TiltCard({
  children,
  tiltOptions,
  className = "",
  as: Component = "div",
  ...props
}: TiltCardProps) {
  const ref = use3DTilt<HTMLDivElement>(tiltOptions);

  return (
    <Component ref={ref} className={`tilt-card ${className}`} {...props}>
      {children}
    </Component>
  );
}
