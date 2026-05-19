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
 * Two modes:
 *
 *   • Single-stage (default): pass `content` + optional `delay`. The
 *     tooltip appears after `delay` ms of hover/focus and stays until
 *     blur/mouseleave.
 *
 *   • Multi-stage (progressive reveal): pass `stages` — an array of
 *     `{ delay, content }` entries in ascending-delay order. On
 *     hover-start, each stage is scheduled via its own `setTimeout`.
 *     When a later stage fires, the rendered content swaps to that
 *     stage's content. The tooltip is visible from the first stage's
 *     delay onward. Hover-away clears all pending timers and hides
 *     the tooltip immediately.
 *
 * Positioning is naive (CSS-only `top-full`/`bottom-full`/etc.).
 * Sufficient for short hint strings — R5 may swap in a layout-aware
 * positioner if collisions become a problem.
 */

export interface TooltipStage {
  /** Delay in ms after hover-start when this stage's content appears. */
  delay: number;
  /** Content for this stage. */
  content: React.ReactNode;
}

export interface TooltipProps {
  /** Single-stage content. Mutually exclusive with `stages`. */
  content?: React.ReactNode;
  /** Multi-stage progressive reveal. Stages should be sorted ascending
   *  by `delay`. At each delay threshold, the rendered content swaps
   *  to that stage's content. Hovering away cancels pending stages
   *  and closes the tooltip immediately. */
  stages?: TooltipStage[];
  side?: "top" | "bottom" | "left" | "right";
  /** Delay in ms before single-stage tooltip shows. Default 400.
   *  Ignored when `stages` is set. */
  delay?: number;
  children: React.ReactElement;
}

export function Tooltip({
  content,
  stages,
  side = "top",
  delay = 400,
  children,
}: TooltipProps) {
  const [visible, setVisible] = React.useState(false);
  // For staged mode: index of the current stage whose content is
  // rendered. -1 means no stage has fired yet (tooltip hidden).
  const [stageIndex, setStageIndex] = React.useState<number>(-1);
  const timersRef = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = React.useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  const open = React.useCallback(() => {
    clearTimers();
    if (stages && stages.length > 0) {
      // Reset stage state, then schedule each stage independently.
      setStageIndex(-1);
      setVisible(false);
      stages.forEach((stage, idx) => {
        const handle = setTimeout(() => {
          setStageIndex(idx);
          setVisible(true);
        }, stage.delay);
        timersRef.current.push(handle);
      });
    } else {
      const handle = setTimeout(() => setVisible(true), delay);
      timersRef.current.push(handle);
    }
  }, [clearTimers, delay, stages]);

  const close = React.useCallback(() => {
    clearTimers();
    setVisible(false);
    setStageIndex(-1);
  }, [clearTimers]);

  React.useEffect(() => () => {
    // Unmount cleanup — abort any pending timers.
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  // Resolve which content node to render.
  const rendered: React.ReactNode =
    stages && stages.length > 0
      ? stageIndex >= 0
        ? stages[stageIndex]?.content
        : null
      : content;

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
      {visible && rendered != null && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 pointer-events-none",
            "px-2 py-1 rounded-md text-xs font-medium",
            "bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-lg",
            sidePositionClass(side),
          )}
        >
          {rendered}
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
