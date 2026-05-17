/**
 * `output` op — terminal node. Exactly one per recipe; the compiler
 * connects its output to the OfflineAudioContext destination (static
 * + loop) or the engine's group gain (instrument). SOUND_LAB.md §4.4.
 *
 * Implemented as a passthrough GainNode so authors can dial overall
 * level via the `gain` param without inserting a separate `gain` op.
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam } from "./OpFactory";

export const output: OpFactory = (ctx, node) => {
  const g = ctx.createGain();
  g.gain.value = numParam(node.params, "gain", 1);
  const built: BuiltNode = {
    output: g,
    inputAt() { return g; },
    paramAt(name) {
      if (name === "gain") return g.gain;
      return undefined;
    },
    dispose() {
      g.disconnect();
    },
  };
  return built;
};
