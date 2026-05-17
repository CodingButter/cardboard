/**
 * `delay` op — `DelayNode` with feedback + optional tone filter.
 *
 * SOUND_LAB.md §4.2. Topology:
 *
 *   input → dry → out
 *           ↓
 *       delayNode → feedback gain → feedback filter (LPF) → delayNode (loop)
 *           ↓
 *         wet gain → out
 *
 * Input port is the `dry` sum node; output is the post-wet sum node.
 * `feedbackFilter` defaults to 8 kHz (a gentle high-cut on the
 * feedback path so repeated taps decay naturally).
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam } from "./OpFactory";

export const delay: OpFactory = (ctx, node) => {
  const time = Math.max(0, numParam(node.params, "time", 0.25));
  const feedback = Math.max(0, Math.min(0.99, numParam(node.params, "feedback", 0.3)));
  const wet = Math.max(0, numParam(node.params, "wet", 0.5));
  const feedbackFilter = numParam(node.params, "feedbackFilter", 8000);

  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  const delayNode = ctx.createDelay(Math.max(0.1, time * 2 + 0.5));
  delayNode.delayTime.value = time;

  const fbGain = ctx.createGain();
  fbGain.gain.value = feedback;
  const fbFilter = ctx.createBiquadFilter();
  fbFilter.type = "lowpass";
  fbFilter.frequency.value = feedbackFilter;

  const wetGain = ctx.createGain();
  wetGain.gain.value = wet;

  // Dry path.
  inGain.connect(outGain);
  // Delay tap.
  inGain.connect(delayNode);
  delayNode.connect(wetGain);
  wetGain.connect(outGain);
  // Feedback loop.
  delayNode.connect(fbFilter);
  fbFilter.connect(fbGain);
  fbGain.connect(delayNode);

  const built: BuiltNode = {
    output: outGain,
    inputAt() { return inGain; },
    paramAt(name) {
      if (name === "time" || name === "delayTime") return delayNode.delayTime;
      if (name === "feedback") return fbGain.gain;
      if (name === "wet") return wetGain.gain;
      if (name === "feedbackFilter") return fbFilter.frequency;
      return undefined;
    },
    dispose() {
      inGain.disconnect();
      outGain.disconnect();
      delayNode.disconnect();
      fbGain.disconnect();
      fbFilter.disconnect();
      wetGain.disconnect();
    },
  };
  return built;
};
