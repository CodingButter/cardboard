/**
 * Lightmap bake — Web Worker entrypoint.
 *
 * E4 of `docs/plans/EDITOR.md`: the editor's ⚡ Bake button posts a
 * scene JSON + bake options into this worker, the worker runs the
 * engine-side `bakeScene` algorithm off the main thread, then posts
 * the baked SceneJSON (with a populated `lightmap` field) back.
 *
 * The actual bake call lives in `runBakeJob` so the smoke test (which
 * can't spin up a real Worker under Bun + fake-indexeddb) can exercise
 * the same code path without postMessage plumbing.
 *
 * Worker contract:
 *   in  : { type: "bake", scene: SceneJSON, opts?: BakeOpts }
 *   out : { type: "progress", fraction: number }
 *       | { type: "done", scene: SceneJSON, stats: BakeStats }
 *       | { type: "error", message: string }
 */

import { bakeScene } from "@two_5_d/engine";
import type { BakeOpts, BakeResult, SceneJSON } from "@two_5_d/engine";

/** Inbound message — the orchestrator posts exactly one of these. */
export interface BakeJobRequest {
  type: "bake";
  scene: SceneJSON;
  opts?: BakeOpts;
}

/** Outbound message: incremental progress. */
export interface BakeJobProgress {
  type: "progress";
  fraction: number;
}

/** Outbound message: terminal success. */
export interface BakeJobDone {
  type: "done";
  scene: SceneJSON;
  stats: BakeResult["stats"];
}

/** Outbound message: terminal failure. */
export interface BakeJobError {
  type: "error";
  message: string;
}

export type BakeJobOutbound = BakeJobProgress | BakeJobDone | BakeJobError;

/**
 * Pure bake job entrypoint — no Worker / DOM dependencies. Called by
 * the worker's message handler AND directly by the smoke test.
 *
 * `onProgress` (optional) receives [0,1] fractions; the worker forwards
 * them as `{type:"progress"}` messages so the host UI can drive a bar.
 */
export function runBakeJob(
  req: BakeJobRequest,
  onProgress?: (fraction: number) => void,
): BakeJobDone {
  const opts: BakeOpts = { ...(req.opts ?? {}) };
  if (onProgress) {
    opts.onProgress = onProgress;
  }
  const { scene, stats } = bakeScene(req.scene, opts);
  return { type: "done", scene, stats };
}

// Only wire up the postMessage handler when running INSIDE a Worker.
// The smoke test imports this module from Bun's main thread; in that
// case `self` is the window/globalThis and we must NOT register a
// `message` listener (it'd capture unrelated postMessage traffic).
//
// Detection: `WorkerGlobalScope` is defined on a Worker's `self` and
// absent on a Window/globalThis. We probe via the global instead of
// pulling the WebWorker lib into the editor's tsconfig — the worker
// is the only module that ever instantiates this codepath.
interface WorkerSelf {
  postMessage(msg: BakeJobOutbound): void;
  addEventListener(
    type: "message",
    handler: (ev: { data: BakeJobRequest }) => void,
  ): void;
}

const workerSelf: WorkerSelf | null = (() => {
  const g = globalThis as Record<string, unknown>;
  const WGS = g["WorkerGlobalScope"] as
    | { prototype: object }
    | undefined;
  const slf = g["self"] as object | undefined;
  if (!WGS || !slf) return null;
  if (!(slf instanceof (WGS as unknown as new () => object))) return null;
  return slf as unknown as WorkerSelf;
})();

if (workerSelf) {
  workerSelf.addEventListener("message", (ev) => {
    const data = ev.data;
    if (!data || data.type !== "bake") return;
    try {
      const result = runBakeJob(data, (fraction) => {
        workerSelf.postMessage({ type: "progress", fraction });
      });
      workerSelf.postMessage(result);
    } catch (err) {
      workerSelf.postMessage({
        type: "error",
        message: (err as Error)?.message ?? String(err),
      });
    }
  });
}
