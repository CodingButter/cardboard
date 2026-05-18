/**
 * Scene serialise / deserialise helpers — bridge the on-disk RLE wire
 * form (per `packages/engine/src/Scene.ts` `RleGrid` / `encodeRleGrid`
 * / `normaliseGridField`) and the editor's in-memory `MutableScene`
 * shape, where every grid layer is the unrolled `number[][]`.
 *
 * Why a dedicated module?  Three call sites need the conversion:
 *
 *   1. `ProjectView` — `loadAsset` → `JSON.parse` → normalise so the
 *      `GridEditor` widget always sees nested arrays.
 *   2. `ProjectView.persistScene` + `lightmapBaker` — encode back to
 *      RLE before `saveAsset` so the on-disk shape stays compact.
 *      Scenes that started life unrolled get RLE'd on first save.
 *   3. Dirty-state / external-rewrite reload — normalise both sides so
 *      a re-load doesn't false-positive because RLE → nested
 *      stringifies differently.
 *
 * Both `walls` / `floors` / `ceilings` are covered. The editor's
 * `MutableScene` also tolerates a `ceiling` (singular) authoring key —
 * we normalise / encode that one too even though the engine only reads
 * `ceilings`. Round-tripping through the editor must not silently
 * drop authoring-only fields.
 *
 * Anything that isn't a grid is returned by reference — these helpers
 * never deep-clone the rest of the scene.
 */

import {
  encodeRleGrid,
  isRleGrid,
  normaliseGridField,
  type GridField,
} from "@two_5_d/engine";

/** Grid-layer keys we normalise / encode. Keep in sync with `MutableScene`. */
const GRID_KEYS = ["walls", "floors", "ceiling", "ceilings"] as const;
type GridKey = (typeof GRID_KEYS)[number];

type Cell = number;
type RawScene = Record<string, unknown>;

function isMaybeGrid(value: unknown): value is GridField<Cell> {
  if (Array.isArray(value)) return true;
  return isRleGrid(value);
}

/**
 * Unroll any RLE grid layers on the scene into nested-array form.
 * Returns a shallow-copied scene; layers already in nested form are
 * passed through by reference. Missing layers stay missing.
 */
export function normaliseSceneGrids<T extends RawScene>(scene: T): T {
  let mutated = false;
  const out: RawScene = { ...scene };
  for (const key of GRID_KEYS) {
    const v = out[key];
    if (v === undefined) continue;
    if (!isMaybeGrid(v)) continue;
    if (isRleGrid(v)) {
      out[key] = normaliseGridField(v as GridField<Cell>);
      mutated = true;
    }
    // Nested-array form already — leave it.
  }
  return (mutated ? out : scene) as T;
}

/**
 * Encode any nested-array grid layers on the scene into the RLE wire
 * form. Returns a shallow-copied scene; layers already in RLE form
 * are passed through by reference. Empty arrays encode to
 * `{ width: 0, height: 0, rle: [] }` — matches `encodeRleGrid`.
 *
 * NB: only re-encodes layers that are actually present. We don't add
 * a `floors` / `ceilings` key just because the engine accepts one.
 */
export function encodeSceneGrids<T extends RawScene>(scene: T): T {
  let mutated = false;
  const out: RawScene = { ...scene };
  for (const key of GRID_KEYS) {
    const v = out[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) continue; // already RLE or non-grid — skip.
    // `encodeRleGrid` accepts any T[][], so the editor's `number[][]`
    // grids fall through unchanged.
    out[key] = encodeRleGrid(v as ReadonlyArray<ReadonlyArray<Cell>>);
    mutated = true;
  }
  return (mutated ? out : scene) as T;
}

/**
 * Convenience — `JSON.parse(text)` + `normaliseSceneGrids` in one
 * call. Returns the parsed scene with every grid layer in nested-
 * array form, ready to hand to `GridEditor`.
 */
export function parseSceneText<T extends RawScene = RawScene>(text: string): T {
  const parsed = JSON.parse(text) as T;
  return normaliseSceneGrids(parsed);
}

/**
 * Convenience — `encodeSceneGrids` + `JSON.stringify(…, null, 2)` in
 * one call. Use this on every editor save path so scenes stay RLE'd
 * on disk.
 */
export function stringifySceneRle<T extends RawScene>(scene: T): string {
  return JSON.stringify(encodeSceneGrids(scene), null, 2);
}
