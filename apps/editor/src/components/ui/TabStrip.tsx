import React from "react";
import { cn } from "../../lib/cn";

/**
 * TabStrip — §4.10.
 *
 * Two variants:
 *   - **primary**: icon + label, ~44px tall, amber underline + faint
 *     amber bg on active. Used as PrimaryTabs in the app shell.
 *   - **secondary**: label-only, ~34px tall, amber bottom border on
 *     active. Used by modal sub-tabs and the StatusConsole.
 *
 * Extras (added with the per-tab contextual right slot):
 *   - `rightSlot`: an optional ReactNode rendered after the tabs at the
 *     right edge of the strip. Stays put — never participates in the
 *     scrollable region. Used by PrimaryTabs to surface the active
 *     view's "contextual" affordance (e.g. the Scene picker on the
 *     Scene tab).
 *   - `scrollable`: when true, the tab buttons live inside an
 *     `overflow-x-auto` region with gradient fade hints on both
 *     edges that double as hover-to-auto-scroll handles. Click a fade
 *     to smooth-scroll to that extreme. Fades only render when the
 *     scroll container is actually overflowing, so the affordance is
 *     invisible when not needed.
 */

export interface TabDescriptor<T extends string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
  /**
   * If true, render a thin vertical divider after this tab to visually
   * separate tab groups (no label, purely a category boundary).
   * Used by PrimaryTabs to chunk Content / Authoring / Project Meta.
   */
  dividerAfter?: boolean;
}

export interface TabStripProps<T extends string> {
  variant: "primary" | "secondary";
  tabs: ReadonlyArray<TabDescriptor<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
  "aria-label"?: string;
  /**
   * Optional contextual content rendered at the right edge of the
   * strip, outside the scrollable tab region. Pinned — never scrolls.
   */
  rightSlot?: React.ReactNode;
  /**
   * When true, the tab buttons render inside a horizontally-scrollable
   * container with translucent gradient fade affordances at each edge.
   * Hover an edge to auto-scroll in that direction; click to jump to
   * the extreme. Fades only appear when overflow is present.
   */
  scrollable?: boolean;
}

export function TabStrip<T extends string>({
  variant,
  tabs,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
  rightSlot,
  scrollable = false,
}: TabStripProps<T>) {
  // Primary tabs row sits directly under the near-black TopBar.
  // Mockups (Editor Design/Map.png et al) show it visibly lighter
  // than the TopBar — same brightness as the panel cards in the
  // rails. The `--color-bg-tabs` token drives that whole strip; the
  // panels inherit `--color-bg-panel` (same value today, kept as a
  // distinct token so the two can diverge later without retuning
  // every panel call site).
  // border-b uses zinc-700/60 so it actually contrasts with the new
  // --color-bg-tabs (#272727) — plain border-zinc-800 reads as the
  // same colour as the tabs-row bg after the theme retune.
  const containerClasses =
    variant === "primary"
      ? "flex items-stretch h-12 border-b border-zinc-700/60 bg-(--color-bg-tabs)"
      : "flex items-stretch h-9 border-b border-zinc-700/60";

  const buttons = tabs.map((tab) => {
    const active = tab.id === value;
    return (
      <React.Fragment key={tab.id}>
        <button
          type="button"
          role="tab"
          aria-selected={active}
          aria-disabled={tab.disabled}
          disabled={tab.disabled}
          onClick={() => !tab.disabled && onChange(tab.id)}
          className={cn(
            "relative inline-flex items-center gap-2 px-4 -mb-px shrink-0",
            "transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-inset",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            variant === "primary"
              ? primaryTabClasses(active)
              : secondaryTabClasses(active),
          )}
        >
          {variant === "primary" && tab.icon && (
            <span className="inline-flex items-center justify-center w-4 h-4">
              {tab.icon}
            </span>
          )}
          <span
            className={
              variant === "primary"
                ? "text-sm font-medium"
                : "text-sm font-medium"
            }
          >
            {tab.label}
          </span>
          {tab.badge && <span className="ml-1">{tab.badge}</span>}
        </button>
        {tab.dividerAfter && (
          <div
            aria-hidden="true"
            className="my-2 w-px self-stretch bg-zinc-700/60 shrink-0"
          />
        )}
      </React.Fragment>
    );
  });

  if (!scrollable && !rightSlot) {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(containerClasses, className)}
      >
        {buttons}
      </div>
    );
  }

  // Scrollable / right-slot layout. The outer container becomes a
  // flex row with: [scrollable tab region] [rightSlot]. Edge fades
  // are positioned absolutely over the scroll region; they participate
  // in pointer events so the user can hover/click them.
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(containerClasses, "relative", className)}
    >
      {scrollable ? (
        <ScrollableTabsRegion>{buttons}</ScrollableTabsRegion>
      ) : (
        <div className="flex items-stretch min-w-0 flex-1">{buttons}</div>
      )}
      {rightSlot && (
        <div className="flex items-center shrink-0 pl-2 pr-3 ml-auto">
          {rightSlot}
        </div>
      )}
    </div>
  );
}

