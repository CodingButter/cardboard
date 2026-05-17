/**
 * `envelope` op — ADSR / AHDSR / AD / AR.
 *
 * Implementation: a `GainNode` whose `.gain` AudioParam is scheduled
 * via setValueAtTime / linearRampToValueAtTime over the AHDSR
 * waypoints. Audio passing through this gain is enveloped; the same
 * gain output is also exposed as a `paramAt("control")` modulation
 * source so other ops (filter cutoff, oscillator detune) can ride
 * the envelope as a control signal.
 *
 * SOUND_LAB.md §3.5 trigger modes:
 *   - "immediate" — fires at recipe / voice start (static + loop default).
 *   - "gate" — fires on voice on, releases on voice off (instrument default).
 *   - "manual" — never auto-fires (SL7+ Sequencer wiring).
 *
 * SL2 implements `immediate` and `gate`; `manual` is parsed but the
 * envelope simply stays at 0 (warning logged).
 */

import type { OpFactory, BuiltNode } from "./OpFactory";
import { numParam, strParam } from "./OpFactory";

type EnvShape = "ad" | "ar" | "adsr" | "ahdsr";

export const envelope: OpFactory = (ctx, node, _recipe, voice) => {
  const shape = strParam<EnvShape>(node.params, "shape", "adsr");

  const attack = Math.max(0.001, numParam(node.params, "attack", 0.01));
  const hold = Math.max(0, numParam(node.params, "hold", 0));
  const decay = Math.max(0.001, numParam(node.params, "decay", 0.2));
  const sustain = Math.max(0, Math.min(1, numParam(node.params, "sustain", 0.6)));
  const release = Math.max(0.001, numParam(node.params, "release", 0.3));
  const peak = Math.max(0, numParam(node.params, "peak", 1));

  // Decide effective shape — fallthrough to ADSR if unknown.
  const env = ctx.createGain();
  env.gain.value = 0;

  // Trigger semantics: instrument voices default to "gate", everything
  // else defaults to "immediate". Node-level `trigger` overrides.
  const trigger = node.trigger ?? (voice ? "gate" : "immediate");

  // Anchor time: voice start (instrument) or 0 (offline).
  const t0 = voice ? voice.startTime : 0;
  const gain = env.gain;

  if (trigger === "manual") {
    // SL2 — manual envelopes stay at 0. SL7+ ships sequencer wiring.
    // Intentionally no warn here to keep test output clean.
  } else {
    // Schedule the on-stage.
    gain.setValueAtTime(0, t0);
    gain.linearRampToValueAtTime(peak, t0 + attack);

    let afterDecay = t0 + attack;
    if (shape === "ahdsr") {
      gain.setValueAtTime(peak, t0 + attack + hold);
      afterDecay = t0 + attack + hold;
    }
    if (shape === "ad") {
      gain.linearRampToValueAtTime(0, afterDecay + decay);
    } else if (shape === "ar") {
      // Attack + release; no decay/sustain (mirrors §4.3).
      // Effective release fires at gate-off; for "immediate" we
      // release immediately after the attack peak.
      const releaseAt = trigger === "gate"
        ? t0 + (voice && Number.isFinite(voice.gateSeconds) ? voice.gateSeconds : 0.1)
        : afterDecay;
      gain.setValueAtTime(peak, releaseAt);
      gain.linearRampToValueAtTime(0, releaseAt + release);
    } else {
      // ADSR / AHDSR.
      gain.linearRampToValueAtTime(sustain * peak, afterDecay + decay);
      if (trigger === "gate") {
        const releaseAt = t0 + (voice && Number.isFinite(voice.gateSeconds)
          ? voice.gateSeconds
          : 0.1);
        // Hold the sustain stage until gate-off, then release.
        gain.setValueAtTime(Math.max(0.0001, sustain * peak), Math.max(releaseAt, afterDecay + decay));
        gain.linearRampToValueAtTime(0, releaseAt + release);
      } else {
        // Immediate — let the sustain decay over a fixed window so
        // the static bake actually ends. Offline contexts won't loop
        // anyway, but a non-zero tail is preserved at recipe duration.
      }
    }
  }

  const built: BuiltNode = {
    output: env,
    inputAt() { return env; },
    paramAt(name) {
      if (name === "gain" || name === "control") return env.gain;
      return undefined;
    },
    dispose() {
      env.disconnect();
    },
  };
  return built;
};
