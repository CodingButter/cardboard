/**
 * Recipe content hash — SHA-256 over the canonical JSON. Used as the
 * IDB cache key for static + loop bakes (SOUND_LAB.md §6.5). The
 * engine version is folded into the hashed payload so a compiler
 * upgrade auto-invalidates stale bakes.
 *
 * Canonicalisation: keys sorted at every object depth, whitespace
 * stripped. This means two recipes that differ only in field order
 * resolve to the same hash + share a bake.
 */

import type { SoundRecipeJson } from "./types";

/**
 * Sound Lab engine-version tag. Bumped whenever recipeCompile changes
 * in a way that would alter the rendered output for an existing
 * recipe. Folded into the cache key so old bakes auto-invalidate.
 */
export const PROCEDURAL_AUDIO_ENGINE_VERSION = "sl2.0.0";

/** Recursively rebuild an object with keys sorted at every depth. */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj).sort()) {
      out[key] = canonicalise(obj[key]);
    }
    return out;
  }
  return value;
}

/** Compute the canonical-JSON string for a recipe. */
export function canonicalRecipeJson(recipe: SoundRecipeJson): string {
  const wrapped = {
    recipe: canonicalise(recipe),
    engine: PROCEDURAL_AUDIO_ENGINE_VERSION,
  };
  return JSON.stringify(wrapped);
}

/**
 * Compute the SHA-256 hex digest of `text`. Uses `crypto.subtle.digest`
 * which is available in all evergreen browsers; the engine has no
 * Node-only fallback path because the runtime engine ships only to
 * browsers (the pack-builder script runs in Bun, which exposes
 * `crypto.subtle` natively).
 */
export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Compute the bake-cache key for a recipe. */
export async function recipeContentHash(recipe: SoundRecipeJson): Promise<string> {
  return sha256Hex(canonicalRecipeJson(recipe));
}
