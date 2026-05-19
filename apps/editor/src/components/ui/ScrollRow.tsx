import React from "react";
import { cn } from "../../lib/cn";

/**
 * ScrollRow — shared horizontal-scroll primitive for dock panels.
 *
 * Generalises the hover-to-auto-scroll affordance from `TabStrip.tsx`
 * (its `scrollable={true}` mode) into a standalone primitive so any
 * panel with a horizontally-overflowing row (tool rows, brush rows,
 * tile-preset categories, etc.) can drop in the same UX without
 * reimplementing the ResizeObserver / rAF dance.
 *
 * Why this exists:
 *   Dock panels render at unpredictable widths — users resize, pop
 *   out, and rearrange freely. **Vertical** scrollbars are themed
 *   globally and acceptable, but **horizontal** scrollbars look out
 *   of place at narrow panel widths. Every horizontal-overflow region
 *   in the editor should hide the native scrollbar and surface this
 *   hover-area affordance instead.
 *
 * Behaviour:
 *   - The inner viewport gets `overflow-x: auto` for real scrolling,
 *     but the native scrollbar is hidden via `scrollbar-width: none`
 *     + `::-webkit-scrollbar { display: none }`, scoped to this
 *     primitive only via Tailwind arbitrary variants (no global CSS
 *     change).
 *   - A `ResizeObserver` on the viewport + a `MutationObserver` on
 *     its child list + a passive scroll listener all feed a single
 *     `updateEdges()` evaluator that computes
 *     `canScrollLeft / canScrollRight`.
 *   - Edge fades render only when their direction is scrollable, and
 *     fully unmount when the content fits — the affordance is
 *     invisible (and inert) for non-overflowing rows.
 *   - Hovering a fade starts a rAF loop scrolling by `scrollSpeed`
 *     pixels per frame; pointer leave cancels the loop; pointer down
 *     smooth-scrolls all the way to that extreme.
 *   - Keyboard: each fade is a real `<button>` (tabbable, Space/Enter
 *     triggers the jump-to-extreme). The viewport's content remains
 *     keyboard-accessible — nothing about ScrollRow traps focus.
 *
 * Out of scope (deliberately):
 *   - Custom wheel-redirect: vertical wheel scrolling passes through
 *     to the parent, only native `deltaX` (or shift+wheel, which
 *     browsers already translate to `deltaX`) drives this region.
 *   - Touch momentum: native `overflow-x: auto` already handles it.
 *   - Vertical virtualisation.
 */

export interface ScrollRowProps {
  /** The row content (typically a flex/grid of items). */
  readonly children: React.ReactNode;
  /** Optional className applied to the OUTER container. */
  readonly className?: string;
  /** Optional className applied to the INNER scroll viewport. Use
   *  this to set the flex/grid layout on the scrollable content. */
  readonly contentClassName?: string;
  /** Pixels per animation frame while the hover-scroll edge is held.
   *  Defaults to 6 (~360px/sec at 60fps). */
  readonly scrollSpeed?: number;
  /** Width of the edge fade in pixels. Defaults to 32. */
  readonly edgeFadeWidth?: number;
}

