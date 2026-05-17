/**
 * `reverb` op — `ConvolverNode` with a procedural impulse response.
 *
 * SOUND_LAB.md §4.2 hints at a future built-in IR library
 * ("small_room", "medium_room", "large_hall", "plate", "spring") plus
 * a `custom` slot for Source-Files-supplied IRs. For SL2 we synthesise
 * an exponentially-decaying noise IR — cheap to generate, audibly
 * reverby, fully deterministic via the seeded RNG.
 *
 * Topology:
 *
 *   input → dry → outGain
 *         → convolver → wetGain → outGain
 *
 * Plus an output gain so authors can dial back when reverb stacking.
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam, strParam } from "./OpFactory";
import { buildReverbImpulse } from "../WaveTables";
import { hashStringSeed } from "../Rng";

// Named-IR shorthand parameters (seconds-to-decay + pre-delay).
const PRESETS: Record<string, { decay: number; preDelay: number }> = {
  small_room: { decay: 0.5, preDelay: 0.005 },
  medium_room: { decay: 1.2, preDelay: 0.01 },
  large_hall: { decay: 3.5, preDelay: 0.04 },
  plate: { decay: 1.5, preDelay: 0.0 },
  spring: { decay: 0.8, preDelay: 0.02 },
};

export const reverb: OpFactory = (ctx, node, recipe) => {
  const impulse = strParam(node.params, "impulse", "medium_room");
  const wet = Math.max(0, Math.min(1, numParam(node.params, "wet", 0.4)));
  const preset = PRESETS[impulse] ?? PRESETS.medium_room!;
  const decay = numParam(node.params, "decay", preset.decay);
  const preDelay = numParam(node.params, "preDelay", preset.preDelay);

  const seed = (recipe.seed ?? 1) ^ hashStringSeed(`${node.id}:reverb`) >>> 0 || 1;
  const buf = buildReverbImpulse(ctx, seed, Math.max(0.1, decay + 0.1), decay, preDelay);

  const convolver = ctx.createConvolver();
  convolver.buffer = buf;

  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  const wetGain = ctx.createGain();
  wetGain.gain.value = wet;
  // Dry mix sits at unity; authors can dial back via the output gain
  // or a follow-up gain op if needed.
  const dryGain = ctx.createGain();
  dryGain.gain.value = 1 - wet;

  inGain.connect(dryGain).connect(outGain);
  inGain.connect(convolver).connect(wetGain).connect(outGain);

  const built: BuiltNode = {
    output: outGain,
    inputAt() { return inGain; },
    paramAt(name) {
      if (name === "wet") return wetGain.gain;
      if (name === "dry") return dryGain.gain;
      return undefined;
    },
    dispose() {
      inGain.disconnect();
      dryGain.disconnect();
      convolver.disconnect();
      wetGain.disconnect();
      outGain.disconnect();
    },
  };
  return built;
};
