/**
 * demo-performance-profiler — data-collection setup script.
 *
 * Two responsibilities:
 *
 *   1. Create the `profiler` Zustand store (`ctx.createStore`) so the
 *      JSON panel can read live FPS / draw-call / memory values via
 *      `$store.profiler.<field>` and the chart-init.ts script can
 *      subscribe to changes.
 *   2. Start a rAF loop that updates the store every frame with the
 *      current sliding-window FPS + memory readout, and a 1Hz
 *      snapshot loop that pushes a `{ fps, drawCalls, memoryMB, t }`
 *      sample into the rolling buffer the chart reads.
 *
 * Two-channel design (per `docs/plans/PERFORMANCE_PROFILER.md` §7.1):
 *
 *   - rAF tick → updates `fps` + `memoryMB` text readouts (fast).
 *   - 1Hz interval → snapshots into `samples[]` for the chart (slow).
 *
 * Decoupling avoids hammering chart.js's `update("none")` at 60 Hz
 * (4-6ms per redraw becomes the dominant cost in the editor process,
 * which would skew the very measurement the chart displays).
 *
 * Cleanup: the returned teardown cancels the rAF, clears the
 * interval, and unregisters every command. The dynamic store is torn
 * down separately by the editor loader's store-unregistrar ring.
 */

// The editor publishes this type from `apps/editor/src/packs/editorPackLoader.ts`.
// Type-only import — Bun's bundler erases it during pack-build, so the
// emitted JS has no editor-side dependency. The relative path works at
// authoring time because the workspace lives under the same monorepo
// root as the editor app.
import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";

/** Size of the rolling sample buffer the chart reads. 60 samples @ 1Hz = 60 seconds. */
const SAMPLE_BUFFER_SIZE = 60;
/** rAF FPS measurement window — count frames in the trailing N ms. */
const FPS_WINDOW_MS = 1000;

interface ProfilerSample {
  /** Frames per second over the trailing FPS_WINDOW_MS at sample time. */
  fps: number;
  /** Draw calls during the last interval. STUB — see §7.2. */
  drawCalls: number;
  /** Used JS heap in MB (Chrome only — 0 on Firefox/Safari). */
  memoryMB: number;
  /** Sample timestamp from `performance.now()`. */
  t: number;
}

interface ProfilerStateData {
  fps: number;
  drawCalls: number;
  memoryMB: number;
  samples: ProfilerSample[];
  paused: boolean;
}

interface ProfilerStateActions extends Record<string, unknown> {
  setFps: (fps: number) => void;
  setMemoryMB: (memoryMB: number) => void;
  pushSample: (sample: ProfilerSample) => void;
  resetSamples: () => void;
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
}

/**
 * Read used JS heap in MB. Chrome-only — graceful 0 on other browsers.
 * Feature-detected via `(performance as any).memory`.
 */
function readMemoryMB(): number {
  const perf = performance as unknown as {
    memory?: { usedJSHeapSize?: number };
  };
  const bytes = perf.memory?.usedJSHeapSize;
  return typeof bytes === "number" ? Math.round(bytes / (1024 * 1024)) : 0;
}

let drawCallsWarned = false;
function readDrawCalls(): number {
  // Editor MapCanvas has no draw-call counter today — see plan §7.2.
  // Console-warn once so the gap is loud + then return 0 for the
  // panel's text readout + the chart line.
  if (!drawCallsWarned) {
    drawCallsWarned = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[demo-performance-profiler] drawCalls stays 0 — editor MapCanvas " +
        "has no draw-call counter yet. See docs/plans/PERFORMANCE_PROFILER.md §7.2.",
    );
  }
  return 0;
}

export default function setup(ctx: EditorPackContext): () => void {
  // ── Create the pack's Zustand store ────────────────────────────
  // `createStore` calls `registerDynamicStore` under the hood so the
  // panel renderer can resolve `$store.profiler.fps` etc. The hook
  // returned here is the SAME shape as the editor's shell-level
  // stores (useSceneStore et al.).
  const store = ctx.createStore<ProfilerStateData, ProfilerStateActions>(
    "profiler",
    {
      fps: 0,
      drawCalls: 0,
      memoryMB: 0,
      samples: [],
      paused: false,
    },
    (set, _get) => ({
      setFps: (fps: number) => set({ fps } as Partial<ProfilerStateData>),
      setMemoryMB: (memoryMB: number) =>
        set({ memoryMB } as Partial<ProfilerStateData>),
      pushSample: (sample: ProfilerSample) =>
        set((s) => {
          const next = s.samples.slice(-SAMPLE_BUFFER_SIZE + 1);
          next.push(sample);
          return { samples: next } as Partial<ProfilerStateData>;
        }),
      resetSamples: () =>
        set({ samples: [] } as Partial<ProfilerStateData>),
      setPaused: (paused: boolean) =>
        set({ paused } as Partial<ProfilerStateData>),
      togglePaused: () =>
        set((s) => ({ paused: !s.paused }) as Partial<ProfilerStateData>),
    }),
  );

  // ── rAF FPS loop ───────────────────────────────────────────────
  // Sliding window of frame timestamps. On each frame we drop
  // timestamps older than FPS_WINDOW_MS and the remaining count is
  // the FPS readout for the trailing 1s window.
  const frameTimes: number[] = [];
  let raf = 0;
  const tick = (now: number): void => {
    if (!store.getState().paused) {
      frameTimes.push(now);
      while (
        frameTimes.length > 0 &&
        now - (frameTimes[0] ?? 0) > FPS_WINDOW_MS
      ) {
        frameTimes.shift();
      }
      store.getState().setFps(frameTimes.length);
      store.getState().setMemoryMB(readMemoryMB());
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // ── 1Hz sample loop ────────────────────────────────────────────
  // Pushes one sample per second into the rolling buffer. The chart
  // subscribes to `samples` and redraws — once per second is plenty
  // for a 60-second time-series.
  const sampleTick = (): void => {
    if (store.getState().paused) return;
    const s = store.getState();
    s.pushSample({
      fps: s.fps,
      drawCalls: readDrawCalls(),
      memoryMB: s.memoryMB,
      t: performance.now(),
    });
  };
  const interval = setInterval(sampleTick, 1000);

  // ── Command registrations ──────────────────────────────────────
  // The panel's Pause/Reset buttons fire these scripts. All three IDs
  // are namespaced under `profiler.` per the editor's command-id
  // convention.
  const unregPause = ctx.registerCommand({
    id: "profiler.pause",
    title: "Profiler: Pause",
    category: "Diagnostics",
    run: () => store.getState().setPaused(true),
  });
  const unregReset = ctx.registerCommand({
    id: "profiler.reset",
    title: "Profiler: Reset",
    category: "Diagnostics",
    run: () => store.getState().resetSamples(),
  });
  const unregToggle = ctx.registerCommand({
    id: "profiler.toggle",
    title: "Profiler: Toggle Pause",
    category: "Diagnostics",
    run: () => store.getState().togglePaused(),
  });

  // ── Hand off to chart-init.ts ──────────────────────────────────
  // Two scripts in one pack, sharing state via the loader's
  // `share`/`consume` slot. Keys are namespaced to avoid collision
  // with other packs (though slots are per-pack-load, not global).
  const Chart = ctx.importLibrary("chart.js");
  ctx.share("profiler:chart-deps", { Chart, store });

  return () => {
    cancelAnimationFrame(raf);
    clearInterval(interval);
    unregPause();
    unregReset();
    unregToggle();
  };
}
