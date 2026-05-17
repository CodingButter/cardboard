/**
 * `filter` op — `BiquadFilterNode` wrapper.
 *
 * SOUND_LAB.md §4.2. SL2 ships the four core types (lpf/hpf/bpf/notch)
 * plus the shelves/peaking that BiquadFilterNode supports natively.
 * `drive` (a pre-filter waveshaper for synth-lead character) is a
 * SL4+ feature; for SL2 it's accepted but ignored.
 *
 * Modulation routes target `cutoff` (mapped to BiquadFilterNode's
 * `frequency`), `Q`, and `gain` (shelf/peaking gain in dB).
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam, strParam } from "./OpFactory";

const TYPE_MAP: Record<string, BiquadFilterType> = {
  lpf: "lowpass",
  lowpass: "lowpass",
  hpf: "highpass",
  highpass: "highpass",
  bpf: "bandpass",
  bandpass: "bandpass",
  notch: "notch",
  allpass: "allpass",
  lowshelf: "lowshelf",
  highshelf: "highshelf",
  peaking: "peaking",
};

export const filter: OpFactory = (ctx, node) => {
  const filt = ctx.createBiquadFilter();
  filt.type = TYPE_MAP[strParam(node.params, "type", "lpf")] ?? "lowpass";
  filt.frequency.value = numParam(node.params, "cutoff", 800);
  filt.Q.value = numParam(node.params, "Q", 1);
  filt.gain.value = numParam(node.params, "gain", 0);

  const built: BuiltNode = {
    output: filt,
    inputAt() { return filt; },
    paramAt(name) {
      if (name === "cutoff" || name === "frequency") return filt.frequency;
      if (name === "Q") return filt.Q;
      if (name === "gain") return filt.gain;
      if (name === "detune") return filt.detune;
      return undefined;
    },
    dispose() {
      filt.disconnect();
    },
  };
  return built;
};
