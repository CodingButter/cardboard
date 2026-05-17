/**
 * `pan` op — `StereoPannerNode`. SOUND_LAB.md §4.4.
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam } from "./OpFactory";

export const pan: OpFactory = (ctx, node) => {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, numParam(node.params, "pan", 0)));
  const built: BuiltNode = {
    output: p,
    inputAt() { return p; },
    paramAt(name) {
      if (name === "pan") return p.pan;
      return undefined;
    },
    dispose() {
      p.disconnect();
    },
  };
  return built;
};
