/**
 * demo-scene-stats — second-consumer chart.js pack.
 *
 * Purpose: dogfood proof that the editor's libraryCache content-hash
 * dedup actually works in practice. This pack declares the SAME
 * `chart.js@4.4.0` entry under `manifest.libraries[]` as the
 * Performance Profiler pack. When both packs load, the loader feeds
 * identical bytes through `resolveLibrary` and the second call hits
 * the cache — observable as a `[libraryCache] cache HIT (dedup)`
 * console line.
 *
 * What this pack ships:
 *
 *   1. A `sceneStats` Zustand store with four bucket counts
 *      (walls / floors / ceilings / empty) + a `reshuffle` action.
 *   2. A `scene-stats.reshuffle` command the panel's Reshuffle button
 *      fires through the command registry.
 *   3. A doughnut chart instantiated on panel-mount that re-renders
 *      whenever the store changes.
 *
 * The bucket values are pack-generated samples (not real scene-store
 * reads) — that's deliberate. The dedup proof doesn't need access to
 * `useSceneStore`, and widening `EditorPackContext.stores` to include
 * the scene store is a separate decision that should be motivated by
 * a pack that genuinely needs the data, not by a verification harness.
 *
 * One-script design (vs the Profiler's setup + chart-init split):
 * `ctx.importLibrary("chart.js")` returns a Promise that we await
 * inside the `onPanelMount` callback, so we don't need a second
 * script + the `share`/`consume` slot. Single-script keeps the proof
 * minimal — fewer moving parts to skew the verification.
 */

// Type-only import — Bun's bundler erases at build time, so the
// emitted JS has no editor-side dependency. Works at authoring time
// because the workspace lives under the same monorepo root.
import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";

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
      backgroundColor: string[];
      borderColor?: string;
      borderWidth?: number;
    }>;
  };
  update: (mode?: string) => void;
  destroy: () => void;
}

interface SceneStatsStateData {
  walls: number;
  floors: number;
  ceilings: number;
  empty: number;
}

interface SceneStatsStateActions extends Record<string, unknown> {
  reshuffle: () => void;
}

/**
 * Generate a fresh set of bucket counts. Pseudo-random but bounded so
 * the chart's segments visibly redistribute on each Reshuffle press.
 * The TOTAL stays at 100 so the doughnut reads as a percentage
 * breakdown — useful for the demo even though the underlying numbers
 * are synthetic.
 */
function generateSample(): SceneStatsStateData {
  // Four random weights, normalised to sum to 100. Using integer
  // truncation + a final-bucket remainder keeps the four readouts as
  // clean integers (no `42.333333…`).
  const weights = [Math.random(), Math.random(), Math.random(), Math.random()];
  const sum = weights[0]! + weights[1]! + weights[2]! + weights[3]!;
  const walls = Math.round((weights[0]! / sum) * 100);
  const floors = Math.round((weights[1]! / sum) * 100);
  const ceilings = Math.round((weights[2]! / sum) * 100);
  const empty = 100 - walls - floors - ceilings;
  return { walls, floors, ceilings, empty };
}

export default async function setup(
  ctx: EditorPackContext,
): Promise<() => void> {
  // ── Pack-owned store ────────────────────────────────────────────
  // Registered under `sceneStats` so the panel JSON's
  // `$store.sceneStats.walls` etc. bindings resolve through
  // resolveBinding's dynamic-store lookup.
  const store = ctx.createStore<SceneStatsStateData, SceneStatsStateActions>(
    "sceneStats",
    generateSample(),
    (set, _get) => ({
      reshuffle: () => set(generateSample() as Partial<SceneStatsStateData>),
    }),
  );

  // ── Command ─────────────────────────────────────────────────────
  // The panel's Reshuffle button fires this through the command
  // registry. Namespaced under `scene-stats.` per editor convention.
  const unregReshuffle = ctx.registerCommand({
    id: "scene-stats.reshuffle",
    title: "Scene Stats: Reshuffle Sample",
    category: "Diagnostics",
    run: () => store.getState().reshuffle(),
  });

  // ── Resolve chart.js — this is the dedup hit ────────────────────
  // The first pack to load (Performance Profiler) takes the cache
  // MISS path and pays for the parse. This pack — loaded second —
  // takes the HIT path: same hash, same Blob URL, same module
  // namespace. The console line in libraryCache.ts proves it.
  const ChartPromise = ctx.importLibrary("chart.js");

  // ── Panel-mount hook ────────────────────────────────────────────
  // Instantiate the doughnut chart when the panel's <canvas> mounts.
  // The closure holds chart + subscription so the mount-teardown can
  // tear them down on panel unmount.
  const unregMount = ctx.onPanelMount("scene-stats", () => {
    const canvas = ctx.getCanvasRef("scene-stats-chart");
    if (!canvas) {
      // eslint-disable-next-line no-console
      console.warn(
        "[demo-scene-stats] canvas ref 'scene-stats-chart' not " +
          "registered at mount time — skipping",
      );
      return;
    }
    let chart: ChartInstance | null = null;
    let storeUnsub: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const mod = (await ChartPromise) as Record<string, unknown>;
      if (cancelled) return;
      const Chart = (mod.Chart ?? mod.default) as ChartConstructor;
      if (typeof Chart !== "function") {
        // eslint-disable-next-line no-console
        console.error(
          "[demo-scene-stats] chart.js bundle did not export Chart " +
            "constructor — got keys: " + Object.keys(mod).join(", "),
        );
        return;
      }

      chart = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels: ["Walls", "Floors", "Ceilings", "Empty"],
          datasets: [
            {
              label: "Cells",
              data: [0, 0, 0, 0],
              // Roughly tile-themed palette — distinct from the
              // profiler chart's FPS/draw-call line colours so the
              // two panels read as different products visually.
              backgroundColor: [
                "#f97316", // orange-500 — walls
                "#10b981", // emerald-500 — floors
                "#3b82f6", // blue-500 — ceilings
                "#475569", // slate-600 — empty
              ],
              borderColor: "#0f172a",
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: {
              position: "right",
              labels: { color: "#cbd5e1", boxWidth: 12 },
            },
            tooltip: { enabled: true },
          },
        },
      });

      const syncToStore = (s: SceneStatsStateData): void => {
        if (!chart) return;
        chart.data.datasets[0]!.data = [
          s.walls,
          s.floors,
          s.ceilings,
          s.empty,
        ];
        chart.update("none");
      };

      syncToStore(store.getState());
      storeUnsub = store.subscribe(syncToStore);
    })();

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
  });

  // ── Pack-level teardown ─────────────────────────────────────────
  return () => {
    unregMount();
    unregReshuffle();
  };
}
