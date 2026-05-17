/**
 * `noise` op — seeded white / pink / brown noise.
 *
 * SOUND_LAB.md §4.1 specifies a precomputed mono buffer (default 4s)
 * looped via `AudioBufferSourceNode`. Seeded so editor preview and
 * pack runtime produce byte-identical output (§3.6 determinism).
 *
 * Per-recipe fallback: when the node's `seed` param is absent, the
 * recipe-level `seed` flows in; combined with `hashStringSeed(node.id)`
 * so two un-seeded noise ops in the same recipe diverge.
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam, strParam } from "./OpFactory";
import { buildNoiseBuffer, type NoiseType } from "../WaveTables";
import { hashStringSeed } from "../Rng";

export const noise: OpFactory = (ctx, node, recipe, voice) => {
  const type = strParam<NoiseType>(node.params, "type", "white");
  // Compose the effective seed: explicit param > recipe seed > 1, all
  // mixed with the node id so multiple noise ops in one recipe diverge.
  const explicit = node.params?.seed;
  const baseSeed =
    typeof explicit === "number" ? explicit : (recipe.seed ?? 1);
  const seed = (baseSeed ^ hashStringSeed(node.id)) >>> 0 || 1;

  // Per SL §4.1 — precompute a 4s buffer by default and loop it.
  const durationSeconds = numParam(node.params, "duration", 4);

  const buf = buildNoiseBuffer(ctx, type, seed, durationSeconds);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const startAt = voice ? voice.startTime : 0;
  src.start(startAt);
  if (voice && Number.isFinite(voice.gateSeconds)) {
    src.stop(voice.startTime + voice.gateSeconds + 4);
  }

  const built: BuiltNode = {
    output: src,
    dispose() {
      try { src.stop(); } catch { /* already stopped */ }
      src.disconnect();
    },
  };
  return built;
};
