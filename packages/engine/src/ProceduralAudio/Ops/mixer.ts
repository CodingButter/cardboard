/**
 * `mixer` op — N-input GainNode summer. All inputs connect through
 * the same node (Web Audio sums automatically); the mixer's own
 * `gain` param scales the result.
 *
 * SOUND_LAB.md §4.4. SL2 does not implement per-input gains
 * (`inputGains: number[]`); SL4+ ships that via per-input scaling
 * GainNodes attached at compile time.
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam } from "./OpFactory";

export const mixer: OpFactory = (ctx, node) => {
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
