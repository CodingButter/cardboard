/**
 * `lfo` op — sub-audio-rate `OscillatorNode` + scaling `GainNode`.
 *
 * SOUND_LAB.md §4.3. The LFO's output is a control signal (not
 * routed to speakers directly) — authors wire it into a target
 * AudioParam via the recipe's `modulation` array. The `depth` param
 * sets how much the LFO contributes; Web Audio sums modulator
 * signals into the target param at audio rate.
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam, strParam } from "./OpFactory";

const WAVE_MAP: Record<string, OscillatorType> = {
  sine: "sine",
  saw: "sawtooth",
  sawtooth: "sawtooth",
  square: "square",
  triangle: "triangle",
};

export const lfo: OpFactory = (ctx, node, _recipe, voice) => {
  const osc = ctx.createOscillator();
  osc.type = WAVE_MAP[strParam(node.params, "type", "sine")] ?? "sine";
  osc.frequency.value = numParam(node.params, "frequency", 1);

  const scaler = ctx.createGain();
  scaler.gain.value = numParam(node.params, "depth", 1);
  osc.connect(scaler);

  const startAt = voice ? voice.startTime : 0;
  osc.start(startAt);
  if (voice && Number.isFinite(voice.gateSeconds)) {
    osc.stop(voice.startTime + voice.gateSeconds + 4);
  }

  const built: BuiltNode = {
    output: scaler,
    paramAt(name) {
      if (name === "frequency") return osc.frequency;
      if (name === "depth" || name === "gain") return scaler.gain;
      return undefined;
    },
    dispose() {
      try { osc.stop(); } catch { /* already stopped */ }
      osc.disconnect();
      scaler.disconnect();
    },
  };
  return built;
};
