import React from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";

/**
 * Tooltip — §4.25.
 *
 * Hover tooltip, hand-rolled (no Radix). Trigger wraps a single
 * child; the tooltip body is portaled to `document.body` and
 * positioned with `fixed` coordinates derived from the trigger's
 * bounding rect. The portal escapes ancestor `overflow: hidden` /
 * `overflow-y: auto` clipping — important inside dockview panels
 * which scroll their content.
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

interface AnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
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
  const [anchorRect, setAnchorRect] = React.useState<AnchorRect | null>(null);
  const wrapperRef = React.useRef<HTMLSpanElement | null>(null);
  const timersRef = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  const measure = React.useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchorRect({
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    });
  }, []);

  const clearTimers = React.useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  const open = React.useCallback(() => {
    clearTimers();
    measure();
    if (stages && stages.length > 0) {
      // Reset stage state, then schedule each stage independently.
      setStageIndex(-1);
      setVisible(false);
      stages.forEach((stage, idx) => {
        const handle = setTimeout(() => {
          measure();
          setStageIndex(idx);
          setVisible(true);
        }, stage.delay);
        timersRef.current.push(handle);
      });
    } else {
      const handle = setTimeout(() => {
        measure();
        setVisible(true);
      }, delay);
      timersRef.current.push(handle);
    }
  }, [clearTimers, delay, measure, stages]);

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
    <>
      <span
        ref={wrapperRef}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className="relative inline-flex"
      >
        {children}
      </span>
      {visible && rendered != null && anchorRect != null && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              style={tooltipFixedStyle(side, anchorRect)}
              className={cn(
                "fixed z-[9999] pointer-events-none",
                "px-2 py-1 rounded-md text-xs font-medium",
                "bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-lg",
                "max-w-[280px]",
              )}
            >
              {rendered}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

/** Compute `fixed` positioning for the tooltip based on the trigger's
 *  bounding rect and the desired side. Centers on the appropriate axis
 *  and gaps by 6px from the trigger edge. */
function tooltipFixedStyle(
  side: TooltipProps["side"],
  r: AnchorRect,
): React.CSSProperties {
  const GAP = 6;
  switch (side) {
    case "bottom":
      return {
        top: r.bottom + GAP,
        left: r.left + r.width / 2,
        transform: "translateX(-50%)",
      };
    case "left":
      return {
        top: r.top + r.height / 2,
        left: r.left - GAP,
        transform: "translate(-100%, -50%)",
      };
    case "right":
      return {
        top: r.top + r.height / 2,
        left: r.right + GAP,
        transform: "translateY(-50%)",
      };
    case "top":
    default:
      return {
        top: r.top - GAP,
        left: r.left + r.width / 2,
        transform: "translate(-50%, -100%)",
      };
  }
}