/**
 * ScrollableTabsRegion — horizontally-scrollable wrapper around the
 * tab buttons with gradient fade affordances on each overflowing edge.
 *
 * Affordance behaviour:
 *   - Hovering an edge fade starts a requestAnimationFrame loop that
 *     scrolls the region by ~10px/frame in that direction. Pointer
 *     leave cancels the loop.
 *   - Clicking an edge fade smooth-scrolls to that extreme (0 or
 *     scrollWidth) so the user can jump from one end to the other in
 *     one click.
 *   - The fades themselves only render when the corresponding edge is
 *     scrollable (i.e. `scrollLeft > 0` or `scrollLeft + clientWidth
 *     < scrollWidth`). When no overflow exists at all the affordances
 *     are entirely invisible and inert.
 *
 * Implementation notes:
 *   - We use a `ResizeObserver` on the scroll container to detect
 *     container/content resizes, and a passive `scroll` listener for
 *     position updates. Both feed the same `updateEdges()` evaluator.
 *   - The rAF loop reads `scrollLeft` each frame and stops on its own
 *     once the extreme is reached (so a user can park the cursor on
 *     the fade after the loop ends without bouncing).
 *   - The fade background uses `--color-bg-tabs` so it blends
 *     seamlessly with the tabs-row token; if the token retunes
 *     downstream the affordance follows automatically.
 */
function ScrollableTabsRegion({ children }: { children: React.ReactNode }) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);
  const rafRef = React.useRef<number | null>(null);

  const updateEdges = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setCanScrollLeft(left);
    setCanScrollRight(right);
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateEdges();
    // ResizeObserver catches both container resizes (window) and
    // content resizes (tab count / label changes). A passive scroll
    // listener keeps the fade visibility in sync with manual scroll.
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateEdges())
        : null;
    if (ro) ro.observe(el);
    const onScroll = () => updateEdges();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (ro) ro.disconnect();
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
        const el = scrollRef.current;
        if (!el) {
          rafRef.current = null;
          return;
        }
        const next = el.scrollLeft + direction * 10;
        const max = el.scrollWidth - el.clientWidth;
        const clamped = Math.max(0, Math.min(max, next));
        el.scrollLeft = clamped;
        // Stop at the extreme so a parked hover doesn't busy-loop.
        if (clamped === 0 || clamped === max) {
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    },
    [cancelLoop],
  );

  const jumpTo = React.useCallback((direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = direction === -1 ? 0 : el.scrollWidth;
    try {
      el.scrollTo({ left: target, behavior: "smooth" });
    } catch {
      // Fallback for environments without smooth-scroll support.
      el.scrollLeft = target;
    }
  }, []);

  // Stop the rAF loop on unmount so we don't leak frames.
  React.useEffect(() => cancelLoop, [cancelLoop]);

  return (
    <div className="relative flex-1 min-w-0 flex items-stretch">
      <div
        ref={scrollRef}
        className="flex items-stretch overflow-x-auto scrollbar-none flex-1 min-w-0"
      >
        {children}
      </div>
      {canScrollLeft && (
        <EdgeFade
          side="left"
          onPointerEnter={() => startLoop(-1)}
          onPointerLeave={cancelLoop}
          onClick={() => jumpTo(-1)}
        />
      )}
      {canScrollRight && (
        <EdgeFade
          side="right"
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
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onClick: () => void;
}

function EdgeFade({
  side,
  onPointerEnter,
  onPointerLeave,
  onClick,
}: EdgeFadeProps) {
  // Gradient direction blends from the tabs-row token (--color-bg-tabs)
  // at the affordance edge into transparent toward the tabs. The fade
  // is ~32px wide — enough to read as a soft vignette without
  // covering the underlying tab labels.
  const gradient =
    side === "left"
      ? "bg-gradient-to-r from-(--color-bg-tabs) to-transparent"
      : "bg-gradient-to-l from-(--color-bg-tabs) to-transparent";
  const positional = side === "left" ? "left-0" : "right-0";
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      aria-label={side === "left" ? "Scroll tabs left" : "Scroll tabs right"}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
      className={cn(
        "absolute top-0 bottom-0 w-8 z-10 cursor-pointer",
        "transition-opacity duration-150 hover:opacity-80",
        positional,
        gradient,
      )}
    />
  );
}

function primaryTabClasses(active: boolean): string {
  return active
    ? "text-amber-300 bg-amber-500/10 border-b-2 border-amber-400"
    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60 border-b-2 border-transparent";
}

function secondaryTabClasses(active: boolean): string {
  return active
    ? "text-amber-300 border-b-2 border-amber-400"
    : "text-zinc-400 hover:text-zinc-100 border-b-2 border-transparent";
}
