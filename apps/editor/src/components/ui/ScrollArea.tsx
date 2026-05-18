import React from "react";
import { cn } from "../../lib/cn";

/**
 * ScrollArea — §4.22.
 *
 * Wraps `overflow: auto` so callers don't have to remember to inherit
 * the editor's amber-thumb scrollbar styling (already global in
 * `index.css`). Optionally fades the trailing edge as a scroll
 * affordance — the fade only renders when content is actually
 * overflowing past the visible bottom edge, otherwise the dark
 * gradient reads as a stray band against the panel surface.
 *
 * Overflow detection mirrors the pattern used by TabStrip's scrollable
 * edge fades: ResizeObserver on the scroll container catches both
 * container + content resizes, a passive scroll listener tracks
 * position changes, both feed a single `canScrollDown` flag.
 */

export interface ScrollAreaProps {
  className?: string;
  axis?: "y" | "x" | "both";
  children: React.ReactNode;
  /** Render a fade gradient at the trailing edge when scrollable. */
  fade?: boolean;
}

export function ScrollArea({
  className,
  axis = "y",
  children,
  fade = true,
}: ScrollAreaProps) {
  const overflow =
    axis === "x" ? "overflow-x-auto overflow-y-hidden" :
    axis === "both" ? "overflow-auto" :
    "overflow-y-auto overflow-x-hidden";

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [canScrollDown, setCanScrollDown] = React.useState(false);

  React.useEffect(() => {
    if (!fade || axis === "x") return;
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollDown(
        el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      );
    };
    update();
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    if (ro) ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      if (ro) ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [fade, axis]);

  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      <div ref={scrollRef} className={cn("h-full w-full", overflow)}>
        {children}
      </div>
      {fade && axis !== "x" && canScrollDown && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-zinc-950/60 to-transparent"
        />
      )}
    </div>
  );
}