export function ScrollRow({
  children,
  className,
  contentClassName,
  scrollSpeed = 6,
  edgeFadeWidth = 32,
}: ScrollRowProps): React.JSX.Element {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);
  const rafRef = React.useRef<number | null>(null);

  const updateEdges = React.useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    // Sub-pixel slack: `scrollWidth` and `clientWidth` can disagree by
    // a fractional pixel at fractional zoom levels, leaving a phantom
    // 1px fade when no real overflow exists. The ±1 buffer matches
    // TabStrip's prior-art.
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setCanScrollLeft(left);
    setCanScrollRight(right);
  }, []);

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    updateEdges();

    // ResizeObserver catches container + content resizes (panel
    // width changes, font reflows, etc.). MutationObserver catches
    // child list changes (items added/removed) which don't always
    // trigger a resize. A passive scroll listener tracks position.
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateEdges())
        : null;
    if (ro) ro.observe(el);

    const mo =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => updateEdges())
        : null;
    if (mo) {
      mo.observe(el, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    const onScroll = () => updateEdges();
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [updateEdges]);

  const cancelLoop = React.useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startLoop = React.useCallback(
    (direction: -1 | 1) => {
      cancelLoop();
      const step = () => {
        const el = viewportRef.current;
        if (!el) {
          rafRef.current = null;
          return;
        }
        const next = el.scrollLeft + direction * scrollSpeed;
        const max = el.scrollWidth - el.clientWidth;
        const clamped = Math.max(0, Math.min(max, next));
        el.scrollLeft = clamped;
        // Stop at the extreme so a parked hover doesn't busy-loop.
        if (clamped === 0 || clamped >= max) {
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [cancelLoop, scrollSpeed],
  );

  const jumpTo = React.useCallback((direction: -1 | 1) => {
    const el = viewportRef.current;
    if (!el) return;
    const target = direction === -1 ? 0 : el.scrollWidth;
    try {
      el.scrollTo({ left: target, behavior: "smooth" });
    } catch {
      // Fallback for environments without smooth-scroll support.
      el.scrollLeft = target;
    }
  }, []);

  // Stop any rAF loop on unmount so we don't leak frames.
  React.useEffect(() => cancelLoop, [cancelLoop]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div
        ref={viewportRef}
        className={cn(
          // overflow-y-hidden keeps a tall child from bleeding into
          // vertical scroll; the parent panel owns vertical scrolling.
          "h-full w-full overflow-x-auto overflow-y-hidden",
          // Scope native scrollbar hiding to THIS viewport only — the
          // global `*::-webkit-scrollbar-*` rules still apply
          // everywhere else (vertical scrollbars stay themed).
          "[scrollbar-width:none]",
          "[&::-webkit-scrollbar]:hidden",
          contentClassName,
        )}
      >
        {children}
      </div>
      {canScrollLeft && (
        <EdgeFade
          side="left"
          width={edgeFadeWidth}
          onPointerEnter={() => startLoop(-1)}
          onPointerLeave={cancelLoop}
          onClick={() => jumpTo(-1)}
        />
      )}
      {canScrollRight && (
        <EdgeFade
          side="right"
          width={edgeFadeWidth}
          onPointerEnter={() => startLoop(1)}
          onPointerLeave={cancelLoop}
          onClick={() => jumpTo(1)}
        />
      )}
    </div>
  );
}

interface EdgeFadeProps {
  side: "left" | "right";
  width: number;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onClick: () => void;
}

function EdgeFade({
  side,
  width,
  onPointerEnter,
  onPointerLeave,
  onClick,
}: EdgeFadeProps) {
  // Gradient fades from the app-shell token at the affordance edge
  // into transparent toward the content. Subtle amber tint on hover
  // surfaces the affordance without obscuring the underlying items.
  const gradient =
    side === "left"
      ? "bg-gradient-to-r from-(--color-bg-app) to-transparent"
      : "bg-gradient-to-l from-(--color-bg-app) to-transparent";
  const positional = side === "left" ? "left-0" : "right-0";

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      // Pre-empt the browser's default click synthesis on Space
      // (which scrolls the page) — we want a deterministic jump.
      event.preventDefault();
      onClick();
    }
  };

  return (
    <button
      type="button"
      role="button"
      aria-label={side === "left" ? "Scroll left" : "Scroll right"}
      tabIndex={0}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onClick}
      onKeyDown={handleKeyDown}
      style={{ width }}
      className={cn(
        "absolute top-0 bottom-0 z-10 cursor-pointer",
        "transition-colors duration-150",
        "hover:bg-amber-500/10",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-inset",
        positional,
        gradient,
      )}
    />
  );
}
