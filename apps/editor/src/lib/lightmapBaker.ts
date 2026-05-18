/**
 * Lightmap-bake orchestrator — the editor's main-thread surface for
 * E4's ⚡ Bake button (see `docs/plans/EDITOR.md` §7).
 *
 * Responsibilities:
 *
 *   1. Load the active scene JSON from IDB.
 *   2. Spin up a one-shot Web Worker (`workers/bake-lightmap.worker.ts`)
 *      so the bake doesn't freeze the React tree on big scenes.
 *   3. Pipe progress events through to an optional `onProgress`
 *      callback so the toolbar button can surface a progress text.
 *   4. Merge the baked lightmap field onto the source scene + persist
 *      it back to IDB via `EditorProjectStore.saveAsset`.
 *   5. Tear down the worker on success / failure / cancel.
 *
 * The smoke test bypasses Web-Worker construction (no Worker runtime
 * under Bun + fake-indexeddb) by importing `runBakeJob` from the
 * worker module directly. See `apps/editor/scripts/smoke-bake-lightmap.ts`.
 */

import type { BakeOpts, SceneJSON } from "@two_5_d/engine";
import { EditorProjectStore } from "./EditorProjectStore";
import { stringifySceneRle } from "./sceneSerde";
import {
  runBakeJob,
  type BakeJobDone,
  type BakeJobOutbound,
} from "../workers/bake-lightmap.worker";

/**
 * Optional progress reporter the orchestrator hands to the toolbar
 * button. The string form ("Baking… 42%") is what the button renders;
 * we keep it pre-formatted here so every caller renders consistently.
 */
export type BakeProgressFn = (status: string) => void;

export interface BakeSceneLightmapResult {
  stats: BakeJobDone["stats"];
  /** The lightmap-bearing scene JSON, post-save. */
  scene: SceneJSON;
}

/**
 * Bake the lightmap for `scenePath` and persist the updated JSON.
 *
 * Resolves once the worker has reported `done` and the scene has been
 * written back to IDB. Rejects on JSON parse errors, missing scene,
 * worker error messages, or unexpected worker termination.
 *
 * `opts.useWorker = false` falls back to in-thread bake — used by the
 * smoke test (no Worker runtime) and as a safety valve if a host
 * environment can't spin up workers. Default is `true`.
 */
export async function bakeSceneLightmap(
  projectId: string,
  scenePath: string,
  onProgress?: BakeProgressFn,
  options: { bakeOpts?: BakeOpts; useWorker?: boolean } = {},
): Promise<BakeSceneLightmapResult> {
  const { bakeOpts, useWorker = true } = options;

  onProgress?.("Loading scene…");
  const body = await EditorProjectStore.loadAsset(projectId, scenePath);
  if (body === null) {
    throw new Error(`bakeSceneLightmap: scene not found at ${scenePath}`);
  }
  if (typeof body !== "string") {
    throw new Error(
      `bakeSceneLightmap: ${scenePath} is a binary asset; expected JSON text`,
    );
  }
  let scene: SceneJSON;
  try {
    scene = JSON.parse(body) as SceneJSON;
  } catch (err) {
    throw new Error(
      `bakeSceneLightmap: invalid JSON in ${scenePath} — ${(err as Error).message}`,
    );
  }

  onProgress?.("Baking…");
  const done = useWorker
    ? await bakeInWorker(scene, bakeOpts, onProgress)
    : await bakeInThread(scene, bakeOpts, onProgress);

  onProgress?.("Saving…");
  // The worker returns the full scene JSON with the `lightmap` field
  // populated. Persist it via `stringifySceneRle` so the grid layers
  // round-trip back to the on-disk RLE wire form — `bakeScene`
  // unrolls grids internally and would otherwise write nested arrays
  // back to disk, flipping any RLE-shipped scene to the verbose form
  // on its first bake.
  await EditorProjectStore.saveAsset(
    projectId,
    scenePath,
    stringifySceneRle(done.scene as unknown as Record<string, unknown>),
  );

  onProgress?.(`Done · ${done.stats.lights} light(s) · ${done.stats.ms.toFixed(0)} ms`);
  return { stats: done.stats, scene: done.scene };
}

/** In-thread fallback — calls the same `runBakeJob` the worker uses. */
async function bakeInThread(
  scene: SceneJSON,
  bakeOpts: BakeOpts | undefined,
  onProgress: BakeProgressFn | undefined,
): Promise<BakeJobDone> {
  return runBakeJob(
    { type: "bake", scene, opts: bakeOpts },
    onProgress
      ? (fraction) => onProgress(`Baking… ${Math.round(fraction * 100)}%`)
      : undefined,
  );
}

/**
 * Spin up a one-shot Web Worker, post the bake job, await `done`
 * (or `error`). Caller waits via the returned Promise. The worker is
 * always terminated before we resolve — single-shot lifecycle.
 */
function bakeInWorker(
  scene: SceneJSON,
  bakeOpts: BakeOpts | undefined,
  onProgress: BakeProgressFn | undefined,
): Promise<BakeJobDone> {
  return new Promise<BakeJobDone>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../workers/bake-lightmap.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch (err) {
      reject(
        new Error(
          `bakeSceneLightmap: failed to construct Worker — ${(err as Error).message}`,
        ),
      );
      return;
    }

    function cleanup(): void {
      try {
        worker.terminate();
      } catch {
        // ignore — worker may already be gone
      }
    }

    worker.addEventListener("message", (ev: MessageEvent<BakeJobOutbound>) => {
      const data = ev.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") {
        return;
      }
      if (data.type === "progress") {
        if (onProgress) {
          onProgress(`Baking… ${Math.round(data.fraction * 100)}%`);
        }
        return;
      }
      if (data.type === "done") {
        cleanup();
        resolve({ type: "done", scene: data.scene, stats: data.stats });
        return;
      }
      if (data.type === "error") {
        cleanup();
        reject(new Error(`bakeSceneLightmap: worker error — ${data.message}`));
        return;
      }
    });
    worker.addEventListener("error", (ev) => {
      cleanup();
      reject(
        new Error(
          `bakeSceneLightmap: worker crashed — ${ev.message || "(no message)"}`,
        ),
      );
    });
    worker.addEventListener("messageerror", () => {
      cleanup();
      reject(new Error("bakeSceneLightmap: worker message could not be deserialised"));
    });

    worker.postMessage({ type: "bake", scene, opts: bakeOpts });
  });
}
