import React, { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";

/**
 * PreviewHost — engine-agnostic canvas-mount + lifecycle primitive.
 *
 * Extracted from CellPreview (#261) so each lab can plug in its own
 * renderer behind a tiny `PreviewEngine` interface and reuse the
 * same canvas mount, ResizeObserver wiring, error handling, and
 * R2-styled outer chrome.
 *
 * **Design intent for future preview types.**
 *   - **Cardboard CellPreview** (existing) — wraps the engine's
 *     WebGLRenderer-backed `CellPreviewEngine` so the right-rail
 *     map preview paints pixel-identical to the in-game renderer.
 *   - **Image Lab (IL3)** — node-graph preview panel will implement
 *     a `PreviewEngine` adapter that owns its 2D canvas + per-node
 *     compositor and surfaces it through the same primitive.
 *   - **Sound Lab (SL3)** — spectrogram / waveform preview will
 *     plug in a Web Audio analyser → canvas renderer behind the
 *     same interface.
 *   - **Animation previews** — sprite-strip + tween-graph playback
 *     panels reuse the lifecycle scaffolding too.
 *
 * The primitive is intentionally narrow: mount canvas, observe
 * size, surface error / loading slots, wire engine teardown on
 * unmount. Everything else (overlays, controls, settings panels)
 * is composed by the caller through `children`.
 */

/**
 * Adapter the host calls into. Implementations own a single
 * `HTMLCanvasElement` reference acquired in `mount` and tear it
 * down in `dispose`.
 *
 * The host calls these in lifecycle order:
 *   1. `mount(canvas)` — synchronous OR async. Errors propagate via
 *      `onError` and switch the host into the error overlay.
 *   2. `ready?()` — optional. When present, the host stays in the
 *      loading overlay until the promise resolves.
 *   3. `update(input)` — pushed each render when `props.input`
 *      changes. Engines that don't take per-render input can
 *      leave the method as a no-op.
 *   4. `resize(w, h)` — fired on every container size change via
 *      a `ResizeObserver`. The initial fire happens immediately
 *      after `mount` resolves so engines size their backing store
 *      to the laid-out container before the first paint.
 *   5. `dispose()` — fired on unmount or engine identity change.
 */
export interface PreviewEngine {
  /** Hook the engine onto the host-provided canvas. May be async
   *  — the host will await before invoking `ready` / `resize` /
   *  `update`. Errors thrown / rejected here flip the host into
   *  the error fallback. */
  mount(canvas: HTMLCanvasElement): void | Promise<void>;
  /** Optional per-render input push. The host calls this whenever
   *  `props.input` changes (by `Object.is` identity), after
   *  `ready` resolves. Engines that pull state imperatively can
   *  ignore this. */
  update?(input: unknown): void;
  /** Container size in CSS pixels. The host fires this on first
   *  mount AND on every ResizeObserver tick. Engines decide
   *  whether to multiply by `devicePixelRatio` for their backing
   *  store. */
  resize(w: number, h: number): void;
  /** Tear down GL contexts / RAF loops / event listeners. The
   *  host guards against double-dispose internally, so a manual
   *  no-op-if-already-disposed flag inside the engine is also
   *  fine. */
  dispose(): void;
  /** Optional async readiness gate. When provided the host
   *  surfaces `loadingFallback` until this resolves; any
   *  rejection routes through `onError` like `mount` failures. */
  ready?(): Promise<void>;
}

export interface PreviewHostProps {
  /** Engine adapter. Identity matters — when `engine` changes
   *  between renders the host disposes the previous instance
   *  and mounts the new one on a fresh canvas. */
  engine: PreviewEngine;
  /** Optional input pushed to `engine.update` after readiness.
   *  Compared by `Object.is` — wrap mutable objects in a fresh
   *  reference each render to force a push. */
  input?: unknown;
  /** Extra classes applied to the outer wrapper (after the R2
   *  defaults). */
  className?: string;
  /** Receives any error thrown by `mount` / `ready` / `update`
   *  / `resize`. Errors also flip the host into the error
   *  fallback overlay so the canvas is hidden. */
  onError?: (err: Error) => void;
  /** Overlay layer rendered above the canvas. Use for orbit
   *  drag surfaces, toggle buttons, badges, etc. The overlay
   *  fills the host's bounding box (`absolute inset-0` parent),
   *  so children should opt into pointer-events themselves
   *  rather than blanket-blocking the canvas. */
  children?: React.ReactNode;
  /** Rendered while `engine.mount` is still pending OR `ready()`
   *  has not yet resolved. */
  loadingFallback?: React.ReactNode;
  /** Rendered when any lifecycle call throws. The fallback
   *  replaces the canvas (the canvas remains in the DOM but the
   *  overlay covers it). */
  errorFallback?: React.ReactNode;
  /** CSS `aspect-ratio` for the outer wrapper (e.g. `"1/1"`
   *  for the cardboard square preview). Only applied when
   *  `fixedHeight` is omitted — otherwise the wrapper sizes by
   *  height and width fills the parent. */
  aspectRatio?: string;
  /** Fixed pixel height for the wrapper. Wins over
   *  `aspectRatio`. */
  fixedHeight?: number;
}

/**
 * Mount a canvas, observe its container, and forward lifecycle
 * events to the provided engine. See `PreviewEngine` above for
 * the contract.
 *
 * The host owns:
 *   - The single `<canvas>` element + its ref.
 *   - The `ResizeObserver` for the container.
 *   - The async-cancellation guard around `mount` / `ready`.
 *   - The loading / error overlay state.
 *
 * The caller owns everything else: overlays via `children`,
 * any per-engine input via `input`, and the engine's own
 * imperative API for non-render-cycle interactions (orbit
 * cameras, layer toggles, etc.).
 */
export function PreviewHost({
  engine,
  input,
  className,
  onError,
  children,
  loadingFallback,
  errorFallback,
  aspectRatio,
  fixedHeight,
}: PreviewHostProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState(false);

  // Mount + ready lifecycle. Re-runs when `engine` identity
  // changes so swapping engines tears down cleanly.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    setError(null);
    setReady(false);

    void (async () => {
      try {
        await engine.mount(canvas);
        if (cancelled) {
          // The unmount cleanup will fire `dispose` below — no
          // need to call it here. Bail before flipping `ready`.
          return;
        }
        if (engine.ready) {
          await engine.ready();
          if (cancelled) return;
        }
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        onError?.(e);
      }
    })();

    return () => {
      cancelled = true;
      try {
        engine.dispose();
      } catch {
        /* swallow — disposal best-effort during teardown */
      }
    };
    // `onError` intentionally omitted — it's a notification sink,
    // not a lifecycle input. Re-binding when the parent re-renders
    // a fresh `onError` lambda would needlessly rebuild the engine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  // Container size → engine.resize. Fires once immediately after
  // ready so the first paint sees the laid-out size, then on
  // every container resize.
  useEffect(() => {
    if (!ready) return;
    const container = containerRef.current;
    if (!container) return;

    const apply = () => {
      try {
        const r = container.getBoundingClientRect();
        engine.resize(r.width, r.height);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        onError?.(e);
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(container);
    return () => ro.disconnect();
    // `onError` omitted as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, ready]);

  // Push `input` whenever it changes (after readiness). Engines
  // without `update` simply opt out.
  useEffect(() => {
    if (!ready) return;
    if (!engine.update) return;
    try {
      engine.update(input);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      onError?.(e);
    }
    // `onError` omitted as above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, input, ready]);

  // Sizing — `fixedHeight` wins, then `aspectRatio`, then nothing
  // (caller controls via `className`).
  const wrapperStyle: React.CSSProperties = {};
  if (fixedHeight !== undefined) {
    wrapperStyle.height = fixedHeight;
  } else if (aspectRatio) {
    wrapperStyle.aspectRatio = aspectRatio;
  }

  return (
    <div
      className={cn(
        // R2 wrapper chrome — matches the previous CellPreview
        // outer container so existing layouts look identical.
        "relative overflow-hidden rounded-md border border-zinc-800",
        "bg-zinc-950",
        className,
      )}
      style={wrapperStyle}
    >
      <div ref={containerRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
      {/* Loading / error overlays render BELOW children so
          caller-supplied overlays (toolbar, expand button, etc.)
          stay clickable even during the loading state. */}
      {error
        ? errorFallback ?? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-red-300 px-4 text-center pointer-events-none">
              Preview failed: {error.message}
            </div>
          )
        : !ready
          ? loadingFallback ?? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 pointer-events-none">
                Loading preview…
              </div>
            )
          : null}
      {children}
    </div>
  );
}
