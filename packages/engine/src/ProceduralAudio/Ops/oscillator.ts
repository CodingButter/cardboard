/**
 * `oscillator` op — `OscillatorNode` wrapper.
 *
 * SL2 supports `sine | saw | pulse | triangle`. Web Audio's native
 * `OscillatorNode.type` covers sine/sawtooth/triangle directly;
 * `pulse` (variable duty cycle) is a SL4+ feature (per SOUND_LAB.md
 * §4.1) and falls through to `square` for SL2.
 *
 * Per SOUND_LAB.md §3.5, instrument-mode recipes can override an
 * oscillator's `frequency` per voice — toggled by `voiceNote: true`
 * in the op's params. Voices forward `opts.frequency` into the param.
 *
 * Modulation routes target `frequency` or `detune`. Both are
 * `AudioParam`s with `connect(audioParam)` support.
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam, strParam, boolParam } from "./OpFactory";

const WAVE_MAP: Record<string, OscillatorType> = {
  sine: "sine",
  saw: "sawtooth",
  sawtooth: "sawtooth",
  square: "square",
  pulse: "square", // SL2 — pulse-width modulation in SL4+
  triangle: "triangle",
};

export const oscillator: OpFactory = (ctx, node, _recipe, voice) => {
  const osc = ctx.createOscillator();
  const type = strParam(node.params, "type", "sine");
  osc.type = WAVE_MAP[type] ?? "sine";

  const freqBase = numParam(node.params, "frequency", 440);
  const voiceNote = boolParam(node.params, "voiceNote", false);
  const freq = voiceNote && voice?.opts.frequency ? voice.opts.frequency : freqBase;
  osc.frequency.value = freq;
  osc.detune.value = numParam(node.params, "detune", 0);

  // Schedule start. For offline contexts this lands during render;
  // for live contexts it starts at the voice's onset time.
  const startAt = voice ? voice.startTime : 0;
  osc.start(startAt);

  // Voices may carry a finite gate — schedule a stop so the node
  // GCs cleanly after the envelope's release tail. Static + loop
  // bakes (no voice) let the OfflineAudioContext terminate.
  if (voice && Number.isFinite(voice.gateSeconds)) {
    osc.stop(voice.startTime + voice.gateSeconds + 4); // +4s release headroom
  }

  const built: BuiltNode = {
    output: osc,
    paramAt(name: string) {
      if (name === "frequency") return osc.frequency;
      if (name === "detune") return osc.detune;
      return undefined;
    },
    dispose() {
      try { osc.stop(); } catch { /* already stopped */ }
      osc.disconnect();
    },
  };
  return built;
};
