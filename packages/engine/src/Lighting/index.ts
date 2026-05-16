/**
 * Engine-side lighting helpers.
 *
 * Currently exports the `bakeScene` function used by:
 *   - `apps/pack-builder/src/build-packs.ts` (CLI build)
 *   - `apps/editor/src/workers/bake.worker.ts` (in-browser bake worker)
 *
 * See `Bake.ts` for the algorithm; `docs/plans/EDITOR.md` §7 for the
 * editor's worker contract; `docs/plans/LIGHTING_OVERHAUL.md` for the
 * full lighting model.
 */
export { bakeScene } from "./Bake";
export type { BakeOpts, BakeResult, BakeStats } from "./Bake";
