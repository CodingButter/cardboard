/**
 * Tutorial system T1 — `<TutorialOverlay/>` portal.
 *
 * Renders a full-viewport SVG dim layer with a rounded-rectangle hole
 * cut out around the active step's target element. Anchored to the
 * target's edge: a speech bubble with the hint + Skip + (for `next`-
 * advance) a Next button.
 *
 * z-index 1100 — above `Modal` (1000), `LayoutsModal` (10000 is for
 * the layouts modal specifically; tutorials don't stack above it).
 * The tutorial dialog is its own layer; it sits above the editor
 * chrome + dockview + the standard modal layer.
 *
 * Per TUTORIALS.md §5.3 the dim layer is `pointer-events: none` by
 * default — clicks pass through to the editor and a `click`-advance
 * step sees the user's actual click on the target. The speech
 * bubble's own UI re-enables pointer events on its container only.
 */

import React from "react";
import { createPortal } from "react-dom";
import {
  advanceStep,
  getRuntimeState,
  resolveSelector,
  skipTutorial,
  stopTutorial,
  subscribe,
} from "./runtime";
import type { RuntimeState, TutorialStep } from "./types";

const VIEWPORT_PADDING = 12;
const BUBBLE_MAX_WIDTH = 320;

function useRuntimeState(): RuntimeState {
  // React 18+ external store sync. The runtime publishes a fresh
  // RuntimeState object on every transition so `===` comparisons work.
  return React.useSyncExternalStore(subscribe, getRuntimeState, getRuntimeState);
}

interface ResolvedTarget {
  rect: DOMRect | null;
  found: boolean;
}

/**
 * Resolve a step's target into a live DOMRect. Returns `rect=null`
 * for centred steps (target === null) and `found=false` if the
 * selector didn't match — the overlay then falls back to a viewport-
 * centred bubble per §5.2's degraded mode.
 */
function resolveTargetRect(target: string | null): ResolvedTarget {
  if (target == null) return { rect: null, found: true };
  try {
    const selector = resolveSelector(target);
    const el = document.querySelector(selector);
    if (!el) return { rect: null, found: false };
    return { rect: el.getBoundingClientRect(), found: true };
  } catch {
    return { rect: null, found: false };
  }
}

