import React from "react";
import { cn } from "../../lib/cn";

/**
 * Tooltip — §4.25.
 *
 * Hover tooltip, hand-rolled (no Radix). Trigger wraps a single
 * child; the tooltip body floats absolutely above it. R5 polish will
 * apply this everywhere — R2 builds the primitive so R4 view
 * migrations can opt-in without rebuilding it.
 *
 * Positioning is naive (CSS-only `top-full`/`bottom-full`/etc.).
 * Sufficient for short hint strings — R5 may swap in a layout-aware
 * positioner if collisions become a problem.
 */

export interface TooltipProps {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Delay in ms before showing. Default 400. */
  delay?: number;
  children: React.ReactElement;
}

export function Tooltip({
  content,
  side = "top",
  delay = 400,
  children,
}: TooltipProps) {
  const [visible, setVisible] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const close = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  React.useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // We wrap the child rather than cloning its event props — keeps the
  // child's own handlers intact and avoids the ref-forwarding dance.
  return (
    <span
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      className="relative inline-flex"
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 pointer-events-none whitespace-nowrap",
            "px-2 py-1 rounded-md text-xs font-medium",
            "bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-lg",
            sidePositionClass(side),
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

function sidePositionClass(side: TooltipProps["side"]): string {
  switch (side) {
    case "bottom":
      return "top-full mt-1 left-1/2 -translate-x-1/2";
    case "left":
      return "right-full mr-1 top-1/2 -translate-y-1/2";
    case "right":
      return "left-full ml-1 top-1/2 -translate-y-1/2";
    case "top":
    default:
      return "bottom-full mb-1 left-1/2 -translate-x-1/2";
  }
}
