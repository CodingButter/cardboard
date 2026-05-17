/**
 * Pure-logic CRUD utilities for cardboard's tile-preset workflow.
 *
 * Foundation for the eventual Tile Preset T4 workflow (#198) — preset
 * edit mode + auto-divergence when a cell's properties diverge from
 * its preset.
 *
 * No side effects. No IDB. No React. Just functions over the engine's
 * `Preset` / `ResolvedPresetData` types.
 */

import type { Preset, ResolvedPresetData } from "@two_5_d/engine";

// The task spec calls the resolved-preset record `ResolvedPreset`; the
// engine exports it as `Preset`. Re-alias here so the public API of
// this module matches the spec without forcing a rename in the engine.
export type ResolvedPreset = Preset;

/**
 * Field set the Cell Inspector exposes for editing. Divergence detection
 * compares these — and only these — between a cell's effective config
 * and its parent preset's data. Keep in sync with the inspector UI.
 */
const EDITABLE_FIELDS: ReadonlyArray<keyof ResolvedPresetData> = [
  "texture",
  "topCap",
  "bottomCap",
  "wallHeight",
  "wallStartZ",
  "partialWall",
  "floorHeight",
  "ceilingHeight",
  "reflectiveness",
  "transition",
  "riserTexture",
  "emissive",
  "tags",
  "collision",
];

/**
 * Deep-clones a preset under a new id. The new preset is identical to
 * the source except for `id` and (if the source's `data.displayName`
 * is set) `data.displayName`, which is rewritten to the new id so the
 * preset picker shows something meaningful for the clone.
 *
 * Uses the platform `structuredClone` so nested objects (`partialWall`,
 * `emissive`, `shader`) and arrays (`tags`, emissive `color`) are fully
 * detached from the source.
 */
export function clonePreset(source: ResolvedPreset, newId: string): ResolvedPreset {
  const cloned = structuredClone(source) as {
    id: string;
    data: ResolvedPresetData;
    sourcePackId: string;
    sourcePath: string;
  };
  cloned.id = newId;
  if (cloned.data.displayName !== undefined) {
    cloned.data.displayName = newId;
  }
  return cloned as ResolvedPreset;
}

/**
 * Generates an auto-named id from a parent's id by appending a random
 * 6-character lowercase hex suffix:
 *
 *   autoNamePreset("brick.wall", [])
 *     → "brick.wall.a3f9c2"   (random per call)
 *
 * Designers can rename the auto-generated id later through the preset
 * edit-mode workflow (#198). The random suffix is only meant to be
 * unique-enough at clone time.
 *
 * Collision strategy: if the freshly-generated id collides with anything
 * in `existingIds`, retry with new randomness up to 10 times. If every
 * attempt collides, fall back to a sequential `_N` suffix (matching the
 * pre-rename behavior) so the function is still total.
 *
 * Trailing `_<digits>` on the parent id is left in place — the random
 * suffix carries the uniqueness, so we don't need to strip a numeric
 * family marker the way the old sequential scheme did.
 */
export function autoNamePreset(
  parentId: string,
  existingIds: ReadonlyArray<string>,
): string {
  const taken = new Set(existingIds);
  for (let i = 0; i < 10; i++) {
    const suffix = randomHex6();
    const candidate = `${parentId}.${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Pathological fallback — every random suffix collided. Use sequential.
  let n = 2;
  while (taken.has(`${parentId}_${n}`)) {
    n++;
  }
  return `${parentId}_${n}`;
}

/**
 * Returns a 6-character lowercase hex string. Uses `crypto.getRandomValues`
 * when available (browser + Bun + modern Node) and falls back to
 * `Math.random` if the platform somehow lacks it.
 */
function randomHex6(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2, 8).padStart(6, "0");
}

/**
 * Returns true if any field in `cellConfig` that the inspector exposes
 * differs from the parent preset's resolved value.
 *
 * A cell-config field that is `undefined` means "inherit the preset" —
 * no divergence. A field that is set to the same value as the preset
 * also doesn't diverge. Nested objects (`partialWall`, `emissive`) are
 * compared structurally; any internal-field mismatch counts.
 */
export function hasDiverged(
  cellConfig: Partial<ResolvedPresetData>,
  parentPreset: ResolvedPreset,
): boolean {
  for (const field of EDITABLE_FIELDS) {
    if (fieldDiverges(cellConfig, parentPreset.data, field)) return true;
  }
  return false;
}

/**
 * Returns the editable-field names where `cellConfig` diverges from
 * `parentPreset.data`. Order matches the `EDITABLE_FIELDS` list above
 * so UI surfaces ("Diverged from preset: texture, emissive") render
 * with a stable, predictable order.
 */
export function divergedFields(
  cellConfig: Partial<ResolvedPresetData>,
  parentPreset: ResolvedPreset,
): ReadonlyArray<keyof ResolvedPresetData> {
  const out: Array<keyof ResolvedPresetData> = [];
  for (const field of EDITABLE_FIELDS) {
    if (fieldDiverges(cellConfig, parentPreset.data, field)) out.push(field);
  }
  return out;
}

/* --- internals --------------------------------------------------------- */

/**
 * Single-field diverge check. A field that's omitted from `cellConfig`
 * (key absent OR value `undefined`) is treated as "inherit" → no
 * divergence — regardless of what the preset has for it. Otherwise we
 * deep-equal the two values.
 */
function fieldDiverges<K extends keyof ResolvedPresetData>(
  cellConfig: Partial<ResolvedPresetData>,
  parentData: ResolvedPresetData,
  field: K,
): boolean {
  const cellValue = cellConfig[field];
  if (cellValue === undefined) return false;
  return !deepEqual(cellValue, parentData[field]);
}

/**
 * Structural deep-equal for the value shapes that show up inside
 * `ResolvedPresetData`: primitives, arrays of primitives (e.g. `tags`,
 * emissive `color`), and small flat objects (`partialWall`, `emissive`).
 *
 * Deliberately minimal — no `Date`/`Map`/`Set`/cycle handling, none of
 * which appear in `ResolvedPresetData`.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (
      !deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      )
    ) {
      return false;
    }
  }
  return true;
}
