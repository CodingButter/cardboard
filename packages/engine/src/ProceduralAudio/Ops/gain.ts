/**
 * `gain` op — single `GainNode`. The default "VCA" op in cardboard's
 * Sound Lab: an envelope or LFO modulates the gain to amplitude-shape
 * an oscillator or noise source. See SOUND_LAB.md §4.4.
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam } from "./OpFactory";

export const gain: OpFactory = (ctx, node) => {
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
