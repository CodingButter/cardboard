/**
 * demo-performance-profiler — chart instantiation script.
 *
 * Runs AFTER setup.ts (the loader executes `manifest.scripts[]` in
 * declaration order). Responsibilities:
 *
 *   1. Pull `{ Chart, store }` from `ctx.share("profiler:chart-deps")`.
 *      The Chart module is a Promise the setup script shared
 *      (`ctx.importLibrary("chart.js")` returns a Promise) — we await
 *      it here.
 *   2. Register an `onPanelMount("performance-profiler", ...)` hook
 *      that:
 *        - Looks up the canvas DOM node via
 *          `ctx.getCanvasRef("profiler-chart")`.
 *        - Instantiates a chart.js line chart with three datasets
 *          (FPS / drawCalls / memoryMB).
 *        - Subscribes to the store; on every change, syncs the chart
 *          datasets to `samples[]` and calls `chart.update("none")`
 *          (zero-animation update).
 *        - Returns a teardown that destroys the chart on panel
 *          unmount.
 *
 * The data-collection (engine concern) and the visualisation
 * (presentation concern) live in separate scripts so a future "stats
 * exporter" pack can reuse setup.ts's store without shipping a chart.
 */

import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";

// Minimal structural typing for the chart.js bundle's exports. The
// real module ships a richer type surface; we only need the bits the
// script touches, and a structural pin keeps the script free of
// the chart.js npm declarations (which we don't bundle into the .apg).
interface ChartConstructor {
  new (
    ctx: HTMLCanvasElement | CanvasRenderingContext2D,
    config: unknown,
  ): ChartInstance;
}
interface ChartInstance {
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      borderColor: string;
      tension?: number;
      yAxisID?: string;
    }>;
  };
  update: (mode?: string) => void;
  destroy: () => void;
}

interface ProfilerSample {
  fps: number;
  drawCalls: number;
  memoryMB: number;
  t: number;
}

interface ProfilerStateData {
  samples: ProfilerSample[];
  [k: string]: unknown;
}

/** The `share` payload setup.ts hands us. */
interface ChartDeps {
  Chart: Promise<unknown>;
  store: {
    getState: () => ProfilerStateData;
    subscribe: (cb: (s: ProfilerStateData) => void) => () => void;
  };
}

export default async function chartInit(
  ctx: EditorPackContext,
): Promise<() => void> {
  // setup.ts shared the Chart promise + the dynamic store under this
  // key. Reading it here is synchronous (the loader runs scripts in
  // declaration order; setup.ts has already called share before we
  // run). The Chart promise is awaited at panel-mount time so the
  // chart.js bundle finishes downloading + evaluating before we try
  // to instantiate.
  const deps = ctx.consume("profiler:chart-deps") as ChartDeps | undefined;
  if (!deps) {
    // eslint-disable-next-line no-console
    console.error(
      "[demo-performance-profiler] chart-init.ts: no chart-deps in share " +
        "slot — setup.ts must run before chart-init.ts (check manifest.scripts " +
        "declaration order)",
    );
    return () => {};
  }
  const { Chart: ChartPromise, store } = deps;

  // Register a panel-mount hook that creates the chart when the
  // panel's `<canvas refName="profiler-chart">` mounts. The mount
  // callback is async (chart.js bundle resolution is async), so we
  // hold the chart instance in a closure variable and return a
  // teardown that destroys it on unmount.
  const unregister = ctx.onPanelMount(
    "performance-profiler",
    () => {
      const canvas = ctx.getCanvasRef("profiler-chart");
      if (!canvas) {
        // eslint-disable-next-line no-console
        console.warn(
          "[demo-performance-profiler] chart-init: canvas ref " +
            "'profiler-chart' not registered at mount time — skipping",
        );
        return;
      }
      let chart: ChartInstance | null = null;
      let storeUnsub: (() => void) | null = null;
      let cancelled = false;

      void (async () => {
        // Resolve chart.js. The module's exports include `Chart` as
        // a named export from `chart.js/auto/auto.js` (pre-registered
        // controllers + scales).
        const mod = (await ChartPromise) as Record<string, unknown>;
        if (cancelled) return;
        const Chart = (mod.Chart ?? mod.default) as ChartConstructor;
        if (typeof Chart !== "function") {
          // eslint-disable-next-line no-console
          console.error(
            "[demo-performance-profiler] chart-init: chart.js bundle did " +
              "not export Chart constructor — got keys: " +
              Object.keys(mod).join(", "),
          );
          return;
        }

        chart = new Chart(canvas, {
          type: "line",
          data: {
            labels: [],
            datasets: [
              {
                label: "FPS",
                data: [],
                borderColor: "#22d3ee", // cyan-400
                tension: 0.2,
                yAxisID: "yFps",
              },
              {
                label: "Draw Calls",
                data: [],
                borderColor: "#f59e0b", // amber-500
                tension: 0.2,
                yAxisID: "yDraw",
              },
              {
                label: "Memory (MB)",
                data: [],
                borderColor: "#ec4899", // pink-500
                tension: 0.2,
                yAxisID: "yMem",
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: "nearest", intersect: false },
            plugins: {
              legend: {
                labels: { color: "#cbd5e1", boxWidth: 12 },
              },
              tooltip: { enabled: true },
            },
            scales: {
              x: {
                ticks: { color: "#64748b", maxTicksLimit: 6 },
                grid: { color: "rgba(100,116,139,0.15)" },
              },
              yFps: {
                position: "left",
                ticks: { color: "#22d3ee" },
                grid: { color: "rgba(100,116,139,0.15)" },
                beginAtZero: true,
              },
              yDraw: {
                position: "right",
                ticks: { color: "#f59e0b" },
                grid: { drawOnChartArea: false },
                beginAtZero: true,
              },
              yMem: {
                position: "right",
                ticks: { color: "#ec4899" },
                grid: { drawOnChartArea: false },
                beginAtZero: true,
              },
            },
          },
        });

        const syncToStore = (s: ProfilerStateData): void => {
          if (!chart) return;
          const samples = s.samples;
          chart.data.labels = samples.map((sample, i) =>
            String(i - samples.length + 1),
          );
          chart.data.datasets[0]!.data = samples.map((sample) => sample.fps);
          chart.data.datasets[1]!.data = samples.map(
            (sample) => sample.drawCalls,
          );
          chart.data.datasets[2]!.data = samples.map(
            (sample) => sample.memoryMB,
          );
          chart.update("none");
        };

        // Seed with current store contents + subscribe for updates.
        syncToStore(store.getState());
        storeUnsub = store.subscribe(syncToStore);
      })();

      // Mount teardown — fires on panel unmount.
      return () => {
        cancelled = true;
        if (storeUnsub) {
          storeUnsub();
          storeUnsub = null;
        }
        if (chart) {
          chart.destroy();
          chart = null;
        }
      };
    },
  );

  // Pack-level teardown — fires on pack disable.
  return () => {
    unregister();
  };
}
