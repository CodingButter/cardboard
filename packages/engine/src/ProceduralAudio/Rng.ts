/**
 * Seeded RNG — Mulberry32. Fast, ~32-bit state, no `Math.random()`
 * dependency. Same seed → same sequence across browsers + engine
 * builds, which is the determinism contract from SOUND_LAB.md §3.6.
 *
 * Used by `Ops/noise.ts` to fill the precomputed noise buffer and by
 * any future random/sample-and-hold ops.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Mulberry32 expects a non-zero 32-bit state. A `0` seed flowing
    // through the engine's "0 means random" sugar (§4.6) is rerouted
    // upstream of this class — we don't second-guess it here.
    this.state = (seed | 0) || 1;
  }

  /** Next 32-bit unsigned int. */
  nextUint32(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Next float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 0x100000000;
  }

  /** Next float in [-1, 1). */
  nextBipolar(): number {
    return this.nextFloat() * 2 - 1;
  }
}

/**
 * Hash a string into a 32-bit integer seed. Used when a recipe's
 * `seed` is unset and the engine wants a deterministic-but-recipe-
 * dependent default — pipe `recipe.id` through here.
 */
export function hashStringSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}