function useTargetRect(target: string | null): ResolvedTarget {
  const [resolved, setResolved] = React.useState<ResolvedTarget>(() =>
    resolveTargetRect(target),
  );
  React.useEffect(() => {
    let cancelled = false;
    const recompute = (): void => {
      if (!cancelled) setResolved(resolveTargetRect(target));
    };
    recompute();
    // Re-resolve once per animation frame for ~6 frames after step
    // change — covers panels that mount lazily. Then settle on resize +
    // mutation-driven recomputes.
    let rafCount = 0;
    const tick = (): void => {
      recompute();
      if (rafCount++ < 6 && !cancelled) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    const observer =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(recompute)
        : null;
    if (observer && typeof document !== "undefined") {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    }
    return () => {
      cancelled = true;
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
      if (observer) observer.disconnect();
    };
  }, [target]);
  return resolved;
}

interface BubblePosition {
  left: number;
  top: number;
  arrowSide: "top" | "bottom" | "left" | "right" | "center";
}

/**
 * Position the speech bubble next to the target rect. T1 implements
 * a simple "pick the side with the most free space" auto strategy
 * with manual `placement` overrides.
 */
function computeBubblePosition(
  rect: DOMRect | null,
  placement: TutorialStep["placement"],
  bubbleW: number,
  bubbleH: number,
  vw: number,
  vh: number,
): BubblePosition {
  if (!rect || placement === "center") {
    return {
      left: Math.max(VIEWPORT_PADDING, (vw - bubbleW) / 2),
      top: Math.max(VIEWPORT_PADDING, (vh - bubbleH) / 2),
      arrowSide: "center",
    };
  }
  const gap = 14;
  const candidates: Array<{
    side: "top" | "bottom" | "left" | "right";
    left: number;
    top: number;
    space: number;
  }> = [
    {
      side: "right",
      left: rect.right + gap,
      top: rect.top + rect.height / 2 - bubbleH / 2,
      space: vw - rect.right - gap,
    },
    {
      side: "left",
      left: rect.left - gap - bubbleW,
      top: rect.top + rect.height / 2 - bubbleH / 2,
      space: rect.left - gap,
    },
    {
      side: "bottom",
      left: rect.left + rect.width / 2 - bubbleW / 2,
      top: rect.bottom + gap,
      space: vh - rect.bottom - gap,
    },
    {
      side: "top",
      left: rect.left + rect.width / 2 - bubbleW / 2,
      top: rect.top - gap - bubbleH,
      space: rect.top - gap,
    },
  ];
  let pick = candidates[0]!;
  if (placement === "top" || placement === "bottom" || placement === "left" || placement === "right") {
    pick = candidates.find((c) => c.side === placement) ?? candidates[0]!;
  } else {
    // auto — biggest free space wins, ties go to the first candidate
    // (right, matching the LTR-bias in §5.2).
    for (const c of candidates) {
      if (c.space > pick.space) pick = c;
    }
  }
  return {
    left: Math.max(
      VIEWPORT_PADDING,
      Math.min(pick.left, vw - bubbleW - VIEWPORT_PADDING),
    ),
    top: Math.max(
      VIEWPORT_PADDING,
      Math.min(pick.top, vh - bubbleH - VIEWPORT_PADDING),
    ),
    arrowSide: pick.side,
  };
}

interface SpotlightProps {
  rect: DOMRect | null;
  padding: number;
  radius: number;
  vw: number;
  vh: number;
}

function SpotlightSvg({ rect, padding, radius, vw, vh }: SpotlightProps): React.JSX.Element {
  const maskId = React.useId();
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      width={vw}
      height={vh}
      viewBox={`0 0 ${vw} ${vh}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <mask id={maskId}>
          <rect width="100%" height="100%" fill="white" />
          {rect && (
            <rect
              x={Math.max(0, rect.left - padding)}
              y={Math.max(0, rect.top - padding)}
              width={Math.min(vw, rect.width + 2 * padding)}
              height={Math.min(vh, rect.height + 2 * padding)}
              rx={radius}
              fill="black"
            />
          )}
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.6)"
        mask={`url(#${maskId})`}
      />
      {rect && (
        <rect
          x={Math.max(0, rect.left - padding)}
          y={Math.max(0, rect.top - padding)}
          width={Math.min(vw, rect.width + 2 * padding)}
          height={Math.min(vh, rect.height + 2 * padding)}
          rx={radius}
          fill="none"
          stroke="rgba(245,158,11,0.8)"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}

interface ActiveOverlayProps {
  state: Extract<RuntimeState, { kind: "active" }>;
}

function ActiveOverlay({ state }: ActiveOverlayProps): React.JSX.Element {
  const step = state.tutorial.steps[state.stepIndex]!;
  const padding = step.highlightPadding ?? 6;
  const radius = step.highlightRadius ?? 8;
  const placement = step.placement ?? "auto";
  const isNextStep = step.advance.kind === "next";
  const isLastStep = state.stepIndex === state.tutorial.steps.length - 1;
  const target = useTargetRect(step.target);
  const [viewport, setViewport] = React.useState(() => ({
    vw: typeof window !== "undefined" ? window.innerWidth : 1024,
    vh: typeof window !== "undefined" ? window.innerHeight : 768,
  }));
  React.useEffect(() => {
    const onResize = (): void => {
      setViewport({ vw: window.innerWidth, vh: window.innerHeight });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Esc skips, Enter advances on `next` steps. We register at window
  // capture phase but `Escape` only fires if the user isn't typing in
  // an input (per common UX expectation).
  React.useEffect(() => {
    const handler = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        skipTutorial();
        return;
      }
      if (ev.key === "Enter" && isNextStep) {
        const target = ev.target;
        // Don't hijack Enter from form inputs.
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        ev.preventDefault();
        advanceStep();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isNextStep]);

  const bubbleRef = React.useRef<HTMLDivElement | null>(null);
  const [bubbleDims, setBubbleDims] = React.useState({ w: 280, h: 140 });
  React.useLayoutEffect(() => {
    if (bubbleRef.current) {
      const rect = bubbleRef.current.getBoundingClientRect();
      setBubbleDims({ w: rect.width, h: rect.height });
    }
  }, [step.hint, state.stepIndex, target.rect?.left, target.rect?.top]);

  const pos = computeBubblePosition(
    target.rect,
    placement,
    bubbleDims.w,
    bubbleDims.h,
    viewport.vw,
    viewport.vh,
  );

  const totalSteps = state.tutorial.steps.length;
  const currentStep = state.stepIndex + 1;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Tutorial: ${state.tutorial.title}`}
      data-tutorial-overlay
      className="fixed inset-0 z-[1100] pointer-events-none"
    >
      <SpotlightSvg
        rect={target.rect}
        padding={padding}
        radius={radius}
        vw={viewport.vw}
        vh={viewport.vh}
      />
      {/* Speech bubble — pointer-events: auto so its buttons work. */}
      <div
        ref={bubbleRef}
        data-tutorial-bubble
        className="absolute pointer-events-auto rounded-lg border border-amber-500/50 bg-zinc-900 px-4 py-3 text-zinc-100 shadow-2xl"
        style={{
          left: pos.left,
          top: pos.top,
          maxWidth: BUBBLE_MAX_WIDTH,
          minWidth: 220,
        }}
      >
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="text-[10px] uppercase tracking-wider text-amber-400">
            {state.tutorial.title}
          </span>
          <span className="text-[10px] text-zinc-500">
            {currentStep} / {totalSteps}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-zinc-100">{step.hint}</p>
        {!target.found && step.target != null && (
          <p className="mt-2 text-[11px] text-amber-500">
            Couldn't find the target on screen. Use Next or Skip to continue.
          </p>
        )}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={skipTutorial}
            className="rounded border border-zinc-700 bg-transparent px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            data-tutorial-skip
          >
            Skip
          </button>
          <button
            type="button"
            onClick={stopTutorial}
            className="rounded border border-zinc-800 bg-transparent px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            aria-label="Close tutorial"
            data-tutorial-close
          >
            Close
          </button>
          {(isNextStep || !target.found) && (
            <button
              type="button"
              onClick={advanceStep}
              className="rounded bg-amber-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
              data-tutorial-next
            >
              {isLastStep ? "Finish" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Host component — mount once near `<App/>`. Subscribes to the runtime
 * and portals an `<ActiveOverlay/>` into `document.body` whenever a
 * tutorial is active.
 */
export function TutorialOverlayHost(): React.JSX.Element | null {
  const state = useRuntimeState();
  if (state.kind !== "active") return null;
  if (typeof document === "undefined") return null;
  return createPortal(<ActiveOverlay state={state} />, document.body);
}
